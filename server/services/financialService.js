
import mongoose from 'mongoose';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UserAsset from '../models/UserAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import { marketDataService } from './marketDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv } from '../utils/mathUtils.js';
import logger from '../config/logger.js';

// Tabela de CDI Anual Simplificada para cálculos históricos rápidos
const HISTORICAL_CDI_YEAR = {
    2019: 5.96, 2020: 2.77, 2021: 4.42, 2022: 12.39, 2023: 13.04, 2024: 10.80, 2025: 11.25, 2026: 11.25
};

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

    findPriceData(history, dateStr) {
        if (!history || history.length === 0) return { close: 0, adjClose: 0 };
        
        const exact = history.find(h => h.date === dateStr);
        if (exact) return { 
            close: exact.close || 0, 
            adjClose: exact.adjClose || exact.close || 0 
        };

        const targetTime = new Date(dateStr).getTime();
        const lastPoint = history[history.length - 1];
        if (new Date(lastPoint.date).getTime() <= targetTime) {
             return { 
                close: lastPoint.close || 0, 
                adjClose: lastPoint.adjClose || lastPoint.close || 0 
            };
        }

        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const hTime = new Date(h.date).getTime();
            if (hTime <= targetTime) {
                return { 
                    close: h.close || 0, 
                    adjClose: h.adjClose || h.close || 0 
                };
            }
        }

        return { close: 0, adjClose: 0 };
    },

    findClosestValue(history, targetDateStr) {
        const data = this.findPriceData(history, targetDateStr);
        return data.adjClose || data.close || 0;
    },

    findHistoricalPrice(history, targetDateStr) {
        const data = this.findPriceData(history, targetDateStr);
        return data.close;
    },

    // --- ENGINE V4.4: CORREÇÃO RENDA FIXA (MARK-TO-CURVE) ---
    async rebuildUserHistory(userId) {
        const startTime = Date.now();
        logger.info(`🛠️ [History] Iniciando reconstrução (Engine V4.4) para User ${userId}...`);
        
        try {
            const txs = await AssetTransaction.find({ user: userId }).sort({ date: 1 });
            if (txs.length === 0) {
                await WalletSnapshot.deleteMany({ user: userId });
                logger.info(`   ➤ Sem transações. Snapshots limpos.`);
                return;
            }

            const uniqueTickers = [...new Set(txs.map(t => t.ticker))];
            const priceMap = new Map();
            const assetMetadataMap = new Map(); // Para guardar tipo/taxa da Renda Fixa

            // 1. Carrega Histórico de Preços e Metadados
            logger.info(`   ➤ Pré-carregando históricos para ${uniqueTickers.length} ativos...`);
            
            // Busca metadados dos ativos para saber se são Renda Fixa
            const userAssets = await UserAsset.find({ user: userId });
            userAssets.forEach(ua => assetMetadataMap.set(ua.ticker, ua));

            await Promise.all(uniqueTickers.map(async (ticker) => {
                const assetMeta = assetMetadataMap.get(ticker);
                const isFixed = assetMeta?.type === 'FIXED_INCOME' || assetMeta?.type === 'CASH' || ticker === 'RESERVA';

                if (isFixed) return; // Renda Fixa calculada matematicamente no loop

                try {
                    const searchTicker = this.normalizeTickerForHistory(ticker);
                    let history = await marketDataService.getBenchmarkHistory(ticker);
                    let needsRefresh = !history || history.length < 5;

                    if (needsRefresh) {
                        await AssetHistory.deleteOne({ ticker: ticker.toUpperCase() });
                        const info = await MarketAsset.findOne({ ticker });
                        const type = info?.type || (ticker.length > 5 ? 'FII' : 'STOCK');
                        
                        try {
                            history = await externalMarketService.getFullHistory(searchTicker, type);
                            if (history && history.length > 0) {
                                await AssetHistory.create({
                                    ticker: ticker.toUpperCase(),
                                    history: history,
                                    lastUpdated: new Date()
                                });
                            }
                        } catch (extErr) {
                            logger.warn(`      ⚠️ Falha ao baixar ${ticker}: ${extErr.message}`);
                        }
                    }
                    
                    if (history && history.length > 0) {
                        history.sort((a, b) => new Date(a.date) - new Date(b.date));
                        priceMap.set(ticker, history);
                    }
                } catch (e) {
                    logger.warn(`Falha no loop de histórico para ${ticker}: ${e.message}`);
                }
            }));

            const startDate = new Date(txs[0].date);
            startDate.setHours(12, 0, 0, 0); 
            const today = new Date();
            today.setHours(12, 0, 0, 0);

            const snapshots = [];
            const portfolio = {}; 
            
            // Controle acumulado para Renda Fixa
            const fixedIncomeState = {};

            let cursor = new Date(startDate);
            let txIndex = 0;
            let daysProcessed = 0;

            // OTIMIZAÇÃO: Busca única de dividendos
            const allDividends = await DividendEvent.find({ ticker: { $in: uniqueTickers } }).sort({ date: 1 });
            let accumulatedDividends = 0;

            let currentQuota = 100.0; 
            let previousEquityNominal = 0;
            let previousEquityAdjusted = 0; 
            
            const lastKnownPrices = {}; 

            logger.info(`   ➤ Calculando evolução diária de ${startDate.toISOString().split('T')[0]} até hoje...`);

            while (cursor <= today) {
                daysProcessed++;
                if (daysProcessed % 365 === 0) await new Promise(resolve => setImmediate(resolve));

                const cursorIso = this.toDateKey(cursor);
                
                // Determina Taxa Diária do CDI para este dia do loop
                const year = cursor.getFullYear();
                const cdiYear = HISTORICAL_CDI_YEAR[year] || 11.25;
                const cdiDailyFactor = Math.pow(1 + (cdiYear / 100), 1/252);

                // --- 1. PROCESSAMENTO DE TRANSAÇÕES ---
                let dayFlowNominal = 0;
                let dayFlowAdjusted = 0;
                
                while (txIndex < txs.length) {
                    const tx = txs[txIndex];
                    const txDateIso = this.toDateKey(tx.date);
                    
                    if (txDateIso > cursorIso) break; 

                    if (!portfolio[tx.ticker]) {
                        portfolio[tx.ticker] = { qty: 0, cost: 0 };
                        // Inicializa estado de RF se necessário
                        const meta = assetMetadataMap.get(tx.ticker);
                        if (meta && (meta.type === 'FIXED_INCOME' || meta.type === 'CASH')) {
                            // IMPORTANTE: currentValue começa zerado e sobe com as compras
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
                        const h = priceMap.get(tx.ticker);
                        const pData = this.findPriceData(h, cursorIso);
                        if (pData.adjClose > 0) txAdjPrice = pData.adjClose;
                    }

                    if (tx.type === 'BUY') {
                        portfolio[tx.ticker].qty += tx.quantity;
                        portfolio[tx.ticker].cost += tx.totalValue;
                        
                        if (isFixed) {
                            // Para Renda Fixa, o valor da compra é adicionado ao saldo atual (Mark-to-Curve base)
                            if (!fixedIncomeState[tx.ticker]) {
                                 fixedIncomeState[tx.ticker] = { currentValue: 0, rate: meta?.fixedIncomeRate || 100 };
                            }
                            fixedIncomeState[tx.ticker].currentValue += tx.totalValue;
                        }

                        dayFlowNominal += tx.totalValue;
                        dayFlowAdjusted += (tx.quantity * txAdjPrice);

                        if (!lastKnownPrices[tx.ticker]) {
                            lastKnownPrices[tx.ticker] = { close: tx.price, adjClose: txAdjPrice };
                        }

                    } else if (tx.type === 'SELL') {
                        const currentAvg = portfolio[tx.ticker].qty > 0 ? portfolio[tx.ticker].cost / portfolio[tx.ticker].qty : 0;
                        portfolio[tx.ticker].qty -= tx.quantity;
                        portfolio[tx.ticker].cost -= (tx.quantity * currentAvg);
                        
                        if (isFixed) {
                            // Reduz proporcionalmente do saldo atual
                            const withdrawValue = tx.totalValue;
                            fixedIncomeState[tx.ticker].currentValue -= withdrawValue;
                            if (fixedIncomeState[tx.ticker].currentValue < 0) fixedIncomeState[tx.ticker].currentValue = 0;
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

                // --- 2. DIVIDENDOS ---
                const dayDividends = allDividends.filter(d => this.toDateKey(d.date) === cursorIso);
                for (const div of dayDividends) {
                    if (portfolio[div.ticker] && portfolio[div.ticker].qty > 0) {
                        accumulatedDividends += (portfolio[div.ticker].qty * div.amount);
                    }
                }

                // --- 3. MARK TO MARKET (Com Juros Compostos para RF) ---
                let totalEquityNominal = 0;
                let totalEquityAdjusted = 0;
                let totalInvested = 0;
                let hasPosition = false;

                // Aplica juros diários para todos ativos de RF ativos (excluindo FDS)
                const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
                if (!isWeekend) {
                    for (const ticker in fixedIncomeState) {
                        if (portfolio[ticker].qty > 0) {
                            const state = fixedIncomeState[ticker];
                            let dailyFactor = 1;
                            
                            // Lógica de Rentabilidade Diária
                            if (state.rate > 30) { // % do CDI (Ex: 100%)
                                // Fórmula: 1 + (TaxaCDIDiaria - 1) * (Percentual / 100)
                                dailyFactor = 1 + ((cdiDailyFactor - 1) * (state.rate / 100));
                            } else { // Pré (Ex: 10%)
                                dailyFactor = Math.pow(1 + (state.rate / 100), 1/252);
                            }
                            state.currentValue *= dailyFactor;
                        }
                    }
                }

                for (const [ticker, pos] of Object.entries(portfolio)) {
                    if (pos.qty <= 0) continue;
                    hasPosition = true;
                    totalInvested += pos.cost;
                    
                    let markClose = 0;
                    let markAdjClose = 0;
                    
                    if (fixedIncomeState[ticker]) {
                        // Para RF, o "Preço" é o Valor Atualizado / Quantidade
                        const val = fixedIncomeState[ticker].currentValue;
                        const unitPrice = pos.qty > 0 ? val / pos.qty : 1;
                        markClose = unitPrice;
                        markAdjClose = unitPrice;
                    } else {
                        const history = priceMap.get(ticker);
                        const pData = this.findPriceData(history, cursorIso);
                        
                        if (pData.close > 0) {
                            markClose = pData.close;
                            markAdjClose = pData.adjClose;
                            lastKnownPrices[ticker] = pData; 
                        } else {
                            markClose = lastKnownPrices[ticker]?.close || (pos.qty > 0 ? pos.cost / pos.qty : 0);
                            markAdjClose = lastKnownPrices[ticker]?.adjClose || markClose;
                        }
                    }
                    
                    totalEquityNominal += pos.qty * markClose;
                    totalEquityAdjusted += pos.qty * markAdjClose;
                }

                // --- 4. TWRR ---
                if (previousEquityAdjusted > 0) {
                    const capitalGainAdj = totalEquityAdjusted - previousEquityAdjusted - dayFlowAdjusted;
                    const denominator = previousEquityAdjusted + (dayFlowAdjusted * 0.5);
                    
                    if (denominator > 0.01) {
                        const dailyReturn = capitalGainAdj / denominator;
                        // Circuit breaker para TWRR diário (evita picos causados por dados sujos)
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
                try {
                    session.startTransaction();
                    await WalletSnapshot.deleteMany({ user: userId }).session(session);
                    
                    const BATCH_SIZE = 2000;
                    for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
                        await WalletSnapshot.insertMany(snapshots.slice(i, i + BATCH_SIZE), { session });
                    }
                    await session.commitTransaction();
                } catch (writeErr) {
                    await session.abortTransaction();
                    throw writeErr;
                } finally {
                    session.endSession();
                }
            }
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [History] Reconstrução concluída em ${duration}s.`);

        } catch (error) {
            logger.error(`❌ [Engine] Erro Fatal no Rebuild: ${error.message}`);
        }
    },

    async calculateUserDividends(userId) {
        const assets = await UserAsset.find({ user: userId });
        const relevantAssets = assets.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
        const tickers = relevantAssets.map(a => a.ticker);

        if (tickers.length === 0) return { dividendMap: new Map(), provisioned: [], totalAllTime: 0, projectedMonthly: 0 };

        // 1. Batch Fetch Market Data (DY) - Otimização de I/O
        const marketInfos = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker dy lastPrice');
        const marketMap = new Map();
        marketInfos.forEach(m => marketMap.set(m.ticker, m));

        // 2. Calculate Projected Monthly
        let projectedMonthly = 0;
        relevantAssets.forEach(asset => {
            const mInfo = marketMap.get(asset.ticker);
            if (mInfo && mInfo.dy > 0) {
                const annualIncome = (asset.quantity * mInfo.lastPrice) * (mInfo.dy / 100);
                projectedMonthly += (annualIncome / 12);
            }
        });

        // 3. Batch Fetch Dividends (CORREÇÃO CRÍTICA N+1)
        // Busca TODOS os dividendos de UMA vez
        const allEvents = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: 1 });
        const eventsMap = new Map();
        
        // Agrupa eventos em memória
        allEvents.forEach(e => {
            if (!eventsMap.has(e.ticker)) eventsMap.set(e.ticker, []);
            eventsMap.get(e.ticker).push(e);
        });

        // 4. Batch Fetch First Transactions (Acquisition Date)
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

        // 5. Processamento em Memória (Sem chamadas ao DB dentro do loop)
        for (const asset of relevantAssets) {
            const firstBuyDate = acquisitionMap.get(asset.ticker);
            const assetEvents = eventsMap.get(asset.ticker) || []; // Pega da memória

            for (const event of assetEvents) {
                const eventDateNormalized = this.normalizeDate(event.date);
                
                // Só conta dividendos cuja Data COM é posterior à data da primeira compra
                if (!firstBuyDate || eventDateNormalized < firstBuyDate) continue;

                const totalValue = safeMult(asset.quantity, event.amount);
                
                if (totalValue > 0) {
                    const pDate = event.paymentDate || new Date(new Date(event.date).setDate(event.date.getDate() + 15));
                    const today = new Date();
                    const isFuture = pDate > today;
                    
                    if (isFuture) {
                        provisioned.push({
                            ticker: asset.ticker,
                            date: pDate,
                            amount: totalValue,
                            isProvisioned: true
                        });
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

    // --- CORREÇÃO IMPORTANTE: FUNÇÃO RESTAURADA ---
    async recalculatePosition(userId, ticker, forcedType = null, session = null) {
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
        const splits = await externalMarketService.getSplitsHistory(ticker, type);
        return { processed: false, reason: "No splits found" };
    }
};
