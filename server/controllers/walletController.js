
import mongoose from 'mongoose';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import DividendEvent from '../models/DividendEvent.js'; 
import TreasuryBond from '../models/TreasuryBond.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent } from '../utils/mathUtils.js';
import logger from '../config/logger.js';

// --- HELPER: Busca data mais próxima no histórico ---
const findClosestValue = (history, targetDateStr) => {
    if (!history || history.length === 0) return null;
    const exact = history.find(h => h.date === targetDateStr);
    if (exact) return exact.close;
    const targetTime = new Date(targetDateStr).getTime();
    let closest = null;
    for (let i = 0; i < history.length; i++) {
        const itemTime = new Date(history[i].date).getTime();
        if (itemTime <= targetTime) closest = history[i];
        else break; 
    }
    return closest ? closest.close : null;
};

// --- HELPER: Reconciliação de Histórico (Snapshot Replay) ---
const reconcileSnapshotHistory = async (userId, ticker, type, quantityDelta, costDelta, txDate) => {
    try {
        const snapshots = await WalletSnapshot.find({ 
            user: userId, 
            date: { $gte: txDate } 
        }).sort({ date: 1 });

        if (snapshots.length === 0) return;

        logger.info(`🔄 [Replay] Reconciliando ${snapshots.length} snapshots para ${ticker}`);

        let priceHistory = [];
        if (type !== 'FIXED_INCOME' && type !== 'CASH') {
            priceHistory = await marketDataService.getBenchmarkHistory(ticker); 
        }

        const bulkOps = [];

        for (const snap of snapshots) {
            let assetPriceAtSnap = 0;
            const snapDateStr = snap.date.toISOString().split('T')[0];

            if (type === 'CASH') {
                assetPriceAtSnap = 1;
            } else if (type === 'FIXED_INCOME') {
                assetPriceAtSnap = 0; 
            } else {
                const histVal = findClosestValue(priceHistory, snapDateStr);
                if (histVal) {
                    assetPriceAtSnap = histVal;
                } else {
                    assetPriceAtSnap = safeDiv(costDelta, quantityDelta); 
                }
            }

            const deltaInvested = costDelta;
            let deltaEquity = 0;
            if (type === 'FIXED_INCOME') {
                deltaEquity = costDelta; 
            } else {
                deltaEquity = safeMult(quantityDelta, assetPriceAtSnap);
            }

            const newTotalInvested = safeAdd(snap.totalInvested, deltaInvested);
            const newTotalEquity = safeAdd(snap.totalEquity, deltaEquity);
            
            const newProfit = safeSub(newTotalEquity, newTotalInvested);
            let newProfitPercent = 0;
            if (newTotalInvested > 0) {
                newProfitPercent = safeMult(safeDiv(newProfit, newTotalInvested), 100);
            }

            bulkOps.push({
                updateOne: {
                    filter: { _id: snap._id },
                    update: { 
                        $set: { 
                            totalInvested: Math.max(0, newTotalInvested),
                            totalEquity: Math.max(0, newTotalEquity),
                            profit: newProfit,
                            profitPercent: newProfitPercent
                        } 
                    }
                }
            });
        }

        if (bulkOps.length > 0) {
            await WalletSnapshot.bulkWrite(bulkOps);
        }

    } catch (e) {
        logger.error(`❌ [Replay] Falha ao reconciliar histórico: ${e.message}`);
    }
};

const calculateUserDividendsInternal = async (userId) => {
    const assets = await UserAsset.find({ user: userId });
    const dividendMap = new Map();
    const provisioned = [];
    let totalAllTime = 0;
    
    const relevantAssets = assets.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
    const tickers = relevantAssets.map(a => a.ticker);

    if (tickers.length === 0) return { dividendMap, provisioned, totalAllTime };

    const firstTransactions = await AssetTransaction.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), ticker: { $in: tickers }, type: 'BUY' } },
        { $sort: { date: 1 } },
        { $group: { _id: "$ticker", firstBuyDate: { $first: "$date" } } }
    ]);

    const acquisitionMap = new Map();
    firstTransactions.forEach(tx => acquisitionMap.set(tx._id, new Date(tx.firstBuyDate)));

    const allEvents = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: -1 });
    const eventsByTicker = new Map();
    allEvents.forEach(evt => {
        if (!eventsByTicker.has(evt.ticker)) eventsByTicker.set(evt.ticker, []);
        eventsByTicker.get(evt.ticker).push(evt);
    });

    for (const asset of relevantAssets) {
        const acquisitionDate = acquisitionMap.get(asset.ticker) || asset.createdAt;
        const assetEvents = eventsByTicker.get(asset.ticker) || [];

        const lastEvent = assetEvents[0];
        const isStale = !lastEvent || (new Date() - lastEvent.createdAt > 1000 * 60 * 60 * 24 * 5); 

        if (isStale) {
            externalMarketService.getDividendsHistory(asset.ticker, asset.type)
                .then(async (yahooDivs) => {
                    if (yahooDivs && yahooDivs.length > 0) {
                        const ops = yahooDivs.map(d => ({
                            updateOne: {
                                filter: { ticker: asset.ticker, date: new Date(d.date), amount: d.amount },
                                update: { $setOnInsert: { 
                                    ticker: asset.ticker, 
                                    date: new Date(d.date), 
                                    amount: d.amount,
                                    paymentDate: new Date(new Date(d.date).setDate(new Date(d.date).getDate() + 15)) 
                                }},
                                upsert: true
                            }
                        }));
                        if (ops.length > 0) await DividendEvent.bulkWrite(ops);
                    }
                })
                .catch(err => logger.warn(`[Background] Falha sync div ${asset.ticker}`));
        }

        for (const event of assetEvents) {
            if (event.date < acquisitionDate) continue;

            const totalValue = safeMult(asset.quantity, event.amount);
            
            if (totalValue > 0) {
                const monthKey = event.date.toISOString().substring(0, 7); 
                const pDate = event.paymentDate || new Date(new Date(event.date).setDate(event.date.getDate() + 15));
                const recentCutoff = new Date();
                recentCutoff.setDate(recentCutoff.getDate() - 30);
                
                if (pDate >= recentCutoff) {
                    provisioned.push({
                        ticker: asset.ticker,
                        date: pDate,
                        amount: totalValue,
                        isProvisioned: true
                    });
                } else {
                    const current = dividendMap.get(monthKey) || 0;
                    dividendMap.set(monthKey, safeAdd(current, totalValue));
                    totalAllTime = safeAdd(totalAllTime, totalValue);
                }
            }
        }
    }

    return { dividendMap, provisioned, totalAllTime };
};

// --- CORE LOGIC: RECALCULATE POSITION (PM + FIFO) ---
const recalculatePosition = async (userId, ticker, forcedType = null) => {
    const transactions = await AssetTransaction.find({ user: userId, ticker }).sort({ date: 1, createdAt: 1 });
    
    // --- Variáveis de Estado (Preço Médio Ponderado) ---
    let quantity = 0;
    let totalCost = 0; 
    let realizedProfit = 0;
    
    // --- Variáveis de Estado (FIFO - Tax Lots) ---
    // Estrutura do Lote: { quantity: number, price: number, date: Date }
    let taxLots = []; 
    let fifoRealizedProfit = 0;

    let firstBuyDate = null;

    for (const tx of transactions) {
        const txQty = safeFloat(tx.quantity);
        const txTotal = safeFloat(tx.totalValue);
        const txPrice = safeFloat(tx.price);

        if (tx.type === 'BUY') {
            // Lógica PM
            quantity = safeAdd(quantity, txQty);
            totalCost = safeAdd(totalCost, txTotal);
            
            // Lógica FIFO (Cria novo lote)
            taxLots.push({
                quantity: txQty,
                price: txPrice,
                date: tx.date
            });

            if (!firstBuyDate) firstBuyDate = tx.date; 

        } else if (tx.type === 'SELL') {
            // Lógica PM (Lucro baseado no preço médio ATUAL)
            const currentAvgPrice = quantity > 0 ? safeDiv(totalCost, quantity) : 0;
            const costOfSoldShares = safeMult(txQty, currentAvgPrice);
            const profit = safeSub(txTotal, costOfSoldShares);
            
            realizedProfit = safeAdd(realizedProfit, profit);
            quantity = safeSub(quantity, txQty);
            totalCost = safeSub(totalCost, costOfSoldShares);

            // Lógica FIFO (Consome lotes mais antigos)
            let remainingToSell = txQty;
            
            // Processa a venda contra os lotes na fila
            while (remainingToSell > 0.000001 && taxLots.length > 0) {
                const oldestLot = taxLots[0]; // Peek
                
                if (oldestLot.quantity > remainingToSell) {
                    // Lote é maior que a venda: consome parcialmente o lote
                    const partialProfit = safeMult(remainingToSell, safeSub(txPrice, oldestLot.price));
                    fifoRealizedProfit = safeAdd(fifoRealizedProfit, partialProfit);
                    
                    oldestLot.quantity = safeSub(oldestLot.quantity, remainingToSell);
                    remainingToSell = 0;
                } else {
                    // Venda consome todo o lote: remove o lote e continua
                    const lotProfit = safeMult(oldestLot.quantity, safeSub(txPrice, oldestLot.price));
                    fifoRealizedProfit = safeAdd(fifoRealizedProfit, lotProfit);
                    
                    remainingToSell = safeSub(remainingToSell, oldestLot.quantity);
                    taxLots.shift(); // Dequeue
                }
            }
        }
        
        // Zera tudo se posição for fechada (evita resíduos de float)
        if (quantity <= 0.000001) {
            quantity = 0;
            totalCost = 0;
            firstBuyDate = null;
            taxLots = []; // Limpa lotes
        }
    }

    // Persistência
    let asset = await UserAsset.findOne({ user: userId, ticker });
    if (!asset) {
        if (transactions.length > 0) {
            const marketInfo = await MarketAsset.findOne({ ticker });
            asset = new UserAsset({
                user: userId,
                ticker,
                type: forcedType || marketInfo?.type || 'STOCK',
                currency: marketInfo?.currency || 'BRL'
            });
        } else {
            return null; 
        }
    } else if (forcedType && asset.type !== forcedType) {
        asset.type = forcedType;
    }

    asset.quantity = quantity;
    asset.totalCost = safeCurrency(totalCost); 
    asset.realizedProfit = safeCurrency(realizedProfit);
    
    // Novo Campo: Lucro FIFO
    asset.fifoRealizedProfit = safeCurrency(fifoRealizedProfit);

    asset.updatedAt = new Date();
    
    if (firstBuyDate && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
        asset.startDate = firstBuyDate;
    }

    await asset.save();
    return asset;
};

export const getWalletData = async (req, res, next) => {
    try {
        const start = performance.now();
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        const activeAssets = userAssets.filter(a => a.quantity > 0.000001);
        const closedAssets = userAssets.filter(a => a.quantity <= 0.000001);

        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0 },
                meta: { usdRate: 5.75 }
            });
        }

        const liveTickers = activeAssets.filter(a => a.type !== 'FIXED_INCOME' && a.type !== 'CASH').map(a => a.ticker);
        
        if (liveTickers.length > 0) {
            marketDataService.refreshQuotesBatch(liveTickers)
                .catch(err => logger.error(`[Background Sync] Erro: ${err.message}`));
        }

        const dbAssets = await MarketAsset.find({ ticker: { $in: liveTickers } }).select('ticker sector name lastPrice');
        const assetMap = new Map();
        dbAssets.forEach(a => {
            assetMap.set(a.ticker, {
                price: a.lastPrice,
                sector: a.sector,
                name: a.name
            });
        });

        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = safeFloat(config?.dollar || 5.75);
        const currentCdi = safeFloat(config?.cdi || 11.15); 

        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        
        let totalRealizedProfit = closedAssets.reduce((acc, curr) => {
            const isDollarized = curr.currency === 'USD' || curr.type === 'STOCK_US' || curr.type === 'CRYPTO';
            const mult = isDollarized ? usdRate : 1;
            const profitInBrl = safeMult((curr.realizedProfit || 0), mult);
            return safeAdd(acc, profitInBrl);
        }, 0);

        const processedAssets = activeAssets.map(asset => {
            let currentPrice = 0;
            let dayChangePct = 0; 
            const isDollarized = asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO';
            const currencyMultiplier = isDollarized ? usdRate : 1;

            if (asset.type === 'CASH') {
                // RENTABILIDADE DE CAIXA (CDI)
                const effectiveRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : 100;
                let cdiFactor = 1;
                if (effectiveRate > 30) {
                    cdiFactor = safeDiv(effectiveRate, 100); 
                }
                
                // Taxa diária do CDI (aprox)
                const dailyCdi = Math.pow(1 + (currentCdi / 100), 1 / 252) - 1;
                const dailyRate = dailyCdi * cdiFactor;

                currentPrice = 1; // Preço base da moeda é 1
                dayChangePct = dailyRate * 100; // Variação do dia em %

            } else if (asset.type === 'FIXED_INCOME') {
                const investedAmount = asset.totalCost; 
                let rawRate = safeFloat(asset.fixedIncomeRate || 10.0);
                let effectiveRate = rawRate;
                
                if (rawRate > 30) {
                    effectiveRate = safeMult(safeDiv(rawRate, 100), currentCdi);
                }

                const startDate = new Date(asset.startDate || asset.createdAt || new Date());
                const now = new Date();
                const diffTime = now - startDate;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
                
                if (diffDays <= 0) {
                    currentPrice = asset.quantity > 0 ? safeDiv(investedAmount, asset.quantity) : 0;
                    dayChangePct = 0;
                } else {
                    const estimatedBusinessDays = Math.floor(diffDays * 5 / 7);
                    const factor = Math.pow(1 + (effectiveRate / 100), estimatedBusinessDays / 252);
                    const currentTotalValueMath = safeMult(investedAmount, factor);
                    currentPrice = asset.quantity > 0 ? safeDiv(currentTotalValueMath, asset.quantity) : 0;
                    dayChangePct = (Math.pow(1 + (effectiveRate/100), 1/252) - 1) * 100;
                }
            } else {
                const cachedData = assetMap.get(asset.ticker);
                if (cachedData) {
                    currentPrice = safeFloat(Number(cachedData.price)) || safeFloat(asset.averagePrice);
                } else {
                    currentPrice = safeFloat(asset.averagePrice);
                }
            }
            
            const totalValueBr = safeMult(safeMult(asset.quantity, currentPrice), currencyMultiplier);
            const totalCostBr = safeMult(asset.totalCost, currencyMultiplier);
            const dayChangeValueBr = safeMult(totalValueBr, safeDiv(dayChangePct, 100));

            totalEquity = safeAdd(totalEquity, totalValueBr);
            totalInvested = safeAdd(totalInvested, totalCostBr);
            totalDayVariation = safeAdd(totalDayVariation, dayChangeValueBr);

            const unrealizedProfitBr = safeSub(totalValueBr, totalCostBr);
            const realizedProfitBr = safeMult((asset.realizedProfit || 0), currencyMultiplier);
            const positionTotalResult = safeAdd(unrealizedProfitBr, realizedProfitBr);
            
            let profitPercent = 0;
            if (totalCostBr > 0) {
                profitPercent = calculatePercent(positionTotalResult, totalCostBr); 
            }

            let sector = 'Geral';
            let assetName = asset.ticker;
            
            if (asset.type === 'FIXED_INCOME') sector = 'Renda Fixa';
            else if (asset.type === 'CASH') sector = 'Reserva';
            else {
                const cached = assetMap.get(asset.ticker);
                if (cached) {
                    sector = cached.sector || 'Geral';
                    assetName = cached.name || asset.ticker;
                }
            }

            return {
                id: asset._id,
                ticker: asset.ticker,
                name: assetName,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: asset.quantity > 0 ? safeDiv(asset.totalCost, asset.quantity) : 0,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: safeCurrency(totalValueBr), 
                totalCost: safeCurrency(totalCostBr),
                profit: safeCurrency(positionTotalResult),
                profitPercent: safeFloat(profitPercent),
                sector: sector,
                fixedIncomeRate: asset.fixedIncomeRate,
                fifoProfit: asset.fifoRealizedProfit || 0
            };
        });

        const currentUnrealized = safeSub(totalEquity, totalInvested);
        const totalResult = safeAdd(currentUnrealized, totalRealizedProfit);
        
        const { totalAllTime } = await calculateUserDividendsInternal(userId);

        const safeTotalEquity = safeCurrency(totalEquity);
        const safeTotalInvested = safeCurrency(totalInvested);
        const safeTotalResult = safeCurrency(totalResult);
        const safeTotalDayVariation = safeCurrency(totalDayVariation);
        const safeTotalDividends = safeCurrency(totalAllTime);

        let totalResultPercent = 0;
        if (safeTotalInvested > 0) {
            totalResultPercent = safeMult(safeDiv(safeTotalResult, safeTotalInvested), 100);
        }

        let dayVariationPercent = 0;
        if (safeTotalEquity > 0) {
            dayVariationPercent = safeMult(safeDiv(safeTotalDayVariation, safeTotalEquity), 100);
        }

        res.json({
            assets: processedAssets,
            kpis: {
                totalEquity: safeTotalEquity,
                totalInvested: safeTotalInvested,
                totalResult: safeTotalResult, 
                totalResultPercent: totalResultPercent,
                dayVariation: safeTotalDayVariation,
                dayVariationPercent: dayVariationPercent,
                totalDividends: safeTotalDividends
            },
            meta: { usdRate, lastUpdate: new Date() }
        });
    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    try {
        const { ticker, type, quantity, currency, date, fixedIncomeRate } = req.body;
        const rawPrice = req.body.price !== undefined ? req.body.price : req.body.averagePrice;
        const userId = req.user.id;
        
        if (!ticker) return res.status(400).json({ message: "Ticker obrigatório." });

        const cleanTicker = ticker.toUpperCase().trim();
        const numQty = safeFloat(parseFloat(quantity));
        const numPrice = safeFloat(parseFloat(rawPrice));
        
        const transactionDate = date ? new Date(date) : new Date();
        if (date) {
            const parts = date.split('-');
            transactionDate.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            transactionDate.setHours(0, 0, 0, 0);
        }

        if (isNaN(numQty) || isNaN(numPrice)) return res.status(400).json({ message: "Valores inválidos." });

        const txType = numQty >= 0 ? 'BUY' : 'SELL';
        const absQty = Math.abs(numQty);
        const txTotalValue = safeMult(absQty, numPrice);
        
        const newTx = new AssetTransaction({
            user: userId,
            ticker: cleanTicker,
            type: txType,
            quantity: absQty,
            price: numPrice,
            totalValue: txTotalValue,
            date: transactionDate,
            notes: 'Inserção Manual'
        });
        await newTx.save();

        if (type !== 'FIXED_INCOME' && type !== 'CASH') {
            try {
                const existingInGlobal = await MarketAsset.findOne({ ticker: cleanTicker });
                if (!existingInGlobal) {
                    await MarketAsset.create({
                        ticker: cleanTicker,
                        name: req.body.name || cleanTicker,
                        type: type,
                        currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL'),
                        sector: 'Outros',
                        lastPrice: numPrice
                    });
                }
                await marketDataService.refreshQuotesBatch([cleanTicker]);
            } catch (globalErr) {}
        }

        const updatedAsset = await recalculatePosition(userId, cleanTicker, type);
        
        if (updatedAsset && type === 'FIXED_INCOME') {
            updatedAsset.fixedIncomeRate = fixedIncomeRate || updatedAsset.fixedIncomeRate || 10.0;
            if (!updatedAsset.startDate || (updatedAsset.quantity === absQty)) { 
                updatedAsset.startDate = transactionDate;
            }
            await updatedAsset.save();
        }

        const qtyDelta = numQty; 
        const costDelta = txType === 'BUY' ? txTotalValue : -txTotalValue;
        
        reconcileSnapshotHistory(userId, cleanTicker, type, qtyDelta, costDelta, transactionDate)
            .catch(err => logger.error(`Erro no replay async: ${err.message}`));
        
        res.status(201).json(updatedAsset || { message: "Transação registrada." });
    } catch (error) { next(error); }
};

export const deleteTransaction = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tx = await AssetTransaction.findOne({ _id: id, user: req.user.id });
        if (!tx) return res.status(404).json({ message: "Transação não encontrada." });
        
        const ticker = tx.ticker;
        const txDate = tx.date;
        const txType = tx.type;
        const txQty = tx.quantity;
        const txValue = tx.totalValue;

        const reverseQty = txType === 'BUY' ? -txQty : txQty;
        const reverseCost = txType === 'BUY' ? -txValue : txValue;

        await AssetTransaction.deleteOne({ _id: id });
        const updatedAsset = await recalculatePosition(req.user.id, ticker);
        
        reconcileSnapshotHistory(req.user.id, ticker, updatedAsset?.type || 'STOCK', reverseQty, reverseCost, txDate)
            .catch(err => logger.error(`Erro no replay delete: ${err.message}`));

        res.json({ message: "Transação removida." });
    } catch (error) { next(error); }
};

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = { user: req.user.id, ticker: ticker.toUpperCase() };

        const totalItems = await AssetTransaction.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            transactions,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                hasMore: page < totalPages
            }
        });
    } catch (error) { next(error); }
};

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]); 
        
        const regex = new RegExp(query, 'i');
        const tickerRegex = new RegExp(`^${query}`, 'i');
        
        let results = [];

        const marketAssets = await MarketAsset.find({ 
            $or: [{ ticker: tickerRegex }, { name: regex }] 
        }).select('ticker name lastPrice type').limit(5);
        
        results = marketAssets.map(a => ({ 
            ticker: a.ticker, 
            name: a.name, 
            price: a.lastPrice, 
            type: a.type 
        }));

        const treasuryBonds = await TreasuryBond.find({ title: regex }).limit(5);
        const treasuryResults = treasuryBonds.map(b => ({
            ticker: b.title, name: b.title, price: b.minInvestment, type: 'FIXED_INCOME', rate: b.rate 
        }));
        results = [...results, ...treasuryResults];

        const fixedMatches = POPULAR_FIXED_INCOME.filter(p => p.name.match(regex)).slice(0, 5);
        const fixedResults = fixedMatches.map(p => ({
            ticker: p.name, name: p.name, price: 0, type: 'FIXED_INCOME', rate: p.rate, isManual: true
        }));
        results = [...results, ...fixedResults];

        const upperQ = query.toUpperCase();
        if (results.length === 0 && (upperQ.includes('CDB') || upperQ.includes('LCI') || upperQ.includes('LCA'))) {
            results.push({
                ticker: query.toUpperCase(),
                name: `Título Privado: ${query}`,
                price: 0,
                type: 'FIXED_INCOME',
                isManual: true
            });
        }

        return res.json(results.slice(0, 10)); 
    } catch (error) { next(error); }
};

export const removeAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const asset = await UserAsset.findOne({ _id: id, user: req.user.id });
        if (asset) {
            await AssetTransaction.deleteMany({ user: req.user.id, ticker: asset.ticker });
            await UserAsset.deleteOne({ _id: id });
        }
        res.json({ message: "Ativo removido." });
    } catch (error) { next(error); }
};

export const resetWallet = async (req, res, next) => {
    try {
        await UserAsset.deleteMany({ user: req.user.id });
        await AssetTransaction.deleteMany({ user: req.user.id });
        await WalletSnapshot.deleteMany({ user: req.user.id });
        res.json({ message: "Carteira resetada." });
    } catch (error) { next(error); }
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const snapshots = await WalletSnapshot.find({ user: userId }).sort({ date: 1 }).limit(365);
        res.json(snapshots);
    } catch (error) { next(error); }
};

export const getWalletPerformance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        let history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        const userAssets = await UserAsset.find({ user: userId });
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = safeFloat(config?.dollar || 5.75);
        const currentCdi = safeFloat(config?.cdi || 11.15); 

        let currentEquity = 0;
        let currentInvested = 0; 

        if (userAssets.length > 0) {
            const tickers = userAssets.map(a => a.ticker);
            const dbAssets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice');
            const priceMap = new Map();
            dbAssets.forEach(a => priceMap.set(a.ticker, a.lastPrice));

            userAssets.forEach(asset => {
                if (asset.quantity > 0) {
                    let price = priceMap.get(asset.ticker) || asset.averagePrice; 
                    if (asset.type === 'CASH') price = 1;
                    if (asset.type === 'FIXED_INCOME') {
                        const invested = asset.totalCost;
                        const rate = asset.fixedIncomeRate || 10.0;
                        const diffTime = Math.max(0, new Date().getTime() - new Date(asset.startDate || new Date()).getTime());
                        const diffDays = diffTime / (1000 * 3600 * 24);
                        // Base 252 (Estimatada) para Performance também
                        const businessDays = Math.floor(diffDays * 5 / 7);
                        const factor = Math.pow(1 + (rate/100), businessDays/252);
                        price = (invested * factor) / asset.quantity;
                    }
                    const mult = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;
                    currentEquity = safeAdd(currentEquity, safeMult(safeMult(asset.quantity, price), mult));
                    currentInvested = safeAdd(currentInvested, safeMult(asset.totalCost, mult));
                }
            });
        }

        let result = [];

        if (history.length === 0 && currentEquity > 0) {
            const oldestTx = await AssetTransaction.findOne({ user: userId }).sort({ date: 1 });
            if (oldestTx) {
                history = [{
                    date: oldestTx.date,
                    totalEquity: oldestTx.totalValue, 
                    totalInvested: oldestTx.totalValue
                }];
            } else {
                 const today = new Date();
                 history = [{ date: today, totalEquity: currentEquity, totalInvested: currentInvested }];
            }
        }

        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP'); 
        if (ibovHistory) {
            ibovHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        }

        const cdiDaily = Math.pow(1 + 0.115, 1/252) - 1; 

        if (history.length > 0) {
            const startDate = new Date(history[0].date);
            const startIbovVal = findClosestValue(ibovHistory, startDate.toISOString().split('T')[0]);
            const startIbov = startIbovVal || 1;

            result = history.map((snap, idx) => {
                const dateStr = new Date(snap.date).toISOString().split('T')[0];
                const invested = snap.totalInvested || 1;
                const equity = snap.totalEquity || 0;
                const walletRentability = invested > 0 ? ((equity - invested) / invested) * 100 : 0;
                
                // Base 252 para CDI
                const daysDiff = Math.floor((new Date(snap.date) - startDate) / (1000 * 60 * 60 * 24));
                const businessDays = Math.floor(daysDiff * 5 / 7);
                const cdiValue = (Math.pow(1 + cdiDaily, Math.max(0, businessDays)) - 1) * 100;

                const currentIbovVal = findClosestValue(ibovHistory, dateStr);
                const ibovValue = currentIbovVal ? ((currentIbovVal - startIbov) / startIbov) * 100 : 0;

                return {
                    date: dateStr,
                    wallet: safeFloat(walletRentability),
                    cdi: safeFloat(cdiValue),
                    ibov: safeFloat(ibovValue)
                };
            });

            const lastResultDate = result.length > 0 ? result[result.length - 1].date : '';
            const todayStr = new Date().toISOString().split('T')[0];

            if (currentEquity > 0 && lastResultDate !== todayStr) {
                const walletNow = currentInvested > 0 ? ((currentEquity - currentInvested) / currentInvested) * 100 : 0;
                const daysDiff = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));
                const businessDays = Math.floor(daysDiff * 5 / 7);
                const cdiNow = (Math.pow(1 + cdiDaily, businessDays) - 1) * 100;
                
                const currentIbovVal = findClosestValue(ibovHistory, todayStr);
                const lastKnownIbov = currentIbovVal || (ibovHistory ? ibovHistory[ibovHistory.length - 1].close : startIbov);
                const ibovNow = ((lastKnownIbov - startIbov) / startIbov) * 100;

                result.push({
                    date: todayStr,
                    wallet: safeFloat(walletNow),
                    cdi: safeFloat(cdiNow),
                    ibov: safeFloat(ibovNow)
                });
            }
        }

        res.json(result);

    } catch (error) {
        logger.error(`Erro Performance: ${error.message}`);
        next(error);
    }
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { dividendMap, provisioned, totalAllTime } = await calculateUserDividendsInternal(userId);

        const history = Array.from(dividendMap.entries())
            .map(([month, value]) => ({ month, value: safeCurrency(value) }))
            .sort((a, b) => a.month.localeCompare(b.month));

        res.json({
            history, 
            provisioned: provisioned.sort((a, b) => new Date(a.date) - new Date(b.date)),
            totalAllTime: safeCurrency(totalAllTime), 
            debug: { totalCalculated: totalAllTime }
        });

    } catch (error) {
        logger.error(`Erro Dividendos: ${error.message}`);
        next(error);
    }
};

// --- NOVO: EXTRATO DE CONTA (UNIFICADO) ---
export const getCashFlow = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filterType = req.query.filterType; // 'ALL', 'CASH', 'TRADE'
        const skip = (page - 1) * limit;
        const userId = req.user.id;

        // 1. Identificar tickers de Caixa para diferenciar e filtrar
        const cashAssets = await UserAsset.find({ user: userId, type: 'CASH' }).select('ticker');
        const cashTickers = cashAssets.map(a => a.ticker);
        
        // Garante que 'RESERVA' sempre esteja na lista de caixa
        if (!cashTickers.includes('RESERVA')) {
            cashTickers.push('RESERVA');
        }

        let query = { user: userId };

        // 2. Aplicar Filtros Dinâmicos
        if (filterType === 'CASH') {
            query.ticker = { $in: cashTickers };
        } else if (filterType === 'TRADE') {
            query.ticker = { $nin: cashTickers };
        }
        // Se filterType === 'ALL' ou undefined, retorna tudo

        const totalItems = await AssetTransaction.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            transactions: transactions.map(tx => ({
                ...tx.toObject(),
                isCashOp: cashTickers.includes(tx.ticker) // Flag para o frontend pintar diferente
            })),
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                hasMore: page < totalPages
            }
        });
    } catch (error) {
        logger.error(`Erro CashFlow: ${error.message}`);
        next(error);
    }
};
