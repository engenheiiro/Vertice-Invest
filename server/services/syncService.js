
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { marketDataService } from './marketDataService.js'; 
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';

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

            const pushOp = (ticker, data, type) => {
                const liquidity = Number(data.liq2m) || Number(data.liquidity) || 0;
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
                                name: ticker, type, currency: 'BRL',
                                isIgnored: false, isBlacklisted: false
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
                logger.info(`ℹ️ [Sync] Etapa 2: ${operations.length} ativos fundamentados.`);
                
                logger.info("ℹ️ [Sync] Etapa 3: Cotações em tempo real");
                
                const validTickers = [];
                const MIN_LIQUIDITY_FOR_LIVE_QUOTE = 100000; 

                stocksMap.forEach((v, k) => {
                    const liq = Number(v.liq2m) || 0;
                    if (liq > MIN_LIQUIDITY_FOR_LIVE_QUOTE) validTickers.push(k);
                });
                
                fiiMap.forEach((v, k) => {
                    const liq = Number(v.liquidity) || 0;
                    if (liq > MIN_LIQUIDITY_FOR_LIVE_QUOTE) validTickers.push(k);
                });
                
                // Batch
                const BATCH_SIZE = 50;
                let updatedQuotesCount = 0;
                for (let i = 0; i < validTickers.length; i += BATCH_SIZE) {
                    const batch = validTickers.slice(i, i + BATCH_SIZE);
                    await marketDataService.refreshQuotesBatch(batch, true);
                    updatedQuotesCount += batch.length;
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
