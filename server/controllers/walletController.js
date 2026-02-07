
import mongoose from 'mongoose';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent } from '../utils/mathUtils.js';
import { countBusinessDays, isBusinessDay } from '../utils/dateUtils.js';
import logger from '../config/logger.js';
import { HISTORICAL_CDI_RATES } from '../config/financialConstants.js'; // Importação Centralizada

// Helper: Calcula o fator diário.
const getDailyFactorForDate = (date, currentConfigRate) => {
    const year = date.getFullYear();
    const currentYear = new Date().getFullYear();
    
    let rate = 11.25; // Fallback seguro

    if (year === currentYear) {
        rate = currentConfigRate || 11.25;
    } else {
        rate = HISTORICAL_CDI_RATES[year] || 10.0;
    }

    // Fator diário = (1 + Taxa/100)^(1/252)
    return Math.pow(1 + (rate / 100), 1/252);
};

export const getWalletData = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        const activeAssets = userAssets.filter(a => a.quantity > 0.000001);
        const closedAssets = userAssets.filter(a => a.quantity <= 0.000001);

        // --- SELF-HEALING CHECK ---
        if (activeAssets.length === 0) {
            const txCount = await AssetTransaction.countDocuments({ user: userId });
            if (txCount > 0) {
                const allTxs = await AssetTransaction.find({ user: userId });
                const distinctTickers = [...new Set(allTxs.map(t => t.ticker))];
                for (const ticker of distinctTickers) {
                    await financialService.recalculatePosition(userId, ticker);
                }
                const healedAssets = await UserAsset.find({ user: userId });
                if (healedAssets.length > 0) {
                    return getWalletData(req, res, next);
                }
            }
        }

        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { 
                    totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, 
                    dayVariation: 0, dayVariationPercent: 0, totalDividends: 0, projectedDividends: 0,
                    weightedRentability: 0 
                },
                meta: { usdRate: 5.75 }
            });
        }

        const liveTickers = activeAssets.filter(a => a.type !== 'FIXED_INCOME' && a.type !== 'CASH').map(a => a.ticker);
        if (liveTickers.length > 0) {
            marketDataService.refreshQuotesBatch(liveTickers).catch(() => {});
        }

        const assetMap = new Map();
        await Promise.all(liveTickers.map(async (ticker) => {
            const data = await marketDataService.getMarketDataByTicker(ticker);
            assetMap.set(ticker, {
                price: data.price,
                change: data.change || 0,
                name: data.name,
                sector: data.sector
            });
        }));

        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = safeFloat(config?.dollar || 5.75);
        const usdChange = safeFloat(config?.dollarChange || 0);
        let currentCdi = (config?.cdi && config.cdi > 0) ? safeFloat(config.cdi) : ((config?.selic && config.selic > 0) ? safeFloat(config.selic) : 11.25);

        const { totalAllTime: totalDividends, projectedMonthly } = await financialService.calculateUserDividends(userId);

        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        
        let totalRealizedProfit = closedAssets.reduce((acc, curr) => {
            const isDollarized = curr.currency === 'USD' || curr.type === 'STOCK_US' || curr.type === 'CRYPTO';
            const mult = isDollarized ? usdRate : 1;
            const profitInBrl = safeMult((curr.realizedProfit || 0), mult);
            return safeAdd(acc, profitInBrl);
        }, 0);

        const now = new Date();
        const isTodayBusinessDay = isBusinessDay(now);

        const processedAssets = activeAssets.map(asset => {
            let currentPrice = 0;
            let dayChangePct = 0; 
            const isDollarized = asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO';
            const currencyMultiplier = isDollarized ? usdRate : 1;

            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                const rawRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : (asset.type === 'CASH' ? 100 : 100);
                
                const selicDailyFactor = Math.pow(1 + (currentCdi / 100), 1 / 252);
                let effectiveDailyFactor = 1;

                if (rawRate > 50) { 
                    const percentOfCdi = rawRate / 100;
                    effectiveDailyFactor = ((selicDailyFactor - 1) * percentOfCdi) + 1;
                } else { 
                    effectiveDailyFactor = Math.pow(1 + (rawRate / 100), 1 / 252);
                }

                if (isTodayBusinessDay) {
                    dayChangePct = (effectiveDailyFactor - 1) * 100;
                } else {
                    dayChangePct = 0;
                }

                let startDate = new Date(asset.startDate || asset.createdAt);
                startDate.setHours(0,0,0,0);
                const calcDate = new Date();
                calcDate.setHours(0,0,0,0);
                
                const businessDays = countBusinessDays(startDate, calcDate);
                let compoundFactor = Math.pow(effectiveDailyFactor, businessDays);

                if (!isFinite(compoundFactor) || compoundFactor < 1) compoundFactor = 1;

                if (asset.type === 'CASH') {
                    currentPrice = compoundFactor; 
                } else {
                    currentPrice = safeMult(asset.averagePrice, compoundFactor);
                }

            } else {
                const cached = assetMap.get(asset.ticker);
                if (cached && cached.price > 0) {
                    currentPrice = safeFloat(Number(cached.price));
                    
                    if (asset.type === 'CRYPTO') {
                        dayChangePct = safeFloat(Number(cached.change));
                    } else {
                        dayChangePct = isTodayBusinessDay ? safeFloat(Number(cached.change)) : 0;
                    }
                } else {
                    currentPrice = 0; 
                    dayChangePct = 0;
                }
            }
            
            const valueBase = asset.type === 'CASH' ? asset.quantity : safeMult(asset.quantity, currentPrice);
            const totalValueBr = asset.type === 'CASH' 
                ? safeMult(valueBase, currentPrice)
                : safeMult(valueBase, currencyMultiplier);

            const totalCostBr = safeMult(asset.totalCost, currencyMultiplier);
            
            let combinedChangePct = dayChangePct;
            if (isDollarized) {
                if (!isTodayBusinessDay && asset.type !== 'CRYPTO') {
                    combinedChangePct = 0;
                } else {
                    combinedChangePct = ((1 + dayChangePct/100) * (1 + usdChange/100) - 1) * 100;
                }
            }

            const dayChangeValueBr = safeMult(totalValueBr, safeDiv(combinedChangePct, 100));

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

            return {
                id: asset._id,
                ticker: asset.ticker,
                name: assetMap.get(asset.ticker)?.name || asset.ticker,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: asset.quantity > 0 ? safeDiv(asset.totalCost, asset.quantity) : 0,
                currentPrice: asset.type === 'CASH' ? 1 : currentPrice,
                currency: asset.currency,
                totalValue: safeCurrency(totalValueBr), 
                totalCost: safeCurrency(totalCostBr),
                profit: safeCurrency(positionTotalResult),
                profitPercent: safeFloat(profitPercent),
                sector: assetMap.get(asset.ticker)?.sector || 'Geral',
                dayChangePct: safeFloat(combinedChangePct)
            };
        });

        const currentUnrealized = safeSub(totalEquity, totalInvested);
        const totalCapitalGain = safeAdd(currentUnrealized, totalRealizedProfit);
        const totalResult = safeAdd(totalCapitalGain, totalDividends);

        const safeTotalEquity = safeCurrency(totalEquity);
        const safeTotalInvested = safeCurrency(totalInvested);
        const safeTotalResult = safeCurrency(totalResult);
        const safeTotalDayVariation = safeCurrency(totalDayVariation);

        let totalResultPercent = 0;
        if (safeTotalInvested > 0) {
            totalResultPercent = safeMult(safeDiv(safeTotalResult, safeTotalInvested), 100);
        }

        let dayVariationPercent = 0;
        if (safeTotalEquity > 0) {
            const denom = safeSub(safeTotalEquity, safeTotalDayVariation);
            if (denom !== 0) {
                dayVariationPercent = safeMult(safeDiv(safeTotalDayVariation, denom), 100);
            }
        }

        let weightedRentability = 0;
        const history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        
        if (history.length > 0) {
            const lastSnapshot = history[history.length - 1];
            if (lastSnapshot.quotaPrice) {
                weightedRentability = ((lastSnapshot.quotaPrice / 100) - 1) * 100;
            } else {
                weightedRentability = totalResultPercent;
            }
        } else {
            weightedRentability = totalResultPercent;
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
                totalDividends: safeCurrency(totalDividends),
                projectedDividends: safeCurrency(projectedMonthly),
                weightedRentability: safeFloat(weightedRentability)
            },
            meta: { usdRate, lastUpdate: new Date() }
        });
    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

export const getWalletPerformance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        
        let history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        
        if (history.length === 0) {
            return res.json([]);
        }

        const currentRate = config?.cdi || 11.15;
        
        let accumulatedCDI = 1.0;
        let previousDate = new Date(history[0].date);
        previousDate.setHours(0,0,0,0);

        const result = history.map((point) => {
            const currentDate = new Date(point.date);
            currentDate.setHours(0,0,0,0);

            const daysDelta = countBusinessDays(previousDate, currentDate);
            
            if (daysDelta > 0) {
                const factor = getDailyFactorForDate(currentDate, currentRate);
                const periodFactor = Math.pow(factor, daysDelta);
                accumulatedCDI *= periodFactor;
            }

            previousDate = currentDate;

            return {
                date: point.date.toISOString().split('T')[0],
                wallet: point.quotaPrice ? ((point.quotaPrice/100)-1)*100 : 0, 
                walletRoi: point.totalInvested > 0 ? ((point.totalEquity - point.totalInvested + point.totalDividends) / point.totalInvested) * 100 : 0,
                cdi: (accumulatedCDI - 1) * 100,
                ibov: (Math.random() * 5) - 2 
            };
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const snapshots = await WalletSnapshot.find({ user: req.user.id }).sort({ date: 1 });
        res.json(snapshots);
    } catch (error) {
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const userId = req.user.id;
        const { ticker, type, quantity, price, date, fixedIncomeRate, name } = req.body;

        if (!ticker || quantity === undefined || price === undefined) {
            throw new Error("Dados incompletos.");
        }

        // [VALIDAÇÃO] Impede datas futuras
        const txDate = date ? new Date(date) : new Date();
        const now = new Date();
        // Zera horas para permitir transações "de hoje" sem erro de fuso horário
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        if (txDate > todayEnd) {
            throw new Error("Não é permitido registrar transações com data futura.");
        }

        const transactionType = quantity >= 0 ? 'BUY' : 'SELL';
        const absQty = Math.abs(parseFloat(quantity));
        const absPrice = Math.abs(parseFloat(price));
        
        const newTx = new AssetTransaction({
            user: userId,
            ticker: ticker.toUpperCase(),
            type: transactionType,
            quantity: absQty,
            price: absPrice,
            totalValue: absQty * absPrice,
            date: txDate,
            notes: name ? `Nome: ${name}` : ''
        });
        await newTx.save({ session });

        const updatedAsset = await financialService.recalculatePosition(userId, ticker.toUpperCase(), type, session);
        
        if (updatedAsset && (type === 'FIXED_INCOME' || type === 'CASH')) {
            if (fixedIncomeRate) updatedAsset.fixedIncomeRate = fixedIncomeRate;
            if (name) updatedAsset.name = name; 
            if (transactionType === 'BUY' && (!updatedAsset.startDate || new Date(date) < updatedAsset.startDate)) {
                updatedAsset.startDate = new Date(date);
            }
            await updatedAsset.save({ session });
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isRetroactive = txDate < yesterday;

        await session.commitTransaction();
        session.endSession();

        if (isRetroactive) {
            logger.info(`🔄 Transação retroativa detectada para ${userId}. Reconstruindo histórico (bloqueante)...`);
            try {
                await financialService.rebuildUserHistory(userId);
                logger.info(`✅ Histórico reconstruído com sucesso.`);
            } catch (err) {
                logger.error(`Erro rebuild histórico: ${err.message}`);
            }
        }

        res.status(201).json({ message: "Transação registrada com sucesso.", asset: updatedAsset });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

export const removeAsset = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const userId = req.user.id;
        const assetId = req.params.id;

        const asset = await UserAsset.findOne({ _id: assetId, user: userId });
        if (!asset) throw new Error("Ativo não encontrado");

        await AssetTransaction.deleteMany({ user: userId, ticker: asset.ticker }).session(session);
        await UserAsset.deleteOne({ _id: assetId }).session(session);

        await session.commitTransaction();
        session.endSession();

        try {
            await financialService.rebuildUserHistory(userId);
        } catch (e) { console.error(e); }

        res.json({ message: "Ativo removido com sucesso." });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

export const resetWallet = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const userId = req.user.id;

        await UserAsset.deleteMany({ user: userId }).session(session);
        await AssetTransaction.deleteMany({ user: userId }).session(session);
        await WalletSnapshot.deleteMany({ user: userId }).session(session);

        await session.commitTransaction();
        session.endSession();
        res.json({ message: "Carteira resetada com sucesso." });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const results = await MarketAsset.find({
            $or: [
                { ticker: { $regex: `^${q}`, $options: 'i' } },
                { name: { $regex: q, $options: 'i' } }
            ],
            isIgnored: false
        })
        .sort({ liquidity: -1 })
        .limit(10)
        .select('ticker name type lastPrice');

        res.json(results);
    } catch (error) {
        next(error);
    }
};

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const { page = 1, limit = 10 } = req.query;
        
        const query = { user: req.user.id, ticker: ticker.toUpperCase() };
        
        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
            
        const total = await AssetTransaction.countDocuments(query);

        res.json({
            transactions,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit),
                hasMore: page * limit < total
            }
        });
    } catch (error) {
        next(error);
    }
};

export const deleteTransaction = async (req, res, next) => {
    try {
        const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: req.user.id });
        if (!tx) return res.status(404).json({ message: "Transação não encontrada" });

        await financialService.recalculatePosition(req.user.id, tx.ticker);
        
        try {
            await financialService.rebuildUserHistory(req.user.id);
        } catch (e) { console.error(e); }

        res.json({ message: "Transação removida." });
    } catch (error) {
        next(error);
    }
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const data = await financialService.calculateUserDividends(req.user.id);
        
        const history = Array.from(data.dividendMap.entries()).map(([month, val]) => ({
            month,
            value: val.total,
            breakdown: val.breakdown
        })).sort((a, b) => a.month.localeCompare(b.month));

        res.json({
            history,
            provisioned: data.provisioned,
            totalAllTime: data.totalAllTime,
            projectedMonthly: data.projectedMonthly
        });
    } catch (error) {
        next(error);
    }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        const query = { user: req.user.id };

        if (filterType === 'CASH') {
            query.ticker = 'RESERVA';
        } else if (filterType === 'TRADE') {
            query.ticker = { $ne: 'RESERVA' };
        }

        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await AssetTransaction.countDocuments(query);

        res.json({
            transactions: transactions.map(t => ({
                ...t.toObject(),
                isCashOp: t.ticker === 'RESERVA'
            })),
            pagination: {
                total,
                hasMore: page * limit < total
            }
        });
    } catch (error) {
        next(error);
    }
};

export const runCorporateAction = async (req, res, next) => {
    try {
        const { ticker, type } = req.body;
        res.json({ message: "Comando recebido.", details: { updates: 0 } });
    } catch (error) {
        next(error);
    }
};
