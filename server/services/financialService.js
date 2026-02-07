
import mongoose from 'mongoose';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UserAsset from '../models/UserAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import EconomicIndex from '../models/EconomicIndex.js'; // Novo
import { marketDataService } from './marketDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv } from '../utils/mathUtils.js';
import { HISTORICAL_CDI_RATES } from '../config/financialConstants.js'; 
import logger from '../config/logger.js';

export const financialService = {
    
    toDateKey(date) {
        if (!date) return null;
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    },

    normalizeDate(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    },

    normalizeTickerForHistory(ticker) {
        const clean = ticker.trim().toUpperCase();
        if (clean.endsWith('.SA') || clean.startsWith('^') || clean.includes('-')) return clean;
        
        if (/^[A-Z]{4}\d{1,2}B?$/.test(clean)) {
            return `${clean}.SA`;
        }
        return clean;
    },

    indexHistoryByDate(history) {
        const map = new Map();
        if (!history || !Array.isArray(history)) return map;
        
        history.forEach(h => {
            if (h.date) {
                map.set(h.date, { 
                    close: h.close || 0, 
                    adjClose: h.adjClose || h.close || 0 
                });
            }
        });
        return map;
    },

    findPriceInMap(priceMap, dateStr) {
        if (!priceMap || priceMap.size === 0) return { close: 0, adjClose: 0 };

        if (priceMap.has(dateStr)) return priceMap.get(dateStr);

        const targetDate = new Date(dateStr);
        for (let i = 1; i <= 5; i++) {
            const prevDate = new Date(targetDate);
            prevDate.setDate(targetDate.getDate() - i);
            const prevKey = prevDate.toISOString().split('T')[0];
            if (priceMap.has(prevKey)) {
                return priceMap.get(prevKey);
            }
        }

        return { close: 0, adjClose: 0 };
    },

    findClosestValue(history, targetDateStr) {
        if (!history) return 0;
        const exact = history.find(h => h.date === targetDateStr);
        if (exact) return exact.adjClose || exact.close;
        return 0;
    },

    async rebuildUserHistory(userId) {
        const startTime = Date.now();
        
        try {
            const txs = await AssetTransaction.find({ user: userId }).sort({ date: 1 });
            if (txs.length === 0) {
                await WalletSnapshot.deleteMany({ user: userId });
                return;
            }

            const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const currentCdiRate = sysConfig?.cdi || 11.25;

            const uniqueTickers = [...new Set(txs.map(t => t.ticker))];
            
            const priceCacheMap = new Map(); 
            const assetMetadataMap = new Map(); 

            const userAssets = await UserAsset.find({ user: userId });
            userAssets.forEach(ua => assetMetadataMap.set(ua.ticker, ua));

            await Promise.all(uniqueTickers.map(async (ticker) => {
                const assetMeta = assetMetadataMap.get(ticker);
                if (assetMeta?.type === 'FIXED_INCOME' || assetMeta?.type === 'CASH' || ticker === 'RESERVA') return; 

                try {
                    const searchTicker = this.normalizeTickerForHistory(ticker);
                    let history = await marketDataService.getBenchmarkHistory(ticker);
                    
                    if (!history || history.length < 5) {
                        const info = await MarketAsset.findOne({ ticker });
                        const type = info?.type || 'STOCK';
                        try {
                            const extHistory = await externalMarketService.getFullHistory(searchTicker, type);
                            if (extHistory && extHistory.length > 0) {
                                await AssetHistory.updateOne(
                                    { ticker: ticker.toUpperCase() },
                                    { history: extHistory, lastUpdated: new Date() },
                                    { upsert: true }
                                );
                                history = extHistory;
                            }
                        } catch (err) { }
                    }
                    
                    if (history && history.length > 0) {
                        priceCacheMap.set(ticker, this.indexHistoryByDate(history));
                    }
                } catch (e) {
                    logger.warn(`Histórico falhou para ${ticker}: ${e.message}`);
                }
            }));

            const startDate = new Date(txs[0].date);
            startDate.setHours(12, 0, 0, 0); 
            const today = new Date();
            today.setHours(12, 0, 0, 0);

            const snapshots = [];
            const portfolio = {}; 
            const fixedIncomeState = {};

            let cursor = new Date(startDate);
            let txIndex = 0;
            
            const allDividends = await DividendEvent.find({ ticker: { $in: uniqueTickers } }).sort({ date: 1 });
            const dividendDateMap = new Map();
            allDividends.forEach(div => {
                const dKey = this.toDateKey(div.date);
                if (!dividendDateMap.has(dKey)) dividendDateMap.set(dKey, []);
                dividendDateMap.get(dKey).push(div);
            });

            let accumulatedDividends = 0;
            let currentQuota = 100.0; 
            let previousEquityNominal = 0;
            let previousEquityAdjusted = 0; 
            const lastKnownPrices = {}; 

            // --- MELHORIA 1: CARREGAR INDICES DIÁRIOS REAIS ---
            const dbIndices = await EconomicIndex.find({ 
                series: 'SELIC', 
                date: { $gte: startDate } 
            }).lean();
            
            const dailyFactorsMap = new Map();
            dbIndices.forEach(idx => {
                const key = this.toDateKey(idx.date);
                if (key) dailyFactorsMap.set(key, idx.accumulatedFactor);
            });

            const cdiFactorsCacheFallback = {};
            const currentYear = today.getFullYear();
            
            for (let y = startDate.getFullYear(); y <= currentYear; y++) {
                let rate = HISTORICAL_CDI_RATES[y] || 10.0; 
                if (y === currentYear) rate = currentCdiRate;
                cdiFactorsCacheFallback[y] = Math.pow(1 + (rate / 100), 1/252);
            }
            // --------------------------------------------------

            while (cursor <= today) {
                const cursorIso = this.toDateKey(cursor);
                
                // Prioriza o fator real do dia (Série 11 BCB)
                let cdiDailyFactor = dailyFactorsMap.get(cursorIso);
                
                // Se não existir (feriado ou gap), usa a constante anual aproximada
                if (!cdiDailyFactor) {
                    cdiDailyFactor = cdiFactorsCacheFallback[cursor.getFullYear()] || 1.0003;
                }

                let dayFlowNominal = 0;
                let dayFlowAdjusted = 0;
                
                while (txIndex < txs.length) {
                    const tx = txs[txIndex];
                    const txDateIso = this.toDateKey(tx.date);
                    
                    if (txDateIso > cursorIso) break; 

                    if (!portfolio[tx.ticker]) {
                        portfolio[tx.ticker] = { qty: 0, cost: 0 };
                        const meta = assetMetadataMap.get(tx.ticker);
                        if (meta && (meta.type === 'FIXED_INCOME' || meta.type === 'CASH')) {
                            fixedIncomeState[tx.ticker] = { 
                                currentValue: 0, 
                                rate: meta.fixedIncomeRate > 0 ? meta.fixedIncomeRate : (meta.type === 'CASH' ? 100 : 10) 
                            };
                        }
                    }
                    
                    let txAdjPrice = tx.price;
                    const meta = assetMetadataMap.get(tx.ticker);
                    const isFixed = meta?.type === 'FIXED_INCOME' || meta?.type === 'CASH';

                    if (!isFixed) {
                        const pMap = priceCacheMap.get(tx.ticker);
                        const pData = this.findPriceInMap(pMap, cursorIso);
                        if (pData.adjClose > 0) txAdjPrice = pData.adjClose;
                    }

                    if (tx.type === 'BUY') {
                        portfolio[tx.ticker].qty += tx.quantity;
                        portfolio[tx.ticker].cost += tx.totalValue;
                        if (isFixed) {
                            if (!fixedIncomeState[tx.ticker]) fixedIncomeState[tx.ticker] = { currentValue: 0, rate: meta?.fixedIncomeRate || 100 };
                            fixedIncomeState[tx.ticker].currentValue += tx.totalValue;
                        }
                        dayFlowNominal += tx.totalValue;
                        dayFlowAdjusted += (tx.quantity * txAdjPrice);
                        
                        if (!lastKnownPrices[tx.ticker]) lastKnownPrices[tx.ticker] = { close: tx.price, adjClose: txAdjPrice };

                    } else if (tx.type === 'SELL') {
                        const currentAvg = portfolio[tx.ticker].qty > 0 ? portfolio[tx.ticker].cost / portfolio[tx.ticker].qty : 0;
                        portfolio[tx.ticker].qty -= tx.quantity;
                        portfolio[tx.ticker].cost -= (tx.quantity * currentAvg);
                        if (isFixed) {
                            fixedIncomeState[tx.ticker].currentValue = Math.max(0, fixedIncomeState[tx.ticker].currentValue - tx.totalValue);
                        }
                        dayFlowNominal -= tx.totalValue;
                        dayFlowAdjusted -= (tx.quantity * txAdjPrice);
                    }
                    
                    if (portfolio[tx.ticker].qty < 0.000001) {
                        portfolio[tx.ticker].qty = 0; 
                        portfolio[tx.ticker].cost = 0;
                        if(fixedIncomeState[tx.ticker]) fixedIncomeState[tx.ticker].currentValue = 0;
                    }
                    txIndex++;
                }

                const dayDividends = dividendDateMap.get(cursorIso) || [];
                for (const div of dayDividends) {
                    if (portfolio[div.ticker] && portfolio[div.ticker].qty > 0) {
                        accumulatedDividends += (portfolio[div.ticker].qty * div.amount);
                    }
                }

                let totalEquityNominal = 0;
                let totalEquityAdjusted = 0;
                let totalInvested = 0;
                let hasPosition = false;

                // Em dias úteis (ou dias onde temos fator BCB), aplica a correção
                // Se cdiDailyFactor veio do mapa, é dia útil. Se veio do fallback, checamos fim de semana.
                const isMapFactor = dailyFactorsMap.has(cursorIso);
                const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
                const shouldApplyRates = isMapFactor || !isWeekend;
                
                if (shouldApplyRates) {
                    for (const ticker in fixedIncomeState) {
                        if (portfolio[ticker].qty > 0) {
                            const state = fixedIncomeState[ticker];
                            let dailyFactor = 1;
                            // Se taxa > 30% a.a., assume que é % do CDI (ex: 110% do CDI)
                            if (state.rate > 30) dailyFactor = 1 + ((cdiDailyFactor - 1) * (state.rate / 100));
                            // Se taxa < 30%, assume que é Pré-fixada a.a. (ex: 12% a.a.)
                            else dailyFactor = Math.pow(1 + (state.rate / 100), 1/252);
                            
                            state.currentValue *= dailyFactor;
                        }
                    }
                }

                for (const ticker in portfolio) {
                    const pos = portfolio[ticker];
                    if (pos.qty <= 0) continue;
                    hasPosition = true;
                    totalInvested += pos.cost;
                    
                    let markClose = 0;
                    let markAdjClose = 0;
                    
                    if (fixedIncomeState[ticker]) {
                        const val = fixedIncomeState[ticker].currentValue;
                        const unitPrice = val / pos.qty;
                        markClose = unitPrice;
                        markAdjClose = unitPrice;
                    } else {
                        const pMap = priceCacheMap.get(ticker);
                        const pData = this.findPriceInMap(pMap, cursorIso);
                        
                        if (pData.close > 0) {
                            markClose = pData.close;
                            markAdjClose = pData.adjClose;
                            lastKnownPrices[ticker] = pData;
                        } else {
                            markClose = lastKnownPrices[ticker]?.close || (pos.cost / pos.qty);
                            markAdjClose = lastKnownPrices[ticker]?.adjClose || markClose;
                        }
                    }
                    
                    totalEquityNominal += pos.qty * markClose;
                    totalEquityAdjusted += pos.qty * markAdjClose;
                }

                if (previousEquityAdjusted > 0) {
                    const capitalGainAdj = totalEquityAdjusted - previousEquityAdjusted - dayFlowAdjusted;
                    const denominator = previousEquityAdjusted + (dayFlowAdjusted * 0.5); 
                    
                    if (denominator > 0.01) {
                        const dailyReturn = capitalGainAdj / denominator;
                        if (dailyReturn > -0.5 && dailyReturn < 0.5) {
                            currentQuota = currentQuota * (1 + dailyReturn);
                        }
                    }
                }
                
                if (hasPosition || totalInvested > 0 || accumulatedDividends > 0) {
                    snapshots.push({
                        user: userId,
                        date: new Date(cursor),
                        totalEquity: safeCurrency(totalEquityNominal),
                        totalInvested: safeCurrency(totalInvested),
                        totalDividends: safeCurrency(accumulatedDividends),
                        profit: safeCurrency(totalEquityNominal - totalInvested),
                        profitPercent: safeFloat(totalInvested > 0 ? ((totalEquityNominal - totalInvested) / totalInvested) * 100 : 0),
                        quotaPrice: safeFloat(currentQuota)
                    });
                }
                
                previousEquityNominal = totalEquityNominal;
                previousEquityAdjusted = totalEquityAdjusted;
                cursor.setDate(cursor.getDate() + 1);
            }

            if (snapshots.length > 0) {
                const session = await mongoose.startSession();
                let retries = 3;
                
                try {
                    while (retries > 0) {
                        try {
                            session.startTransaction();
                            await WalletSnapshot.deleteMany({ user: userId }).session(session);
                            const CHUNK_SIZE = 5000;
                            for (let i = 0; i < snapshots.length; i += CHUNK_SIZE) {
                                await WalletSnapshot.insertMany(snapshots.slice(i, i + CHUNK_SIZE), { session });
                            }
                            await session.commitTransaction();
                            break; 
                        } catch (err) {
                            await session.abortTransaction();
                            if (err.message.includes('Write conflict') || err.hasErrorLabel?.('TransientTransactionError')) {
                                if (retries > 1) {
                                    retries--;
                                    await new Promise(r => setTimeout(r, 250)); 
                                    continue;
                                }
                            }
                            throw err; 
                        }
                    }
                } catch (writeErr) {
                    throw writeErr;
                } finally {
                    session.endSession();
                }
            }
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [History] Reconstrução V4.7 (Precision) concluída em ${duration}s.`);

        } catch (error) {
            logger.error(`❌ [Engine] Erro Fatal no Rebuild: ${error.message}`);
        }
    },

    async calculateUserDividends(userId) {
        // ... (Mantido código original de dividendos para brevidade)
        const assets = await UserAsset.find({ user: userId });
        const relevantAssets = assets.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
        const tickers = relevantAssets.map(a => a.ticker);

        if (tickers.length === 0) return { dividendMap: new Map(), provisioned: [], totalAllTime: 0, projectedMonthly: 0 };

        const marketInfos = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker dy lastPrice');
        const marketMap = new Map();
        marketInfos.forEach(m => marketMap.set(m.ticker, m));

        let projectedMonthly = 0;
        relevantAssets.forEach(asset => {
            const mInfo = marketMap.get(asset.ticker);
            if (mInfo && mInfo.dy > 0) {
                const annualIncome = (asset.quantity * mInfo.lastPrice) * (mInfo.dy / 100);
                projectedMonthly += (annualIncome / 12);
            }
        });

        const allEvents = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: 1 });
        const eventsMap = new Map();
        allEvents.forEach(e => {
            if (!eventsMap.has(e.ticker)) eventsMap.set(e.ticker, []);
            eventsMap.get(e.ticker).push(e);
        });

        const firstTransactions = await AssetTransaction.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), ticker: { $in: tickers }, type: 'BUY' } },
            { $sort: { date: 1 } },
            { $group: { _id: "$ticker", firstBuyDate: { $first: "$date" } } }
        ]);

        const acquisitionMap = new Map();
        firstTransactions.forEach(tx => acquisitionMap.set(tx._id, this.normalizeDate(tx.firstBuyDate)));

        const dividendMap = new Map();
        const provisioned = [];
        let totalAllTime = 0;

        for (const asset of relevantAssets) {
            const firstBuyDate = acquisitionMap.get(asset.ticker);
            const assetEvents = eventsMap.get(asset.ticker) || [];

            for (const event of assetEvents) {
                const eventDateNormalized = this.normalizeDate(event.date);
                if (!firstBuyDate || eventDateNormalized < firstBuyDate) continue;

                const totalValue = safeMult(asset.quantity, event.amount);
                
                if (totalValue > 0) {
                    const pDate = event.paymentDate || new Date(new Date(event.date).setDate(event.date.getDate() + 15));
                    const today = new Date();
                    const isFuture = pDate > today;
                    
                    if (isFuture) {
                        provisioned.push({ ticker: asset.ticker, date: pDate, amount: totalValue, isProvisioned: true });
                    } else {
                        const monthKey = pDate.toISOString().substring(0, 7);
                        if (!dividendMap.has(monthKey)) dividendMap.set(monthKey, { total: 0, breakdown: [] });
                        const entry = dividendMap.get(monthKey);
                        entry.total = safeAdd(entry.total, totalValue);
                        
                        const existingBreakdown = entry.breakdown.find(b => b.ticker === asset.ticker);
                        if (existingBreakdown) existingBreakdown.amount = safeAdd(existingBreakdown.amount, totalValue);
                        else entry.breakdown.push({ ticker: asset.ticker, amount: totalValue });

                        totalAllTime = safeAdd(totalAllTime, totalValue);
                    }
                }
            }
        }

        return { dividendMap, provisioned, totalAllTime, projectedMonthly };
    },

    async recalculatePosition(userId, ticker, forcedType = null, session = null) {
        // ... (Mantido código original de recalculatePosition para brevidade)
        const query = AssetTransaction.find({ user: userId, ticker }).sort({ date: 1, createdAt: 1 });
        if (session) query.session(session);
        const transactions = await query;
        
        let quantity = 0;
        let totalCost = 0; 
        let realizedProfit = 0;
        let taxLots = []; 
        let firstBuyDate = null;

        for (const tx of transactions) {
            const txQty = safeFloat(tx.quantity);
            const txPrice = safeFloat(tx.price);
            const txTotal = safeMult(txQty, txPrice); 

            if (tx.type === 'BUY') {
                quantity = safeAdd(quantity, txQty);
                totalCost = safeAdd(totalCost, txTotal);
                taxLots.push({ quantity: txQty, price: txPrice, date: tx.date });
                if (!firstBuyDate) firstBuyDate = tx.date; 
            } else if (tx.type === 'SELL') {
                const currentAvg = quantity > 0 ? safeDiv(totalCost, quantity) : 0;
                const costOfSoldShares = safeMult(txQty, currentAvg);
                const profit = safeSub(txTotal, costOfSoldShares);
                
                realizedProfit = safeAdd(realizedProfit, profit);
                quantity = safeSub(quantity, txQty);
                totalCost = safeSub(totalCost, costOfSoldShares);
                
                let remainingToSell = txQty;
                while (remainingToSell > 0.000001 && taxLots.length > 0) {
                    const oldestLot = taxLots[0]; 
                    if (oldestLot.quantity > remainingToSell) {
                        oldestLot.quantity = safeSub(oldestLot.quantity, remainingToSell);
                        remainingToSell = 0;
                    } else {
                        remainingToSell = safeSub(remainingToSell, oldestLot.quantity);
                        taxLots.shift(); 
                    }
                }
            }
        }

        if (taxLots.length > 500) {
            const lotsToMerge = taxLots.slice(0, 100);
            const keptLots = taxLots.slice(100);
            let mergedQty = 0;
            let mergedCost = 0;
            
            lotsToMerge.forEach(l => {
                mergedQty = safeAdd(mergedQty, l.quantity);
                mergedCost = safeAdd(mergedCost, safeMult(l.quantity, l.price));
            });
            
            const mergedPrice = mergedQty > 0 ? safeDiv(mergedCost, mergedQty) : 0;
            
            taxLots = [{
                date: lotsToMerge[lotsToMerge.length - 1].date,
                quantity: mergedQty,
                price: mergedPrice,
                _id: false
            }, ...keptLots];
        }

        if (quantity < -0.000001) throw new Error(`Saldo insuficiente para ${ticker}.`);
        if (quantity <= 0.000001) { quantity = 0; totalCost = 0; taxLots = []; }

        let assetQuery = UserAsset.findOne({ user: userId, ticker });
        if (session) assetQuery.session(session);
        let asset = await assetQuery;

        if (!asset) {
            if (transactions.length > 0) {
                const marketInfo = await MarketAsset.findOne({ ticker });
                asset = new UserAsset({
                    user: userId, ticker,
                    type: forcedType || marketInfo?.type || 'STOCK',
                    currency: marketInfo?.currency || 'BRL'
                });
            } else { return null; }
        } else if (forcedType && asset.type !== forcedType) {
            asset.type = forcedType;
        }

        asset.quantity = quantity;
        asset.totalCost = safeCurrency(totalCost); 
        asset.realizedProfit = safeCurrency(realizedProfit);
        asset.taxLots = taxLots;
        asset.updatedAt = new Date();
        
        if (firstBuyDate && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
            asset.startDate = firstBuyDate;
        }

        await asset.save({ session }); 
        return asset;
    },

    async applyCorporateEvents(ticker, type) {
        return { processed: false, reason: "Feature disabled in optimization mode" };
    }
};
