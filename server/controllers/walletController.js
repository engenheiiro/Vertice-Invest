
import mongoose from 'mongoose';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent, calculateDailyDietz, calculateSharpeRatio, calculateBeta, safeValue, safePrice, QUANTITY_EPSILON, selectAnchorSnapshot, computeLiveQuota, benchmarkStep } from '../utils/mathUtils.js';
import { countBusinessDays, isBusinessDay } from '../utils/dateUtils.js';
import { accrueFixedIncomeValue, fixedIncomeDailyFactor, brazilToday, brazilDateOnly } from '../utils/fixedIncome.js';
import logger from '../config/logger.js';
import { HISTORICAL_CDI_RATES, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { runDailySnapshot } from '../services/schedulerService.js'; // Importado

const getDailyFactorForDate = (date, currentConfigRate) => {
    const year = date.getFullYear();
    const currentYear = new Date().getFullYear();

    let rate = DEFAULT_SELIC_FALLBACK;

    if (year === currentYear) {
        rate = currentConfigRate || DEFAULT_SELIC_FALLBACK;
    } else {
        rate = HISTORICAL_CDI_RATES[year] || 10.0;
    }

    return Math.pow(1 + (rate / 100), 1/252);
};

// HELPER: Calcula KPIs em tempo real (versão leve do getWalletData)
const calculateLiveKPIS = async (userId, currentCdi) => {
    const activeAssets = await UserAsset.find({ user: userId, quantity: { $gt: QUANTITY_EPSILON } });

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
    const calcDate = brazilToday();

    for (const asset of activeAssets) {
        const multiplier = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;

        let val;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            // Fonte única de accrual (idêntica ao getWalletData) — antes este
            // caminho ignorava o rendimento (val = qty), divergindo do KPI.
            val = accrueFixedIncomeValue(asset, { cdiRate: currentCdi, calcDate });
        } else {
            const mData = await marketDataService.getMarketDataByTicker(asset.ticker);
            val = safeValue(asset.quantity, mData.price || 0);
        }

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

        // Carteira ideal (alocação-alvo) persistida no usuário — acompanha a resposta.
        const userPrefs = await User.findById(userId).select('targetAllocation targetReserve').lean();
        const targets = {
            targetAllocation: userPrefs?.targetAllocation || { STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10, FIXED_INCOME: 0 },
            targetReserve: typeof userPrefs?.targetReserve === 'number' ? userPrefs.targetReserve : 10000,
        };

        const userAssets = await UserAsset.find({ user: userId });
        const activeAssets = userAssets.filter(a => a.quantity > QUANTITY_EPSILON);
        const closedAssets = userAssets.filter(a => a.quantity <= QUANTITY_EPSILON);

        // Auto-Heal se não houver ativos mas houver transações (reconstrução forçada)
        if (activeAssets.length === 0) {
            const txCount = await AssetTransaction.countDocuments({ user: userId });
            if (txCount > 0) {
                const allTxs = await AssetTransaction.find({ user: userId });
                const distinctTickers = [...new Set(allTxs.map(t => t.ticker))];
                for (const ticker of distinctTickers) {
                    await financialService.recalculatePosition(userId, ticker);
                }
                const healedAssets = await UserAsset.find({ user: userId, quantity: { $gt: QUANTITY_EPSILON } });
                if (healedAssets.length > 0) {
                    return getWalletData(req, res, next);
                }
            }
        }

        if (userAssets.length === 0) {
            const emptyConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const emptyUsdRate = safeFloat(emptyConfig?.dollar || 5.75);
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
                ...targets,
                meta: { usdRate: emptyUsdRate }
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

        const brazilTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const isTodayBusinessDay = isBusinessDay(new Date(brazilTodayStr + 'T00:00:00.000Z'));

        const processedAssets = activeAssets.map(asset => {
            let currentPrice = 0;
            let dayChangePct = 0; 

            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                // Accrual via fonte única (utils/fixedIncome) — idêntico ao
                // calculateLiveKPIS, garantindo KPI e ponto live do gráfico iguais.
                const effectiveDailyFactor = fixedIncomeDailyFactor(asset.fixedIncomeRate, currentCdi);
                dayChangePct = isTodayBusinessDay ? (effectiveDailyFactor - 1) * 100 : 0;

                const calcDate = brazilToday();
                const totalCurrentValue = accrueFixedIncomeValue(asset, { cdiRate: currentCdi, calcDate });
                const totalQuantity = asset.quantity;

                if (totalQuantity > 0) {
                    currentPrice = totalCurrentValue / totalQuantity;
                } else {
                    currentPrice = asset.type === 'CASH' ? 1 : safeDiv(asset.totalCost, asset.quantity);
                }

                // Ativo comprado HOJE: zera a variação do dia (evita variação irreal).
                const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
                const lotDayStr = (d) => {
                    const o = new Date(d);
                    if (o.getUTCHours() === 0 && o.getUTCMinutes() === 0 && o.getUTCSeconds() === 0) return o.toISOString().split('T')[0];
                    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(o);
                };
                const boughtToday = asset.taxLots && asset.taxLots.length > 0 && asset.taxLots.every(lot => lotDayStr(lot.date) === todayStr);
                if (boughtToday) dayChangePct = 0;

            } else {
                const cached = assetMap.get(asset.ticker);
                if (cached && cached.price > 0) {
                    currentPrice = safeFloat(Number(cached.price));
                    if (asset.type === 'CRYPTO') {
                        dayChangePct = safeFloat(Number(cached.change));
                    } else {
                        dayChangePct = isTodayBusinessDay ? safeFloat(Number(cached.change)) : 0;
                    }
                    
                    // Ajuste para ativos comprados HOJE (evita variação irreal no dia da compra)
                    const todayStr = new Date().toISOString().split('T')[0];
                    const boughtToday = asset.taxLots && asset.taxLots.length > 0 && asset.taxLots.every(lot => new Date(lot.date).toISOString().split('T')[0] === todayStr);
                    
                    if (boughtToday && asset.quantity > 0) {
                        const averagePrice = safePrice(asset.totalCost, asset.quantity);
                        if (averagePrice > 0) {
                            dayChangePct = ((currentPrice / averagePrice) - 1) * 100;
                        }
                    }
                } else {
                    currentPrice = 0; 
                    dayChangePct = 0;
                }
            }
            
            const isDollarized = asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO';
            const currentMultiplier = isDollarized ? usdRate : 1;
            const prevMultiplier = isDollarized ? (usdRate / (1 + usdChange/100)) : 1;

            const valueBase = asset.type === 'CASH' ? asset.quantity : safeValue(asset.quantity, currentPrice);
            const totalValueBr = asset.type === 'CASH'
                ? safeMult(safeMult(asset.quantity, currentPrice), currentMultiplier)
                : safeMult(valueBase, currentMultiplier);

            const totalCostBr = safeMult(asset.totalCost, currentMultiplier);

            // Cálculo robusto da variação diária em BRL
            // Considera tanto a variação do ativo quanto a variação cambial
            const priceStart = currentPrice / (1 + dayChangePct/100);
            const valueStartBr = safeMult(safeValue(asset.quantity, priceStart), prevMultiplier);

            const dayChangeValueBr = safeSub(totalValueBr, valueStartBr);
            const combinedChangePct = valueStartBr > 0 ? ((totalValueBr / valueStartBr) - 1) * 100 : 0;

            totalEquity = safeAdd(totalEquity, totalValueBr);
            totalInvested = safeAdd(totalInvested, totalCostBr);
            totalDayVariation = safeAdd(totalDayVariation, dayChangeValueBr);

            const unrealizedProfitBr = safeSub(totalValueBr, totalCostBr);
            const realizedProfitBr = safeMult((asset.realizedProfit || 0), currentMultiplier);
            const positionTotalResult = safeAdd(unrealizedProfitBr, realizedProfitBr);
            
            let profitPercent = 0;
            if (totalCostBr > 0) {
                profitPercent = calculatePercent(positionTotalResult, totalCostBr); 
            }

            return {
                id: asset._id,
                ticker: asset.ticker,
                // Nome ao vivo (mercado) → nome salvo (cofrinho/renda fixa) → ticker.
                name: assetMap.get(asset.ticker)?.name || asset.name || asset.ticker,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: asset.quantity > 0 ? safePrice(asset.totalCost, asset.quantity) : 0,
                currentPrice: asset.type === 'CASH' ? 1 : currentPrice,
                currency: asset.currency,
                totalValue: safeCurrency(totalValueBr), 
                totalCost: safeCurrency(totalCostBr),
                profit: safeCurrency(positionTotalResult),
                profitPercent: safeFloat(profitPercent),
                sector: assetMap.get(asset.ticker)?.sector || (asset.type === 'FIXED_INCOME' ? 'Renda Fixa' : asset.type === 'CASH' ? 'Caixa' : 'Outros'),
                dayChangePct: safeFloat(combinedChangePct),
                tags: asset.tags // Return tags
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
        const now = new Date();
        let weightedRentability = 0;
        let dataQuality = 'AUDITED'; // Default Audited
        let sharpeRatio = 0;
        let beta = 0;
        
        // Busca últimos 30 snapshots para encontrar um ponto de ancoragem válido
        const snapshots = await WalletSnapshot.find({ user: userId })
            .sort({ date: -1 })
            .limit(30)
            .lean();
            
        // Âncora via regra única compartilhada (paridade KPI × gráfico).
        const lastSnapshot = selectAnchorSnapshot(snapshots);

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

            // Fonte única da cota live (utils/mathUtils.computeLiveQuota) — mesmo
            // cálculo que getWalletPerformance usa no ponto live.
            const liveQuotaPrice = computeLiveQuota(lastSnapshot, safeTotalEquity, periodFlow);
            weightedRentability = ((liveQuotaPrice / 100) - 1) * 100;
        } else {
            weightedRentability = totalResultPercent;
            dataQuality = 'ESTIMATED'; // Sem histórico, é apenas ROI simples
        }

        // --- CÁLCULO DE VOLATILIDADE (Sharpe) ---
        // Usa as quotaPrices dos últimos 30 snapshots já carregados.
        // Beta omitido aqui pois exigiria buscar histórico do Ibovespa (pesado) — disponível em getWalletPerformance.
        if (snapshots.length >= 10) {
            const sortedSnaps = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
            const walletReturns = [];
            for (let i = 1; i < sortedSnaps.length; i++) {
                const prev = sortedSnaps[i - 1].quotaPrice || 100;
                const curr = sortedSnaps[i].quotaPrice || 100;
                if (prev > 0) walletReturns.push(((curr / prev) - 1) * 100);
            }
            if (walletReturns.length >= 5) {
                sharpeRatio = calculateSharpeRatio(walletReturns, currentCdi);
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
                totalDividends: safeCurrency(totalDividends),
                projectedDividends: safeCurrency(projectedMonthly),
                weightedRentability: safeFloat(weightedRentability),
                dataQuality: dataQuality,
                sharpeRatio: safeFloat(sharpeRatio),
                beta: safeFloat(beta)
            },
            ...targets,
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

        // "Hoje" no fuso de São Paulo (mesma referência do KPI) — evita que o
        // relógio UTC do servidor anexe um ponto "do dia seguinte" e acumule um
        // dia extra de CDI no benchmark.
        const today = brazilToday();
        const todayStr = today.toISOString().split('T')[0];
        const lastSnapshot = history[history.length - 1];
        const lastSnapshotDate = brazilDateOnly(lastSnapshot.date).toISOString().split('T')[0];

        if (lastSnapshotDate !== todayStr) {
            const liveData = await calculateLiveKPIS(userId, config?.cdi || 11.25);

            if (liveData && liveData.totalEquity > 0) {
                // Mesma âncora do KPI (getWalletData): regra única compartilhada.
                const anchor = selectAnchorSnapshot([...history].reverse());

                // Fluxo de caixa desde o âncora (aportes/resgates) — Modified Dietz.
                let periodFlow = 0;
                if (anchor) {
                    const anchorDate = new Date(anchor.date);
                    anchorDate.setHours(23, 59, 59, 999);
                    const txsSince = await AssetTransaction.find({
                        user: userId,
                        date: { $gt: anchorDate }
                    }).lean();
                    txsSince.forEach(tx => {
                        if (tx.type === 'BUY') periodFlow += tx.totalValue;
                        else if (tx.type === 'SELL') periodFlow -= tx.totalValue;
                    });
                }

                // Fonte única da cota live — idêntica ao KPI (weightedRentability).
                const liveQuotaPrice = computeLiveQuota(anchor, liveData.totalEquity, periodFlow);

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

        // Benchmarks cashflow-aware (modo R$): o capital cresce pelo índice e
        // recebe os MESMOS aportes/resgates nas datas reais — comparável à
        // carteira (que também inclui os aportes). Semente = invested inicial.
        let cdiVal = 0, ipcaVal = 0, ibovVal = 0;
        let prevInvested = history[0]?.totalInvested || 0;
        let prevIbovForVal = baseIbov;

        const result = history.map((point, index) => {
            const dateStr = point.date.toISOString().split('T')[0];
            const currentDate = new Date(point.date);
            currentDate.setHours(0,0,0,0);

            const daysDelta = countBusinessDays(previousDate, currentDate);

            const periodFactorCDI = daysDelta > 0 ? Math.pow(getDailyFactorForDate(currentDate, currentRate), daysDelta) : 1;
            const periodFactorIPCA = daysDelta > 0 ? Math.pow(Math.pow(1 + (totalIpcaRate / 100), 1/252), daysDelta) : 1;
            accumulatedCDI *= periodFactorCDI;
            accumulatedIPCA *= periodFactorIPCA;
            previousDate = currentDate;

            // IBOV Acumulado
            let currentIbov = ibovMap.get(dateStr);
            if (point.isLive && !currentIbov) {
                currentIbov = config?.ibov;
            }
            if (!currentIbov && baseIbov) currentIbov = baseIbov;

            const ibovPercent = baseIbov && currentIbov ? ((currentIbov / baseIbov) - 1) * 100 : 0;
            const walletTWRR = point.quotaPrice ? ((point.quotaPrice/100)-1)*100 : 0;

            // --- Valores cashflow-aware dos benchmarks (modo R$) ---
            const periodFactorIbov = (prevIbovForVal > 0 && currentIbov) ? (currentIbov / prevIbovForVal) : 1;
            const flow = (point.totalInvested || 0) - prevInvested;
            if (index === 0) {
                cdiVal = ipcaVal = ibovVal = point.totalInvested || 0;
            } else {
                cdiVal = benchmarkStep(cdiVal, periodFactorCDI, flow);
                ipcaVal = benchmarkStep(ipcaVal, periodFactorIPCA, flow);
                ibovVal = benchmarkStep(ibovVal, periodFactorIbov, flow);
            }
            prevInvested = point.totalInvested || 0;
            if (currentIbov) prevIbovForVal = currentIbov;

            // Coleta de retornos diários (para Beta/Sharpe)
            if (index > 0) {
                const prevPoint = history[index-1];
                const prevQuota = prevPoint.quotaPrice || 100;
                const currQuota = point.quotaPrice || 100;
                const dailyWalletReturn = ((currQuota / prevQuota) - 1) * 100;
                walletReturns.push(dailyWalletReturn);

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
                equity: point.totalEquity ?? 0,
                invested: point.totalInvested ?? 0,
                cdi: (accumulatedCDI - 1) * 100,
                ipca: (accumulatedIPCA - 1) * 100,
                ibov: ibovPercent,
                cdiValue: safeCurrency(cdiVal),
                ipcaValue: safeCurrency(ipcaVal),
                ibovValue: safeCurrency(ibovVal),
            };
        });

        // Forward-fill do Ibov % quando faltar cotação no dia (feriado/sem dado).
        let lastKnownIbov = 0;
        result.forEach(r => {
            if (r.ibov !== 0) lastKnownIbov = r.ibov;
            else r.ibov = lastKnownIbov;
        });

        // Calcular Métricas Finais
        const sharpe = calculateSharpeRatio(walletReturns, currentRate);
        const beta = calculateBeta(walletReturns, marketReturns);

        res.json({
            history: result,
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
        // Ingestão de proventos do ticker em background (não bloqueia a resposta).
        // Garante que compras novas já apareçam com proventos sem rodar o script.
        if (transactionType === 'BUY' && !['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) {
            financialService.syncDividends([{ ticker: ticker.toUpperCase(), type }]).catch(() => {});
        }
        res.status(201).json({ message: "Transação registrada.", asset: updatedAsset });
    } catch (error) {
        await session.abortTransaction(); session.endSession(); next(error);
    }
};

export const updateAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tags, name } = req.body;
        const userId = req.user.id;

        const asset = await UserAsset.findOne({ _id: id, user: userId });
        if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

        if (tags !== undefined) asset.tags = tags;
        // Renomear cofrinho (Reserva/Caixa) ou título de Renda Fixa.
        if (name !== undefined) asset.name = String(name).trim();

        await asset.save();
        res.json({ message: "Ativo atualizado.", asset });
    } catch (error) {
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

// PUT /wallet/targets — salva a carteira ideal (alocação-alvo + reserva) do usuário.
export const updateWalletTargets = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { targetAllocation, targetReserve } = req.body;

        const update = {};
        if (targetAllocation !== undefined) {
            update.targetAllocation = {
                STOCK: safeFloat(targetAllocation.STOCK || 0),
                FII: safeFloat(targetAllocation.FII || 0),
                STOCK_US: safeFloat(targetAllocation.STOCK_US || 0),
                CRYPTO: safeFloat(targetAllocation.CRYPTO || 0),
                FIXED_INCOME: safeFloat(targetAllocation.FIXED_INCOME || 0),
            };
        }
        if (targetReserve !== undefined) {
            update.targetReserve = Math.max(0, safeFloat(targetReserve));
        }

        const updated = await User.findByIdAndUpdate(userId, { $set: update }, { new: true })
            .select('targetAllocation targetReserve').lean();

        res.json({
            message: 'Carteira ideal atualizada.',
            targetAllocation: updated?.targetAllocation,
            targetReserve: updated?.targetReserve,
        });
    } catch (error) {
        next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const { q, type } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const marketResults = await MarketAsset.find({
            $or: [{ ticker: { $regex: `^${q}`, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }],
            isIgnored: { $ne: true }
        }).sort({ liquidity: -1 }).limit(8).select('ticker name type lastPrice rate index');

        if (type === 'FIXED_INCOME') {
            const bonds = await TreasuryBond.find({
                title: { $regex: q, $options: 'i' }
            }).sort({ type: 1, maturityDate: 1 }).limit(10);

            const formattedBonds = bonds.map(b => ({
                ticker: b.title,
                name: b.title,
                type: 'FIXED_INCOME',
                lastPrice: b.unitPrice,
                rate: b.rate,
                index: b.index,
                maturityDate: b.maturityDate,
                isTreasury: true
            }));

            return res.json([...marketResults, ...formattedBonds]);
        }

        res.json(marketResults);
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
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const userId = req.user.id;
        const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: userId }, { session });
        if (!tx) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: "Transação não encontrada" });
        }
        // Recalcula a posição na MESMA transação: se o recálculo falhar (ex.: saldo
        // insuficiente), o delete é revertido — sem estado financeiro inconsistente.
        await financialService.recalculatePosition(userId, tx.ticker, null, session);
        await session.commitTransaction();
        session.endSession();
        try { await financialService.rebuildUserHistory(userId); } catch (e) {}
        res.json({ message: "Transação removida." });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

// Throttle do self-heal de dividendos (1h por usuário) — evita re-scraping a
// cada poll do Cofre enquanto os dados ainda estão zerados.
const DIVIDEND_HEAL_TTL = 60 * 60 * 1000;
const dividendHealAt = new Map();

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const data = await financialService.calculateUserDividends(userId);
        const history = Array.from(data.dividendMap.entries()).map(([month, val]) => ({ month, value: val.total, breakdown: val.breakdown })).sort((a, b) => a.month.localeCompare(b.month));
        res.json({ history, provisioned: data.provisioned, totalAllTime: data.totalAllTime, projectedMonthly: data.projectedMonthly });

        // Self-heal: se o usuário tem ativos pagadores mas TUDO está zerado, é
        // sinal de que faltou sincronizar proventos e/ou popular dy. Dispara em
        // background (sem travar a resposta) sincronização de DividendEvent +
        // refresh de fundamentos (dy/preço). Throttle por usuário evita repetição.
        const isEmpty = data.totalAllTime === 0 && data.projectedMonthly === 0 && (data.provisioned?.length || 0) === 0;
        if (isEmpty) {
            const last = dividendHealAt.get(userId) || 0;
            if (Date.now() - last > DIVIDEND_HEAL_TTL) {
                dividendHealAt.set(userId, Date.now());
                (async () => {
                    try {
                        const eligible = await UserAsset.find({ user: userId, quantity: { $gt: QUANTITY_EPSILON } }).select('ticker type').lean();
                        const payers = eligible.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
                        if (payers.length === 0) return;
                        await marketDataService.refreshFundamentals(payers.map(a => a.ticker));
                        await financialService.syncDividends(payers.map(a => ({ ticker: a.ticker, type: a.type })));
                        logger.info(`[Dividends] Self-heal concluído p/ ${userId} (${payers.length} ativos).`);
                    } catch (e) {
                        logger.warn(`[Dividends] Self-heal falhou p/ ${userId}: ${e.message}`);
                    }
                })();
            }
        }
    } catch (error) { next(error); }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        const userId = req.user.id;

        // Cofrinhos (Reserva/Caixa) do usuário: cada um é um UserAsset type=CASH com
        // ticker próprio. Mapa ticker→nome para rotular o extrato e set para filtrar.
        const cashAssets = await UserAsset.find({ user: userId, type: 'CASH' }).select('ticker name').lean();
        const cashTickers = cashAssets.map(a => a.ticker);
        const cashNameByTicker = new Map(cashAssets.map(a => [a.ticker, a.name || 'Reserva']));

        const query = { user: userId };
        if (filterType === 'CASH') query.ticker = { $in: cashTickers };
        else if (filterType === 'TRADE') query.ticker = { $nin: cashTickers };
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
        const total = await AssetTransaction.countDocuments(query);
        res.json({
            transactions: transactions.map(t => {
                const isCashOp = cashNameByTicker.has(t.ticker);
                return { ...t.toObject(), isCashOp, cashName: isCashOp ? cashNameByTicker.get(t.ticker) : undefined };
            }),
            pagination: { total, hasMore: page * limit < total }
        });
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

// NOVO: Ação Manual de Snapshot (Admin)
export const forceSnapshot = async (req, res, next) => {
    try {
        const { force } = req.body;
        // Chama a função isolada do scheduler
        const result = await runDailySnapshot(!!force);
        
        if (result.status === 'ERROR') throw new Error(result.error);
        if (result.status === 'SKIPPED') {
            return res.status(200).json({ message: "Snapshot ignorado (Feriado ou Fim de semana). Use force=true para obrigar." });
        }
        
        res.json({ message: "Snapshot executado com sucesso.", stats: result.stats });
    } catch (error) {
        next(error);
    }
};
