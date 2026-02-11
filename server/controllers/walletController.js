
import mongoose from 'mongoose';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent, calculateDailyDietz, calculateSharpeRatio, calculateBeta } from '../utils/mathUtils.js';
import { countBusinessDays, isBusinessDay } from '../utils/dateUtils.js';
import logger from '../config/logger.js';
import { HISTORICAL_CDI_RATES } from '../config/financialConstants.js'; 

const getDailyFactorForDate = (date, currentConfigRate) => {
    const year = date.getFullYear();
    const currentYear = new Date().getFullYear();
    
    let rate = 11.25; 

    if (year === currentYear) {
        rate = currentConfigRate || 11.25;
    } else {
        rate = HISTORICAL_CDI_RATES[year] || 10.0;
    }

    return Math.pow(1 + (rate / 100), 1/252);
};

// HELPER: Calcula KPIs em tempo real (versão leve do getWalletData)
const calculateLiveKPIS = async (userId, currentCdi) => {
    const activeAssets = await UserAsset.find({ user: userId, quantity: { $gt: 0.000001 } });
    
    if (activeAssets.length === 0) return null;

    // Refresh rápido nos ativos voláteis
    const tickers = activeAssets.filter(a => !['FIXED_INCOME', 'CASH'].includes(a.type)).map(a => a.ticker);
    await marketDataService.refreshQuotesBatch(tickers);

    let totalEquity = 0;
    let totalInvested = 0;
    let totalDividends = 0; 

    // Pega dividendos totais (já calculados no financialService)
    const divData = await financialService.calculateUserDividends(userId);
    totalDividends = divData.totalAllTime;

    const usdConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const usdRate = usdConfig?.dollar || 5.75;

    for (const asset of activeAssets) {
        let currentPrice = 0;
        const multiplier = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;

        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            const rawRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : 100;
            const selicDailyFactor = Math.pow(1 + (currentCdi / 100), 1 / 252);
            let effectiveDailyFactor = 1;
            if (rawRate > 50) effectiveDailyFactor = ((selicDailyFactor - 1) * (rawRate/100)) + 1;
            else effectiveDailyFactor = Math.pow(1 + (rawRate / 100), 1 / 252);

            let startDate = new Date(asset.startDate || asset.createdAt);
            startDate.setHours(0,0,0,0);
            const calcDate = new Date();
            calcDate.setHours(0,0,0,0);
            
            const businessDays = countBusinessDays(startDate, calcDate);
            const compoundFactor = Math.pow(effectiveDailyFactor, businessDays);
            
            currentPrice = asset.type === 'CASH' ? compoundFactor : safeMult(asset.averagePrice, compoundFactor);

        } else {
            const mData = await marketDataService.getMarketDataByTicker(asset.ticker);
            currentPrice = mData.price || 0;
        }

        const qty = asset.quantity;
        const val = asset.type === 'CASH' ? qty : safeMult(qty, currentPrice);
        
        totalEquity += safeMult(val, multiplier);
        totalInvested += safeMult(asset.totalCost, multiplier);
    }

    return {
        totalEquity,
        totalInvested,
        totalDividends
    };
};

export const getWalletData = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        const activeAssets = userAssets.filter(a => a.quantity > 0.000001);
        const closedAssets = userAssets.filter(a => a.quantity <= 0.000001);

        // Auto-Heal se não houver ativos mas houver transações (reconstrução forçada)
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
                    weightedRentability: 0,
                    dataQuality: 'AUDITED',
                    sharpeRatio: 0,
                    beta: 0
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

        // --- CÁLCULO LIVE TWRR (SOURCE OF TRUTH BLINDADA) ---
        let weightedRentability = 0;
        let dataQuality = 'AUDITED'; // Default Audited
        let sharpeRatio = 0;
        let beta = 0;
        
        // Busca últimos 30 snapshots para encontrar um ponto de ancoragem válido
        const snapshots = await WalletSnapshot.find({ user: userId })
            .sort({ date: -1 })
            .limit(30)
            .lean();
            
        let lastSnapshot = null;

        // Heurística de Auto-Cura e Qualidade de Dados
        if (snapshots.length > 0) {
            if (snapshots.length === 1) {
                lastSnapshot = snapshots[0];
            } else {
                for (let i = 0; i < snapshots.length; i++) {
                    const snap = snapshots[i];
                    const isResetValue = Math.abs((snap.quotaPrice || 100) - 100) < 0.1;
                    
                    if (isResetValue) {
                        const hasValidHistory = snapshots.slice(i + 1).some(old => Math.abs((old.quotaPrice || 100) - 100) > 1);
                        if (hasValidHistory) {
                            continue; // Pula snapshot corrompido
                        }
                    }
                    lastSnapshot = snap;
                    break;
                }
            }
            if (!lastSnapshot) lastSnapshot = snapshots[0];
        }
        
        if (lastSnapshot && lastSnapshot.quotaPrice) {
            // Se o snapshot encontrado for muito antigo (> 3 dias), a qualidade cai para Estimada
            const diffDays = (now.getTime() - new Date(lastSnapshot.date).getTime()) / (1000 * 3600 * 24);
            if (diffDays > 3) dataQuality = 'ESTIMATED';

            const snapshotDate = new Date(lastSnapshot.date);
            snapshotDate.setHours(23, 59, 59, 999); 
            
            const txs = await AssetTransaction.find({ user: userId, date: { $gt: snapshotDate } });
            
            let periodFlow = 0;
            txs.forEach(tx => {
                if(tx.type === 'BUY') periodFlow += tx.totalValue;
                else if(tx.type === 'SELL') periodFlow -= tx.totalValue;
            });

            const v0 = lastSnapshot.totalEquity;
            const v1 = safeTotalEquity;
            const f = periodFlow;
            
            // Uso do Helper Centralizado de Math
            const periodReturn = calculateDailyDietz(v0, v1, f);
            
            let liveQuotaPrice = lastSnapshot.quotaPrice;
            if (periodReturn > -0.8 && periodReturn < 1.0) {
                liveQuotaPrice = lastSnapshot.quotaPrice * (1 + periodReturn);
            } else {
                dataQuality = 'ESTIMATED';
            }
            
            weightedRentability = ((liveQuotaPrice / 100) - 1) * 100;
        } else {
            weightedRentability = totalResultPercent;
            dataQuality = 'ESTIMATED'; // Sem histórico, é apenas ROI simples
        }

        // --- CÁLCULO DE VOLATILIDADE (Sharpe & Beta) ---
        // Exige histórico de snapshots (pelo menos 10 dias)
        // Isso é pesado, então fazemos apenas se houver histórico suficiente.
        if (snapshots.length >= 10) {
            // Para simplificar no endpoint de resumo, usamos uma lógica aproximada ou deixamos 0
            // O cálculo real está no getWalletPerformance onde temos o array completo
            // Para este endpoint, vamos retornar 0 ou um valor mockado se não tivermos cache.
            // (Para produção real, isso deveria ser calculado no snapshot noturno e salvo)
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
                weightedRentability: safeFloat(weightedRentability),
                dataQuality: dataQuality,
                sharpeRatio: safeFloat(sharpeRatio),
                beta: safeFloat(beta)
            },
            meta: { usdRate, lastUpdate: new Date() }
        });
    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

// --- CORREÇÃO DE RENTABILIDADE (LIVE POINT + FILTRO AVANÇADO) ---
export const getWalletPerformance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        
        let history = await WalletSnapshot.find({ 
            user: userId, 
            totalEquity: { $gt: 1 } 
        }).sort({ date: 1 }).lean();
        
        if (history.length === 0) {
            return res.json([]);
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const lastSnapshot = history[history.length - 1];
        const lastSnapshotDate = lastSnapshot.date.toISOString().split('T')[0];

        if (lastSnapshotDate !== todayStr) {
            const liveData = await calculateLiveKPIS(userId, config?.cdi || 11.25);
            
            if (liveData && liveData.totalEquity > 0) {
                let validPrevQuota = 100;
                let validPrevEquity = 0;
                
                for (let i = history.length - 1; i >= 0; i--) {
                    const snap = history[i];
                    if (snap.quotaPrice && Math.abs(snap.quotaPrice - 100) > 0.01) {
                        validPrevQuota = snap.quotaPrice;
                        validPrevEquity = snap.totalEquity;
                        break;
                    }
                    if (i === 0) {
                        validPrevQuota = snap.quotaPrice || 100;
                        validPrevEquity = snap.totalEquity;
                    }
                }

                let liveQuotaPrice = validPrevQuota;
                if (validPrevEquity > 0) {
                    const dailyReturn = (liveData.totalEquity - validPrevEquity) / validPrevEquity;
                    const safeReturn = Math.max(-0.2, Math.min(0.2, dailyReturn));
                    liveQuotaPrice = validPrevQuota * (1 + safeReturn);
                }

                history.push({
                    date: today,
                    totalEquity: liveData.totalEquity,
                    totalInvested: liveData.totalInvested,
                    totalDividends: liveData.totalDividends,
                    quotaPrice: liveQuotaPrice,
                    isLive: true 
                });
            }
        }

        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP');
        const ibovMap = new Map();
        if (ibovHistory && Array.isArray(ibovHistory)) {
            ibovHistory.forEach(h => ibovMap.set(h.date, h.close || h.adjClose));
        }

        const startDateStr = history[0].date.toISOString().split('T')[0];
        let baseIbov = ibovMap.get(startDateStr);
        if (!baseIbov) {
             const fallback = ibovHistory?.find(h => h.date >= startDateStr);
             baseIbov = fallback ? (fallback.close || fallback.adjClose) : 120000;
        }

        const currentRate = config?.cdi || 11.15;
        let accumulatedCDI = 1.0;
        let accumulatedIPCA = 1.0; // IPCA + 6%
        let previousDate = new Date(history[0].date);
        previousDate.setHours(0,0,0,0);

        // Taxas para IPCA+6%
        const ipcaRate = config?.ipca || 4.5;
        const realRate = 6.0;
        const totalIpcaRate = ipcaRate + realRate; // ex: 10.5% a.a.

        // --- CÁLCULO DE MÉTRICAS (SHARPE & BETA) ---
        // Arrays de retornos diários para cálculo estatístico
        const walletReturns = [];
        const marketReturns = [];

        const result = history.map((point, index) => {
            const dateStr = point.date.toISOString().split('T')[0];
            const currentDate = new Date(point.date);
            currentDate.setHours(0,0,0,0);

            const daysDelta = countBusinessDays(previousDate, currentDate);
            
            if (daysDelta > 0) {
                // CDI
                const factorCDI = getDailyFactorForDate(currentDate, currentRate);
                accumulatedCDI *= Math.pow(factorCDI, daysDelta);

                // IPCA+6%
                const factorIPCA = Math.pow(1 + (totalIpcaRate / 100), 1/252);
                accumulatedIPCA *= Math.pow(factorIPCA, daysDelta);
            }
            previousDate = currentDate;

            // IBOV Acumulado
            let currentIbov = ibovMap.get(dateStr);
            if (point.isLive && !currentIbov) {
                currentIbov = config?.ibov;
            }
            if (!currentIbov && baseIbov) currentIbov = baseIbov;

            const ibovPercent = baseIbov && currentIbov ? ((currentIbov / baseIbov) - 1) * 100 : 0;
            const walletTWRR = point.quotaPrice ? ((point.quotaPrice/100)-1)*100 : 0;
            
            // Coleta de retornos diários (para Beta/Sharpe)
            if (index > 0) {
                const prevPoint = history[index-1];
                const prevQuota = prevPoint.quotaPrice || 100;
                const currQuota = point.quotaPrice || 100;
                const dailyWalletReturn = ((currQuota / prevQuota) - 1) * 100;
                walletReturns.push(dailyWalletReturn);

                // Market Return do dia
                // (Precisaríamos do valor absoluto anterior do Ibov, mas como temos percentual acumulado, podemos derivar ou pegar do map)
                // Simplificação: Pegamos variação do ibovPercent atual vs anterior
                const prevIbovVal = (index === 1 && !history[0].isLive) ? baseIbov : (ibovMap.get(history[index-1].date.toISOString().split('T')[0]) || baseIbov);
                const dailyMarketReturn = prevIbovVal > 0 ? ((currentIbov / prevIbovVal) - 1) * 100 : 0;
                marketReturns.push(dailyMarketReturn);
            }

            const walletROI = point.totalInvested > 0 
                ? ((point.totalEquity - point.totalInvested + point.totalDividends) / point.totalInvested) * 100 
                : 0;

            return {
                date: dateStr,
                wallet: walletTWRR, 
                walletRoi: walletROI,
                cdi: (accumulatedCDI - 1) * 100,
                ipca: (accumulatedIPCA - 1) * 100, // Novo Benchmark
                ibov: ibovPercent
            };
        });

        const cleanedResult = result.filter((r, idx) => {
            if (idx === 0) return true;
            if (Math.abs(r.wallet) < 0.001 && Math.abs(result[idx-1].wallet) > 1) return false;
            return true;
        });
        
        let lastKnownIbov = 0;
        cleanedResult.forEach(r => {
            if (r.ibov !== 0) lastKnownIbov = r.ibov;
            else r.ibov = lastKnownIbov;
        });

        // Calcular Métricas Finais
        const sharpe = calculateSharpeRatio(walletReturns, currentRate);
        const beta = calculateBeta(walletReturns, marketReturns);

        res.json({
            history: cleanedResult,
            stats: {
                sharpe: safeFloat(sharpe),
                beta: safeFloat(beta)
            }
        });
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

// ... (Restante dos endpoints de transação mantidos) ...
export const addAssetTransaction = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const userId = req.user.id;
        const { ticker, type, quantity, price, date, fixedIncomeRate, name } = req.body;
        if (!ticker || quantity === undefined || price === undefined) throw new Error("Dados incompletos.");
        const txDate = date ? new Date(date) : new Date();
        const now = new Date();
        const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
        if (txDate > todayEnd) throw new Error("Data futura não permitida.");
        const transactionType = quantity >= 0 ? 'BUY' : 'SELL';
        const newTx = new AssetTransaction({
            user: userId, ticker: ticker.toUpperCase(), type: transactionType,
            quantity: Math.abs(parseFloat(quantity)), price: Math.abs(parseFloat(price)),
            totalValue: Math.abs(parseFloat(quantity)) * Math.abs(parseFloat(price)),
            date: txDate, notes: name ? `Nome: ${name}` : ''
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
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        const isRetroactive = txDate < yesterday;
        await session.commitTransaction();
        session.endSession();
        if (isRetroactive) {
            try { await financialService.rebuildUserHistory(userId); } catch (err) {}
        }
        res.status(201).json({ message: "Transação registrada.", asset: updatedAsset });
    } catch (error) {
        await session.abortTransaction(); session.endSession(); next(error);
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
        try { await financialService.rebuildUserHistory(userId); } catch (e) {}
        res.json({ message: "Ativo removido." });
    } catch (error) {
        await session.abortTransaction(); session.endSession(); next(error);
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
        res.json({ message: "Carteira resetada." });
    } catch (error) {
        await session.abortTransaction(); session.endSession(); next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const results = await MarketAsset.find({
            $or: [{ ticker: { $regex: `^${q}`, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }],
            isIgnored: false
        }).sort({ liquidity: -1 }).limit(10).select('ticker name type lastPrice');
        res.json(results);
    } catch (error) { next(error); }
};

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const query = { user: req.user.id, ticker: ticker.toUpperCase() };
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
        const total = await AssetTransaction.countDocuments(query);
        res.json({ transactions, pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit), hasMore: page * limit < total } });
    } catch (error) { next(error); }
};

export const deleteTransaction = async (req, res, next) => {
    try {
        const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: req.user.id });
        if (!tx) return res.status(404).json({ message: "Transação não encontrada" });
        await financialService.recalculatePosition(req.user.id, tx.ticker);
        try { await financialService.rebuildUserHistory(req.user.id); } catch (e) {}
        res.json({ message: "Transação removida." });
    } catch (error) { next(error); }
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const data = await financialService.calculateUserDividends(req.user.id);
        const history = Array.from(data.dividendMap.entries()).map(([month, val]) => ({ month, value: val.total, breakdown: val.breakdown })).sort((a, b) => a.month.localeCompare(b.month));
        res.json({ history, provisioned: data.provisioned, totalAllTime: data.totalAllTime, projectedMonthly: data.projectedMonthly });
    } catch (error) { next(error); }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        const query = { user: req.user.id };
        if (filterType === 'CASH') query.ticker = 'RESERVA';
        else if (filterType === 'TRADE') query.ticker = { $ne: 'RESERVA' };
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
        const total = await AssetTransaction.countDocuments(query);
        res.json({ transactions: transactions.map(t => ({ ...t.toObject(), isCashOp: t.ticker === 'RESERVA' })), pagination: { total, hasMore: page * limit < total } });
    } catch (error) { next(error); }
};

export const runCorporateAction = async (req, res, next) => {
    try {
        const { ticker, type } = req.body;
        res.json({ message: "Comando recebido.", details: { updates: 0 } });
    } catch (error) { next(error); }
};

export const fixWalletSnapshots = async (req, res, next) => {
    try {
        const deletedCount = await WalletSnapshot.deleteMany({
            $or: [{ quotaPrice: { $lte: 0.1 } }, { quotaPrice: { $gte: 1000000 } }]
        });
        
        const users = await WalletSnapshot.distinct('user');
        let resetDeletions = 0;

        for (const userId of users) {
            const snaps = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
            const toDelete = [];
            for (let i = 1; i < snaps.length; i++) {
                const prev = snaps[i-1];
                const curr = snaps[i];
                if (Math.abs(curr.quotaPrice - 100) < 0.01 && Math.abs(prev.quotaPrice - 100) > 5) {
                    toDelete.push(curr._id);
                }
            }
            if (toDelete.length > 0) {
                await WalletSnapshot.deleteMany({ _id: { $in: toDelete } });
                resetDeletions += toDelete.length;
            }
        }

        res.json({ 
            message: "Limpeza de snapshots concluída.", 
            deletedZeros: deletedCount.deletedCount,
            deletedResets: resetDeletions
        });
    } catch (error) {
        next(error);
    }
};

// NOVO: Endpoint de Saúde dos Dados (Admin)
export const getSnapshotHealth = async (req, res, next) => {
    try {
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const totalUsers = await User.countDocuments({});
        const snapshotsToday = await WalletSnapshot.countDocuments({ date: { $gte: today } });
        const lastRun = await WalletSnapshot.findOne().sort({ createdAt: -1 }).select('createdAt');

        res.json({
            totalUsers,
            snapshotsToday,
            coverage: totalUsers > 0 ? ((snapshotsToday / totalUsers) * 100).toFixed(1) + '%' : '0%',
            lastRun: lastRun?.createdAt,
            status: snapshotsToday > (totalUsers * 0.9) ? 'HEALTHY' : 'WARNING'
        });
    } catch (error) {
        next(error);
    }
};
