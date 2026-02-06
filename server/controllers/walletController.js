
import mongoose from 'mongoose';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent } from '../utils/mathUtils.js';
import { countBusinessDays } from '../utils/dateUtils.js';
import logger from '../config/logger.js';

// --- CDI HISTÓRICO APROXIMADO (Taxa Média Anual) ---
const CDI_HISTORY = {
    2020: 2.77,
    2021: 4.42,
    2022: 12.39,
    2023: 13.04,
    2024: 10.80, 
    2025: 11.25,
    2026: 11.25 // Projeção
};

const getDailyCDIFactor = (date) => {
    const year = date.getFullYear();
    const rate = CDI_HISTORY[year] || CDI_HISTORY[2025];
    return Math.pow(1 + (rate / 100), 1 / 252);
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
                logger.warn(`⚠️ Inconsistência detectada para usuário ${userId}: Transações existem mas UserAssets vazio. Iniciando Self-Healing...`);
                
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
                name: data.name
            });
        }));

        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = safeFloat(config?.dollar || 5.75);
        const usdChange = safeFloat(config?.dollarChange || 0);
        
        let currentCdi = (config?.cdi && config.cdi > 0) ? safeFloat(config.cdi) : 11.15;
        if (currentCdi > 50) currentCdi = 11.15;

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
                const rawRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : (asset.type === 'CASH' ? 100 : 10.0);
                
                const cdiDaily = Math.pow(1 + (currentCdi / 100), 1 / 252) - 1;
                let effectiveDailyRate = 0;

                if (rawRate > 30) { 
                    const cdiFactor = safeDiv(rawRate, 100); 
                    effectiveDailyRate = cdiDaily * cdiFactor;
                } else { 
                    effectiveDailyRate = Math.pow(1 + (rawRate / 100), 1 / 252) - 1;
                }

                dayChangePct = effectiveDailyRate * 100;

                let startDate = new Date(asset.startDate || asset.createdAt || new Date());
                if (isNaN(startDate.getTime()) || startDate.getFullYear() < 2000) {
                    startDate = new Date(asset.createdAt || new Date());
                }
                
                startDate.setHours(0,0,0,0);
                const now = new Date();
                now.setHours(0,0,0,0);
                
                const businessDays = countBusinessDays(startDate, now);
                const safeDays = Math.max(0, businessDays);

                let compoundFactor = Math.pow(1 + effectiveDailyRate, safeDays);

                if (compoundFactor > 5 && safeDays < 3000) {
                    compoundFactor = 1 + (safeDays * effectiveDailyRate); 
                }

                if (asset.type === 'CASH') {
                    const totalVal = safeMult(asset.totalCost, compoundFactor);
                    currentPrice = asset.quantity > 0 ? safeDiv(totalVal, asset.quantity) : 1;
                } else {
                    const totalProjected = safeMult(asset.totalCost, compoundFactor);
                    currentPrice = asset.quantity > 0 ? safeDiv(totalProjected, asset.quantity) : 0;
                }

            } else {
                const cached = assetMap.get(asset.ticker);
                if (cached && cached.price > 0) {
                    currentPrice = safeFloat(Number(cached.price));
                    dayChangePct = safeFloat(Number(cached.change)); 
                } else {
                    currentPrice = 0; 
                    dayChangePct = 0;
                }
            }
            
            const totalValueBr = safeMult(safeMult(asset.quantity, currentPrice), currencyMultiplier);
            const totalCostBr = safeMult(asset.totalCost, currencyMultiplier);
            
            let combinedChangePct = dayChangePct;
            if (isDollarized) {
                combinedChangePct = dayChangePct + usdChange; 
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
                currentPrice: currentPrice,
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
        const totalResult = safeAdd(currentUnrealized, totalRealizedProfit);
        
        const { totalAllTime, projectedMonthly } = await financialService.calculateUserDividends(userId);

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
            dayVariationPercent = safeMult(safeDiv(safeTotalDayVariation, safeTotalEquity), 100);
        }

        let weightedRentability = 0;
        const history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        
        if (history.length > 0) {
            const lastSnapshot = history[history.length - 1];
            if (lastSnapshot.quotaPrice) {
                weightedRentability = ((lastSnapshot.quotaPrice / 100) - 1) * 100;
            } else {
                weightedRentability = totalResultPercent;
                financialService.rebuildUserHistory(userId).catch(e => {});
            }
        } else {
            weightedRentability = totalResultPercent;
        }

        const lastSnapshot = history.length > 0 ? history[history.length - 1] : null;
        if (totalEquity > 1000) {
            if (!lastSnapshot || Math.abs(lastSnapshot.totalEquity - totalEquity) > (totalEquity * 0.5)) {
                financialService.rebuildUserHistory(userId).catch(e => logger.error(`Falha no AutoRepair: ${e.message}`));
            }
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
                totalDividends: safeCurrency(totalAllTime),
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
        let history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        
        if (history.length === 0) {
             await financialService.rebuildUserHistory(userId);
             history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        }

        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP'); 
        if (ibovHistory) {
            ibovHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        }
        
        if (history.length === 0) return res.json([]);

        const result = [];
        const startQuota = history[0].quotaPrice || 100;
        
        const startIbovVal = financialService.findClosestValue(ibovHistory, history[0].date.toISOString().split('T')[0]) || 100000;
        let cumulativeCdi = 1.0; 

        for (let i = 0; i < history.length; i++) {
            const point = history[i];
            const dateStr = point.date.toISOString().split('T')[0];
            const pointDate = new Date(point.date);
            
            const currentQuota = point.quotaPrice || 100;
            const walletTwrr = ((currentQuota / startQuota) - 1) * 100;

            let walletRoi = 0;
            if (point.totalInvested > 0) {
                walletRoi = ((point.totalEquity - point.totalInvested) / point.totalInvested) * 100;
            }

            let currentIbovVal = financialService.findClosestValue(ibovHistory, dateStr);
            if (!currentIbovVal && i === history.length - 1 && ibovHistory.length > 0) {
                currentIbovVal = ibovHistory[ibovHistory.length - 1].close;
            }
            const currentIbov = currentIbovVal || startIbovVal;
            const ibovPerf = ((currentIbov - startIbovVal) / startIbovVal) * 100;

            if (i > 0) {
                const prevDate = new Date(history[i-1].date);
                const businessDays = countBusinessDays(prevDate, pointDate);
                const dailyFactor = getDailyCDIFactor(pointDate);
                const safeDays = Math.min(businessDays, 30); 
                if (safeDays > 0) {
                    cumulativeCdi *= Math.pow(dailyFactor, safeDays);
                }
            }
            const cdiPerf = (cumulativeCdi - 1) * 100;

            result.push({
                date: dateStr,
                wallet: safeFloat(walletTwrr),    
                walletRoi: safeFloat(walletRoi), 
                cdi: safeFloat(cdiPerf),
                ibov: safeFloat(ibovPerf)
            });
        }
        res.json(result);
    } catch (error) {
        logger.error(`Erro Performance: ${error.message}`);
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { ticker, type, quantity, currency, date, fixedIncomeRate } = req.body;
        const rawPrice = req.body.price !== undefined ? req.body.price : req.body.averagePrice;
        const userId = req.user.id;
        
        if (!ticker) throw new Error("Ticker obrigatório.");

        const cleanTicker = ticker.toUpperCase().trim();
        
        // --- INPUT VALIDATION (SANITIZAÇÃO ESTRITA) ---
        const numQty = parseFloat(quantity);
        const numPrice = parseFloat(rawPrice);

        if (isNaN(numQty) || isNaN(numPrice)) throw new Error("Valores numéricos inválidos.");
        if (!isFinite(numQty) || !isFinite(numPrice)) throw new Error("Valores infinitos não permitidos.");
        
        if (numPrice < 0) throw new Error("O preço unitário não pode ser negativo.");
        if (Math.abs(numQty) > 1000000000) throw new Error("Quantidade excede o limite permitido.");
        if (numPrice > 1000000000) throw new Error("Preço excede o limite permitido.");
        // ----------------------------------------------
        
        const transactionDate = date ? new Date(date) : new Date();
        
        if (date && typeof date === 'string' && date.includes('-')) {
            const parts = date.split('-');
            transactionDate.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            transactionDate.setHours(12, 0, 0, 0); 
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const txDateCheck = new Date(transactionDate.getFullYear(), transactionDate.getMonth(), transactionDate.getDate());

        if (txDateCheck > startOfToday) {
            throw new Error("Não é possível registrar transações com data futura.");
        }

        if (numQty < 0) {
            const currentAsset = await UserAsset.findOne({ user: userId, ticker: cleanTicker }).session(session);
            const currentQty = currentAsset ? currentAsset.quantity : 0;
            if (Math.abs(numQty) > currentQty) {
                throw new Error(`Saldo insuficiente. Você possui ${currentQty}, tentou vender ${Math.abs(numQty)}.`);
            }
        }

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
        await newTx.save({ session }); 

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
                marketDataService.refreshQuotesBatch([cleanTicker]).catch(() => {});
            } catch (globalErr) {}
        }

        const updatedAsset = await financialService.recalculatePosition(userId, cleanTicker, type, session);
        
        if (updatedAsset && (type === 'FIXED_INCOME' || type === 'CASH')) {
            updatedAsset.fixedIncomeRate = fixedIncomeRate || updatedAsset.fixedIncomeRate || 10.0;
            if (txType === 'BUY') { 
                if (!updatedAsset.startDate || updatedAsset.quantity === absQty) {
                    updatedAsset.startDate = transactionDate;
                }
            }
            await updatedAsset.save({ session });
        }

        await session.commitTransaction();
        session.endSession();

        financialService.rebuildUserHistory(userId).catch(e => {
            logger.error(`Erro ao reconstruir histórico: ${e.message}`);
        });
        
        res.status(201).json(updatedAsset || { message: "Transação registrada." });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        logger.error(`Erro Transaction Add: ${error.message}`);
        if (error.message.includes('Saldo insuficiente') || error.message.includes('data futura') || error.message.includes('preço unitário') || error.message.includes('Valores')) {
            return res.status(400).json({ message: error.message });
        }
        next(error);
    }
};

export const deleteTransaction = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { id } = req.params;
        const tx = await AssetTransaction.findOne({ _id: id, user: req.user.id }).session(session);
        if (!tx) throw new Error("Transação não encontrada.");
        
        const ticker = tx.ticker;

        await AssetTransaction.deleteOne({ _id: id }).session(session);
        await financialService.recalculatePosition(req.user.id, ticker, null, session);
        
        await session.commitTransaction();
        session.endSession();

        financialService.rebuildUserHistory(req.user.id).catch(err => logger.error(`Erro rebuild (delete): ${err.message}`));

        res.json({ message: "Transação removida." });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
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
        
        const marketAssets = await MarketAsset.find({ 
            $or: [{ ticker: tickerRegex }, { name: regex }] 
        }).select('ticker name lastPrice type').limit(5);
        
        const bonds = await TreasuryBond.find({
            title: regex
        }).limit(5);

        const POPULAR_FIXED = [
            { ticker: 'SOFISA', name: 'Sofisa Direto', type: 'FIXED_INCOME', rate: 110, index: 'CDI' },
            { ticker: 'NUBANK-RESERVA', name: 'Nubank (Caixinha Reserva)', type: 'FIXED_INCOME', rate: 100, index: 'CDI' },
            { ticker: 'NUBANK-TURBO', name: 'Nubank (Caixinha Turbo)', type: 'FIXED_INCOME', rate: 115, index: 'CDI' },
            { ticker: 'INTER', name: 'Banco Inter (Meu Porquinho)', type: 'FIXED_INCOME', rate: 100, index: 'CDI' },
            { ticker: 'MERCADO-PAGO', name: 'Mercado Pago (Conta)', type: 'FIXED_INCOME', rate: 100, index: 'CDI' },
            { ticker: 'PICPAY', name: 'PicPay (Cofrinhos)', type: 'FIXED_INCOME', rate: 102, index: 'CDI' },
            { ticker: 'PAGBANK', name: 'PagBank (Conta Rendeira)', type: 'FIXED_INCOME', rate: 100, index: 'CDI' },
            { ticker: 'ITAU-ITI', name: 'Itaú (Iti)', type: 'FIXED_INCOME', rate: 100, index: 'CDI' },
            { ticker: '99PAY', name: '99Pay (Lucrativa)', type: 'FIXED_INCOME', rate: 110, index: 'CDI' },
            { ticker: 'C6-BANK', name: 'C6 Bank (CDB Cartão)', type: 'FIXED_INCOME', rate: 100, index: 'CDI' }
        ];

        const staticMatches = POPULAR_FIXED.filter(p => 
            p.name.match(regex) || p.ticker.match(regex)
        );

        const results = [
            ...marketAssets.map(a => ({ 
                ticker: a.ticker, 
                name: a.name, 
                price: a.lastPrice, 
                type: a.type 
            })),
            ...bonds.map(b => ({
                ticker: b.title,
                name: b.title,
                price: b.minInvestment || 0,
                type: 'FIXED_INCOME',
                rate: b.rate 
            })),
            ...staticMatches.map(p => ({
                ticker: p.ticker,
                name: p.name,
                type: p.type,
                rate: p.rate,
                price: 1 
            }))
        ];

        const uniqueResults = Array.from(new Map(results.map(item => [item.ticker, item])).values());

        return res.json(uniqueResults.slice(0, 10)); 
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
        const userId = req.user.id;
        const snapshotCount = await WalletSnapshot.countDocuments({ user: userId });
        if (snapshotCount === 0) {
            const txCount = await AssetTransaction.countDocuments({ user: userId });
            if (txCount > 0) {
                await financialService.rebuildUserHistory(userId);
            }
        }
        const snapshots = await WalletSnapshot.find({ user: userId }).sort({ date: 1 }).limit(365);
        res.json(snapshots);
    } catch (error) { next(error); }
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { dividendMap, provisioned, totalAllTime, projectedMonthly } = await financialService.calculateUserDividends(userId);

        const history = Array.from(dividendMap.entries())
            .map(([month, data]) => ({ 
                month, 
                value: safeCurrency(data.total),
                breakdown: data.breakdown || [] 
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

        res.json({
            history, 
            provisioned: provisioned.sort((a, b) => new Date(a.date) - new Date(b.date)),
            totalAllTime: safeCurrency(totalAllTime),
            projectedMonthly: safeCurrency(projectedMonthly)
        });

    } catch (error) {
        logger.error(`Erro Dividendos: ${error.message}`);
        next(error);
    }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filterType = req.query.filterType; 
        const skip = (page - 1) * limit;
        const userId = req.user.id;

        const cashAssets = await UserAsset.find({ user: userId, type: 'CASH' }).select('ticker');
        const cashTickers = cashAssets.map(a => a.ticker);
        if (!cashTickers.includes('RESERVA')) cashTickers.push('RESERVA');

        let query = { user: userId };

        if (filterType === 'CASH') {
            query.ticker = { $in: cashTickers };
        } else if (filterType === 'TRADE') {
            query.ticker = { $nin: cashTickers };
        }

        const totalItems = await AssetTransaction.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 }) 
            .skip(skip)
            .limit(limit);

        res.json({
            transactions: transactions.map(tx => ({
                ...tx.toObject(),
                isCashOp: cashTickers.includes(tx.ticker)
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

export const runCorporateAction = async (req, res, next) => {
    try {
        const { ticker, type } = req.body;
        if (!ticker) return res.status(400).json({ message: "Ticker obrigatório" });

        logger.info(`Admin solicitou correção de eventos para ${ticker}`);
        
        const result = await financialService.applyCorporateEvents(ticker, type || 'STOCK');
        
        res.json({ 
            message: result.processed ? "Correção aplicada com sucesso." : "Nenhum evento encontrado ou necessário.",
            details: result 
        });

    } catch (error) {
        logger.error(`Erro Corporate Action: ${error.message}`);
        next(error);
    }
};
