
import mongoose from 'mongoose';
import InvestmentGoal from '../models/InvestmentGoal.js';
import GoalJourney from '../models/GoalJourney.js';
import GoalContribution from '../models/GoalContribution.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UserAsset from '../models/UserAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { valueFixedIncomeAsset, brazilToday } from '../utils/fixedIncome.js';
import { loadTreasuryPricing } from '../services/treasuryPriceService.js';
import { monthsRemaining, requiredMonthly, decomposeProgress, fv, annualToMonthly, computeStreak, resolveGoalStatus, calendarMonthsBetween } from '../utils/goalMath.js';
import { orderChainFrom } from '../utils/goalChain.js';
import { safeCurrency, safeFloat, safeSub, safeMult, safeValue, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { isDollarized } from '../utils/assetCurrency.js';
import { LIMITS_CONFIG } from '../config/subscription.js';
import logger from '../config/logger.js';

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Teto de metas por plano (Onda 3 do plano comercial de 30/08/2026): o Free tem
 * "Metas Financeiras Limitadas", o Essential em diante tem ilimitadas.
 * Fail-closed: plano desconhecido cai no degrau do Free. ADMIN não tem teto.
 * O teto é por CARTEIRA — metas são 100% escopadas por carteira (Fase 2), e o
 * limite de carteiras do plano já contém o total da conta.
 */
const goalLimitFor = (user) => {
    if (user?.role === 'ADMIN') return Infinity;
    return LIMITS_CONFIG.goals[user?.plan] ?? LIMITS_CONFIG.goals.GUEST;
};

/** Carrega as metas da carteira e devolve a cadeia inteira da meta informada. */
const collectChain = async (goal, userId, walletId) => {
    const all = await InvestmentGoal.find({ user: userId, wallet: walletId });
    return orderChainFrom(goal, all);
};

/** Apaga jornadas que ficaram sem nenhum marco (a cadeia foi desfeita). */
const pruneOrphanJourneys = async (userId, walletId, journeyIds = []) => {
    const ids = journeyIds.filter(Boolean);
    if (ids.length === 0) return;
    const stillUsed = await InvestmentGoal.distinct('journey', {
        user: userId,
        wallet: walletId,
        journey: { $in: ids },
    });
    const used = new Set(stillUsed.map(String));
    const orphans = ids.filter((id) => !used.has(String(id)));
    if (orphans.length > 0) {
        await GoalJourney.deleteMany({ _id: { $in: orphans }, user: userId, wallet: walletId });
    }
};

// Soma N meses a uma data, tratando a parte fracionária como ~30 dias.
const addMonths = (base, months) => {
    if (!isFinite(months)) return null;
    const d = new Date(base);
    const whole = Math.floor(months);
    const frac = months - whole;
    d.setMonth(d.getMonth() + whole);
    d.setDate(d.getDate() + Math.round(frac * 30));
    return d;
};

const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthsBetween = (a, b) => (b.getTime() - a.getTime()) / (30.4375 * MS_DAY);

// Patrimônio espelhado da carteira = último snapshot diário DESTA carteira.
const getLatestSnapshot = async (userId, walletId) => {
    return WalletSnapshot.findOne({ user: userId, wallet: walletId }).sort({ date: -1 }).lean();
};

/**
 * Retorna o patrimônio atual da carteira ao vivo.
 * Recalcula sempre em tempo real a partir de UserAsset — mesma lógica do
 * walletController/schedulerService — para que a meta reflita imediatamente
 * qualquer adição/alteração de ativo no dia. O snapshot mais recente é usado
 * apenas como fallback (carteira sem ativos ou erro de cotação).
 *
 * NÃO usar o snapshot de hoje como atalho: ele é gerado uma vez por dia
 * (scheduler), então ativos adicionados depois ficariam invisíveis na meta
 * até o snapshot do dia seguinte, divergindo da página de Carteira.
 */
const getLiveWalletEquity = async (userId, walletId) => {
    const snapshot = await getLatestSnapshot(userId, walletId);

    try {
        const assets = await UserAsset.find({ user: userId, wallet: walletId, quantity: { $gt: QUANTITY_EPSILON } });
        // Carteira vazia (reset ou remoção de todos os ativos) = patrimônio 0.
        // Não cair no snapshot aqui, senão a meta manteria um valor fantasma.
        if (assets.length === 0) return { equity: 0, snapshot };

        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
        const cdi = config?.cdi || DEFAULT_SELIC_FALLBACK;
        const usdRate = config?.dollar || 5.75;
        const calcDate = brazilToday();

        const tickers = assets.filter((a) => !['CASH', 'FIXED_INCOME'].includes(a.type)).map((a) => a.ticker);
        if (tickers.length > 0) await marketDataService.refreshQuotesBatch(tickers);

        // (5.8) Cotações em lote (1 query) em vez de um findOne por ativo (N+1).
        const marketMap = await marketDataService.getMarketDataMap(tickers);
        // Mesma régua de valorização da carteira: título público marcado a
        // mercado, resto na curva. A meta media contra um patrimônio diferente do
        // exibido se usasse só accrual.
        const treasuryPricing = await loadTreasuryPricing(assets);

        let totalEquity = 0;
        for (const asset of assets) {
            const multiplier = isDollarized(asset) ? usdRate : 1;
            let val;
            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                val = valueFixedIncomeAsset(asset, {
                    cdiRate: cdi, selic: config?.selic, ipca: config?.ipca, calcDate,
                    history: treasuryPricing.historyFor(asset),
                }).value;
            } else {
                const mData = marketMap.get(asset.ticker);
                val = safeValue(asset.quantity, mData?.price || 0);
            }
            totalEquity += safeMult(val, multiplier);
        }
        return { equity: safeCurrency(totalEquity), snapshot };
    } catch (e) {
        logger.warn(`getLiveWalletEquity fallback to snapshot: ${e.message}`);
        return { equity: snapshot?.totalEquity || 0, snapshot };
    }
};

/**
 * Projeta os campos derivados de uma meta a partir do patrimônio da carteira.
 * Fonte da verdade do estado salvo; o front replica para previews "what-if".
 */
const computeGoalProjection = (goal, walletEquity, opts = {}) => {
    const mirrored = goal.mirrorWallet ? safeFloat(walletEquity) : 0;
    const currentValue = safeCurrency(mirrored + safeFloat(goal.manualBalance));
    const remainingAmount = safeCurrency(Math.max(0, goal.targetAmount - currentValue));
    const progressPct = goal.targetAmount > 0
        ? Math.min(100, safeFloat((currentValue / goal.targetAmount) * 100))
        : 0;

    const n = monthsRemaining(currentValue, goal.monthlyTarget, goal.expectedAnnualRate, goal.targetAmount);
    const now = new Date();
    const projectedDate = isFinite(n) ? addMonths(now, n) : null;
    // Contador DERIVADO da data prevista (ver calendarMonthsBetween): "Faltam N
    // meses" e o mês exibido apontam para o mesmo lugar, sem exceção. Zero é um
    // resultado legítimo — chegada dentro do mês corrente — e o front o escreve
    // como "este mês"; não forçar um piso aqui, que reintroduziria a divergência.
    const monthsLeft = projectedDate ? calendarMonthsBetween(now, projectedDate) : null;

    // Se há prazo (targetDate), calcula o aporte necessário para batê-lo.
    let requiredMonthlyForDeadline = null;
    let onTrack;
    if (goal.targetDate) {
        const monthsToDeadline = (new Date(goal.targetDate).getTime() - Date.now()) / (30.4375 * MS_DAY);
        const req = requiredMonthly(currentValue, goal.expectedAnnualRate, goal.targetAmount, monthsToDeadline);
        requiredMonthlyForDeadline = isFinite(req) ? req : null;
        // No caminho se o aporte planejado cobre o necessário (tolerância de 1%).
        onTrack = requiredMonthlyForDeadline !== null && goal.monthlyTarget >= requiredMonthlyForDeadline * 0.99;
    } else {
        onTrack = monthsLeft !== null; // sem prazo: basta existir um caminho de chegada
    }

    // --- Plano vs. real: baseline ancorado no valor/data de início ---
    const effectiveStartValue = safeFloat(opts.startValue ?? goal.startValue ?? 0);
    const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
    const r = annualToMonthly(goal.expectedAnnualRate);
    const monthsSinceStart = Math.max(0, monthsBetween(startDate, new Date()));
    // Onde o plano diz que você deveria estar HOJE.
    const planExpectedNow = safeCurrency(fv(r, monthsSinceStart, effectiveStartValue, goal.monthlyTarget));
    const valueVsPlan = safeCurrency(currentValue - planExpectedNow);
    // Quando o plano atinge o alvo a partir do início.
    const plannedMonthsFromStart = monthsRemaining(effectiveStartValue, goal.monthlyTarget, goal.expectedAnnualRate, goal.targetAmount);
    const plannedDate = isFinite(plannedMonthsFromStart) ? addMonths(startDate, plannedMonthsFromStart) : null;
    // Adiantado (+) / atrasado (−) em meses: plano vs. previsão atual.
    const dateDeltaMonths = (plannedDate && projectedDate)
        ? Math.round(monthsBetween(projectedDate, plannedDate))
        : null;

    return {
        currentValue,
        walletEquity: mirrored,
        startValue: effectiveStartValue,
        remainingAmount,
        progressPct,
        monthsRemaining: monthsLeft,
        projectedDate,
        plannedDate,
        planExpectedNow,
        valueVsPlan,
        dateDeltaMonths,
        requiredMonthlyForDeadline,
        onTrack,
        achieved: currentValue >= goal.targetAmount,
    };
};

/**
 * Baseline da curva "Plano". Usa o `startValue` congelado na criação; metas
 * anteriores ao campo ficam com 0 e caem no 1º snapshot a partir do início.
 *
 * Compartilhado por listGoals e getGoal DE PROPÓSITO: resolver o fallback só no
 * detalhe fazia o card da lista e o modal divergirem em plannedDate,
 * valueVsPlan e dateDeltaMonths — o card dizia "no plano" e o modal "3 meses
 * adiantado" para a mesma meta.
 */
const resolveStartValue = (goal, snapshots) => {
    if (goal.startValue || !goal.mirrorWallet) return goal.startValue;
    const startDate = goal.startDate ? new Date(goal.startDate) : null;
    const anchor = startDate ? snapshots.find((s) => new Date(s.date) >= startDate) : snapshots[0];
    return safeCurrency((anchor?.totalEquity || 0) + safeFloat(goal.manualBalance));
};

/**
 * Reconcilia o status salvo da meta com o patrimônio atual (lazy, no read/write).
 * Delega a decisão à máquina de estados pura resolveGoalStatus (histerese de 2%
 * + rebaixamento de marco E4) e aplica o efeito colateral de gravar. Retorna
 * true se houve mudança.
 */
const syncGoalStatus = async (goalDoc, projection) => {
    const decision = resolveGoalStatus(
        goalDoc.status,
        projection.currentValue,
        projection.progressPct,
        goalDoc.targetAmount,
        goalDoc.lastCelebratedMilestone,
    );
    if (!decision.changed) return false;

    goalDoc.status = decision.status;
    if (decision.achievedAtAction === 'set') {
        if (!goalDoc.achievedAt) goalDoc.achievedAt = new Date(); // "Data real" da conquista
    } else if (decision.achievedAtAction === 'clear') {
        goalDoc.achievedAt = undefined;
    }
    if (decision.lastCelebratedMilestone !== null) {
        goalDoc.lastCelebratedMilestone = decision.lastCelebratedMilestone;
    }
    await goalDoc.save();
    return true;
};

/**
 * Histórico mensal de aporte líquido (últimos N meses) — aporte da carteira
 * (ΣBUY−ΣSELL, se espelha) + aportes manuais. Ordem cronológica, meses sem
 * aporte preenchidos com 0. Base para streak e ritmo real (média 3m).
 */
const buildMonthlyHistory = async (userId, walletId, goal, months = 12) => {
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const map = new Map(); // 'YYYY-MM' -> amount
    // `new ObjectId(undefined)` geraria um id ALEATÓRIO (não omite o filtro!),
    // então o campo só entra no $match quando walletId de fato foi passado.
    const walletMatch = walletId ? { wallet: new mongoose.Types.ObjectId(walletId) } : {};

    if (goal.mirrorWallet) {
        const walletAgg = await AssetTransaction.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), ...walletMatch, date: { $gte: since } } },
            {
                $group: {
                    _id: { y: { $year: '$date' }, m: { $month: '$date' } },
                    inflow: { $sum: { $cond: [{ $eq: ['$type', 'BUY'] }, '$totalValue', { $multiply: ['$totalValue', -1] }] } },
                },
            },
        ]);
        walletAgg.forEach((row) => {
            const key = `${row._id.y}-${String(row._id.m).padStart(2, '0')}`;
            map.set(key, (map.get(key) || 0) + row.inflow);
        });
    }

    const manualAgg = await GoalContribution.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), ...walletMatch, goal: goal._id, date: { $gte: since } } },
        { $group: { _id: { y: { $year: '$date' }, m: { $month: '$date' } }, total: { $sum: '$amount' } } },
    ]);
    manualAgg.forEach((row) => {
        const key = `${row._id.y}-${String(row._id.m).padStart(2, '0')}`;
        map.set(key, (map.get(key) || 0) + row.total);
    });

    const series = [];
    for (let i = 0; i < months; i++) {
        const d = new Date(since);
        d.setMonth(d.getMonth() + i);
        const key = monthKey(d);
        series.push({ month: key, amount: safeCurrency(map.get(key) || 0) });
    }
    return series;
};

/**
 * Série da trajetória: Real (passado, patrimônio + manual acumulado na data),
 * Plano (início→alvo) e Projeção (hoje→data prevista) num eixo de tempo único.
 *
 * `now` é injetável para teste: as quebras desta série moram justamente nas
 * fronteiras de mês (ver goal_trajectory.spec.js).
 */
export const buildTrajectory = (goal, snapshots, contributions, projection, now = new Date()) => {
    const r = annualToMonthly(goal.expectedAnnualRate);
    const start = goal.startDate ? new Date(goal.startDate) : new Date();
    const target = goal.targetAmount;
    const startValue = projection.startValue;

    // Aporte manual acumulado até uma data.
    const sortedContribs = [...contributions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const cumManualUpTo = (date) => sortedContribs.reduce((s, c) => (new Date(c.date) <= date ? s + c.amount : s), 0);

    // Mapa do valor REAL por mês.
    const realMap = new Map();
    if (goal.mirrorWallet) {
        const byMonth = new Map();
        snapshots.forEach((s) => byMonth.set(monthKey(new Date(s.date)), s)); // último do mês vence
        byMonth.forEach((s) => {
            const d = new Date(s.date);
            realMap.set(monthKey(d), safeCurrency((s.totalEquity || 0) + cumManualUpTo(d)));
        });
    } else {
        sortedContribs.forEach((c) => {
            const d = new Date(c.date);
            realMap.set(monthKey(d), safeCurrency(cumManualUpTo(d)));
        });
    }
    realMap.set(monthKey(now), projection.currentValue); // ponto de hoje

    // Horizonte: maior entre data prevista, plano e prazo.
    const ends = [projection.projectedDate, projection.plannedDate, goal.targetDate]
        .filter(Boolean).map((d) => new Date(d).getTime());
    const horizonEnd = ends.length ? new Date(Math.max(...ends)) : now;
    const totalMonths = Math.max(1, Math.round(monthsBetween(start, horizonEnd)));
    const step = totalMonths > 120 ? 12 : totalMonths > 48 ? 6 : totalMonths > 18 ? 3 : 1;

    // Todo ponto é um DIA-CALENDÁRIO ancorado ao MEIO-DIA UTC — mesma convenção de
    // parseCalendarDate (dateUtils). O eixo é mensal, mas as datas de CHEGADA caem
    // no meio do mês e precisam de um ponto próprio (ver `landing` abaixo), então
    // a chave é o dia, não o mês. O meio-dia mantém o dia correto tanto num
    // processo UTC (prod) quanto num browser em BRT: ancorado à meia-noite LOCAL
    // do servidor, todo rótulo do eixo saía um mês adiantado.
    const dayKey = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12);

    // Conjunto de timestamps a plotar: o 1º de cada mês do horizonte…
    const keys = new Set();
    for (let m = 0; m <= totalMonths; m += step) {
        const d = new Date(start); d.setMonth(d.getMonth() + m); keys.add(dayKey(firstOfMonth(d)));
    }
    realMap.forEach((_, k) => {
        const [y, mm] = k.split('-'); keys.add(dayKey(new Date(Number(y), Number(mm) - 1, 1)));
    });
    [now, horizonEnd, projection.plannedDate, projection.projectedDate].forEach((d) => {
        if (d) keys.add(dayKey(firstOfMonth(new Date(d))));
    });

    // …mais as CHEGADAS, no dia real. Cada curva termina no instante em que encosta
    // no alvo, e esse instante quase nunca é dia 1º: a meta de R$ 35 mil chegava em
    // 26/02, então a série morria no ponto de 01/02 valendo R$ 33,2 mil e a Projeção
    // nunca tocava a linha da Meta. Arredondar a chegada para o 1º do mês é o que
    // criava o degrau — e ainda faria o gráfico discordar da "Data prevista" do
    // cabeçalho. No ponto de chegada o valor é o alvo POR DEFINIÇÃO, não um fv:
    // addMonths trabalha com mês fracionário (~30 dias) e reavaliar a fórmula ali
    // devolveria alguns reais a menos, deixando a curva de novo raspando a linha.
    const plannedEndTs = projection.plannedDate ? dayKey(new Date(projection.plannedDate)) : null;
    const projectedEndTs = projection.projectedDate ? dayKey(new Date(projection.projectedDate)) : null;
    // Só há chegada se ainda existe caminho até o alvo. Numa meta já batida a
    // "chegada" é hoje e forçar o alvo puxaria a curva para BAIXO do patrimônio.
    const plannedLanding = (plannedEndTs !== null && startValue < target) ? plannedEndTs : null;
    const projectedLanding = (projectedEndTs !== null && projection.currentValue < target) ? projectedEndTs : null;
    if (plannedLanding !== null) keys.add(plannedLanding);
    if (projectedLanding !== null) keys.add(projectedLanding);

    // Âncora da projeção: o PONTO do mês corrente. Todo ponto mensal é o dia 1º,
    // então medir a distância de `now` até ele em meses dá sempre um negativo que
    // cresce ao longo do mês — o corte antigo (`>= -0.5`) derrubava esse ponto a
    // partir do dia 16 e a Projeção perdia a âncora que a liga ao Real. Com passo
    // trimestral o próximo ponto elegível ficava 3 meses adiante, abrindo um vão
    // no gráfico que se fechava sozinho no dia 1º. Comparar o mês elimina a borda.
    const currentMonthTs = dayKey(firstOfMonth(now));

    return [...keys].sort((a, b) => a - b).map((ts) => {
        const d = new Date(ts);
        const point = { t: new Date(ts).toISOString() };
        // Real só existe nos pontos MENSAIS: a chegada é um marcador sintético no
        // futuro e herdaria o patrimônio do mês corrente se caísse dentro dele.
        if (d.getUTCDate() === 1 && realMap.has(monthKey(d))) point.real = realMap.get(monthKey(d));
        // Plano: do início até encostar no alvo.
        if (plannedEndTs === null || ts <= plannedEndTs) {
            const p = ts === plannedLanding
                ? target
                : fv(r, Math.max(0, monthsBetween(start, d)), startValue, goal.monthlyTarget);
            point.planned = safeCurrency(Math.min(p, target));
        }
        // Projeção: do mês corrente até encostar no alvo.
        if (ts >= currentMonthTs && (projectedEndTs === null || ts <= projectedEndTs)) {
            const pj = ts === projectedLanding
                ? target
                : fv(r, Math.max(0, monthsBetween(now, d)), projection.currentValue, goal.monthlyTarget);
            // Teto acima do alvo, mas nunca abaixo do patrimônio atual: numa meta
            // já batida o clamp puxaria a âncora para baixo do Real.
            point.projected = safeCurrency(Math.min(pj, Math.max(target * 1.02, projection.currentValue)));
        }
        return point;
    });
};

// GET /goals — lista as metas do usuário já com projeções.
export const listGoals = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const [goals, { equity: walletEquity, snapshot }] = await Promise.all([
            InvestmentGoal.find({ user: userId, wallet: walletId, status: { $ne: 'ARCHIVED' } })
                .sort({ createdAt: 1 })
                .populate('journey', 'name'),
            getLiveWalletEquity(userId, walletId),
        ]);

        // Snapshots só quando alguma meta precisa do fallback de baseline (metas
        // antigas sem startValue) — evita carregar o histórico à toa.
        const snapshots = goals.some((g) => !g.startValue && g.mirrorWallet)
            ? await WalletSnapshot.find({ user: userId, wallet: walletId }).sort({ date: 1 }).lean()
            : [];

        const result = [];
        for (const goal of goals) {
            const projection = computeGoalProjection(goal, walletEquity, { startValue: resolveStartValue(goal, snapshots) });
            await syncGoalStatus(goal, projection);
            result.push({ ...goal.toObject(), status: goal.status, ...projection });
        }
        res.json({ goals: result, walletEquity, snapshotDate: snapshot?.date || null });
    } catch (error) {
        logger.error(`Erro ao listar metas: ${error.message}`);
        next(error);
    }
};

// GET /goals/:id — detalhe com ledger, histórico mensal e decomposição do mês.
export const getGoal = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId, wallet: walletId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const { equity: walletEquity, snapshot } = await getLiveWalletEquity(userId, walletId);

        // Histórico patrimonial p/ a trajetória (ordem cronológica).
        const snapshots = await WalletSnapshot.find({ user: userId, wallet: walletId }).sort({ date: 1 }).lean();

        const projection = computeGoalProjection(goal, walletEquity, { startValue: resolveStartValue(goal, snapshots) });
        await syncGoalStatus(goal, projection);

        // Aportes manuais (ledger).
        const contributions = await GoalContribution.find({ user: userId, wallet: walletId, goal: goal._id })
            .sort({ date: -1 })
            .limit(100)
            .lean();

        // Aporte líquido da carteira no mês corrente (BUY − SELL), se espelha.
        const monthStart = startOfMonth();
        let walletInflowThisMonth = 0;
        if (goal.mirrorWallet) {
            const agg = await AssetTransaction.aggregate([
                { $match: { user: new mongoose.Types.ObjectId(userId), wallet: new mongoose.Types.ObjectId(walletId), date: { $gte: monthStart } } },
                {
                    $group: {
                        _id: null,
                        inflow: {
                            $sum: { $cond: [{ $eq: ['$type', 'BUY'] }, '$totalValue', { $multiply: ['$totalValue', -1] }] },
                        },
                    },
                },
            ]);
            walletInflowThisMonth = agg[0]?.inflow || 0;
        }
        const manualThisMonth = contributions
            .filter((c) => new Date(c.date) >= monthStart)
            .reduce((acc, c) => acc + c.amount, 0);
        const contributionsThisMonth = safeCurrency(walletInflowThisMonth + manualThisMonth);

        // Decomposição do mês: aporte vs. mercado, ancorada no snapshot do início do mês.
        const monthAnchor = await WalletSnapshot.findOne({ user: userId, wallet: walletId, date: { $lt: monthStart } })
            .sort({ date: -1 })
            .lean();
        const prevMirrored = goal.mirrorWallet ? (monthAnchor?.totalEquity || 0) : 0;
        // valor da meta no início do mês ≈ patrimônio ancorado + (saldo manual − aportes manuais do mês)
        const prevValue = safeCurrency(prevMirrored + (goal.manualBalance - manualThisMonth));
        const decomposition = decomposeProgress(prevValue, projection.currentValue, contributionsThisMonth);

        // Trajetória (real/plano/projeção) + histórico mensal p/ streak e ritmo.
        const trajectory = buildTrajectory(goal, snapshots, contributions, projection);
        const monthlyHistory = await buildMonthlyHistory(userId, walletId, goal, 12);
        const amounts = monthlyHistory.map((m) => m.amount);
        const streak = computeStreak(amounts);
        const last3 = amounts.slice(-3);
        const avgContribution3m = safeCurrency(last3.reduce((a, b) => a + b, 0) / (last3.length || 1));

        res.json({
            goal: { ...goal.toObject(), status: goal.status, ...projection },
            contributions,
            currentMonth: {
                contributions: contributionsThisMonth,
                manual: safeCurrency(manualThisMonth),
                wallet: safeCurrency(walletInflowThisMonth),
                ...decomposition,
            },
            trajectory,
            monthlyHistory,
            streak,
            avgContribution3m,
            walletEquity,
            snapshotDate: snapshot?.date || null,
        });
    } catch (error) {
        logger.error(`Erro ao buscar meta: ${error.message}`);
        next(error);
    }
};

// POST /goals — cria uma nova meta.
export const createGoal = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const { name, icon, color, targetAmount, monthlyTarget, expectedAnnualRate, startDate, targetDate, mirrorWallet, manualBalance, previousGoalId } = req.body;

        const limit = goalLimitFor(req.user);
        const total = await InvestmentGoal.countDocuments({ user: userId, wallet: walletId });
        if (total >= limit) {
            return res.status(403).json({
                message: `Seu plano permite ${limit} metas por carteira. Faça upgrade para criar metas ilimitadas.`,
                requiredPlan: 'ESSENTIAL',
            });
        }

        const useMirror = mirrorWallet !== undefined ? mirrorWallet : true;
        const { equity: liveEquity } = await getLiveWalletEquity(userId, walletId);

        // Marco novo herda a jornada do anterior: quem já nomeou a jornada não
        // precisa renomear a cada meta que acrescenta.
        let journey = null;
        if (previousGoalId) {
            const previous = await InvestmentGoal.findOne({ _id: previousGoalId, user: userId, wallet: walletId });
            journey = previous?.journey || null;
        }
        // Baseline da curva "Plano": valor da meta no momento da criação.
        const startValue = safeCurrency((useMirror ? liveEquity : 0) + (manualBalance || 0));

        const goal = await InvestmentGoal.create({
            user: userId,
            wallet: walletId,
            name,
            icon,
            color,
            targetAmount: safeCurrency(targetAmount),
            monthlyTarget: safeCurrency(monthlyTarget || 0),
            expectedAnnualRate: safeFloat(expectedAnnualRate ?? 10),
            startDate: startDate || Date.now(),
            targetDate: targetDate || undefined,
            mirrorWallet: useMirror,
            manualBalance: safeCurrency(manualBalance || 0),
            startValue,
            previousGoalId: previousGoalId || null,
            journey,
        });

        const projection = computeGoalProjection(goal, liveEquity);
        res.status(201).json({ goal: { ...goal.toObject(), ...projection } });
    } catch (error) {
        logger.error(`Erro ao criar meta: ${error.message}`);
        next(error);
    }
};

// PUT /goals/:id — atualiza campos da meta.
export const updateGoal = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId, wallet: walletId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const fields = ['name', 'icon', 'color', 'mirrorWallet', 'status', 'lastCelebratedMilestone', 'previousGoalId'];
        for (const f of fields) {
            if (req.body[f] !== undefined) goal[f] = req.body[f];
        }
        if (req.body.targetAmount !== undefined) goal.targetAmount = safeCurrency(req.body.targetAmount);
        if (req.body.monthlyTarget !== undefined) goal.monthlyTarget = safeCurrency(req.body.monthlyTarget);
        if (req.body.expectedAnnualRate !== undefined) goal.expectedAnnualRate = safeFloat(req.body.expectedAnnualRate);
        if (req.body.targetDate !== undefined) goal.targetDate = req.body.targetDate || undefined;
        // Baseline do "Plano": congelado na criação, mas corrigível. Quem cria a
        // meta ANTES de lançar a carteira fica com um baseline perto de zero, e o
        // "adiantado vs. plano" passa a comparar contra uma carteira que não
        // existia. Sem isso a única saída seria recriar a meta.
        if (req.body.startValue !== undefined) goal.startValue = safeCurrency(req.body.startValue);

        // Religar a meta a outra cadeia troca a jornada junto: sem isso ela
        // carregaria para a cadeia nova o nome da antiga.
        let releasedJourney = null;
        if (req.body.previousGoalId !== undefined) {
            releasedJourney = goal.journey || null;
            const previous = req.body.previousGoalId
                ? await InvestmentGoal.findOne({ _id: req.body.previousGoalId, user: userId, wallet: walletId })
                : null;
            goal.journey = previous?.journey || null;
        }

        goal.updatedAt = Date.now();
        await goal.save();
        if (releasedJourney) await pruneOrphanJourneys(userId, walletId, [releasedJourney]);

        const { equity: walletEquity } = await getLiveWalletEquity(userId, walletId);
        const projection = computeGoalProjection(goal, walletEquity);
        res.json({ goal: { ...goal.toObject(), ...projection } });
    } catch (error) {
        logger.error(`Erro ao atualizar meta: ${error.message}`);
        next(error);
    }
};

// DELETE /goals/:id — remove a meta e seus aportes manuais.
export const deleteGoal = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const goal = await InvestmentGoal.findOneAndDelete({ _id: req.params.id, user: userId, wallet: walletId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });
        await GoalContribution.deleteMany({ user: userId, wallet: walletId, goal: goal._id });
        // Era o último marco da jornada? Então o nome não tem mais o que nomear.
        await pruneOrphanJourneys(userId, walletId, [goal.journey]);
        res.json({ message: 'Meta removida.' });
    } catch (error) {
        logger.error(`Erro ao remover meta: ${error.message}`);
        next(error);
    }
};

/**
 * PUT /goals/:id/journey — nomeia (ou renomeia) a jornada da cadeia da meta.
 *
 * Aceita QUALQUER marco da cadeia: o servidor percorre a cadeia inteira e aplica
 * o vínculo a todos. É isso que dispensa migração — cadeia criada antes da
 * jornada existir ganha a sua no primeiro rename.
 */
export const renameJourney = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const { name } = req.body;

        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId, wallet: walletId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const chain = await collectChain(goal, userId, walletId);
        if (chain.length < 2) {
            return res.status(400).json({ message: 'Só uma jornada encadeada pode ser nomeada.' });
        }

        // Cadeia legada pode ter marcos com jornada e outros sem — o primeiro id
        // encontrado manda, e o vínculo é reaplicado a todos ao final.
        const presentIds = [...new Set(chain.map((g) => g.journey).filter(Boolean).map(String))];
        const existingId = presentIds[0] || null;
        let journey = existingId
            ? await GoalJourney.findOneAndUpdate(
                { _id: existingId, user: userId, wallet: walletId },
                { name, updatedAt: Date.now() },
                { new: true },
            )
            : null;
        if (!journey) journey = await GoalJourney.create({ user: userId, wallet: walletId, name });

        await InvestmentGoal.updateMany(
            { _id: { $in: chain.map((g) => g._id) }, user: userId, wallet: walletId },
            { journey: journey._id, updatedAt: Date.now() },
        );

        // Cadeia que carregava mais de uma jornada (fruto de religamento) deixa
        // as perdedoras sem nenhum marco — some com elas em vez de acumular lixo.
        await pruneOrphanJourneys(
            userId,
            walletId,
            presentIds.filter((id) => id !== String(journey._id)),
        );

        res.json({ journey: { _id: journey._id, name: journey.name } });
    } catch (error) {
        logger.error(`Erro ao nomear jornada: ${error.message}`);
        next(error);
    }
};

// DELETE /goals — remove TODAS as metas DESTA CARTEIRA (e seus aportes manuais).
// Espelha o "Resetar Carteira": ação destrutiva, confirmada no front.
export const clearAllGoals = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const { deletedCount } = await InvestmentGoal.deleteMany({ user: userId, wallet: walletId });
        await GoalContribution.deleteMany({ user: userId, wallet: walletId });
        await GoalJourney.deleteMany({ user: userId, wallet: walletId });
        res.json({ message: 'Todas as metas removidas.', deletedCount: deletedCount || 0 });
    } catch (error) {
        logger.error(`Erro ao limpar metas: ${error.message}`);
        next(error);
    }
};

// POST /goals/:id/contributions — registra aporte manual e devolve a meta recalculada.
export const addContribution = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId, wallet: walletId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const { amount, date, note } = req.body;
        const value = safeCurrency(amount);

        // "Adiantou X meses": meses antes vs. depois do aporte (com patrimônio atual).
        const { equity: walletEquity } = await getLiveWalletEquity(userId, walletId);
        const before = computeGoalProjection(goal, walletEquity);

        await GoalContribution.create({ user: userId, wallet: walletId, goal: goal._id, amount: value, date: date || Date.now(), note });
        goal.manualBalance = safeCurrency(safeFloat(goal.manualBalance) + value);
        goal.updatedAt = Date.now();

        const after = computeGoalProjection(goal, walletEquity);
        await syncGoalStatus(goal, after);
        // Persiste o manualBalance sempre (syncGoalStatus só salva quando muda o
        // status; sem isso, um aporte numa meta já ACHIEVED não seria gravado).
        await goal.save();

        const monthsAccelerated = (before.monthsRemaining !== null && after.monthsRemaining !== null)
            ? Math.max(0, before.monthsRemaining - after.monthsRemaining)
            : null;

        res.status(201).json({
            goal: { ...goal.toObject(), status: goal.status, ...after },
            monthsAccelerated,
        });
    } catch (error) {
        logger.error(`Erro ao registrar aporte: ${error.message}`);
        next(error);
    }
};

// DELETE /goals/:id/contributions/:cid — remove um aporte manual.
export const deleteContribution = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId, wallet: walletId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const contribution = await GoalContribution.findOneAndDelete({ _id: req.params.cid, user: userId, wallet: walletId, goal: goal._id });
        if (!contribution) return res.status(404).json({ message: 'Aporte não encontrado.' });

        goal.manualBalance = safeCurrency(safeSub(goal.manualBalance, contribution.amount));
        goal.updatedAt = Date.now();
        await goal.save();

        const { equity: walletEquity } = await getLiveWalletEquity(userId, walletId);
        const projection = computeGoalProjection(goal, walletEquity);
        res.json({ goal: { ...goal.toObject(), ...projection } });
    } catch (error) {
        logger.error(`Erro ao remover aporte: ${error.message}`);
        next(error);
    }
};
