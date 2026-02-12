
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { marketDataService } from './marketDataService.js'; 
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

                    vacancy: Number(data.vacancy) || 0,
                    capRate: Number(data.capRate) || 0,
                    qtdImoveis: Number(data.qtdImoveis) || 0,

                    sector: finalSector, 
                    lastAnalysisDate: timestamp,
                    updatedAt: timestamp
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
            const assetsForExternal = await MarketAsset.find({ 
                type: { $in: ['CRYPTO', 'STOCK_US'] } 
            }).select('ticker type');

            if (assetsForExternal.length > 0) {
                const tickersToFetch = assetsForExternal.map(a => a.ticker);
                const quotes = await externalMarketService.getQuotes(tickersToFetch);
                
                quotes.forEach(quote => {
                    operations.push({
                        updateOne: {
                            filter: { ticker: quote.ticker },
                            update: {
                                $set: {
                                    lastPrice: quote.price,
                                    change: quote.change,
                                    updatedAt: timestamp
                                }
                            }
                        }
                    });
                });
            }

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
                    const t = op.updateOne.filter.ticker;
                    const update = op.updateOne.update.$set;
                    if (update.liquidity > MIN_LIQUIDITY_FOR_LIVE_QUOTE) {
                        validTickers.push(t);
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
