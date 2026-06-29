
import mongoose from 'mongoose';
import { runTransaction, txError } from '../utils/dbTransaction.js';
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
import { countBusinessDays, isBusinessDay, toDateKey, startOfDay } from '../utils/dateUtils.js';
import { accrueFixedIncomeValue, fixedIncomeDailyFactor, assetDailyFactor, brazilToday, brazilDateOnly } from '../utils/fixedIncome.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
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

    // (5.4 + 5.8) Dividendos, macro e cotações em lote (sem N+1): em vez de um
    // findOne por ativo, getMarketDataMap resolve todos os tickers de uma vez.
    const [divData, usdConfig, marketMap] = await Promise.all([
        financialService.calculateUserDividends(userId),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }),
        marketDataService.getMarketDataMap(tickers),
    ]);
    totalDividends = divData.totalAllTime;

    const usdRate = usdConfig?.dollar || 5.75;
    const selic = usdConfig?.selic;
    const ipca = usdConfig?.ipca;
    const calcDate = brazilToday();

    for (const asset of activeAssets) {
        const multiplier = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;

        let val;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            // Fonte única de accrual (idêntica ao getWalletData) — antes este
            // caminho ignorava o rendimento (val = qty), divergindo do KPI.
            val = accrueFixedIncomeValue(asset, { cdiRate: currentCdi, selic, ipca, calcDate });
        } else {
            const mData = marketMap.get(asset.ticker);
            val = safeValue(asset.quantity, mData?.price || 0);
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

// (6.2) Limite de profundidade do auto-heal: getWalletData recursa no máximo
// MAX_WALLET_HEAL_DEPTH vezes para nunca entrar em loop infinito caso o
// recálculo de posições reporte sucesso mas não estabilize o estado.
const MAX_WALLET_HEAL_DEPTH = 1;

// (6.3) Helpers extraídos de getWalletData para que cada etapa seja pequena e
// testável isoladamente. A aritmética financeira é idêntica à versão monolítica.

// Carrega preferências + holdings do usuário e deriva targets/active/closed.
const loadWalletState = async (userId) => {
    // (5.4) Preferências e holdings dependem só do userId → buscadas em paralelo.
    const [userPrefs, userAssets] = await Promise.all([
        User.findById(userId).select('targetAllocation targetReserve targetMonthlyDividendIncome targetSubAllocation').lean(),
        UserAsset.find({ user: userId }),
    ]);

    // Carteira ideal (alocação-alvo + sub-metas) persistida no usuário — acompanha a resposta.
    const targets = {
        targetAllocation: userPrefs?.targetAllocation || { STOCK: 40, FII: 30, STOCK_US: 20, ETF: 0, CRYPTO: 10, FIXED_INCOME: 0 },
        targetReserve: typeof userPrefs?.targetReserve === 'number' ? userPrefs.targetReserve : 10000,
        targetMonthlyDividendIncome: typeof userPrefs?.targetMonthlyDividendIncome === 'number' ? userPrefs.targetMonthlyDividendIncome : 0,
        targetSubAllocation: userPrefs?.targetSubAllocation || {
            FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
            STOCK_US: { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 },
        },
    };

    const activeAssets = userAssets.filter(a => a.quantity > QUANTITY_EPSILON);
    const closedAssets = userAssets.filter(a => a.quantity <= QUANTITY_EPSILON);

    return { userAssets, activeAssets, closedAssets, targets };
};

// Auto-Heal: sem ativos ativos mas com transações → reconstrói as posições.
// Retorna os ativos curados (>0) ou null se nada foi reconstruído.
const autoHealPositions = async (userId) => {
    const txCount = await AssetTransaction.countDocuments({ user: userId });
    if (txCount === 0) return null;

    const allTxs = await AssetTransaction.find({ user: userId });
    const distinctTickers = [...new Set(allTxs.map(t => t.ticker))];
    for (const ticker of distinctTickers) {
        await financialService.recalculatePosition(userId, ticker);
    }
    const healedAssets = await UserAsset.find({ user: userId, quantity: { $gt: QUANTITY_EPSILON } });
    return healedAssets.length > 0 ? healedAssets : null;
};

// Resposta para carteira vazia (sem holdings).
const buildEmptyWalletResponse = async (targets) => {
    const emptyConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const emptyUsdRate = safeFloat(emptyConfig?.dollar || 5.75);
    return {
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
    };
};

// (5.4 + 5.8) Quatro leituras independentes resolvidas num único lote:
// cotações (1 query em lote, sem N+1 — 5.8), macro, dividendos e os snapshots
// usados no TWRR/Sharpe. (5.3) Promise.allSettled: se uma falha (ex.: cálculo
// de dividendos), a carteira ainda renderiza com degradação graciosa.
const fetchWalletMarketContext = async (userId, liveTickers) => {
    const [assetMapR, configR, dividendsR, snapshotsR] = await Promise.allSettled([
        marketDataService.getMarketDataMap(liveTickers),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }),
        financialService.calculateUserDividends(userId),
        WalletSnapshot.find({ user: userId }).sort({ date: -1 }).limit(30).lean(),
    ]);

    const assetMap = assetMapR.status === 'fulfilled' ? assetMapR.value : new Map();
    const config = configR.status === 'fulfilled' ? configR.value : null;
    const { totalAllTime: totalDividends = 0, projectedMonthly = 0, receivedByTicker = {} } =
        dividendsR.status === 'fulfilled' ? dividendsR.value : {};
    const snapshots = snapshotsR.status === 'fulfilled' ? snapshotsR.value : [];

    return { assetMap, config, totalDividends, projectedMonthly, receivedByTicker, snapshots };
};

// Processa um único ativo: resolve preço/variação e devolve o card pronto +
// as contribuições para os totais da carteira. Aritmética idêntica à original.
const processWalletAsset = (asset, { assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay }) => {
    let currentPrice = 0;
    let dayChangePct = 0;

    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
        // Accrual via fonte única (utils/fixedIncome) — idêntico ao
        // calculateLiveKPIS, garantindo KPI e ponto live do gráfico iguais.
        const effectiveDailyFactor = assetDailyFactor(asset, macroRates);
        dayChangePct = isTodayBusinessDay ? (effectiveDailyFactor - 1) * 100 : 0;

        const calcDate = brazilToday();
        const totalCurrentValue = accrueFixedIncomeValue(asset, { ...macroRates, calcDate });
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
            const todayStr = toDateKey(new Date());
            const boughtToday = asset.taxLots && asset.taxLots.length > 0 && asset.taxLots.every(lot => toDateKey(lot.date) === todayStr);

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

    const unrealizedProfitBr = safeSub(totalValueBr, totalCostBr);
    const realizedProfitBr = safeMult((asset.realizedProfit || 0), currentMultiplier);
    const positionTotalResult = safeAdd(unrealizedProfitBr, realizedProfitBr);

    let profitPercent = 0;
    if (totalCostBr > 0) {
        profitPercent = calculatePercent(positionTotalResult, totalCostBr);
    }

    const processed = {
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
        tags: asset.tags, // Return tags
        // Sub-tipos usados pela ramificação da Carteira Ideal (real vs meta):
        // RF → índice (IPCA/SELIC/CDI/PRE); Exterior → usSubType (STOCK/ETF/REIT/DOLLAR).
        fixedIncomeIndex: asset.fixedIncomeIndex || null,
        usSubType: asset.usSubType || null,
    };

    return { processed, totalValueBr, totalCostBr, dayChangeValueBr };
};

// --- CÁLCULO LIVE TWRR + VOLATILIDADE (SOURCE OF TRUTH BLINDADA) ---
// Beta omitido aqui pois exigiria buscar histórico do Ibovespa (pesado) —
// disponível em getWalletPerformance.
const computeWalletMetrics = async ({ userId, snapshots, safeTotalEquity, totalResultPercent, currentCdi }) => {
    const now = new Date();
    let weightedRentability = 0;
    let dataQuality = 'AUDITED'; // Default Audited
    let sharpeRatio = 0;
    const beta = 0;

    // Snapshots (últimos 30) já carregados no lote paralelo acima (5.4).
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
            if (tx.type === 'BUY') periodFlow += tx.totalValue;
            else if (tx.type === 'SELL') periodFlow -= tx.totalValue;
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

    return { weightedRentability, dataQuality, sharpeRatio, beta };
};

export const getWalletData = async (req, res, next, _depth = 0) => {
    try {
        const userId = req.user.id;

        const { userAssets, activeAssets, closedAssets, targets } = await loadWalletState(userId);

        // Auto-Heal se não houver ativos mas houver transações (reconstrução forçada).
        if (activeAssets.length === 0) {
            const healed = await autoHealPositions(userId);
            if (healed) {
                // (6.2) Reprocessa com o estado curado, mas só até o limite de
                // profundidade — nunca recursa infinitamente.
                if (_depth < MAX_WALLET_HEAL_DEPTH) {
                    return getWalletData(req, res, next, _depth + 1);
                }
                logger.warn(`getWalletData: limite de auto-heal (${MAX_WALLET_HEAL_DEPTH}) atingido para ${userId}; renderizando estado atual.`);
            }
        }

        if (userAssets.length === 0) {
            return res.json(await buildEmptyWalletResponse(targets));
        }

        const liveTickers = activeAssets.filter(a => a.type !== 'FIXED_INCOME' && a.type !== 'CASH').map(a => a.ticker);
        if (liveTickers.length > 0) {
            // Refresh em background: não bloqueia a resposta (usa cache atual). A
            // falha é logada em vez de silenciada — o card ainda renderiza.
            marketDataService.refreshQuotesBatch(liveTickers)
                .catch(err => logger.warn(`[Wallet] Refresh de cotações em background falhou: ${err.message}`));
        }

        const { assetMap, config, totalDividends, projectedMonthly, receivedByTicker, snapshots } =
            await fetchWalletMarketContext(userId, liveTickers);

        const usdRate = safeFloat(config?.dollar || 5.75);
        const usdChange = safeFloat(config?.dollarChange || 0);
        const currentCdi = (config?.cdi && config.cdi > 0) ? safeFloat(config.cdi) : ((config?.selic && config.selic > 0) ? safeFloat(config.selic) : DEFAULT_SELIC_FALLBACK);
        const macroRates = { cdiRate: currentCdi, selic: config?.selic, ipca: config?.ipca };

        const totalRealizedProfit = closedAssets.reduce((acc, curr) => {
            const isDollarized = curr.currency === 'USD' || curr.type === 'STOCK_US' || curr.type === 'CRYPTO';
            const mult = isDollarized ? usdRate : 1;
            const profitInBrl = safeMult((curr.realizedProfit || 0), mult);
            return safeAdd(acc, profitInBrl);
        }, 0);

        const brazilTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const isTodayBusinessDay = isBusinessDay(new Date(brazilTodayStr + 'T00:00:00.000Z'));

        // Processa cada ativo e acumula os totais (mesma ordem/aritmética da versão monolítica).
        const assetCtx = { assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay };
        const processedAssets = [];
        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        for (const asset of activeAssets) {
            const { processed, totalValueBr, totalCostBr, dayChangeValueBr } = processWalletAsset(asset, assetCtx);
            // Proventos recebidos (all-time, BRL) deste ativo — alimenta a
            // Rentabilidade total (preço + proventos) na Detalhamento por Classe,
            // distinta da Variação (só preço).
            processed.dividendsReceived = safeCurrency(receivedByTicker[asset.ticker] || 0);
            processedAssets.push(processed);
            totalEquity = safeAdd(totalEquity, totalValueBr);
            totalInvested = safeAdd(totalInvested, totalCostBr);
            totalDayVariation = safeAdd(totalDayVariation, dayChangeValueBr);
        }

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

        const { weightedRentability, dataQuality, sharpeRatio, beta } = await computeWalletMetrics({
            userId, snapshots, safeTotalEquity, totalResultPercent, currentCdi,
        });

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
        const todayStr = toDateKey(today);
        const lastSnapshot = history[history.length - 1];
        const lastSnapshotDate = toDateKey(brazilDateOnly(lastSnapshot.date));

        if (lastSnapshotDate !== todayStr) {
            const liveData = await calculateLiveKPIS(userId, config?.cdi || DEFAULT_SELIC_FALLBACK);

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

        const startDateStr = toDateKey(history[0].date);
        let baseIbov = ibovMap.get(startDateStr);
        if (!baseIbov) {
             const fallback = ibovHistory?.find(h => h.date >= startDateStr);
             baseIbov = fallback ? (fallback.close || fallback.adjClose) : 120000;
        }

        const currentRate = config?.cdi || DEFAULT_SELIC_FALLBACK;
        let accumulatedCDI = 1.0;
        let accumulatedIPCA = 1.0; // IPCA + 6%
        let previousDate = startOfDay(history[0].date);

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
            const dateStr = toDateKey(point.date);
            const currentDate = startOfDay(point.date);

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

                const prevIbovVal = (index === 1 && !history[0].isLive) ? baseIbov : (ibovMap.get(toDateKey(history[index-1].date)) || baseIbov);
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
    const userId = req.user.id;
    const { ticker, type, quantity, price, date, fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, name, usSubType, currency } = req.body;
    const txDate = date ? new Date(date) : new Date();
    const transactionType = quantity >= 0 ? 'BUY' : 'SELL';
    let updatedAsset;
    try {
        if (!ticker || quantity === undefined || price === undefined) throw AppError.badRequest("Dados incompletos.");
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        if (txDate > todayEnd) throw AppError.badRequest("Data futura não permitida.");
        await runTransaction(async (session) => {
            const newTx = new AssetTransaction({
                user: userId, ticker: ticker.toUpperCase(), type: transactionType,
                quantity: Math.abs(parseFloat(quantity)), price: Math.abs(parseFloat(price)),
                totalValue: Math.abs(parseFloat(quantity)) * Math.abs(parseFloat(price)),
                date: txDate, notes: name ? `Nome: ${name}` : ''
            });
            await newTx.save({ session });
            updatedAsset = await financialService.recalculatePosition(userId, ticker.toUpperCase(), type, session, currency);
            if (updatedAsset && (type === 'FIXED_INCOME' || type === 'CASH')) {
                if (fixedIncomeRate) updatedAsset.fixedIncomeRate = fixedIncomeRate;
                // Pós-fixados/indexados (Selic/CDI/IPCA): o rendimento é índice vivo +
                // spread, não a taxa cheia. Persiste índice+spread p/ accrual correto
                // (corrige o bug do Tesouro Selic render só o spread como prefixado).
                if (type === 'FIXED_INCOME') {
                    let idx = fixedIncomeIndex;
                    let spread = fixedIncomeSpread;
                    if (!idx) {
                        // Fonte autoritativa: descobre o índice pelo título no catálogo.
                        const safeTitle = String(ticker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const bond = await TreasuryBond.findOne({ title: new RegExp(`^${safeTitle}$`, 'i') }).session(session);
                        if (bond?.index) { idx = bond.index; if (spread == null) spread = bond.rate; }
                    }
                    if (idx === 'SELIC' || idx === 'CDI' || idx === 'IPCA') {
                        updatedAsset.fixedIncomeIndex = idx;
                        updatedAsset.fixedIncomeSpread = Number(spread) || 0;
                    } else if (idx === 'PRE') {
                        updatedAsset.fixedIncomeIndex = 'PRE';
                    }
                }
                if (name) updatedAsset.name = name;
                if (transactionType === 'BUY' && (!updatedAsset.startDate || new Date(date) < updatedAsset.startDate)) {
                    updatedAsset.startDate = new Date(date);
                }
                await updatedAsset.save({ session });
            }
            // Exterior: override manual do sub-tipo no cadastro. A auto-heurística
            // já rodou em recalculatePosition; aqui o usuário tem a última palavra.
            if (updatedAsset && type === 'STOCK_US' && usSubType) {
                updatedAsset.usSubType = usSubType;
                updatedAsset.usSubTypeManual = true;
                await updatedAsset.save({ session });
            }
        });
    } catch (error) {
        return next(error);
    }
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (txDate < yesterday) {
        // Best-effort: a transação já foi persistida. Se o rebuild do histórico
        // falhar, logamos (sem silenciar) — o snapshot é corrigido no próximo
        // recálculo/job diário, mas a falha precisa ficar visível.
        try {
            await financialService.rebuildUserHistory(userId);
        } catch (err) {
            logger.warn(`[Wallet] Rebuild de histórico falhou após addAssetTransaction (user ${userId}): ${err.message}`);
        }
    }
    // Ingestão de proventos do ticker em background (não bloqueia a resposta).
    // Garante que compras novas já apareçam com proventos sem rodar o script.
    if (transactionType === 'BUY' && !['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) {
        financialService.syncDividends([{ ticker: ticker.toUpperCase(), type }])
            .catch(err => logger.warn(`[Wallet] Sync de proventos em background falhou para ${ticker}: ${err.message}`));
    }
    res.status(201).json({ message: "Transação registrada.", asset: updatedAsset });
};

export const updateAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tags, name, usSubType } = req.body;
        const userId = req.user.id;

        const asset = await UserAsset.findOne({ _id: id, user: userId });
        if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

        if (tags !== undefined) asset.tags = tags;
        // Renomear cofrinho (Reserva/Caixa) ou título de Renda Fixa.
        if (name !== undefined) asset.name = String(name).trim();
        // Override manual do sub-tipo de Exterior — só faz sentido para STOCK_US.
        // Marca usSubTypeManual para que a auto-heurística não sobrescreva depois.
        if (usSubType !== undefined && asset.type === 'STOCK_US') {
            asset.usSubType = usSubType;
            asset.usSubTypeManual = true;
        }

        await asset.save();
        res.json({ message: "Ativo atualizado.", asset });
    } catch (error) {
        next(error);
    }
};

export const removeAsset = async (req, res, next) => {
    const userId = req.user.id;
    const assetId = req.params.id;
    try {
        await runTransaction(async (session) => {
            const asset = await UserAsset.findOne({ _id: assetId, user: userId });
            if (!asset) throw txError(404, "Ativo não encontrado");
            await AssetTransaction.deleteMany({ user: userId, ticker: asset.ticker }).session(session);
            await UserAsset.deleteOne({ _id: assetId }).session(session);
        });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        return next(error);
    }
    // Best-effort pós-commit (ver removeAsset/addAssetTransaction): loga em vez de silenciar.
    try {
        await financialService.rebuildUserHistory(userId);
    } catch (e) {
        logger.warn(`[Wallet] Rebuild de histórico falhou após remover ativo (user ${userId}): ${e.message}`);
    }
    res.json({ message: "Ativo removido." });
};

export const resetWallet = async (req, res, next) => {
    const userId = req.user.id;
    try {
        await runTransaction(async (session) => {
            await UserAsset.deleteMany({ user: userId }).session(session);
            await AssetTransaction.deleteMany({ user: userId }).session(session);
            await WalletSnapshot.deleteMany({ user: userId }).session(session);
        });
    } catch (error) {
        return next(error);
    }
    res.json({ message: "Carteira resetada." });
};

// PUT /wallet/targets — salva a carteira ideal (alocação-alvo + reserva) do usuário.
export const updateWalletTargets = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { targetAllocation, targetReserve, targetMonthlyDividendIncome, targetSubAllocation } = req.body;

        const update = {};
        if (targetAllocation !== undefined) {
            update.targetAllocation = {
                STOCK: safeFloat(targetAllocation.STOCK || 0),
                FII: safeFloat(targetAllocation.FII || 0),
                STOCK_US: safeFloat(targetAllocation.STOCK_US || 0),
                ETF: safeFloat(targetAllocation.ETF || 0),
                CRYPTO: safeFloat(targetAllocation.CRYPTO || 0),
                FIXED_INCOME: safeFloat(targetAllocation.FIXED_INCOME || 0),
            };
        }
        if (targetReserve !== undefined) {
            update.targetReserve = Math.max(0, safeFloat(targetReserve));
        }
        if (targetMonthlyDividendIncome !== undefined) {
            update.targetMonthlyDividendIncome = Math.max(0, safeFloat(targetMonthlyDividendIncome));
        }
        if (targetSubAllocation !== undefined) {
            const fi = targetSubAllocation.FIXED_INCOME || {};
            const us = targetSubAllocation.STOCK_US || {};
            update.targetSubAllocation = {
                FIXED_INCOME: {
                    IPCA: safeFloat(fi.IPCA || 0),
                    POS: safeFloat(fi.POS || 0),
                    PRE: safeFloat(fi.PRE || 0),
                },
                STOCK_US: {
                    STOCK: safeFloat(us.STOCK || 0),
                    REIT: safeFloat(us.REIT || 0),
                    ETF: safeFloat(us.ETF || 0),
                    DOLLAR: safeFloat(us.DOLLAR || 0),
                },
            };
        }

        const updated = await User.findByIdAndUpdate(userId, { $set: update }, { new: true })
            .select('targetAllocation targetReserve targetMonthlyDividendIncome targetSubAllocation').lean();

        res.json({
            message: 'Carteira ideal atualizada.',
            targetAllocation: updated?.targetAllocation,
            targetReserve: updated?.targetReserve,
            targetMonthlyDividendIncome: updated?.targetMonthlyDividendIncome,
            targetSubAllocation: updated?.targetSubAllocation,
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
    const userId = req.user.id;
    let txTicker;
    try {
        await runTransaction(async (session) => {
            const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: userId }, { session });
            if (!tx) throw txError(404, "Transação não encontrada");
            txTicker = tx.ticker;
            // Recalcula a posição na MESMA transação: se o recálculo falhar (ex.: saldo
            // insuficiente), o delete é revertido — sem estado financeiro inconsistente.
            await financialService.recalculatePosition(userId, tx.ticker, null, session);
        });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        return next(error);
    }
    // Best-effort pós-commit (ver acima): loga em vez de silenciar.
    try {
        await financialService.rebuildUserHistory(userId);
    } catch (e) {
        logger.warn(`[Wallet] Rebuild de histórico falhou após remover transação (user ${userId}): ${e.message}`);
    }
    res.json({ message: "Transação removida." });
};

// Throttle do self-heal de dividendos (1h por usuário) — evita re-scraping a
// cada poll do Cofre enquanto os dados ainda estão zerados.
const DIVIDEND_HEAL_TTL = 60 * 60 * 1000;
const dividendHealAt = new Map();

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        // `req.user` (cache do authMiddleware) não carrega targetMonthlyDividendIncome
        // — busca dedicada, em paralelo com o cálculo de proventos.
        const [data, userGoal] = await Promise.all([
            financialService.calculateUserDividends(userId),
            User.findById(userId).select('targetMonthlyDividendIncome').lean(),
        ]);
        const history = Array.from(data.dividendMap.entries()).map(([month, val]) => ({ month, value: val.total, breakdown: val.breakdown })).sort((a, b) => a.month.localeCompare(b.month));

        // Meta é MENSAL → `current` precisa ser uma grandeza mensal, nunca o
        // acumulado vitalício (`totalAllTime`), senão a barra estoura em 100%.
        // Espelha o que o card exibe (displayDividends): soma das provisões do
        // mês corrente quando houver, senão o fluxo mensal projetado.
        const target = userGoal?.targetMonthlyDividendIncome || 0;
        const provisionedSum = (data.provisioned || []).reduce((acc, p) => safeAdd(acc, p.amount || 0), 0);
        const current = provisionedSum > 0 ? provisionedSum : data.projectedMonthly;
        const goal = {
            target,
            current,
            progressPercent: target > 0 ? Math.min(100, safeDiv(safeMult(current, 100), target)) : null,
        };

        res.json({
            history,
            provisioned: data.provisioned,
            totalAllTime: data.totalAllTime,
            projectedMonthly: data.projectedMonthly,
            yieldOnCost: data.yieldOnCost,
            goal,
        });

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
        const today = startOfDay(new Date());

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
