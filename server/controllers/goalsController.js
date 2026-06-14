
import mongoose from 'mongoose';
import InvestmentGoal from '../models/InvestmentGoal.js';
import GoalContribution from '../models/GoalContribution.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UserAsset from '../models/UserAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { accrueFixedIncomeValue, brazilToday } from '../utils/fixedIncome.js';
import { monthsRemaining, requiredMonthly, decomposeProgress, fv, annualToMonthly, computeStreak } from '../utils/goalMath.js';
import { safeCurrency, safeFloat, safeSub, safeMult, safeValue, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import logger from '../config/logger.js';

const MS_DAY = 24 * 60 * 60 * 1000;

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

// Patrimônio espelhado da carteira = último snapshot diário do usuário.
const getLatestSnapshot = async (userId) => {
    return WalletSnapshot.findOne({ user: userId }).sort({ date: -1 }).lean();
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
const getLiveWalletEquity = async (userId) => {
    const snapshot = await getLatestSnapshot(userId);

    try {
        const assets = await UserAsset.find({ user: userId, quantity: { $gt: QUANTITY_EPSILON } });
        // Carteira vazia (reset ou remoção de todos os ativos) = patrimônio 0.
        // Não cair no snapshot aqui, senão a meta manteria um valor fantasma.
        if (assets.length === 0) return { equity: 0, snapshot };

        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
        const cdi = config?.cdi || 11.25;
        const usdRate = config?.dollar || 5.75;
        const calcDate = brazilToday();

        const tickers = assets.filter((a) => !['CASH', 'FIXED_INCOME'].includes(a.type)).map((a) => a.ticker);
        if (tickers.length > 0) await marketDataService.refreshQuotesBatch(tickers);

        let totalEquity = 0;
        for (const asset of assets) {
            const multiplier = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;
            let val;
            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                val = accrueFixedIncomeValue(asset, { cdiRate: cdi, calcDate });
            } else {
                const mData = await marketDataService.getMarketDataByTicker(asset.ticker);
                val = safeValue(asset.quantity, mData.price || 0);
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
    const monthsLeft = isFinite(n) ? Math.ceil(n) : null;
    const projectedDate = isFinite(n) ? addMonths(new Date(), n) : null;

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

// Marca como ACHIEVED no banco se cruzou o alvo (efeito colateral leve, lazy).
const syncAchievedStatus = async (goalDoc, achieved) => {
    if (achieved && goalDoc.status === 'ACTIVE') {
        goalDoc.status = 'ACHIEVED';
        if (!goalDoc.achievedAt) goalDoc.achievedAt = new Date(); // "Data real" da conquista
        await goalDoc.save();
    }
};

/**
 * Histórico mensal de aporte líquido (últimos N meses) — aporte da carteira
 * (ΣBUY−ΣSELL, se espelha) + aportes manuais. Ordem cronológica, meses sem
 * aporte preenchidos com 0. Base para streak e ritmo real (média 3m).
 */
const buildMonthlyHistory = async (userId, goal, months = 12) => {
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const map = new Map(); // 'YYYY-MM' -> amount

    if (goal.mirrorWallet) {
        const walletAgg = await AssetTransaction.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), date: { $gte: since } } },
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
        { $match: { user: new mongoose.Types.ObjectId(userId), goal: goal._id, date: { $gte: since } } },
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
 */
const buildTrajectory = (goal, snapshots, contributions, projection) => {
    const r = annualToMonthly(goal.expectedAnnualRate);
    const start = goal.startDate ? new Date(goal.startDate) : new Date();
    const now = new Date();
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

    // Conjunto de timestamps (1º de cada mês) a plotar.
    const keys = new Set();
    for (let m = 0; m <= totalMonths; m += step) {
        const d = new Date(start); d.setMonth(d.getMonth() + m); keys.add(firstOfMonth(d).getTime());
    }
    realMap.forEach((_, k) => {
        const [y, mm] = k.split('-'); keys.add(new Date(Number(y), Number(mm) - 1, 1).getTime());
    });
    [now, horizonEnd, projection.plannedDate, projection.projectedDate].forEach((d) => {
        if (d) keys.add(firstOfMonth(new Date(d)).getTime());
    });

    return [...keys].sort((a, b) => a - b).map((ts) => {
        const d = new Date(ts);
        const mk = monthKey(d);
        const point = { t: d.toISOString() };
        if (realMap.has(mk)) point.real = realMap.get(mk);
        // Plano: do início até atingir o alvo.
        if (!projection.plannedDate || d <= new Date(projection.plannedDate)) {
            const p = fv(r, Math.max(0, monthsBetween(start, d)), startValue, goal.monthlyTarget);
            point.planned = safeCurrency(Math.min(p, target));
        }
        // Projeção: de hoje até a data prevista.
        const mFromNow = monthsBetween(now, d);
        if (mFromNow >= -0.5 && (!projection.projectedDate || d <= new Date(projection.projectedDate))) {
            const pj = fv(r, Math.max(0, mFromNow), projection.currentValue, goal.monthlyTarget);
            point.projected = safeCurrency(Math.min(pj, target * 1.02));
        }
        return point;
    });
};

// GET /goals — lista as metas do usuário já com projeções.
export const listGoals = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const [goals, { equity: walletEquity, snapshot }] = await Promise.all([
            InvestmentGoal.find({ user: userId, status: { $ne: 'ARCHIVED' } }).sort({ createdAt: 1 }),
            getLiveWalletEquity(userId),
        ]);

        const result = [];
        for (const goal of goals) {
            const projection = computeGoalProjection(goal, walletEquity);
            await syncAchievedStatus(goal, projection.achieved);
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
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const { equity: walletEquity, snapshot } = await getLiveWalletEquity(userId);

        // Histórico patrimonial p/ a trajetória (ordem cronológica).
        const snapshots = await WalletSnapshot.find({ user: userId }).sort({ date: 1 }).lean();

        // Baseline do "Plano": usa startValue salvo; p/ metas antigas sem o campo,
        // estima pelo 1º snapshot a partir do início (ou 0).
        let effectiveStartValue = goal.startValue;
        if (!effectiveStartValue && goal.mirrorWallet) {
            const startDate = goal.startDate ? new Date(goal.startDate) : null;
            const anchor = startDate ? snapshots.find((s) => new Date(s.date) >= startDate) : snapshots[0];
            effectiveStartValue = safeCurrency((anchor?.totalEquity || 0) + safeFloat(goal.manualBalance));
        }

        const projection = computeGoalProjection(goal, walletEquity, { startValue: effectiveStartValue });
        await syncAchievedStatus(goal, projection.achieved);

        // Aportes manuais (ledger).
        const contributions = await GoalContribution.find({ user: userId, goal: goal._id })
            .sort({ date: -1 })
            .limit(100)
            .lean();

        // Aporte líquido da carteira no mês corrente (BUY − SELL), se espelha.
        const monthStart = startOfMonth();
        let walletInflowThisMonth = 0;
        if (goal.mirrorWallet) {
            const agg = await AssetTransaction.aggregate([
                { $match: { user: new mongoose.Types.ObjectId(userId), date: { $gte: monthStart } } },
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
        const monthAnchor = await WalletSnapshot.findOne({ user: userId, date: { $lt: monthStart } })
            .sort({ date: -1 })
            .lean();
        const prevMirrored = goal.mirrorWallet ? (monthAnchor?.totalEquity || 0) : 0;
        // valor da meta no início do mês ≈ patrimônio ancorado + (saldo manual − aportes manuais do mês)
        const prevValue = safeCurrency(prevMirrored + (goal.manualBalance - manualThisMonth));
        const decomposition = decomposeProgress(prevValue, projection.currentValue, contributionsThisMonth);

        // Trajetória (real/plano/projeção) + histórico mensal p/ streak e ritmo.
        const trajectory = buildTrajectory(goal, snapshots, contributions, projection);
        const monthlyHistory = await buildMonthlyHistory(userId, goal, 12);
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
        const { name, icon, color, targetAmount, monthlyTarget, expectedAnnualRate, startDate, targetDate, mirrorWallet, manualBalance, previousGoalId } = req.body;

        const useMirror = mirrorWallet !== undefined ? mirrorWallet : true;
        const { equity: liveEquity, snapshot } = await getLiveWalletEquity(userId);
        // Baseline da curva "Plano": valor da meta no momento da criação.
        const startValue = safeCurrency((useMirror ? liveEquity : 0) + (manualBalance || 0));

        const goal = await InvestmentGoal.create({
            user: userId,
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
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const fields = ['name', 'icon', 'color', 'mirrorWallet', 'status', 'lastCelebratedMilestone', 'previousGoalId'];
        for (const f of fields) {
            if (req.body[f] !== undefined) goal[f] = req.body[f];
        }
        if (req.body.targetAmount !== undefined) goal.targetAmount = safeCurrency(req.body.targetAmount);
        if (req.body.monthlyTarget !== undefined) goal.monthlyTarget = safeCurrency(req.body.monthlyTarget);
        if (req.body.expectedAnnualRate !== undefined) goal.expectedAnnualRate = safeFloat(req.body.expectedAnnualRate);
        if (req.body.targetDate !== undefined) goal.targetDate = req.body.targetDate || undefined;
        goal.updatedAt = Date.now();
        await goal.save();

        const { equity: walletEquity } = await getLiveWalletEquity(userId);
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
        const goal = await InvestmentGoal.findOneAndDelete({ _id: req.params.id, user: userId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });
        await GoalContribution.deleteMany({ user: userId, goal: goal._id });
        res.json({ message: 'Meta removida.' });
    } catch (error) {
        logger.error(`Erro ao remover meta: ${error.message}`);
        next(error);
    }
};

// POST /goals/:id/contributions — registra aporte manual e devolve a meta recalculada.
export const addContribution = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const { amount, date, note } = req.body;
        const value = safeCurrency(amount);

        // "Adiantou X meses": meses antes vs. depois do aporte (com patrimônio atual).
        const { equity: walletEquity } = await getLiveWalletEquity(userId);
        const before = computeGoalProjection(goal, walletEquity);

        await GoalContribution.create({ user: userId, goal: goal._id, amount: value, date: date || Date.now(), note });
        goal.manualBalance = safeCurrency(safeFloat(goal.manualBalance) + value);
        goal.updatedAt = Date.now();

        const after = computeGoalProjection(goal, walletEquity);
        await syncAchievedStatus(goal, after.achieved);
        if (goal.status !== 'ACHIEVED') await goal.save();

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
        const goal = await InvestmentGoal.findOne({ _id: req.params.id, user: userId });
        if (!goal) return res.status(404).json({ message: 'Meta não encontrada.' });

        const contribution = await GoalContribution.findOneAndDelete({ _id: req.params.cid, user: userId, goal: goal._id });
        if (!contribution) return res.status(404).json({ message: 'Aporte não encontrado.' });

        goal.manualBalance = safeCurrency(safeSub(goal.manualBalance, contribution.amount));
        goal.updatedAt = Date.now();
        await goal.save();

        const { equity: walletEquity } = await getLiveWalletEquity(userId);
        const projection = computeGoalProjection(goal, walletEquity);
        res.json({ goal: { ...goal.toObject(), ...projection } });
    } catch (error) {
        logger.error(`Erro ao remover aporte: ${error.message}`);
        next(error);
    }
};
