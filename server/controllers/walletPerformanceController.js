// Rentabilidade (carteira × benchmarks) e histórico patrimonial. Extraído de walletController.js.
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { safeFloat, safeCurrency, selectAnchorSnapshot, computeLiveQuota, benchmarkStep, resolveCurrentCdiRate } from '../utils/mathUtils.js';
import { computeQuotaSharpe, computeQuotaBeta, snapshotDayKey } from '../utils/walletRisk.js';
import { countBusinessDays, toDateKey } from '../utils/dateUtils.js';
import { brazilToday, brazilDateOnly } from '../utils/fixedIncome.js';
import { loadCdiCurve } from '../utils/cdiCurve.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import {
    boundedPointLimit,
    boundedPageLimit,
    DEFAULT_HISTORY_POINTS,
    DEFAULT_PERFORMANCE_POINTS,
    downsampleTimeSeries,
} from '../utils/timeSeriesDownsample.js';
import { calculateLiveKPIS, computePendingFlowBRL, getDailyFactorForDate } from './walletKpis.js';

// Ponto live (hoje) anexado à série quando o último snapshot não é de hoje.
// Muta `history` — mesma ordem de leituras da versão monolítica.
const appendLivePoint = async (history, { userId, walletId, config, today, todayStr }) => {
    const lastSnapshot = history[history.length - 1];
    const lastSnapshotDate = toDateKey(brazilDateOnly(lastSnapshot.date));
    if (lastSnapshotDate === todayStr) return;

    // Mesma âncora do KPI (getWalletData): regra única compartilhada. Vem
    // antes do KPI live porque o recorte de proventos da cota depende dela.
    const anchor = selectAnchorSnapshot([...history].reverse());
    const anchorDayKey = anchor ? (anchor.dayKey || snapshotDayKey(anchor)) : null;
    // CDI pela mesma cadeia do card e do snapshot (CDI → Selic → fallback).
    const liveData = await calculateLiveKPIS(
        userId, resolveCurrentCdiRate(config, DEFAULT_SELIC_FALLBACK), walletId,
        { sinceDayKey: anchorDayKey },
    );
    if (!liveData || !(liveData.totalEquity > 0)) return;

    // Fluxo de caixa desde o âncora (aportes/resgates) — Modified Dietz.
    const periodFlow = await computePendingFlowBRL({
        userId,
        walletId,
        anchor,
        currentUsd: config?.dollar > 0 ? config.dollar : null,
    });

    // Fonte única da cota live — idêntica ao KPI (weightedRentability).
    // Com a renda do período (proventos com ex-date desde o âncora),
    // como o card — sem ela o ponto live afundava no dia-ex.
    const liveQuotaPrice = computeLiveQuota(anchor, liveData.totalEquity, periodFlow, liveData.dividendsSinceAnchor);

    history.push({
        date: today,
        totalEquity: liveData.totalEquity,
        totalInvested: liveData.totalInvested,
        totalDividends: liveData.totalDividends,
        quotaPrice: liveQuotaPrice,
        isLive: true
    });
};

const buildIbovMap = (ibovHistory) => {
    const ibovMap = new Map();
    if (ibovHistory && Array.isArray(ibovHistory)) {
        ibovHistory.forEach(h => ibovMap.set(h.date, h.close || h.adjClose));
    }
    return ibovMap;
};

// Fechamento do Ibov no primeiro dia da série (ou o primeiro pregão depois dele).
const resolveBaseIbov = (ibovMap, ibovHistory, startDateStr) => {
    const baseIbov = ibovMap.get(startDateStr);
    if (baseIbov) return baseIbov;
    const fallback = ibovHistory?.find(h => h.date >= startDateStr);
    return fallback ? (fallback.close || fallback.adjClose) : 120000;
};

// Fatores do CDI e do IPCA+6% no intervalo de `daysDelta` dias úteis.
const benchmarkPeriodFactors = (daysDelta, currentDate, { currentRate, benchmarkCdiCurve, totalIpcaRate }) => ({
    cdi: daysDelta > 0 ? Math.pow(getDailyFactorForDate(currentDate, currentRate, benchmarkCdiCurve), daysDelta) : 1,
    ipca: daysDelta > 0 ? Math.pow(Math.pow(1 + (totalIpcaRate / 100), 1/252), daysDelta) : 1,
});

// Fechamento do Ibov para o ponto; o ponto live usa a cotação do macro.
const ibovCloseForPoint = (point, dateStr, ibovMap, config, lastKnownIbov) => {
    let currentIbov = ibovMap.get(dateStr);
    if (point.isLive && !currentIbov) {
        currentIbov = config?.ibov;
    }
    // Dia sem cotação (feriado, dado faltante): repete o último fechamento
    // conhecido — o índice "anda de lado" em vez de saltar.
    if (!currentIbov) currentIbov = lastKnownIbov;
    return currentIbov;
};

const pointReturns = (point, baseIbov, currentIbov) => ({
    ibovPercent: baseIbov && currentIbov ? ((currentIbov / baseIbov) - 1) * 100 : 0,
    walletTWRR: point.quotaPrice ? ((point.quotaPrice/100)-1)*100 : 0,
    walletROI: point.totalInvested > 0
        ? ((point.totalEquity - point.totalInvested + point.totalDividends) / point.totalInvested) * 100
        : 0,
});

// null preservado: safeFloat(null) viraria 0 ("sem risco" onde não houve medição).
const floatOrNull = (value) => (value === null ? null : safeFloat(value));

// --- CORREÇÃO DE RENTABILIDADE (LIVE POINT + FILTRO AVANÇADO) ---
/**
 * Série de rentabilidade (carteira × CDI × IPCA+6% × Ibov) + métricas de risco.
 * Extraído do handler pelo mesmo motivo de buildWalletPayload: o link público
 * renderiza a MESMA aba Rentabilidade, então precisa da mesma matemática — não
 * de uma segunda implementação que possa divergir.
 */
export const buildWalletPerformancePayload = async (userId, walletId) => {
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });

        let history = await WalletSnapshot.find({
            user: userId,
            wallet: walletId,
            totalEquity: { $gt: 1 }
        })
            .sort({ date: 1 })
            .select('date dayKey totalEquity totalInvested totalDividends quotaPrice calculatedAt')
            .lean();
        
        if (history.length === 0) {
            return [];
        }

        // "Hoje" no fuso de São Paulo (mesma referência do KPI) — evita que o
        // relógio UTC do servidor anexe um ponto "do dia seguinte" e acumule um
        // dia extra de CDI no benchmark.
        const today = brazilToday();
        const todayStr = toDateKey(today);
        await appendLivePoint(history, { userId, walletId, config, today, todayStr });

        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP');
        const ibovMap = buildIbovMap(ibovHistory);

        const startDateStr = snapshotDayKey(history[0]);
        const baseIbov = resolveBaseIbov(ibovMap, ibovHistory, startDateStr);
        // Último fechamento conhecido do índice, para dias sem cotação. Antes o
        // código caía no `baseIbov` (o fechamento do PRIMEIRO dia da série): além
        // de zerar o % daquele dia, virava a nova referência do passo seguinte e
        // a curva em R$ dava um salto artificial (fator = close/baseIbov).
        let lastKnownIbov = baseIbov;

        const currentRate = resolveCurrentCdiRate(config, DEFAULT_SELIC_FALLBACK);
        const benchmarkCdiCurve = await loadCdiCurve({ since: brazilDateOnly(history[0].date), currentRate });
        let accumulatedCDI = 1.0;
        let accumulatedIPCA = 1.0; // IPCA + 6%
        // (TZ) Ancora no DIA-CALENDÁRIO BR do snapshot, não em startOfDay(date). O
        // snapshot é gravado às 23:59 BRT (= 02:59 UTC do dia seguinte); startOfDay
        // num servidor UTC devolvia o dia SEGUINTE, e o countBusinessDays entre
        // snapshots perdia a sexta (o snapshot de sexta caía num "sábado"), fazendo
        // o CDI acumular 1 dia útil A MENOS que a carteira — que então "batia" o CDI
        // sendo 100% CDI (impossível). brazilDateOnly alinha benchmark e carteira.
        let previousDate = brazilDateOnly(history[0].date);

        // Taxas para IPCA+6%
        const ipcaRate = config?.ipca || 4.5;
        const realRate = 6.0;
        const totalIpcaRate = ipcaRate + realRate; // ex: 10.5% a.a.
        const factorCtx = { currentRate, benchmarkCdiCurve, totalIpcaRate };

        // Benchmarks cashflow-aware (modo R$): o capital cresce pelo índice e
        // recebe os MESMOS aportes/resgates nas datas reais — comparável à
        // carteira (que também inclui os aportes). Semente = invested inicial.
        let cdiVal = 0, ipcaVal = 0, ibovVal = 0;
        let prevInvested = history[0]?.totalInvested || 0;
        let prevIbovForVal = baseIbov;

        const result = history.map((point, index) => {
            const dateStr = snapshotDayKey(point);
            const currentDate = brazilDateOnly(point.date);

            const daysDelta = countBusinessDays(previousDate, currentDate);

            const { cdi: periodFactorCDI, ipca: periodFactorIPCA } = benchmarkPeriodFactors(daysDelta, currentDate, factorCtx);
            accumulatedCDI *= periodFactorCDI;
            accumulatedIPCA *= periodFactorIPCA;
            previousDate = currentDate;

            // IBOV Acumulado
            const currentIbov = ibovCloseForPoint(point, dateStr, ibovMap, config, lastKnownIbov);
            if (currentIbov) lastKnownIbov = currentIbov;

            const { ibovPercent, walletTWRR, walletROI } = pointReturns(point, baseIbov, currentIbov);

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

        // (O forward-fill do Ibov % que existia aqui saiu: o carry-forward agora é
        // feito na fonte, sobre o FECHAMENTO do índice. Fazê-lo no percentual
        // final tratava "0%" como sinônimo de "sem dado" e apagava um dia em que
        // o índice genuinamente empatou com a base.)

        // Calcular Métricas Finais
        // Sharpe e Beta pela MESMA fonte do KPI (utils/walletRisk) e sobre a MESMA
        // série: janela rolante, corte no último evento de regime, espaçamento de
        // 1 pregão validado e ponto live fora. O histórico completo continua
        // alimentando o gráfico — só as métricas de risco usam a janela.
        // O índice é lido pelo dia-calendário BR: os snapshots fecham às 23:59 BRT
        // e a chave UTC crua apontaria para o pregão seguinte.
        const resolveIbovClose = (dayKey) => ibovMap.get(dayKey);
        const { sharpe, sample: sharpeSample, skippedGaps: sharpeSkippedGaps, confidence, standardError, regimeBreakAt } =
            computeQuotaSharpe(history, currentRate);
        const { beta, sample: betaSample } = computeQuotaBeta(history, resolveIbovClose);

        return {
            history: downsampleTimeSeries(result, { maxPoints: DEFAULT_PERFORMANCE_POINTS }),
            stats: {
                sharpe: floatOrNull(sharpe),
                sharpeSample,
                sharpeSkippedGaps,
                sharpeConfidence: confidence,
                sharpeStandardError: floatOrNull(standardError),
                regimeBreakAt,
                beta: floatOrNull(beta),
                betaSample
            }
        };
};

// GET /wallet/performance — casca fina sobre buildWalletPerformancePayload.
export const getWalletPerformance = async (req, res, next) => {
    try {
        res.json(await buildWalletPerformancePayload(req.user.id, req.walletId));
    } catch (error) {
        next(error);
    }
};

export const buildWalletHistoryPayload = async (
    userId,
    walletId,
    { maxPoints = DEFAULT_HISTORY_POINTS, before = null, pageLimit = null } = {},
) => {
    const filter = { user: userId, wallet: walletId };
    if (before) filter.date = { $lt: before };

    const projection = 'date dayKey totalEquity totalInvested totalDividends profit profitPercent quotaPrice allocation calculatedAt source calculationVersion';
    if (pageLimit) {
        const page = await WalletSnapshot.find(filter)
            .sort({ date: -1 })
            .limit(pageLimit)
            .select(projection)
            .lean();
        return page.reverse();
    }

    const history = await WalletSnapshot.find(filter).sort({ date: 1 }).select(projection).lean();
    return downsampleTimeSeries(history, { maxPoints });
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const maxPoints = boundedPointLimit(req.query.maxPoints, DEFAULT_HISTORY_POINTS);
        const requestedLimit = req.query.limit ? boundedPageLimit(req.query.limit) : null;
        const beforeDate = req.query.before ? new Date(req.query.before) : null;
        const before = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
        res.json(await buildWalletHistoryPayload(req.user.id, req.walletId, {
            maxPoints,
            before,
            pageLimit: requestedLimit,
        }));
    } catch (error) {
        next(error);
    }
};
