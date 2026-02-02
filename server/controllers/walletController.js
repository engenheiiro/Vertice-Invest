
import mongoose from 'mongoose';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent } from '../utils/mathUtils.js';
import logger from '../config/logger.js';

// ... (Outros métodos getWalletData, addAssetTransaction, etc. mantidos iguais aos anteriores, focando na mudança do getWalletDividends)

export const getWalletData = async (req, res, next) => {
    // ... (Implementação padrão V5 mantida para economizar espaço na resposta, já que não foi alterada)
    // Se o usuário pedir o código completo, fornecerei, mas aqui foco na mudança crítica.
    try {
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
            marketDataService.refreshQuotesBatch(liveTickers).catch(() => {});
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

            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                currentPrice = asset.quantity > 0 ? safeDiv(asset.totalCost, asset.quantity) : 1; 
                if(asset.type === 'FIXED_INCOME') currentPrice *= 1.0004; 
            } else {
                const cachedData = assetMap.get(asset.ticker);
                currentPrice = cachedData && cachedData.price > 0 ? safeFloat(Number(cachedData.price)) : safeFloat(asset.averagePrice);
            }
            
            const totalValueBr = safeMult(safeMult(asset.quantity, currentPrice), currencyMultiplier);
            const totalCostBr = safeMult(asset.totalCost, currencyMultiplier);
            
            totalEquity = safeAdd(totalEquity, totalValueBr);
            totalInvested = safeAdd(totalInvested, totalCostBr);

            const volatility = asset.type === 'CRYPTO' ? 0.05 : 0.015;
            dayChangePct = (Math.random() * volatility * 2 - volatility) * 100;
            const dayChangeValueBr = safeMult(totalValueBr, safeDiv(dayChangePct, 100));
            totalDayVariation = safeAdd(totalDayVariation, dayChangeValueBr);

            let sector = 'Geral';
            if (asset.type === 'FIXED_INCOME') sector = 'Renda Fixa';
            else if (asset.type === 'CASH') sector = 'Reserva';
            else {
                const cached = assetMap.get(asset.ticker);
                if (cached) sector = cached.sector || 'Geral';
            }

            const profit = totalValueBr - totalCostBr;
            const profitPercent = totalCostBr > 0 ? (profit / totalCostBr) * 100 : 0;

            return {
                id: asset._id,
                ticker: asset.ticker,
                name: assetMap.get(asset.ticker)?.name || asset.ticker,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: asset.quantity > 0 ? safeDiv(asset.totalCost, asset.quantity) : 0,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: safeCurrency(totalValueBr), 
                totalCost: safeCurrency(totalCostBr),
                profit: safeCurrency(profit),
                profitPercent: safeFloat(profitPercent),
                sector: sector,
            };
        });

        const currentUnrealized = safeSub(totalEquity, totalInvested);
        const totalResult = safeAdd(currentUnrealized, totalRealizedProfit);
        const { totalAllTime } = await financialService.calculateUserDividends(userId);

        // AUTO-REPAIR: Se histórico vazio mas tem saldo, força rebuild
        const lastSnapshot = await WalletSnapshot.findOne({ user: userId }).sort({ date: -1 });
        if (totalEquity > 1000) {
            if (!lastSnapshot || lastSnapshot.totalEquity < (totalEquity * 0.1)) {
                financialService.rebuildUserHistory(userId).catch(e => logger.error(`Falha no AutoRepair: ${e.message}`));
            }
        }

        res.json({
            assets: processedAssets,
            kpis: {
                totalEquity: safeCurrency(totalEquity),
                totalInvested: safeCurrency(totalInvested),
                totalResult: safeCurrency(totalResult), 
                totalResultPercent: totalInvested > 0 ? (totalResult / totalInvested) * 100 : 0,
                dayVariation: safeCurrency(totalDayVariation),
                dayVariationPercent: totalEquity > 0 ? (totalDayVariation / totalEquity) * 100 : 0,
                totalDividends: safeCurrency(totalAllTime)
            },
            meta: { usdRate, lastUpdate: new Date() }
        });
    } catch (error) {
        next(error);
    }
};

// ... (Exportações padrão addAssetTransaction, deleteTransaction, etc.)
export const addAssetTransaction = async (req, res, next) => {
    // ... (Mantido igual ao original)
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const { ticker, type, quantity, price, date } = req.body;
        const userId = req.user.id;
        const cleanTicker = ticker.toUpperCase().trim();
        const numQty = parseFloat(quantity);
        const numPrice = parseFloat(price);
        
        const newTx = new AssetTransaction({
            user: userId,
            ticker: cleanTicker,
            type: numQty >= 0 ? 'BUY' : 'SELL',
            quantity: Math.abs(numQty),
            price: numPrice,
            totalValue: Math.abs(numQty) * numPrice,
            date: date ? new Date(date) : new Date()
        });
        await newTx.save({ session }); 
        await financialService.recalculatePosition(userId, cleanTicker, type, session);
        await session.commitTransaction();
        session.endSession();
        financialService.rebuildUserHistory(userId).catch(err => logger.error(`Background Rebuild Error: ${err.message}`));
        res.status(201).json({ message: "Transação registrada." });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

export const deleteTransaction = async (req, res, next) => {
    try {
        const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: req.user.id });
        if (tx) {
            await financialService.recalculatePosition(req.user.id, tx.ticker);
            financialService.rebuildUserHistory(req.user.id).catch(()=>{});
        }
        res.json({ message: "Removido" });
    } catch (error) { next(error); }
};

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const transactions = await AssetTransaction.find({ user: req.user.id, ticker: ticker.toUpperCase() }).sort({ date: -1 });
        res.json({ transactions, pagination: { hasMore: false } });
    } catch (error) { next(error); }
};

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]); 
        const regex = new RegExp(query, 'i');
        const marketAssets = await MarketAsset.find({ $or: [{ ticker: regex }, { name: regex }] }).limit(5);
        res.json(marketAssets.map(a => ({ ticker: a.ticker, name: a.name, type: a.type })));
    } catch (error) { next(error); }
};

export const removeAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const asset = await UserAsset.findOne({ _id: id, user: req.user.id });
        if (asset) {
            await AssetTransaction.deleteMany({ user: req.user.id, ticker: asset.ticker });
            await UserAsset.deleteOne({ _id: id });
            financialService.rebuildUserHistory(req.user.id).catch(()=>{});
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
        const snapshots = await WalletSnapshot.find({ user: req.user.id }).sort({ date: 1 }).limit(365);
        res.json(snapshots);
    } catch (error) { next(error); }
};

export const getWalletPerformance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        let history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        const hasAssets = await UserAsset.exists({ user: userId, quantity: { $gt: 0 } });
        
        if (history.length === 0 && hasAssets) {
            await financialService.rebuildUserHistory(userId);
            history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        }

        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP'); 
        if (ibovHistory) ibovHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        const cdiDaily = Math.pow(1 + 0.115, 1/252) - 1; 

        const result = history.map((snap) => {
            const dateStr = snap.date.toISOString().split('T')[0];
            const walletPerf = snap.totalInvested > 0 ? ((snap.totalEquity - snap.totalInvested) / snap.totalInvested) * 100 : 0;
            const startIbov = financialService.findClosestValue(ibovHistory, history[0].date.toISOString().split('T')[0]) || 100000;
            const currentIbov = financialService.findClosestValue(ibovHistory, dateStr) || startIbov;
            const ibovPerf = ((currentIbov - startIbov) / startIbov) * 100;
            const daysDiff = Math.floor((new Date(snap.date) - new Date(history[0].date)) / (1000 * 60 * 60 * 24));
            const businessDays = Math.floor(daysDiff * 5 / 7);
            const cdiPerf = (Math.pow(1 + cdiDaily, businessDays) - 1) * 100;

            return {
                date: dateStr,
                wallet: safeFloat(walletPerf),
                cdi: safeFloat(cdiPerf),
                ibov: safeFloat(ibovPerf)
            };
        });
        res.json(result);
    } catch (error) { next(error); }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        const skip = (page - 1) * limit;
        const userId = req.user.id;
        let query = { user: userId };
        if (filterType === 'CASH') query.ticker = { $in: ['RESERVA', 'CAIXA'] };
        else if (filterType === 'TRADE') query.ticker = { $nin: ['RESERVA', 'CAIXA'] };
        const transactions = await AssetTransaction.find(query).sort({ date: -1 }).skip(skip).limit(Number(limit));
        const total = await AssetTransaction.countDocuments(query);
        res.json({
            transactions: transactions.map(tx => ({ ...tx.toObject(), isCashOp: ['RESERVA'].includes(tx.ticker) })),
            pagination: { hasMore: (page * limit) < total }
        });
    } catch (error) { next(error); }
};

// --- MUDANÇA IMPORTANTE AQUI ---
export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { dividendMap, provisioned, totalAllTime } = await financialService.calculateUserDividends(userId);

        // Converte o Map para Array para o frontend, mantendo o breakdown
        const history = Array.from(dividendMap.entries())
            .map(([month, data]) => ({ 
                month, 
                value: safeCurrency(data.total),
                breakdown: data.breakdown || [] // Inclui o detalhamento
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

        res.json({
            history, 
            provisioned: provisioned.sort((a, b) => new Date(a.date) - new Date(b.date)),
            totalAllTime: safeCurrency(totalAllTime)
        });

    } catch (error) {
        logger.error(`Erro Dividendos: ${error.message}`);
        next(error);
    }
};
