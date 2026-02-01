
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js'; 
import SystemConfig from '../models/SystemConfig.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';

const CACHE_DURATION_MINUTES = 20; // Tempo de validade do preço no banco

const FALLBACK_MACRO = {
    selic: { value: 11.25 },
    cdi: { value: 11.15 },
    ipca: { value: 4.50 },
    riskFree: { value: 11.25 },
    ntnbLong: { value: 6.30 },
    ibov: { value: 128000, change: 0 },
    usd: { value: 5.75, change: 0 },
    spx: { value: 5200, change: 0 },
    btc: { value: 65000, change: 0 }
};

export const marketDataService = {
    normalizeSymbol(ticker) {
        if (!ticker) return '';
        return ticker.toUpperCase().trim().replace('.SA', '');
    },

    async getMarketDataByTicker(ticker) {
        try {
            const cleanTicker = this.normalizeSymbol(ticker);
            const asset = await MarketAsset.findOne({ ticker: cleanTicker });

            if (asset) {
                return { 
                    price: asset.lastPrice || 0, 
                    change: 0, 
                    name: asset.name 
                };
            }
            return { price: 0, change: 0, name: ticker };
        } catch (error) {
            logger.error(`Erro ao ler ticker ${ticker}: ${error.message}`);
            return { price: 0, change: 0, name: ticker };
        }
    },

    async refreshQuotesBatch(tickers) {
        if (!tickers || tickers.length === 0) return;

        const cleanTickers = [...new Set(tickers.map(t => this.normalizeSymbol(t)))];
        const now = new Date();
        const threshold = new Date(now.getTime() - CACHE_DURATION_MINUTES * 60 * 1000);

        try {
            const dbAssets = await MarketAsset.find({ ticker: { $in: cleanTickers } }).select('ticker lastAnalysisDate updatedAt lastPrice type');
            
            const toUpdate = [];
            const assetMap = new Map();
            
            dbAssets.forEach(a => assetMap.set(a.ticker, a));

            cleanTickers.forEach(ticker => {
                const asset = assetMap.get(ticker);
                if (!asset || !asset.updatedAt || asset.updatedAt < threshold || asset.lastPrice === 0) {
                    toUpdate.push(ticker);
                }
            });

            if (toUpdate.length === 0) return;

            logger.info(`⚡ [SmartSync] Atualizando ${toUpdate.length} ativos: ${toUpdate.join(', ')}`);

            const quotes = await externalMarketService.getQuotes(toUpdate);

            if (!quotes || quotes.length === 0) return;

            const operations = quotes.map(quote => ({
                updateOne: {
                    filter: { ticker: this.normalizeSymbol(quote.ticker) },
                    update: {
                        $set: {
                            lastPrice: quote.price,
                            updatedAt: now
                        }
                    }
                }
            }));

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
                logger.info(`✅ [SmartSync] ${operations.length} preços atualizados no banco.`);
            }

        } catch (error) {
            logger.error(`❌ [SmartSync] Falha: ${error.message}`);
        }
    },

    async getBenchmarkHistory(ticker = '^BVSP') {
        try {
            let historyEntry = await AssetHistory.findOne({ ticker });
            const now = new Date();
            const cacheLimit = new Date(now.getTime() - 12 * 60 * 60 * 1000);

            if (!historyEntry || historyEntry.lastUpdated < cacheLimit) {
                logger.info(`📊 [Benchmark] Atualizando histórico cacheado de ${ticker}...`);
                const externalHistory = await externalMarketService.getFullHistory(ticker, 'INDEX');
                
                if (externalHistory && externalHistory.length > 0) {
                    if (historyEntry) {
                        historyEntry.history = externalHistory;
                        historyEntry.lastUpdated = now;
                        await historyEntry.save();
                    } else {
                        historyEntry = await AssetHistory.create({
                            ticker,
                            history: externalHistory,
                            lastUpdated: now
                        });
                    }
                }
            }
            return historyEntry ? historyEntry.history : null;
        } catch (error) {
            logger.error(`Erro ao buscar benchmark ${ticker}: ${error.message}`);
            return null;
        }
    },

    async getPriceAtDate(ticker, dateStr, type) {
        const cleanTicker = this.normalizeSymbol(ticker);
        
        try {
            let historyEntry = await AssetHistory.findOne({ ticker: cleanTicker });
            
            if (!historyEntry) {
                const externalHistory = await externalMarketService.getFullHistory(cleanTicker, type);
                if (externalHistory && externalHistory.length > 0) {
                    historyEntry = await AssetHistory.create({
                        ticker: cleanTicker,
                        history: externalHistory,
                        lastUpdated: new Date()
                    });
                } else {
                    return null;
                }
            }

            const dayData = historyEntry.history.find(h => h.date === dateStr);
            if (dayData) {
                return {
                    price: dayData.close,
                    adjustedPrice: dayData.adjClose,
                    source: 'history_cache'
                };
            }

            const targetDate = new Date(dateStr);
            const closest = historyEntry.history
                .filter(h => new Date(h.date) <= targetDate)
                .pop();

            if (closest) {
                return {
                    price: closest.close,
                    adjustedPrice: closest.adjClose,
                    source: 'history_approx',
                    foundDate: closest.date
                };
            }

            return null;

        } catch (error) {
            logger.error(`Erro ao buscar histórico ${cleanTicker}: ${error.message}`);
            return null;
        }
    },

    async getMacroIndicators() {
        try {
            const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            if (config) {
                return {
                    selic: { value: config.selic },
                    cdi: { value: config.cdi },
                    ipca: { value: config.ipca },
                    riskFree: { value: config.riskFree },
                    ntnbLong: { value: config.ntnbLong },
                    usd: { value: config.dollar || 5.75, change: config.dollarChange || 0 }, 
                    ibov: { value: config.ibov || 128000, change: config.ibovChange || 0 },
                    spx: { value: config.spx || 5800, change: config.spxChange || 0 },
                    btc: { value: config.btc || 90000, change: config.btcChange || 0 }
                };
            }
            return FALLBACK_MACRO;
        } catch (e) {
            logger.error(`Erro Macro: ${e.message}`);
            return FALLBACK_MACRO;
        }
    },

    async performFullSync() {
        try {
            logger.info("🔄 [SYNC] Iniciando sincronização TOTAL de dados...");
            
            // 1. Atualiza dados Macro
            await macroDataService.performMacroSync();

            const operations = [];
            const timestamp = new Date();

            // 2. Tenta Scraping Principal (Fundamentus)
            const stocksMap = await fundamentusService.getStocksMap();
            const fiiMap = await fundamentusService.getFIIsMap();
            
            const isScrapingFailed = stocksMap.size === 0 && fiiMap.size === 0;

            if (isScrapingFailed) {
                logger.warn("⚠️ ALERTA: Scraping principal falhou (possível bloqueio 403). Iniciando Fallback via Yahoo...");
            }

            const pushOp = (ticker, data, type) => {
                let finalSector = SECTOR_OVERRIDES[ticker];
                if (!finalSector) {
                    finalSector = data.sector || 'Outros';
                }

                operations.push({
                    updateOne: {
                        filter: { ticker: ticker },
                        update: {
                            $set: {
                                lastPrice: Number(data.price) || 0,
                                dy: Number(data.dy) || 0,
                                p_vp: Number(data.pvp) || 0,
                                marketCap: Number(data.marketCap) || 0,
                                vacancy: Number(data.vacancy) || 0,
                                sector: finalSector, 
                                lastAnalysisDate: timestamp,
                                updatedAt: timestamp
                            },
                            $setOnInsert: {
                                name: ticker, type, currency: 'BRL',
                                isIgnored: false, isBlacklisted: false
                            }
                        },
                        upsert: true
                    }
                });
            };

            // Se o scraping funcionou, usa os dados ricos
            if (stocksMap.size > 0) stocksMap.forEach((v, k) => pushOp(k, v, 'STOCK'));
            if (fiiMap.size > 0) fiiMap.forEach((v, k) => pushOp(k, v, 'FII'));

            // 3. Busca Ativos que não vieram no Scraping (Fallback ou Ativos Internacionais)
            // Inclui STOCK e FII se o scraping falhou para tentar pegar pelo menos o preço
            const typesToFetchExternal = ['CRYPTO', 'STOCK_US'];
            if (isScrapingFailed) {
                typesToFetchExternal.push('STOCK', 'FII');
            }

            const assetsForExternal = await MarketAsset.find({ 
                type: { $in: typesToFetchExternal } 
            }).select('ticker type');

            if (assetsForExternal.length > 0) {
                const tickersToFetch = assetsForExternal.map(a => a.ticker);
                const quotes = await externalMarketService.getQuotes(tickersToFetch);
                
                quotes.forEach(quote => {
                    // Update simples apenas de preço e data
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
                logger.info(`✅ [SYNC] Sincronização concluída! ${operations.length} ativos atualizados.`);
                return { success: true, count: operations.length };
            } else {
                logger.warn("⚠️ [SYNC] Nenhum ativo atualizado.");
                return { success: false, count: 0 };
            }

        } catch (error) {
            logger.error(`❌ [SYNC] Falha fatal: ${error.message}`);
            // Não relança o erro para não derrubar o cron job
            return { success: false, error: error.message };
        }
    },

    async getMarketData(assetClass) {
        const isBrasil = assetClass === 'STOCK' || assetClass === 'FII' || assetClass === 'BRASIL_10';
        const results = [];
        
        if (isBrasil) {
            const queryType = assetClass === 'BRASIL_10' ? { $in: ['STOCK', 'FII'] } : { $in: [assetClass] };
            
            const dbAssets = await MarketAsset.find({ 
                type: queryType,
                isIgnored: false,
                isBlacklisted: false
            });

            // Tenta obter dados detalhados para calcular métricas
            let fundDataMap = new Map();
            try {
                if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
                    const stockMap = await fundamentusService.getStocksMap();
                    if (stockMap) stockMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'STOCK' }));
                }
                if (assetClass === 'FII' || assetClass === 'BRASIL_10') {
                    const fiiMap = await fundamentusService.getFIIsMap();
                    if (fiiMap) fiiMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'FII' }));
                }
            } catch (e) {
                logger.warn("Falha ao obter dados fundamentais para ranking. Usando dados do banco.");
            }

            for (const asset of dbAssets) {
                // Se o scraping falhou, tenta usar dados do banco (cache)
                // Se não tiver dados no banco, usa um objeto "mock" seguro para não quebrar a UI
                const fundData = fundDataMap.get(asset.ticker) || {
                    ticker: asset.ticker,
                    price: asset.lastPrice || 0,
                    dy: asset.dy || 0,
                    pvp: asset.p_vp || 0,
                    marketCap: asset.marketCap || 0,
                    liquidity: 1000000 // Fallback para não ser filtrado se faltar dados
                };

                // Filtro de liquidez (exceto se for fallback forçado)
                const liquidity = fundData.liq2m || fundData.liquidity || 0;
                if (fundDataMap.size > 0 && liquidity < 200000) continue; 

                results.push({
                    ticker: asset.ticker,
                    type: asset.type,
                    name: asset.name || asset.ticker, 
                    sector: asset.sector, 
                    price: asset.lastPrice || fundData.price,
                    dbFlags: { isBlacklisted: asset.isBlacklisted, isTier1: asset.isTier1 }, 
                    metrics: {
                        ...fundData,
                        marketCap: asset.marketCap || fundData.marketCap || 0,
                        avgLiquidity: liquidity,
                        dy: asset.dy || fundData.dy || 0,
                        pvp: asset.p_vp || fundData.pvp || 0
                    }
                });
            }
        }
        
        if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
            return deduplicateAssets(results);
        }
        return results;
    }
};

const deduplicateAssets = (assets) => {
    const grouped = {};
    assets.forEach(asset => {
        let root = asset.ticker.substring(0, 4);
        if (!grouped[root]) {
            grouped[root] = asset;
        } else {
            // Mantém o de maior liquidez
            if (asset.metrics.avgLiquidity > grouped[root].metrics.avgLiquidity) {
                grouped[root] = asset;
            }
        }
    });
    return Object.values(grouped);
};
