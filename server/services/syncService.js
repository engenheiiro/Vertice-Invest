
import YahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { marketDataService } from './marketDataService.js';
import { usStocksFundamentalsService } from './usStocksFundamentalsService.js';
import { resolveSector, deriveFiiSubType } from '../utils/sectorResolver.js';
import { backfillSectors } from './sectorBackfillService.js';
import { classifyUsAsset } from '../utils/usClassification.js';
import { appendSnapshots } from './fundamentalHistoryService.js';
import {
    createFundamentusStats,
    finalizeFundamentusStats,
    validateFundamentusIngestion,
} from '../utils/ingestionHealth.js';

const yahooFinanceLTM = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const LTM_BATCH_SIZE = 10;
const LTM_BATCH_DELAY_MS = 400;
const LTM_TICKER_TIMEOUT_MS = 8000;

async function fetchYahooLTM(ticker) {
    try {
        const data = await Promise.race([
            yahooFinanceLTM.quoteSummary(`${ticker}.SA`, {
                modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail']
            }, { validateResult: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LTM_TICKER_TIMEOUT_MS))
        ]);
        const fd = data.financialData || {};
        const ks = data.defaultKeyStatistics || {};
        const sd = data.summaryDetail || {};
        const shares = ks.sharesOutstanding || 0;
        return {
            marketCap: sd.marketCap || null,
            netRevenue: fd.totalRevenue || null,
            netIncome: fd.netIncomeToCommon || null,
            netDebt: (fd.totalDebt && fd.totalCash != null) ? (fd.totalDebt - fd.totalCash) : null,
            patrimLiq: (ks.bookValue && shares) ? ks.bookValue * shares : null,
        };
    } catch {
        return null;
    }
}

async function enrichBRStocksLTM() {
    // Só enriquece ativos STOCK BR (sem sufixo .SA no banco, mas com sufixo na busca)
    // onde algum campo LTM ainda é zero ou ausente.
    const candidates = await MarketAsset.find({
        type: 'STOCK',
        $or: [{ netRevenue: { $in: [0, null] } }, { netIncome: { $in: [0, null] } }]
    }).select('ticker netRevenue netIncome netDebt patrimLiq marketCap').lean();

    if (candidates.length === 0) return;

    logger.info(`ℹ️ [Sync] Etapa 4.5: Enriquecendo LTM de ${candidates.length} ações BR via Yahoo Finance...`);
    const bulkOps = [];

    for (let i = 0; i < candidates.length; i += LTM_BATCH_SIZE) {
        const batch = candidates.slice(i, i + LTM_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(a => fetchYahooLTM(a.ticker)));

        for (let j = 0; j < results.length; j++) {
            if (results[j].status !== 'fulfilled' || !results[j].value) continue;
            const asset = batch[j];
            const ltm = results[j].value;
            const $set = {};
            // Só atualiza o campo se ainda estava zerado/ausente E o Yahoo retornou valor
            if ((!asset.marketCap) && ltm.marketCap) $set.marketCap = ltm.marketCap;
            if ((!asset.netRevenue) && ltm.netRevenue) $set.netRevenue = ltm.netRevenue;
            if ((!asset.netIncome) && ltm.netIncome) $set.netIncome = ltm.netIncome;
            if ((!asset.netDebt && asset.netDebt !== 0) && ltm.netDebt != null) $set.netDebt = ltm.netDebt;
            if ((!asset.patrimLiq) && ltm.patrimLiq) $set.patrimLiq = ltm.patrimLiq;
            if (Object.keys($set).length > 0) {
                bulkOps.push({ updateOne: { filter: { ticker: asset.ticker }, update: { $set } } });
            }
        }

        if (i + LTM_BATCH_SIZE < candidates.length) {
            await new Promise(r => setTimeout(r, LTM_BATCH_DELAY_MS));
        }
    }

    if (bulkOps.length > 0) {
        await MarketAsset.bulkWrite(bulkOps);
        logger.info(`✅ [Sync] Etapa 4.5: LTM enriquecido para ${bulkOps.length} ações BR.`);
    } else {
        logger.info(`ℹ️ [Sync] Etapa 4.5: Nenhum campo LTM novo encontrado via Yahoo Finance.`);
    }
}

// Mapa de Correção de Erros da Fonte Externa (Fundamentus/Scraping)
const KNOWN_TYPOS = {
    'CPLEE5': 'CPLE6',   // Copel PNB
    'AZULL4': 'AZUL4',   // Azul PN
    'CVBII11': 'CVBI11', // VBI CRI
    'MALLL11': 'MALL11', // Malls Brasil
    'QAGRR11': 'QAGR11', // Quasar Agro
    'JPSA3': 'IGTI3',    // Jereissati -> Iguatemi (Rebranding antigo não atualizado na fonte)
    'RBHG11': 'RBRL11',  // Frequente confusão na fonte
    'BLMO11': 'BLMG11'   // BlueMacaw Log
};

export const syncService = {
    /**
     * Orquestrador Principal de Sincronização.
     */
    async performFullSync() {
        try {
            logger.info("ℹ️ [Sync] Etapa 1: Macroeconomia");
            await macroDataService.performMacroSync();

            logger.info("ℹ️ [Sync] Etapa 2: Fundamentos (Scraping)");
            const operations = [];
            // (Fase 3) Leituras de fundamentos a anexar na série temporal (track record).
            const snapshotRecords = [];
            const timestamp = new Date();

            const stocksMap = await fundamentusService.getStocksMap();
            const fiiMap = await fundamentusService.getFIIsMap();
            const ingestionStats = createFundamentusStats({
                stockParsed: stocksMap.size,
                fiiParsed: fiiMap.size,
            });
            
            const isScrapingFailed = stocksMap.size === 0 && fiiMap.size === 0;

            if (isScrapingFailed) {
                const stats = finalizeFundamentusStats(ingestionStats);
                await SystemConfig.findOneAndUpdate(
                    { key: 'MACRO_INDICATORS' },
                    { $set: { lastSyncStats: {
                        typosFixed: 0,
                        assetsProcessed: 0,
                        fundamentalsHealthy: false,
                        errorCode: 'FUNDAMENTUS_BLOCKED',
                        fundamentals: stats,
                        timestamp,
                    } } },
                    { upsert: true },
                );
                return { success: false, error: "Scraping blocked.", errorCode: 'FUNDAMENTUS_BLOCKED', fundamentals: stats };
            }

            const processedTickers = new Set();
            let typosFixedCount = 0; // Contador para Monitor de Qualidade

            const pushOp = (rawTicker, data, type) => {
                const classStats = ingestionStats[type];
                // 1. CAMADA DE SANITIZAÇÃO (CORREÇÃO DE TYPOS)
                let ticker = rawTicker;
                if (KNOWN_TYPOS[rawTicker]) {
                    ticker = KNOWN_TYPOS[rawTicker];
                    typosFixedCount++;
                }

                // 2. FILTRO DE DUPLICIDADE PÓS-CORREÇÃO
                if (processedTickers.has(ticker)) {
                    classStats.duplicates++;
                    return;
                }
                processedTickers.add(ticker);

                const liquidity = Number(data.liq2m) || Number(data.liquidity) || 0;
                
                // Filtro de liquidez mínima para não sujar o banco com lixo
                if (liquidity < 5000) {
                    classStats.rejectedLowLiquidity++;
                    return;
                }
                classStats.accepted++;

                // Resolução resiliente: override exato → override por base (ações)
                // → setor do scraping (FIIs) → default por tipo.
                const finalSector = resolveSector({ ticker, type, scrapedSector: data.sector });

                const updateFields = {
                    lastPrice: Number(data.price) || 0,
                    dy: Number(data.dy) || 0,
                    p_vp: Number(data.pvp) || 0,
                    liquidity: liquidity,

                    pl: Number(data.pl) || 0,
                    roe: Number(data.roe) || 0,
                    roic: Number(data.roic) || 0,
                    netMargin: Number(data.netMargin) || 0,
                    evEbitda: Number(data.evEbitda) || 0,
                    revenueGrowth: Number(data.cresRec5a) || 0,
                    debtToEquity: Number(data.debtToEquity ?? data.divBrutaPatrim) || 0,

                    vacancy: Number(data.vacancy) || 0,
                    capRate: Number(data.capRate) || 0,
                    qtdImoveis: Number(data.qtdImoveis) || 0,

                    sector: finalSector,
                    fiiSubType: type === 'FII' ? deriveFiiSubType(finalSector) : null,
                    lastFundamentalsDate: timestamp,
                    lastAnalysisDate: timestamp,
                    updatedAt: timestamp,

                    // Se o Fundamentus tem dados, o ativo está vivo. Reseta falhas.
                    isActive: true,
                    failCount: 0
                };

                // Financials LTM derivados (engenharia reversa): 0 = não foi possível
                // calcular. Carry-forward — só sobrescreve quando o novo valor é
                // significativo, evitando que um scrape parcial zere dados bons
                // (corrige lacunas intermitentes no modal "Financials (LTM)").
                const ltmFields = {
                    marketCap: Number(data.marketCap) || 0,
                    netDebt: Number(data.netDebt) || 0,
                    netRevenue: Number(data.netRevenue) || 0,
                    netIncome: Number(data.netIncome) || 0,
                    totalAssets: Number(data.totalAssets) || 0,
                    patrimLiq: Number(data.patrimLiq) || 0,
                    payout: Number(data.payout) || 0,
                };
                for (const [k, v] of Object.entries(ltmFields)) {
                    if (v !== 0) updateFields[k] = v;
                }

                operations.push({
                    updateOne: {
                        filter: { ticker: ticker },
                        update: {
                            $set: updateFields,
                            $setOnInsert: {
                                name: ticker, // Usa o ticker como nome se não tiver outro
                                type,
                                currency: 'BRL',
                                isIgnored: false,
                                isBlacklisted: false
                            }
                        },
                        upsert: true
                    }
                });

                // (Fase 3) Coleta a leitura de fundamentos para a série temporal (track record).
                // payout vem por carry-forward em ltmFields; aqui usamos o dado bruto do scrape.
                snapshotRecords.push({
                    ticker,
                    type,
                    roe: updateFields.roe,
                    netMargin: updateFields.netMargin,
                    payout: Number(data.payout) || 0,
                    dy: updateFields.dy,
                    revenueGrowth: updateFields.revenueGrowth,
                    pl: updateFields.pl,
                });
            };

            if (stocksMap.size > 0) stocksMap.forEach((v, k) => pushOp(k, v, 'STOCK'));
            if (fiiMap.size > 0) fiiMap.forEach((v, k) => pushOp(k, v, 'FII'));

            // Fail closed antes de qualquer bulkWrite: uma queda abrupta na taxa
            // parseado→aceito indica layout deslocado ou fonte parcial. Não mistura
            // operações externas no denominador e não persiste fundamentos suspeitos.
            const ingestionHealth = validateFundamentusIngestion(ingestionStats);
            if (!ingestionHealth.ok) {
                logger.error(`❌ [Sync] Fundamentos degradados: ${ingestionHealth.reason}`, {
                    errorCode: ingestionHealth.code,
                    fundamentals: ingestionHealth.stats,
                });
                await SystemConfig.findOneAndUpdate(
                    { key: 'MACRO_INDICATORS' },
                    { $set: { lastSyncStats: {
                        typosFixed: typosFixedCount,
                        assetsProcessed: 0,
                        fundamentalsHealthy: false,
                        errorCode: ingestionHealth.code,
                        fundamentals: ingestionHealth.stats,
                        timestamp,
                    } } },
                    { upsert: true },
                );
                return {
                    success: false,
                    error: ingestionHealth.reason,
                    errorCode: ingestionHealth.code,
                    fundamentals: ingestionHealth.stats,
                };
            }

            // 3. Atualiza Ativos Internacionais e Cripto
            // isActive filter: ativos delistados já desativados pela blacklist dinâmica
            // não devem ser re-cotados aqui (a reativação tem varredura própria). Sem
            // isto, tickers mortos (SGEN, ABC, MRO...) eram tentados todo sync.
            let assetsForExternal = await MarketAsset.find({
                type: { $in: ['CRYPTO', 'STOCK_US'] },
                isActive: { $ne: false }
            }).select('ticker type failCount lastFailDate marketCap liquidity');

            logger.info("ℹ️ [Sync] Verificando/Seeding default cryptocurrencies...");
            const defaultCryptos = [
                'BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'USDC', 'XRP', 'DOGE', 'TON', 'ADA',
                'SHIB', 'AVAX', 'TRX', 'DOT', 'BCH', 'LINK', 'MATIC', 'NEAR', 'LTC', 'ICP',
                'LEO', 'DAI', 'UNI', 'APT', 'STX', 'ETC', 'MNT', 'FIL', 'RNDR', 'ARB',
                'XMR', 'OKB', 'IMX', 'KAS', 'XLM', 'INJ', 'VET', 'FDUSD', 'OP', 'GRT',
                'TAO', 'THETA', 'MKR', 'CRO', 'FET', 'LDO', 'ALGO', 'RUNE', 'AAVE', 'BSV'
            ];
            
            const existingCryptos = new Set(assetsForExternal.filter(a => a.type === 'CRYPTO').map(a => a.ticker));
            
            for (const ticker of defaultCryptos) {
                operations.push({
                    updateOne: {
                        filter: { ticker },
                        update: {
                            $setOnInsert: {
                                name: ticker,
                                type: 'CRYPTO',
                                currency: 'USD',
                                sector: 'Criptomoeda',
                                isIgnored: false,
                                isBlacklisted: false
                            }
                        },
                        upsert: true
                    }
                });
                
                if (!existingCryptos.has(ticker)) {
                    assetsForExternal.push({ ticker, type: 'CRYPTO' });
                }
            }

            if (assetsForExternal.length > 0) {
                const tickersToFetch = assetsForExternal
                    .map(a => a.ticker)
                    .filter(t => typeof t === 'string' && t.trim().length > 0);
                const quotes = await externalMarketService.getQuotes(tickersToFetch);

                const successfulTickers = new Set(
                    quotes.filter(q => q.price > 0).map(q => q.ticker)
                );

                // Blacklist dinâmica no path Exterior/Cripto: tickers que falharam em
                // Yahoo E Google ganham failCount (1/dia) e são desativados ao atingir o
                // teto. Reusa a mesma regra de marketDataService — tickers throttlados
                // se recuperam (reset no sucesso), delistados acumulam e somem do sync.
                const failureOps = marketDataService.buildQuoteFailureOps(assetsForExternal, successfulTickers);
                if (failureOps.length > 0) operations.push(...failureOps);

                quotes.forEach(quote => {
                    const updateData = {
                        lastPrice: quote.price,
                        change: quote.change,
                        updatedAt: timestamp,
                        isActive: true,
                        failCount: 0
                    };
                    
                    if (quote.marketCap) updateData.marketCap = quote.marketCap;
                    if (quote.volume) updateData.liquidity = quote.volume;

                    operations.push({
                        updateOne: {
                            filter: { ticker: quote.ticker },
                            update: {
                                $set: updateData
                            }
                        }
                    });
                });
            }

            // Etapa 3.5: Seed inicial S&P 500 + ETFs nacionais (cria registros se não existirem)
            logger.info("ℹ️ [Sync] Etapa 3.5: Seed S&P 500 + ETFs nacionais (se necessário)");
            await usStocksFundamentalsService.seedSP500Assets();
            await usStocksFundamentalsService.seedBrEtfAssets();

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);

                // (Fase 3) Anexa a leitura mensal de fundamentos à série temporal (track record).
                // Idempotente por mês; falha aqui não pode derrubar o sync.
                try {
                    const snap = await appendSnapshots(snapshotRecords, timestamp);
                    if (snap.appended > 0) logger.info(`🗂️ [Sync] Snapshots de fundamentos atualizados: ${snap.appended}`);
                } catch (err) {
                    logger.error(`❌ [Sync] Append de snapshots de fundamentos falhou: ${err.message}`);
                }

                // Backfill de setores: corrige setores incorretos/ausentes em
                // TODO o acervo (inclusive ativos fora do scraping). Idempotente.
                try {
                    const bf = await backfillSectors();
                    if (bf.updated > 0) logger.info(`🩹 [Sync] Setores corrigidos no backfill: ${bf.updated}`);
                } catch (err) {
                    logger.error(`❌ [Sync] Backfill de setores falhou: ${err.message}`);
                }

                // Backfill de sub-tipo de Exterior (STOCK_US): STOCK | ETF | REIT | DOLLAR.
                // Idempotente; só grava quando a classificação heurística muda. O sub-tipo
                // alimenta os sub-filtros do Research e o viés por sub-meta do rebalance (PR3).
                try {
                    const usAssets = await MarketAsset.find({ type: 'STOCK_US' })
                        .select('ticker sector name currency usSubType type').lean();
                    const usOps = [];
                    for (const a of usAssets) {
                        const sub = classifyUsAsset({
                            ticker: a.ticker, sector: a.sector, type: a.type,
                            currency: a.currency, name: a.name,
                        });
                        if (sub && sub !== a.usSubType) {
                            usOps.push({ updateOne: { filter: { ticker: a.ticker }, update: { $set: { usSubType: sub } } } });
                        }
                    }
                    if (usOps.length > 0) {
                        await MarketAsset.bulkWrite(usOps);
                        logger.info(`🩹 [Sync] Sub-tipos de Exterior classificados: ${usOps.length}`);
                    }
                } catch (err) {
                    logger.error(`❌ [Sync] Backfill de usSubType (Exterior) falhou: ${err.message}`);
                }

                // SALVA ESTATÍSTICAS DE QUALIDADE
                await SystemConfig.findOneAndUpdate(
                    { key: 'MACRO_INDICATORS' },
                    {
                        $set: {
                            lastSyncStats: {
                                typosFixed: typosFixedCount,
                                assetsProcessed: operations.length,
                                fundamentalsHealthy: true,
                                errorCode: null,
                                fundamentals: ingestionHealth.stats,
                                timestamp: new Date()
                            }
                        }
                    },
                    { upsert: true }
                );

                logger.info(
                    `ℹ️ [Sync] Etapa 2: STOCK ${ingestionHealth.stats.STOCK.accepted}/${ingestionHealth.stats.STOCK.parsed} · ` +
                    `FII ${ingestionHealth.stats.FII.accepted}/${ingestionHealth.stats.FII.parsed} aceitos ` +
                    `(operações totais: ${operations.length}; typos: ${typosFixedCount}).`
                );

                logger.info("ℹ️ [Sync] Etapa 3: Cotações em tempo real");
                
                const validTickers = [];
                const MIN_LIQUIDITY_FOR_LIVE_QUOTE = 100000; 

                // Reconstrói a lista de validTickers baseada nos dados JÁ SANITIZADOS
                operations.forEach(op => {
                    if (op.updateOne && op.updateOne.update && op.updateOne.update.$set) {
                        const t = op.updateOne.filter.ticker;
                        const update = op.updateOne.update.$set;
                        if (update.liquidity && update.liquidity > MIN_LIQUIDITY_FOR_LIVE_QUOTE) {
                            validTickers.push(t);
                        }
                    }
                });
                
                // Batch
                const BATCH_SIZE = 50;
                // Remove duplicatas de validTickers
                const uniqueValidTickers = [...new Set(validTickers)];

                for (let i = 0; i < uniqueValidTickers.length; i += BATCH_SIZE) {
                    const batch = uniqueValidTickers.slice(i, i + BATCH_SIZE);
                    await marketDataService.refreshQuotesBatch(batch, true);
                    await new Promise(r => setTimeout(r, 200)); 
                }
                
                // Etapa 4: Fundamentals US (1x/dia via guard de tempo)
                try {
                    const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
                    const lastUSFundamentals = macroConfig?.lastUSFundamentalsSync;
                    const shouldSyncFundamentals = !lastUSFundamentals ||
                        Date.now() - new Date(lastUSFundamentals).getTime() > 23 * 60 * 60 * 1000;

                    if (shouldSyncFundamentals) {
                        logger.info("ℹ️ [Sync] Etapa 4: Fundamentals S&P 500 (sincronização diária)");
                        await usStocksFundamentalsService.syncUSStocksFundamentals();
                        // ETFs nacionais (B3) — dy/marketCap via Yahoo .SA (o seed não traz fundamentos)
                        await usStocksFundamentalsService.syncBrEtfFundamentals();
                        await SystemConfig.findOneAndUpdate(
                            { key: 'MACRO_INDICATORS' },
                            { $set: { lastUSFundamentalsSync: new Date() } },
                            { upsert: true }
                        );
                    } else {
                        logger.info("ℹ️ [Sync] Etapa 4: Fundamentals US — já sincronizados nas últimas 23h, pulando.");
                    }
                } catch (err) {
                    logger.error(`❌ [Sync] Etapa 4 falhou: ${err.message}`);
                }

                // Etapa 4.5: Enriquecimento LTM via Yahoo Finance para ações BR (1x/dia)
                try {
                    const macroConfig4 = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
                    const lastLTMEnrich = macroConfig4?.lastBRLTMEnrichSync;
                    const shouldEnrich = !lastLTMEnrich ||
                        Date.now() - new Date(lastLTMEnrich).getTime() > 23 * 60 * 60 * 1000;
                    if (shouldEnrich) {
                        await enrichBRStocksLTM();
                        await SystemConfig.findOneAndUpdate(
                            { key: 'MACRO_INDICATORS' },
                            { $set: { lastBRLTMEnrichSync: new Date() } },
                            { upsert: true }
                        );
                    } else {
                        logger.info("ℹ️ [Sync] Etapa 4.5: LTM BR — já enriquecido nas últimas 23h, pulando.");
                    }
                } catch (err) {
                    logger.error(`❌ [Sync] Etapa 4.5 falhou: ${err.message}`);
                }

                return {
                    success: true,
                    count: operations.length,
                    fundamentalsProcessed: ingestionHealth.stats.STOCK.accepted + ingestionHealth.stats.FII.accepted,
                    fundamentals: ingestionHealth.stats,
                };
            } else {
                return { success: false, count: 0, error: "Nenhum ativo válido encontrado." };
            }

        } catch (error) {
            logger.error(`❌ [Sync Interno] Falha: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};
