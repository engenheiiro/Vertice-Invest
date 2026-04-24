
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { marketDataService } from './marketDataService.js';
import { usStocksFundamentalsService } from './usStocksFundamentalsService.js';
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';

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
            const timestamp = new Date();

            const stocksMap = await fundamentusService.getStocksMap();
            const fiiMap = await fundamentusService.getFIIsMap();
            
            const isScrapingFailed = stocksMap.size === 0 && fiiMap.size === 0;

            if (isScrapingFailed) {
                return { success: false, error: "Scraping blocked." };
            }

            const processedTickers = new Set();
            let typosFixedCount = 0; // Contador para Monitor de Qualidade

            const deriveFiiSubType = (sector) => {
                if (!sector) return null;
                const s = sector.toLowerCase();
                if (s.includes('papel') || s.includes('crédito') || s.includes('recebíveis') || s.includes('cri')) return 'PAPEL';
                if (s.includes('fundo de fundo') || s.includes('fof')) return 'FOF';
                if (s.includes('híbrido') || s.includes('hibrido')) return 'HIBRIDO';
                if (s.includes('desenvolvimento') || s.includes('residencial')) return 'DESENVOLVIMENTO';
                return 'TIJOLO';
            };

            const pushOp = (rawTicker, data, type) => {
                // 1. CAMADA DE SANITIZAÇÃO (CORREÇÃO DE TYPOS)
                let ticker = rawTicker;
                if (KNOWN_TYPOS[rawTicker]) {
                    ticker = KNOWN_TYPOS[rawTicker];
                    typosFixedCount++;
                }

                // 2. FILTRO DE DUPLICIDADE PÓS-CORREÇÃO
                if (processedTickers.has(ticker)) return;
                processedTickers.add(ticker);

                const liquidity = Number(data.liq2m) || Number(data.liquidity) || 0;
                
                // Filtro de liquidez mínima para não sujar o banco com lixo
                if (liquidity < 5000) return;

                let finalSector = SECTOR_OVERRIDES[ticker];
                if (!finalSector) {
                    finalSector = data.sector || 'Outros';
                }

                const updateFields = {
                    lastPrice: Number(data.price) || 0,
                    dy: Number(data.dy) || 0,
                    p_vp: Number(data.pvp) || 0,
                    marketCap: Number(data.marketCap) || 0,
                    liquidity: liquidity,
                    
                    pl: Number(data.pl) || 0,
                    roe: Number(data.roe) || 0,
                    roic: Number(data.roic) || 0,
                    netMargin: Number(data.netMargin) || 0,
                    evEbitda: Number(data.evEbitda) || 0,
                    revenueGrowth: Number(data.cresRec5a) || 0,
                    debtToEquity: Number(data.divBrutaPatrim) || 0,
                    netDebt: Number(data.netDebt) || 0,
                    payout: Number(data.payout) || 0,

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
            };

            if (stocksMap.size > 0) stocksMap.forEach((v, k) => pushOp(k, v, 'STOCK'));
            if (fiiMap.size > 0) fiiMap.forEach((v, k) => pushOp(k, v, 'FII'));

            // 3. Atualiza Ativos Internacionais e Cripto
            let assetsForExternal = await MarketAsset.find({ 
                type: { $in: ['CRYPTO', 'STOCK_US'] } 
            }).select('ticker type');

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
                const tickersToFetch = assetsForExternal.map(a => a.ticker);
                const quotes = await externalMarketService.getQuotes(tickersToFetch);
                
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

            // Etapa 3.5: Seed inicial S&P 500 (cria registros se não existirem)
            logger.info("ℹ️ [Sync] Etapa 3.5: Seed S&P 500 (se necessário)");
            await usStocksFundamentalsService.seedSP500Assets();

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);

                // SALVA ESTATÍSTICAS DE QUALIDADE
                await SystemConfig.findOneAndUpdate(
                    { key: 'MACRO_INDICATORS' },
                    {
                        $set: {
                            lastSyncStats: {
                                typosFixed: typosFixedCount,
                                assetsProcessed: operations.length,
                                timestamp: new Date()
                            }
                        }
                    },
                    { upsert: true }
                );

                logger.info(`ℹ️ [Sync] Etapa 2: ${operations.length} ativos fundamentados (Typos corrigidos: ${typosFixedCount}).`);

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

                return { success: true, count: operations.length };
            } else {
                return { success: false, count: 0, error: "Nenhum ativo válido encontrado." };
            }

        } catch (error) {
            logger.error(`❌ [Sync Interno] Falha: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};