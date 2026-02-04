
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { marketDataService } from './marketDataService.js'; // Importado para refreshQuotesBatch
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

            // 2. Scraping Principal (Fundamentos)
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
                    // Preço base do Fundamentus (D-1 ou D-0 atrasado)
                    lastPrice: Number(data.price) || 0,
                    
                    // Indicadores
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
                    debtToEquity: Number(data.divBrutaPatrim) || 0, 
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

            // 3. Atualiza Ativos Internacionais e Cripto (Já inclui preço atualizado)
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
                                    change: quote.change, // Importante: Salva variação
                                    updatedAt: timestamp
                                }
                            }
                        }
                    });
                });
            }

            // Executa o Bulk Write Principal (Fundamentos)
            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
                logger.info(`✅ [SYNC-ENGINE] Fundamentos atualizados para ${operations.length} ativos.`);
                
                // --- CORREÇÃO DE INTEGRIDADE E PERFORMANCE ---
                logger.info("📡 [SYNC-ENGINE] Iniciando 'Paint Job': Atualizando cotações e variação % via Yahoo...");
                
                // Coleta apenas ativos COM LIQUIDEZ para evitar buscar lixo no Yahoo
                const validTickers = [];
                const MIN_LIQUIDITY = 1000; // R$ 1.000,00 de negociação média (filtra micos mortos)

                stocksMap.forEach((v, k) => {
                    const liq = Number(v.liq2m) || 0;
                    if (liq > MIN_LIQUIDITY) validTickers.push(k);
                });
                
                fiiMap.forEach((v, k) => {
                    const liq = Number(v.liquidity) || 0;
                    if (liq > MIN_LIQUIDITY) validTickers.push(k);
                });
                
                logger.info(`   ➤ Filtrados ${validTickers.length} ativos líquidos para atualização real-time (de ${stocksMap.size + fiiMap.size} totais).`);

                // Atualiza em lotes para não estourar rate limit
                const BATCH_SIZE = 50;
                let updatedQuotesCount = 0;
                for (let i = 0; i < validTickers.length; i += BATCH_SIZE) {
                    const batch = validTickers.slice(i, i + BATCH_SIZE);
                    // FORCE = TRUE para ignorar o timestamp recente do Fundamentus e pegar preço real
                    await marketDataService.refreshQuotesBatch(batch, true);
                    updatedQuotesCount += batch.length;
                    // Pequena pausa para ser gentil com a API
                    await new Promise(r => setTimeout(r, 200)); 
                }
                
                logger.info(`✅ [SYNC-ENGINE] Cotações 'Paint Job' finalizado. ${updatedQuotesCount} ativos com preço/variação real-time.`);

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
