/**
 * Lógica derivada do modal de detalhe da meta — sem JSX, testável.
 *
 * O componente (`GoalDetailModal.tsx`) só busca, muta e desenha; tudo que é
 * decisão sobre o que aparece (e com que texto) mora aqui.
 */
import type { Goal, GoalDetail } from '../../services/goals';
import type { CoachState } from '../../utils/goalCoach';
import { formatCurrency, formatCompact } from '../../utils/format';
import { monthsRemaining, monthsSaved, addMonths, annualToMonthly, calendarMonthsBetween } from '../../utils/goalMath';
import { formatMonths } from './goalTheme';

const MILESTONES = [25, 50, 75, 100];
const LONG_MONTH: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const SHORT_MONTH: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };

const brl = (v: number, privacy?: boolean) => formatCurrency(v, 'BRL', { privacy });
const monthWord = (n: number) => (n === 1 ? 'mês' : 'meses');

/** Marco cruzado e ainda não comemorado (25/50/75/100%), ou undefined. */
export const crossedMilestone = (goal: Goal, alreadyCelebrated: number): number | undefined => {
  const already = Math.max(goal.lastCelebratedMilestone || 0, alreadyCelebrated);
  return MILESTONES.filter((m) => goal.progressPct >= m && m > already).pop();
};

export const milestoneMessage = (milestone: number): string =>
  milestone >= 100 ? '🏆 Meta conquistada!' : `🎉 Você cruzou ${milestone}% da meta!`;

export const coachStateOf = (goal: Goal, data: GoalDetail): CoachState => ({
  progressPct: goal.progressPct,
  onTrack: goal.onTrack,
  achieved: goal.achieved,
  monthsRemaining: goal.monthsRemaining,
  monthlyTarget: goal.monthlyTarget,
  requiredMonthlyForDeadline: goal.requiredMonthlyForDeadline,
  hasDeadline: !!goal.targetDate,
  fromContribution: data.currentMonth.fromContribution,
  fromMarket: data.currentMonth.fromMarket,
  dateDeltaMonths: goal.dateDeltaMonths,
  valueVsPlan: goal.valueVsPlan,
  streak: data.streak,
  avgContribution3m: data.avgContribution3m,
});

/**
 * Premissa de rendimento — o que a taxa está fazendo pela projeção.
 *
 * Com patrimônio grande e aporte pequeno, a MAIOR PARTE do avanço previsto vem
 * da taxa, não do bolso do usuário: R$ 46,6 mil a 13,9% a.a. rendem ~R$ 509/mês
 * ao lado de um aporte de R$ 500 — e a data prevista cai de 7 meses para 3 por
 * causa disso. Sem esta caixa, "faltam 3 meses" parece aritmética do aporte e
 * vira promessa; com ela, o usuário vê a premissa e o cenário sem rendimento.
 */
export const buildPremise = (goal: Goal, now: Date) => {
  if (goal.achieved) return null;
  const monthlyYield = goal.currentValue * annualToMonthly(goal.expectedAnnualRate);
  const nNoYield = monthsRemaining(goal.currentValue, goal.monthlyTarget, 0, goal.targetAmount);
  const dateNoYield = Number.isFinite(nNoYield) ? addMonths(now, nNoYield) : null;
  return {
    monthlyYield,
    noYield: dateNoYield
      ? { date: dateNoYield.toLocaleDateString('pt-BR', LONG_MONTH), months: formatMonths(calendarMonthsBetween(now, dateNoYield)) }
      : null,
  };
};

/** Simulador "e se eu aportar…": `pmt` nulo é o aporte atual da meta. */
export const buildWhatIf = (goal: Goal, whatIfPmt: number | null, now: Date) => {
  const pmt = whatIfPmt ?? goal.monthlyTarget;
  const n = monthsRemaining(goal.currentValue, pmt, goal.expectedAnnualRate, goal.targetAmount);
  const date = Number.isFinite(n) ? addMonths(now, n) : null;
  const saved = monthsSaved(goal.currentValue, goal.monthlyTarget, goal.expectedAnnualRate, goal.targetAmount, pmt - goal.monthlyTarget);
  const changed = pmt !== goal.monthlyTarget;
  return {
    pmt,
    max: Math.max(goal.monthlyTarget * 3, 1000),
    dateLabel: date ? date.toLocaleDateString('pt-BR', SHORT_MONTH) : '—',
    savedLabel: changed && Number.isFinite(saved) && saved > 0 ? `chega ${formatMonths(Math.round(saved))} antes` : null,
    canAdopt: changed,
  };
};

/** Aporte do mês corrente contra o sugerido. Null quando não há o que acompanhar. */
export const buildMonthProgress = (goal: Goal, data: GoalDetail, privacy?: boolean) => {
  if (goal.achieved || goal.monthlyTarget <= 0) return null;
  const done = data.currentMonth.contributions;
  const remaining = Math.max(0, goal.monthlyTarget - done);
  return {
    done,
    hit: remaining <= 0,
    remainingLabel: remaining <= 0 ? '✓ meta do mês batida' : `faltam ${brl(remaining, privacy)}`,
    pct: Math.min(100, (done / goal.monthlyTarget) * 100),
  };
};

/** Linha de baixo da meta conquistada: quanto antes/depois do previsto. */
export const achievedDeltaText = (delta: number | null): string | null => {
  if (delta === null || delta === 0) return null;
  const abs = Math.abs(delta);
  return `${abs} ${monthWord(abs)} ${delta > 0 ? 'antes' : 'depois'} do previsto`;
};

type PlanDelta = { kind: 'ahead' | 'behind'; label: string } | { kind: 'onPlan'; label: string };

/** Data prevista contra o plano: adiantado, atrasado ou no plano (null sem comparação). */
export const planDeltaOf = (delta: number | null): PlanDelta | null => {
  if (delta === null) return null;
  if (delta > 0) return { kind: 'ahead', label: `${formatMonths(delta)} adiantado` };
  if (delta < 0) return { kind: 'behind', label: `${formatMonths(Math.abs(delta))} atrasado` };
  return { kind: 'onPlan', label: 'No plano' };
};

/** Diferença de valor contra o plano; abaixo de R$ 1 não vale a linha. */
export const valueVsPlanOf = (value: number, privacy?: boolean) =>
  Math.abs(value) >= 1
    ? { positive: value >= 0, label: `${value >= 0 ? '+' : '−'}${brl(Math.abs(value), privacy)} vs. plano` }
    : null;

export const projectedDateLabel = (goal: Goal): string =>
  goal.projectedDate ? new Date(goal.projectedDate).toLocaleDateString('pt-BR', LONG_MONTH) : '—';

export type StatIcon = 'calendar' | 'target' | 'arrow' | 'trend' | 'alert';
interface StatView { label: string; icon: StatIcon; value: string; accent?: string }

export const buildStats = (goal: Goal, avgContribution3m: number, privacy?: boolean): StatView[] => {
  const compact = (v: number) => formatCompact(v, 'BRL', { privacy });
  const required = goal.targetDate ? goal.requiredMonthlyForDeadline : null;
  return [
    { label: 'Faltam', icon: 'calendar', value: goal.achieved ? 'Concluída' : formatMonths(goal.monthsRemaining), accent: goal.achieved ? 'text-emerald-400' : undefined },
    { label: 'Planejada', icon: 'target', value: goal.plannedDate ? new Date(goal.plannedDate).toLocaleDateString('pt-BR', SHORT_MONTH) : '—' },
    { label: 'Aporte/mês', icon: 'arrow', value: compact(goal.monthlyTarget) },
    {
      label: goal.targetDate ? 'Necessário/mês' : 'Ritmo 3m',
      icon: goal.onTrack ? 'trend' : 'alert',
      value: compact(required !== null ? required : avgContribution3m || 0),
      accent: goal.onTrack ? 'text-emerald-400' : 'text-yellow-400',
    },
  ];
};

/** Sequência de meses aportando e o efeito do mercado no mês. */
export const buildMonthFacts = (data: GoalDetail, privacy?: boolean) => {
  const { fromContribution, fromMarket } = data.currentMonth;
  return {
    streak: data.streak >= 1 ? `${data.streak} ${monthWord(data.streak)} seguidos` : null,
    market: fromContribution !== 0 || fromMarket !== 0
      ? { positive: fromMarket >= 0, label: `${fromMarket >= 0 ? '+' : ''}${brl(fromMarket, privacy)}` }
      : null,
  };
};

export const contributionMeta = (date: string, note?: string): string =>
  `${new Date(date).toLocaleDateString('pt-BR')}${note ? ` · ${note}` : ''}`;
