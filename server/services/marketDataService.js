
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js'; 
import SystemConfig from '../models/SystemConfig.js';
import { externalMarketService } from './externalMarketService.js';

// Não importa mais fundamentusService aqui para evitar conflitos e uso misto.
// A fonte da verdade agora é o MongoDB populado pelo syncService.

const CACHE_DURATION_MINUTES = 20; 

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

            // SmartSync só atualiza preço (cotação rápida) via External (Yahoo)
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
                    btc: { value: config.btc || 90000, change: config.btcChange || 0 },
                    lastUpdated: config.lastUpdated
                };
            }
            return FALLBACK_MACRO;
        } catch (e) {
            logger.error(`Erro Macro: ${e.message}`);
            return FALLBACK_MACRO;
        }
    },

    // --- MUDANÇA CRÍTICA: LÊ APENAS DO BANCO ---
    // Isso garante que a UI use os dados ricos populados pelo syncService
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

            for (const asset of dbAssets) {
                // Filtro de liquidez básico (já salvo no banco pelo sync)
                if ((asset.liquidity || 0) < 200000) continue; 

                results.push({
                    ticker: asset.ticker,
                    type: asset.type,
                    name: asset.name || asset.ticker, 
                    sector: asset.sector, 
                    price: asset.lastPrice || 0,
                    dbFlags: { isBlacklisted: asset.isBlacklisted, isTier1: asset.isTier1 }, 
                    
                    // Mapeia todos os campos salvos no MarketAssetSchema para o objeto de metrics esperado
                    metrics: {
                        ticker: asset.ticker,
                        price: asset.lastPrice,
                        dy: asset.dy || 0,
                        pvp: asset.p_vp || 0,
                        marketCap: asset.marketCap || 0,
                        avgLiquidity: asset.liquidity || 0,
                        
                        // Stocks
                        pl: asset.pl || 0,
                        roe: asset.roe || 0,
                        roic: asset.roic || 0,
                        netMargin: asset.netMargin || 0,
                        evEbitda: asset.evEbitda || 0,
                        revenueGrowth: asset.revenueGrowth || 0,
                        debtToEquity: asset.debtToEquity || 0,
                        netDebt: asset.netDebt || 0,

                        // FIIs
                        vacancy: asset.vacancy || 0,
                        capRate: asset.capRate || 0,
                        qtdImoveis: asset.qtdImoveis || 0
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
