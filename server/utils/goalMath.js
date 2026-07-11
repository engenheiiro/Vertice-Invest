/**
 * Motor de cálculo do Planejador de Metas Patrimoniais.
 *
 * Reaproveita a MESMA matemática de juros compostos da Calculadora do front
 * (client/src/pages/Calculator.tsx → fv/annualToMonthly) e adiciona o inverso:
 * dado patrimônio atual, aporte mensal, taxa e alvo, resolve "quantos meses
 * faltam". Funções puras e testáveis (server/tests/goal_math.spec.js).
 *
 * Convenção: valores monetários passam por safe* de mathUtils.js (regra 7).
 */
import { safeCurrency, safeFloat } from './mathUtils.js';

/** Converte taxa anual em % (ex.: 10) para taxa mensal decimal composta. */
export const annualToMonthly = (annualPct) => {
    const a = safeFloat(annualPct);
    return Math.pow(1 + a / 100, 1 / 12) - 1;
};

/**
 * Valor Futuro com aportes mensais (idêntico à Calculadora).
 * FV = PV·(1+r)^n + PMT·[((1+r)^n − 1) / r]
 * @param {number} rate Taxa MENSAL decimal (ex.: 0.0079)
 * @param {number} n Número de meses
 * @param {number} pv Valor presente
 * @param {number} pmt Aporte mensal
 */
export const fv = (rate, n, pv, pmt) => {
    if (rate === 0 || !isFinite(rate)) return safeCurrency(pv + pmt * n);
    return safeCurrency(pv * Math.pow(1 + rate, n) + (pmt * (Math.pow(1 + rate, n) - 1)) / rate);
};

/**
 * Resolve o número de meses até atingir a meta.
 * n = ln[(FV·r + PMT)/(PV·r + PMT)] / ln(1+r)   (caso r=0 → (FV−PV)/PMT)
 * Retorna 0 se já atingiu, Infinity se não há caminho de crescimento.
 * @returns {number} meses (float, pode ser fracionário) ou Infinity
 */
export const monthsRemaining = (pv, pmt, annualRate, target) => {
    const PV = safeFloat(pv);
    const PMT = safeFloat(pmt);
    const FV = safeFloat(target);
    const r = annualToMonthly(annualRate);

    if (FV <= 0) return 0;
    if (PV >= FV) return 0;

    // Sem juros: progressão linear pelos aportes.
    if (r === 0) {
        if (PMT <= 0) return Infinity;
        return (FV - PV) / PMT;
    }

    // Sem aporte e sem patrimônio inicial → nunca cresce.
    if (PMT <= 0 && PV <= 0) return Infinity;

    const numerator = FV * r + PMT;
    const denominator = PV * r + PMT;
    if (denominator <= 0) return Infinity;

    const ratio = numerator / denominator;
    if (ratio <= 1) return 0;

    const n = Math.log(ratio) / Math.log(1 + r);
    return isFinite(n) && n > 0 ? n : Infinity;
};

/**
 * Aporte mensal necessário para bater a meta numa quantidade fixa de meses
 * (usado quando a meta tem prazo/targetDate definido).
 * PMT = (FV − PV·(1+r)^N)·r / ((1+r)^N − 1)   (caso r=0 → (FV−PV)/N)
 * @returns {number} aporte mensal (>=0); 0 se o PV já chega lá sozinho.
 */
export const requiredMonthly = (pv, annualRate, target, monthsToDeadline) => {
    const PV = safeFloat(pv);
    const FV = safeFloat(target);
    const N = safeFloat(monthsToDeadline);
    const r = annualToMonthly(annualRate);

    if (N <= 0) return Infinity; // prazo no passado/hoje: não dá pra parcelar
    if (FV <= PV) return 0;

    if (r === 0) return safeCurrency((FV - PV) / N);

    const fvFromPv = PV * Math.pow(1 + r, N);
    if (fvFromPv >= FV) return 0; // o patrimônio atual já alcança a meta no prazo

    const pmt = ((FV - fvFromPv) * r) / (Math.pow(1 + r, N) - 1);
    return safeCurrency(pmt > 0 ? pmt : 0);
};

/**
 * Decompõe a variação do patrimônio entre o que veio de APORTE e o que veio do
 * MERCADO (valorização/proventos). fromMarket = Δpatrimônio − aportes.
 */
export const decomposeProgress = (prevEquity, currentEquity, contributions) => {
    const totalChange = safeCurrency(safeFloat(currentEquity) - safeFloat(prevEquity));
    const fromContribution = safeCurrency(contributions);
    const fromMarket = safeCurrency(totalChange - fromContribution);
    return { totalChange, fromContribution, fromMarket };
};

/**
 * Quantos meses são economizados ao aumentar o aporte mensal em `deltaPmt`.
 * Usado pelo simulador "what-if". Retorna 0 se não houver ganho mensurável.
 */
export const monthsSaved = (pv, pmt, annualRate, target, deltaPmt) => {
    const base = monthsRemaining(pv, pmt, annualRate, target);
    const faster = monthsRemaining(pv, safeFloat(pmt) + safeFloat(deltaPmt), annualRate, target);
    if (!isFinite(base)) return isFinite(faster) ? Infinity : 0; // saiu de "nunca" p/ finito
    if (!isFinite(faster)) return 0;
    const saved = base - faster;
    return saved > 0 ? saved : 0;
};

// Marcos comemorados (%) — espelha MILESTONES do front (GoalDetailModal).
export const GOAL_MILESTONES = [25, 50, 75, 100];
// Histerese: só reverte ACHIEVED→ACTIVE abaixo de 98% do alvo. Evita piscar
// Conquistada↔Ativa (e re-notificar) quando o patrimônio oscila na fronteira.
export const ACHIEVE_REVERT_RATIO = 0.98;

/**
 * Decide o próximo status de uma meta a partir do patrimônio atual (função pura;
 * o controller aplica o efeito colateral de gravar). Máquina de estados com
 * histerese de 2% na volta:
 *   - ACTIVE  → ACHIEVED quando currentValue ≥ targetAmount.
 *   - ACHIEVED → ACTIVE  quando currentValue < 98% do alvo; rebaixa o marco
 *     comemorado para o maior múltiplo ainda alcançado (E4: recruzar 100%
 *     volta a comemorar) e zera achievedAt.
 * @returns {{ changed: boolean, status: string, achievedAtAction: 'set'|'clear'|null, lastCelebratedMilestone: number|null }}
 */
export const resolveGoalStatus = (status, currentValue, progressPct, targetAmount, lastCelebratedMilestone = 0) => {
    const value = safeFloat(currentValue);
    const target = safeFloat(targetAmount);
    const noop = { changed: false, status, achievedAtAction: null, lastCelebratedMilestone: null };

    if (status === 'ACTIVE' && value >= target && target > 0) {
        return { changed: true, status: 'ACHIEVED', achievedAtAction: 'set', lastCelebratedMilestone: null };
    }

    if (status === 'ACHIEVED' && target > 0 && value < target * ACHIEVE_REVERT_RATIO) {
        const highestValid = GOAL_MILESTONES.filter((m) => safeFloat(progressPct) >= m).pop() || 0;
        const nextMilestone = (safeFloat(lastCelebratedMilestone) > highestValid) ? highestValid : null;
        return { changed: true, status: 'ACTIVE', achievedAtAction: 'clear', lastCelebratedMilestone: nextMilestone };
    }

    return noop;
};

/**
 * Nº de meses consecutivos (do mais recente para trás) com aporte líquido > 0.
 * `monthlyNetAmounts` em ordem cronológica (último elemento = mês mais recente).
 */
export const computeStreak = (monthlyNetAmounts) => {
    if (!Array.isArray(monthlyNetAmounts)) return 0;
    let streak = 0;
    for (let i = monthlyNetAmounts.length - 1; i >= 0; i--) {
        if (safeFloat(monthlyNetAmounts[i]) > 0) streak++;
        else break;
    }
    return streak;
};
