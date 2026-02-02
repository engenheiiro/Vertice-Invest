
import mongoose from 'mongoose';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UserAsset from '../models/UserAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import MarketAsset from '../models/MarketAsset.js';
import { marketDataService } from './marketDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv } from '../utils/mathUtils.js';
import logger from '../config/logger.js';

export const financialService = {
    
    toDateKey(date) {
        if (!date) return null;
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    },

    findClosestValue(history, targetDateStr) {
        if (!history || !Array.isArray(history) || history.length === 0) return null;
        const match = history.find(h => h.date <= targetDateStr);
        return match ? match.close : null;
    },

    async rebuildUserHistory(userId) {
        const session = await mongoose.startSession();
        try {
            // ... (Lógica V5 mantida - Time Machine)
            // Para economizar tokens e foco, mantemos a lógica V5 anterior que já estava correta quanto ao loop.
            // O foco aqui é garantir que calculateUserDividends esteja perfeito.
            
            const txs = await AssetTransaction.find({ user: userId }).sort({ date: 1 });
            if (txs.length === 0) {
                await WalletSnapshot.deleteMany({ user: userId });
                return;
            }

            const uniqueTickers = [...new Set(txs.map(t => t.ticker))];
            const priceMap = new Map();

            await Promise.all(uniqueTickers.map(async (ticker) => {
                if (['RESERVA', 'CDI', 'SELIC'].includes(ticker)) return;
                let history = await marketDataService.getBenchmarkHistory(ticker);
                if (!history || history.length < 5) {
                    const info = await MarketAsset.findOne({ ticker });
                    history = await externalMarketService.getFullHistory(ticker, info?.type || 'STOCK');
                }
                if (history && history.length > 0) {
                    history.sort((a, b) => new Date(b.date) - new Date(a.date));
                    priceMap.set(ticker, history);
                }
            }));

            const startDate = new Date(txs[0].date);
            startDate.setHours(12, 0, 0, 0);
            const today = new Date();
            today.setHours(12, 0, 0, 0);

            const snapshots = [];
            const portfolio = {}; 
            let cursor = new Date(startDate);
            let txIndex = 0;

            while (cursor <= today) {
                const cursorIso = this.toDateKey(cursor);
                while (txIndex < txs.length) {
                    const tx = txs[txIndex];
                    const txDateIso = this.toDateKey(tx.date);
                    if (txDateIso > cursorIso) break;

                    if (!portfolio[tx.ticker]) portfolio[tx.ticker] = { qty: 0, cost: 0 };
                    if (tx.type === 'BUY') {
                        portfolio[tx.ticker].qty += tx.quantity;
                        portfolio[tx.ticker].cost += tx.totalValue;
                    } else if (tx.type === 'SELL') {
                        const currentAvg = portfolio[tx.ticker].qty > 0 ? portfolio[tx.ticker].cost / portfolio[tx.ticker].qty : 0;
                        portfolio[tx.ticker].qty -= tx.quantity;
                        portfolio[tx.ticker].cost -= (tx.quantity * currentAvg);
                    }
                    if (portfolio[tx.ticker].qty < 0.000001) {
                        portfolio[tx.ticker].qty = 0;
                        portfolio[tx.ticker].cost = 0;
                    }
                    txIndex++;
                }

                let totalEquity = 0;
                let totalInvested = 0;
                let hasPosition = false;

                for (const [ticker, pos] of Object.entries(portfolio)) {
                    if (pos.qty <= 0) continue;
                    hasPosition = true;
                    totalInvested += pos.cost;
                    
                    let markPrice = 0;
                    if (ticker === 'RESERVA' || ticker.includes('CDB') || ticker.includes('LCI')) {
                        markPrice = pos.qty > 0 ? pos.cost / pos.qty : 1;
                    } else {
                        const history = priceMap.get(ticker);
                        const historicalPrice = this.findClosestValue(history, cursorIso);
                        markPrice = historicalPrice ? historicalPrice : (pos.qty > 0 ? pos.cost / pos.qty : 0);
                    }
                    totalEquity += pos.qty * markPrice;
                }

                if (hasPosition && totalInvested > 0) {
                    const lastSnap = snapshots[snapshots.length - 1];
                    const isDuplicate = lastSnap && this.toDateKey(lastSnap.date) === cursorIso;
                    if (!isDuplicate) {
                        snapshots.push({
                            user: userId,
                            date: new Date(cursor),
                            totalEquity: safeCurrency(totalEquity),
                            totalInvested: safeCurrency(totalInvested),
                            profit: safeCurrency(totalEquity - totalInvested),
                            profitPercent: safeFloat(((totalEquity - totalInvested) / totalInvested) * 100)
                        });
                    }
                }
                cursor.setDate(cursor.getDate() + 1);
            }

            if (snapshots.length > 0) {
                session.startTransaction();
                await WalletSnapshot.deleteMany({ user: userId }).session(session);
                await WalletSnapshot.insertMany(snapshots, { session });
                await session.commitTransaction();
            }
        } catch (error) {
            await session.abortTransaction();
            logger.error(`❌ [Engine] Erro: ${error.message}`);
        } finally {
            session.endSession();
        }
    },

    // --- CORREÇÃO CRÍTICA DE DIVIDENDOS ---
    async calculateUserDividends(userId) {
        // 1. Pega os ativos atuais
        const assets = await UserAsset.find({ user: userId });
        const relevantAssets = assets.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
        const tickers = relevantAssets.map(a => a.ticker);

        if (tickers.length === 0) return { dividendMap: new Map(), provisioned: [], totalAllTime: 0 };

        // 2. Descobre a data da PRIMEIRA COMPRA de cada ativo
        // Isso é crucial para não contar dividendos de 2020 se comprou em 2024
        const firstTransactions = await AssetTransaction.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), ticker: { $in: tickers }, type: 'BUY' } },
            { $sort: { date: 1 } },
            { $group: { _id: "$ticker", firstBuyDate: { $first: "$date" } } }
        ]);

        const acquisitionMap = new Map();
        firstTransactions.forEach(tx => acquisitionMap.set(tx._id, new Date(tx.firstBuyDate)));

        // 3. Busca eventos de dividendos no banco
        const allEvents = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: -1 });
        const eventsByTicker = new Map();
        allEvents.forEach(evt => {
            if (!eventsByTicker.has(evt.ticker)) eventsByTicker.set(evt.ticker, []);
            eventsByTicker.get(evt.ticker).push(evt);
        });

        const dividendMap = new Map(); // Key: "YYYY-MM" -> { total: number, breakdown: [{ticker, amount}] }
        const provisioned = [];
        let totalAllTime = 0;

        for (const asset of relevantAssets) {
            // Data de corte: Usa a primeira transação ou a criação do ativo, o que for mais antigo
            const acquisitionDate = acquisitionMap.get(asset.ticker) || asset.createdAt;
            const assetEvents = eventsByTicker.get(asset.ticker) || [];

            // Sync Otimista se faltar dados
            if (assetEvents.length === 0) {
                externalMarketService.getDividendsHistory(asset.ticker, asset.type)
                    .then(async (yahooDivs) => {
                        if (yahooDivs && yahooDivs.length > 0) {
                            const ops = yahooDivs.map(d => ({
                                updateOne: {
                                    filter: { ticker: asset.ticker, date: new Date(d.date), amount: d.amount },
                                    update: { $setOnInsert: { ticker: asset.ticker, date: new Date(d.date), amount: d.amount }},
                                    upsert: true
                                }
                            }));
                            if (ops.length > 0) await DividendEvent.bulkWrite(ops);
                        }
                    }).catch(() => {});
            }

            for (const event of assetEvents) {
                // STRICT GATE: Ignora se o evento foi antes da compra
                if (new Date(event.date) < new Date(acquisitionDate)) continue;

                const totalValue = safeMult(asset.quantity, event.amount);
                
                if (totalValue > 0) {
                    // Data de Pagamento (Estimada em D+15 se não houver)
                    const pDate = event.paymentDate || new Date(new Date(event.date).setDate(event.date.getDate() + 15));
                    
                    // Lógica de Provisionamento (Futuro ou Recente não pago)
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
                        // Histórico Recebido
                        const monthKey = pDate.toISOString().substring(0, 7); // YYYY-MM
                        
                        if (!dividendMap.has(monthKey)) {
                            dividendMap.set(monthKey, { total: 0, breakdown: [] });
                        }
                        
                        const entry = dividendMap.get(monthKey);
                        entry.total = safeAdd(entry.total, totalValue);
                        
                        // Adiciona ao breakdown (agrupando por ticker no mesmo mês)
                        const existingBreakdown = entry.breakdown.find(b => b.ticker === asset.ticker);
                        if (existingBreakdown) {
                            existingBreakdown.amount = safeAdd(existingBreakdown.amount, totalValue);
                        } else {
                            entry.breakdown.push({ ticker: asset.ticker, amount: totalValue });
                        }

                        totalAllTime = safeAdd(totalAllTime, totalValue);
                    }
                }
            }
        }

        return { dividendMap, provisioned, totalAllTime };
    },

    async recalculatePosition(userId, ticker, forcedType = null, session = null) {
        // ... (Mantido inalterado, lógica V5 de Recalculate está sólida)
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
            const txTotal = safeFloat(tx.totalValue);
            const txPrice = safeFloat(tx.price);

            if (tx.type === 'BUY') {
                quantity = safeAdd(quantity, txQty);
                totalCost = safeAdd(totalCost, txTotal);
                taxLots.push({ quantity: txQty, price: txPrice, date: tx.date });
                if (!firstBuyDate) firstBuyDate = tx.date; 
            } else if (tx.type === 'SELL') {
                const currentAvgPrice = quantity > 0 ? safeDiv(totalCost, quantity) : 0;
                const costOfSoldShares = safeMult(txQty, currentAvgPrice);
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
        if (firstBuyDate && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) asset.startDate = firstBuyDate;

        await asset.save({ session }); 
        return asset;
    }
};
