
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

// --- LISTA DE PRODUTOS POPULARES ---
const POPULAR_FIXED_INCOME = [
    { name: 'Sofisa Direto (CDB 110% CDI)', type: 'FIXED_INCOME', rate: 110, index: 'CDI', liquidity: 'Imediata' },
    { name: 'Nubank (Caixinha Reserva 100% CDI)', type: 'FIXED_INCOME', rate: 100, index: 'CDI', liquidity: 'Imediata' },
    { name: 'Nubank (Caixinha Turbo 115% CDI)', type: 'FIXED_INCOME', rate: 115, index: 'CDI', liquidity: 'Imediata' },
    { name: 'Banco Inter (Meu Porquinho 100% CDI)', type: 'FIXED_INCOME', rate: 100, index: 'CDI', liquidity: 'Imediata' },
    { name: 'Mercado Pago (Conta 100% CDI)', type: 'FIXED_INCOME', rate: 100, index: 'CDI', liquidity: 'Imediata' },
    { name: 'PicPay (Cofrinho 102% CDI)', type: 'FIXED_INCOME', rate: 102, index: 'CDI', liquidity: 'Imediata' },
    { name: 'PagBank (Conta 100% CDI)', type: 'FIXED_INCOME', rate: 100, index: 'CDI', liquidity: 'Imediata' },
    { name: 'Itaú (Iti 100% CDI)', type: 'FIXED_INCOME', rate: 100, index: 'CDI', liquidity: 'Imediata' },
    { name: '99Pay (Lucrativa 110% CDI)', type: 'FIXED_INCOME', rate: 110, index: 'CDI', liquidity: 'Imediata' },
    { name: 'C6 Bank (CDB Cartão de Crédito)', type: 'FIXED_INCOME', rate: 100, index: 'CDI', liquidity: 'Imediata' }
];

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

// OTIMIZAÇÃO: Bulk Fetching
const calculateUserDividendsInternal = async (userId) => {
    const assets = await UserAsset.find({ user: userId });
    const dividendMap = new Map();
    const provisioned = [];
    let totalAllTime = 0;
    
    const today = new Date();
    today.setHours(0,0,0,0);
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 30);

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

const recalculatePosition = async (userId, ticker, forcedType = null) => {
    const transactions = await AssetTransaction.find({ user: userId, ticker }).sort({ date: 1, createdAt: 1 });
    let quantity = 0;
    let totalCost = 0; 
    let realizedProfit = 0;

    for (const tx of transactions) {
        const txQty = safeFloat(tx.quantity);
        const txTotal = safeFloat(tx.totalValue);

        if (tx.type === 'BUY') {
            quantity = safeAdd(quantity, txQty);
            totalCost = safeAdd(totalCost, txTotal);
        } else if (tx.type === 'SELL') {
            const currentAvgPrice = quantity > 0 ? safeDiv(totalCost, quantity) : 0;
            const costOfSoldShares = safeMult(txQty, currentAvgPrice);
            const profit = safeSub(txTotal, costOfSoldShares);
            
            realizedProfit = safeAdd(realizedProfit, profit);
            quantity = safeSub(quantity, txQty);
            totalCost = safeSub(totalCost, costOfSoldShares);
        }
        
        // Correção de resíduos
        if (quantity <= 0.000001) {
            quantity = 0;
            totalCost = 0;
        }
    }

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
    asset.updatedAt = new Date();
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
        let totalRealizedProfit = closedAssets.reduce((acc, curr) => safeAdd(acc, (curr.realizedProfit || 0)), 0);

        const processedAssets = activeAssets.map(asset => {
            let currentPrice = 0;
            let dayChangePct = 0; 
            const isDollarized = asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO';
            const currencyMultiplier = isDollarized ? usdRate : 1;

            if (asset.type === 'CASH') {
                currentPrice = 1;
                dayChangePct = 0;
            } else if (asset.type === 'FIXED_INCOME') {
                const investedAmount = asset.totalCost; 
                let rawRate = safeFloat(asset.fixedIncomeRate || 10.0);
                let effectiveRate = rawRate;
                
                if (rawRate > 30) {
                    effectiveRate = safeMult(safeDiv(rawRate, 100), currentCdi);
                }

                // FIX: Cálculo de Renda Fixa rigoroso (Data sem hora)
                // Removemos o componente de hora para evitar distorções no D+0
                const startDate = new Date(asset.startDate || asset.createdAt || new Date());
                const now = new Date();
                
                // Normaliza para meia-noite UTC para calcular dias inteiros corridos
                const utcStart = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
                
                const diffTime = utcNow - utcStart;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
                
                // Se diffDays <= 0 (mesmo dia), retorno zero para evitar confusão no D+0
                if (diffDays <= 0) {
                    currentPrice = asset.quantity > 0 ? safeDiv(investedAmount, asset.quantity) : 0;
                    dayChangePct = 0;
                } else {
                    // M = C * (1 + i)^(t/365)
                    const factor = Math.pow(1 + (effectiveRate / 100), diffDays / 365);
                    const currentTotalValueMath = safeMult(investedAmount, factor);
                    
                    currentPrice = asset.quantity > 0 ? safeDiv(currentTotalValueMath, asset.quantity) : 0;
                    
                    // Variação Diária Teórica
                    dayChangePct = (Math.pow(1 + (effectiveRate/100), 1/365) - 1) * 100;
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

            const unrealizedProfit = safeSub(totalValueBr, totalCostBr);
            const positionTotalResult = safeAdd(unrealizedProfit, (asset.realizedProfit || 0));
            
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
                fixedIncomeRate: asset.fixedIncomeRate 
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

        const end = performance.now();
        logger.debug(`⏱️ [Wallet] Response Time: ${(end - start).toFixed(2)}ms`);

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
        
        // FIX: Data sem hora para consistência com o cálculo de rentabilidade
        const transactionDate = date ? new Date(date) : new Date();
        if (date) {
            // Garante que a data inserida pelo usuário (YYYY-MM-DD) seja interpretada no fuso local corretamente
            // Mas para o banco, salvamos com hora zerada para facilitar comparações
            const parts = date.split('-');
            transactionDate.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            transactionDate.setHours(0, 0, 0, 0);
        }

        if (isNaN(numQty) || isNaN(numPrice)) return res.status(400).json({ message: "Valores inválidos." });

        const txType = numQty >= 0 ? 'BUY' : 'SELL';
        const absQty = Math.abs(numQty);
        
        const newTx = new AssetTransaction({
            user: userId,
            ticker: cleanTicker,
            type: txType,
            quantity: absQty,
            price: numPrice,
            totalValue: safeMult(absQty, numPrice),
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
            
            // Se for a primeira compra ou reinício de posição, define a data de início para o cálculo
            // IMPORTANTE: Reseta a data de início se a posição estava zerada antes
            if (!updatedAsset.startDate || (updatedAsset.quantity === absQty)) { 
                updatedAsset.startDate = transactionDate;
            }
            await updatedAsset.save();
        }
        
        res.status(201).json(updatedAsset || { message: "Transação registrada." });
    } catch (error) { next(error); }
};

// ... (Restante das funções mantidas)
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

export const deleteTransaction = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tx = await AssetTransaction.findOne({ _id: id, user: req.user.id });
        if (!tx) return res.status(404).json({ message: "Transação não encontrada." });
        const ticker = tx.ticker;
        await AssetTransaction.deleteOne({ _id: id });
        await recalculatePosition(req.user.id, ticker);
        res.json({ message: "Transação removida." });
    } catch (error) { next(error); }
};

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]); 
        
        const regex = new RegExp(query, 'i');
        const tickerRegex = new RegExp(`^${query}`, 'i');
        
        let results = [];

        // 1. Busca Mercado (Stocks/FIIs)
        const marketAssets = await MarketAsset.find({ 
            $or: [{ ticker: tickerRegex }, { name: regex }] 
        }).select('ticker name lastPrice type').limit(5);
        
        results = marketAssets.map(a => ({ 
            ticker: a.ticker, 
            name: a.name, 
            price: a.lastPrice, 
            type: a.type 
        }));

        // 2. Busca Tesouro Direto
        const treasuryBonds = await TreasuryBond.find({ title: regex }).limit(5);
        const treasuryResults = treasuryBonds.map(b => ({
            ticker: b.title, name: b.title, price: b.minInvestment, type: 'FIXED_INCOME', rate: b.rate 
        }));
        results = [...results, ...treasuryResults];

        // 3. PRODUTOS POPULARES
        const fixedMatches = POPULAR_FIXED_INCOME.filter(p => p.name.match(regex)).slice(0, 5);
        const fixedResults = fixedMatches.map(p => ({
            ticker: p.name, name: p.name, price: 0, type: 'FIXED_INCOME', rate: p.rate, isManual: true
        }));
        results = [...results, ...fixedResults];

        // 4. Fallback Genérico
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
                        const factor = Math.pow(1 + (rate/100), diffDays/365);
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
                
                const daysDiff = Math.floor((new Date(snap.date) - startDate) / (1000 * 60 * 60 * 24));
                const cdiValue = (Math.pow(1 + cdiDaily, Math.max(0, daysDiff)) - 1) * 100;

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
                const cdiNow = (Math.pow(1 + cdiDaily, daysDiff) - 1) * 100;
                
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
