/**
 * Regras puras do formulário de metas (criar/editar): estado inicial, validação,
 * corpo enviado ao servidor, metas elegíveis para encadeamento e a projeção
 * "what-if" ao vivo. Sem React — o componente só liga estes pedaços à tela.
 */
import type { CreateGoalPayload, Goal, WalletReturn } from '../../services/goals';
import { parseCurrencyToFloat } from '../../utils/assetTransaction';
import { monthsRemaining, requiredMonthly, addMonths, calendarMonthsBetween } from '../../utils/goalMath';

export interface GoalFormState {
  name: string;
  icon: string;
  color: string;
  targetAmount: string;
  monthlyTarget: string;
  rate: string;
  mirrorWallet: boolean;
  targetDate: string;
  manualBalance: string;
  previousGoalId: string;
  /** Baseline da curva "Plano" — só editável, nunca na criação (lá ele é capturado do patrimônio ao vivo). */
  startValue: string;
}

export type GoalFormPayload = CreateGoalPayload & { startValue?: number };

/** Valor monetário digitado ('1.234,56') → número; lixo vira 0. */
const num = (v: string): number => {
  const n = parseCurrencyToFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Taxa digitada → número; vazio ou inválido vira 0. */
const rateNumber = (v: string): number => parseFloat(v) || 0;

/** Número salvo → texto do campo de moeda ('1234,50', sem separador de milhar). */
const amountField = (v: number): string => String(v.toFixed(2)).replace('.', ',');

/** 14 → '14,0%'. */
export const formatPct = (v: number): string => `${v.toFixed(1).replace('.', ',')}%`;

const EMPTY_FORM: GoalFormState = {
  name: '', icon: 'target', color: 'emerald', targetAmount: '', monthlyTarget: '', rate: '10', mirrorWallet: true,
  targetDate: '', manualBalance: '', previousGoalId: '', startValue: '',
};

/** Estado inicial: vazio na criação, os valores salvos na edição. */
export const initialGoalForm = (goal?: Goal | null): GoalFormState => {
  if (!goal) return { ...EMPTY_FORM };
  return {
    name: goal.name || EMPTY_FORM.name,
    icon: goal.icon || EMPTY_FORM.icon,
    color: goal.color || EMPTY_FORM.color,
    targetAmount: amountField(goal.targetAmount),
    monthlyTarget: amountField(goal.monthlyTarget),
    rate: String(goal.expectedAnnualRate),
    mirrorWallet: goal.mirrorWallet,
    // O prazo é data de calendário: o servidor valida com calendarDate() e o grava como
    // meia-noite UTC. Ler em UTC devolve o dia gravado; ler no fuso local daria o dia
    // anterior em Brasília (21h da véspera).
    targetDate: goal.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : '',
    manualBalance: '',
    previousGoalId: goal.previousGoalId || '',
    startValue: amountField(goal.startValue || 0),
  };
};

/** Mensagem do primeiro problema do formulário, ou null quando dá para gravar. */
export const validateGoalForm = (form: GoalFormState): string | null => {
  if (!form.name.trim()) return 'Dê um nome para a meta.';
  if (num(form.targetAmount) <= 0) return 'Defina um valor-alvo maior que zero.';
  return null;
};

/** Corpo enviado ao servidor. Saldo fora da carteira só na criação; baseline só na edição. */
export const buildGoalPayload = (form: GoalFormState, isEdit: boolean): GoalFormPayload => {
  const payload: GoalFormPayload = {
    name: form.name.trim(),
    icon: form.icon,
    color: form.color,
    targetAmount: num(form.targetAmount),
    monthlyTarget: num(form.monthlyTarget),
    expectedAnnualRate: rateNumber(form.rate),
    mirrorWallet: form.mirrorWallet,
    targetDate: form.targetDate || null,
    previousGoalId: form.previousGoalId || null,
  };
  if (!isEdit && num(form.manualBalance) > 0) payload.manualBalance = num(form.manualBalance);
  if (isEdit) payload.startValue = num(form.startValue);
  return payload;
};

/**
 * Metas que podem ser "anteriores" desta: nem ela mesma, nem as que já têm outra
 * meta apontando para elas.
 */
export const eligiblePreviousGoals = (allGoals: Goal[], currentId?: string): Goal[] => {
  const alreadyFollowed = new Set<string>();
  for (const g of allGoals) if (g.previousGoalId) alreadyFollowed.add(g.previousGoalId);
  return allGoals.filter((g) => g._id !== currentId && !alreadyFollowed.has(g._id));
};

/** Taxa do histórico da carteira, só quando a janela já basta para anualizar. */
export const walletHistoryRate = (walletReturn?: WalletReturn): number | null =>
  (walletReturn?.enough && walletReturn.value !== null ? walletReturn.value : null);

/** Dias de histórico a explicar ("curto demais"), ou null quando não há o que dizer. */
export const shortHistoryDays = (walletReturn?: WalletReturn): number | null =>
  (walletReturn && !walletReturn.enough && walletReturn.days > 0 ? Math.round(walletReturn.days) : null);

export interface GoalPreview {
  baseline: number;
  n: number;
  months: number | null;
  projDate: Date | null;
  required: number | null;
}

type PreviewInput = Pick<GoalFormState, 'targetAmount' | 'monthlyTarget' | 'rate' | 'mirrorWallet' | 'manualBalance' | 'targetDate'>;

const MS_PER_MONTH = 30.4375 * 24 * 3600 * 1000;

/** Aporte necessário para bater o prazo; null sem prazo ou quando não há aporte que resolva. */
const requiredForDeadline = (baseline: number, rate: number, target: number, targetDate: string): number | null => {
  if (!targetDate) return null;
  const months = (new Date(targetDate).getTime() - Date.now()) / MS_PER_MONTH;
  const req = requiredMonthly(baseline, rate, target, months);
  return Number.isFinite(req) ? req : null;
};

/** Preview "what-if" ao vivo (espelho do goalMath do backend); null sem valor-alvo. */
export const computeGoalPreview = (form: PreviewInput, totalEquity: number): GoalPreview | null => {
  const target = num(form.targetAmount);
  if (target <= 0) return null;
  const baseline = (form.mirrorWallet ? totalEquity : 0) + num(form.manualBalance);
  const rate = rateNumber(form.rate);
  const now = new Date();
  const n = monthsRemaining(baseline, num(form.monthlyTarget), rate, target);
  const projDate = Number.isFinite(n) ? addMonths(now, n) : null;
  // Meses derivados da data (não de Math.ceil(n)): "tempo estimado" e "data
  // prevista" ficam lado a lado no preview e não podem se contradizer.
  const months = projDate ? calendarMonthsBetween(now, projDate) : null;
  return { baseline, n, months, projDate, required: requiredForDeadline(baseline, rate, target, form.targetDate) };
};
