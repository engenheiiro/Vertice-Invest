
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';

export const syncService = {
    /**
     * Orquestrador Principal de Sincronização.
     */
    async performFullSync() {
        try {
            logger.info("🔄 [SYNC-ENGINE] Iniciando rotina de atualização massiva...");
            
            // 1. Atualiza dados Macro
            await macroDataService.performMacroSync();

            const operations = [];
            const timestamp = new Date();

            // 2. Scraping Principal
            const stocksMap = await fundamentusService.getStocksMap();
            const fiiMap = await fundamentusService.getFIIsMap();
            
            const isScrapingFailed = stocksMap.size === 0 && fiiMap.size === 0;

            if (isScrapingFailed) {
                logger.error("❌ ERRO CRÍTICO: Scraping falhou totalmente (Bloqueio ou Site Offline). Abortando atualização de Ações/FIIs.");
                return { success: false, error: "Scraping blocked (403/Timeout)." };
            }

            const pushOp = (ticker, data, type) => {
                let finalSector = SECTOR_OVERRIDES[ticker];
                if (!finalSector) {
                    finalSector = data.sector || 'Outros';
                }

                // Mapeamento Seguro de Dados (Garante persistência de todos os campos)
                const updateFields = {
                    lastPrice: Number(data.price) || 0,
                    dy: Number(data.dy) || 0,
                    p_vp: Number(data.pvp) || 0,
                    marketCap: Number(data.marketCap) || 0,
                    liquidity: Number(data.liq2m) || Number(data.liquidity) || 0,
                    
                    // Stocks
                    pl: Number(data.pl) || 0,
                    roe: Number(data.roe) || 0,
                    roic: Number(data.roic) || 0,
                    netMargin: Number(data.netMargin) || 0,
                    evEbitda: Number(data.evEbitda) || 0,
                    revenueGrowth: Number(data.cresRec5a) || 0,
                    debtToEquity: Number(data.divBrutaPatrim) || 0, // Usando Dívida Bruta/PL como proxy se Dívida Líq não vier direta
                    netDebt: Number(data.netDebt) || 0,

                    // FIIs
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

            // 3. Atualiza Ativos Internacionais
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
                                    updatedAt: timestamp
                                }
                            }
                        }
                    });
                });
            }

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
                logger.info(`✅ [SYNC-ENGINE] Sucesso! ${operations.length} ativos atualizados no banco com dados completos.`);
                return { success: true, count: operations.length };
            } else {
                logger.warn("⚠️ [SYNC-ENGINE] Nenhum ativo para atualizar.");
                return { success: false, count: 0 };
            }

        } catch (error) {
            logger.error(`❌ [SYNC-ENGINE] Falha fatal: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};
