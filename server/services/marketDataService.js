
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js'; 
import SystemConfig from '../models/SystemConfig.js';
import { externalMarketService } from './externalMarketService.js';

const CACHE_DURATION_MINUTES = 20; 
const MAX_FAILURES_BEFORE_BLACKLIST = 10;

const FALLBACK_MACRO = {
    selic: { value: 11.25 },
    cdi: { value: 11.15 },
    ipca: { value: 4.50 },
    riskFree: { value: 11.25 },
    ntnbLong: { value: 6.30 },
    ibov: { value: 128000, change: 0 },
    usd: { value: 5.75, change: 0 },
    spx: { value: 5200, change: 0 },
    btc: { value: 65000, change: 0 },
    lastUpdated: new Date()
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

            if (asset && asset.lastPrice > 0) {
                return { 
                    price: asset.lastPrice, 
                    change: asset.change || 0, 
                    name: asset.name 
                };
            }

            const history = await AssetHistory.findOne({ ticker: cleanTicker });
            if (history && history.history && history.history.length > 0) {
                const sorted = history.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const lastClose = sorted[0].close || sorted[0].adjClose;
                
                if (lastClose > 0) {
                    return {
                        price: lastClose,
                        change: 0, 
                        name: ticker,
                        isFallback: true
                    };
                }
            }

            return { price: 0, change: 0, name: ticker };
        } catch (error) {
            return { price: 0, change: 0, name: ticker };
        }
    },

    async refreshQuotesBatch(tickers, force = false) {
        if (!tickers || tickers.length === 0) return;

        const cleanTickers = [...new Set(tickers.map(t => this.normalizeSymbol(t)))];
        const now = new Date();
        const threshold = new Date(now.getTime() - CACHE_DURATION_MINUTES * 60 * 1000);

        try {
            const dbAssets = await MarketAsset.find({ ticker: { $in: cleanTickers } }).select('ticker updatedAt lastPrice change isActive failCount');
            
            const toUpdate = [];
            const assetMap = new Map();
            
            dbAssets.forEach(a => assetMap.set(a.ticker, a));

            cleanTickers.forEach(ticker => {
                const asset = assetMap.get(ticker);
                
                // Se já estiver desativado pela blacklist, ignora (a menos que force)
                if (asset && !asset.isActive && !force) return;

                if (force) {
                    toUpdate.push(ticker);
                } else {
                    const isStale = !asset || !asset.updatedAt || asset.updatedAt < threshold;
                    if (isStale || !asset || asset.lastPrice === 0) {
                        toUpdate.push(ticker);
                    }
                }
            });

            if (toUpdate.length === 0) return;

            const quotes = await externalMarketService.getQuotes(toUpdate);
            const operations = [];
            
            // Set para controle de sucesso/falha
            const successfulTickers = new Set();

            for (const quote of quotes) {
                const ticker = this.normalizeSymbol(quote.ticker);
                const currentAsset = assetMap.get(ticker);
                
                let newPrice = quote.price;
                let newChange = quote.change || 0;
                let isSuccess = false;

                if (newPrice && newPrice > 0) {
                    isSuccess = true;
                    successfulTickers.add(ticker);
                    
                    operations.push({
                        updateOne: {
                            filter: { ticker: ticker },
                            update: {
                                $set: {
                                    lastPrice: newPrice,
                                    change: newChange, 
                                    updatedAt: now,
                                    isActive: true,
                                    failCount: 0 // Reset do contador de falhas em caso de sucesso
                                }
                            }
                        }
                    });
                }
            }

            // --- BLACKLIST DINÂMICA (DETECTAR FALHAS) ---
            // Verifica quais tickers solicitados NÃO retornaram ou retornaram erro
            toUpdate.forEach(requestedTicker => {
                if (!successfulTickers.has(requestedTicker)) {
                    const asset = assetMap.get(requestedTicker);
                    if (asset) {
                        const newFailCount = (asset.failCount || 0) + 1;
                        const shouldDeactivate = newFailCount >= MAX_FAILURES_BEFORE_BLACKLIST;
                        
                        const updatePayload = {
                            failCount: newFailCount
                        };

                        if (shouldDeactivate) {
                            updatePayload.isActive = false;
                            logger.warn(`⛔ [Blacklist] Ativo ${requestedTicker} desativado após ${newFailCount} falhas consecutivas.`);
                        }

                        operations.push({
                            updateOne: {
                                filter: { ticker: requestedTicker },
                                update: { $set: updatePayload }
                            }
                        });
                    }
                }
            });

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
            }

        } catch (error) {
            logger.error(`❌ [MarketData] Falha: ${error.message}`);
        }
    },

    async getBenchmarkHistory(ticker = '^BVSP') {
        try {
            let historyEntry = await AssetHistory.findOne({ ticker });
            const now = new Date();
            const cacheLimit = new Date(now.getTime() - 12 * 60 * 60 * 1000);

            if (!historyEntry || historyEntry.lastUpdated < cacheLimit) {
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
            if (dayData && dayData.close > 0) {
                return {
                    price: dayData.close,
                    adjustedPrice: dayData.adjClose,
                    source: 'history_cache'
                };
            }
            const targetDate = new Date(dateStr);
            const sortedHistory = [...historyEntry.history].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const closest = sortedHistory.find(h => new Date(h.date) <= targetDate);
            if (closest && closest.close > 0) {
                return {
                    price: closest.close,
                    adjustedPrice: closest.adjClose,
                    source: 'history_approx',
                    foundDate: closest.date
                };
            }
            return null;
        } catch (error) {
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
                    btc: { value: config.btc || 90000, change: config.btcChange || 0 },
                    lastUpdated: config.lastUpdated
                };
            }
            return FALLBACK_MACRO;
        } catch (e) {
            return FALLBACK_MACRO;
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
                isBlacklisted: false,
                isActive: true // Só pega ativos vivos para análise
            });

            for (const asset of dbAssets) {
                if ((asset.liquidity || 0) < 200000) continue; 

                results.push({
                    ticker: asset.ticker,
                    type: asset.type,
                    name: asset.name || asset.ticker, 
                    sector: asset.sector, 
                    price: asset.lastPrice || 0,
                    dbFlags: { isBlacklisted: asset.isBlacklisted, isTier1: asset.isTier1 }, 
                    metrics: {
                        ticker: asset.ticker,
                        price: asset.lastPrice,
                        dy: asset.dy || 0,
                        pvp: asset.p_vp || 0,
                        marketCap: asset.marketCap || 0,
                        avgLiquidity: asset.liquidity || 0,
                        pl: asset.pl || 0,
                        roe: asset.roe || 0,
                        roic: asset.roic || 0,
                        netMargin: asset.netMargin || 0,
                        evEbitda: asset.evEbitda || 0,
                        revenueGrowth: asset.revenueGrowth || 0,
                        debtToEquity: asset.debtToEquity || 0,
                        netDebt: asset.netDebt || 0,
                        vacancy: asset.vacancy || 0,
                        capRate: asset.capRate || 0,
                        qtdImoveis: asset.qtdImoveis || 0,
                        structural: {
                            quality: 50,
                            valuation: 50,
                            risk: 50
                        }
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
            if (asset.metrics.avgLiquidity > grouped[root].metrics.avgLiquidity) {
                grouped[root] = asset;
            }
        }
    });
    return Object.values(grouped);
};
