
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
            logger.info("🔄 [SYNC-ENGINE] Iniciando rotina de atualização massiva...");
            
            await macroDataService.performMacroSync();

            const operations = [];
            const timestamp = new Date();

            const stocksMap = await fundamentusService.getStocksMap();
            const fiiMap = await fundamentusService.getFIIsMap();
            
            const isScrapingFailed = stocksMap.size === 0 && fiiMap.size === 0;

            if (isScrapingFailed) {
                logger.error("❌ ERRO CRÍTICO: Scraping falhou totalmente. Abortando atualização.");
                return { success: false, error: "Scraping blocked." };
            }

            const pushOp = (ticker, data, type) => {
                // IGNORAR ATIVOS MORTOS (ZOMBIE FILTER)
                // Se o ativo tem liquidez média zerada ou muito baixa, é lixo. Não salvamos.
                const liquidity = Number(data.liq2m) || Number(data.liquidity) || 0;
                
                // Mínimo de R$ 5.000,00 de negociação média para ser considerado no banco.
                // Isso elimina recibos de subscrição antigos (finais 12, 13, 14, 15) e empresas falidas.
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
                logger.info(`✅ [SYNC-ENGINE] Fundamentos atualizados para ${operations.length} ativos.`);
                
                logger.info("📡 [SYNC-ENGINE] Iniciando 'Paint Job': Atualizando cotações...");
                
                const validTickers = [];
                // FILTRO DE ATUALIZAÇÃO REAL-TIME AINDA MAIS RÍGIDO
                // Só gasta cota de API (Brapi/Yahoo) com ativos que negociam > R$ 100k/dia
                const MIN_LIQUIDITY_FOR_LIVE_QUOTE = 100000; 

                stocksMap.forEach((v, k) => {
                    const liq = Number(v.liq2m) || 0;
                    if (liq > MIN_LIQUIDITY_FOR_LIVE_QUOTE) validTickers.push(k);
                });
                
                fiiMap.forEach((v, k) => {
                    const liq = Number(v.liquidity) || 0;
                    if (liq > MIN_LIQUIDITY_FOR_LIVE_QUOTE) validTickers.push(k);
                });
                
                logger.info(`   ➤ Filtrados ${validTickers.length} ativos líquidos para atualização real-time (de ${stocksMap.size + fiiMap.size} totais).`);

                // Batch
                const BATCH_SIZE = 50;
                let updatedQuotesCount = 0;
                for (let i = 0; i < validTickers.length; i += BATCH_SIZE) {
                    const batch = validTickers.slice(i, i + BATCH_SIZE);
                    await marketDataService.refreshQuotesBatch(batch, true);
                    updatedQuotesCount += batch.length;
                    await new Promise(r => setTimeout(r, 200)); 
                }
                
                logger.info(`✅ [SYNC-ENGINE] Cotações finalizadas. ${updatedQuotesCount} ativos atualizados.`);

                return { success: true, count: operations.length };
            } else {
                logger.warn("⚠️ [SYNC-ENGINE] Nenhum ativo válido para atualizar.");
                return { success: false, count: 0 };
            }

        } catch (error) {
            logger.error(`❌ [SYNC-ENGINE] Falha fatal: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};
