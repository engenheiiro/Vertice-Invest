import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, WalletReturn } from '../../services/goals';
import {
  buildGoalPayload, computeGoalPreview, eligiblePreviousGoals, formatPct, initialGoalForm,
  shortHistoryDays, validateGoalForm, walletHistoryRate, type GoalFormState,
} from './createGoalForm';

const AGORA = new Date('2026-11-22T12:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

const goal = (over: Partial<Goal> = {}): Goal => ({
  _id: 'g1', name: 'Reserva', icon: 'home', color: 'blue', targetAmount: 1234567.5, monthlyTarget: 850,
  expectedAnnualRate: 8, targetDate: '2027-06-30T00:00:00.000Z', startValue: 3200.4, previousGoalId: 'p0', mirrorWallet: false,
  ...over,
} as Goal);

const form = (over: Partial<GoalFormState> = {}): GoalFormState => ({ ...initialGoalForm(), name: 'Casa', targetAmount: '1.000,00', ...over });

const walletReturn = (over: Partial<WalletReturn> = {}): WalletReturn => ({
  value: null, days: 62, totalReturnPct: 12, enough: false, capped: false, ...over,
});

describe('initialGoalForm', () => {
  it('criação: vazio, taxa 10, ícone alvo, cor esmeralda, espelho ligado', () => {
    expect(initialGoalForm()).toEqual({
      name: '', icon: 'target', color: 'emerald', targetAmount: '', monthlyTarget: '', rate: '10', mirrorWallet: true,
      targetDate: '', manualBalance: '', previousGoalId: '', startValue: '',
    });
    expect(initialGoalForm(null).rate).toBe('10');
  });

  it('edição: valores salvos com vírgula e sem separador de milhar, prazo em YYYY-MM-DD', () => {
    expect(initialGoalForm(goal())).toEqual({
      name: 'Reserva', icon: 'home', color: 'blue', targetAmount: '1234567,50', monthlyTarget: '850,00', rate: '8',
      mirrorWallet: false, targetDate: '2027-06-30', manualBalance: '', previousGoalId: 'p0', startValue: '3200,40',
    });
  });

  it('edição com opcionais vazios cai nos padrões', () => {
    const f = initialGoalForm(goal({ icon: '', color: '', targetDate: null, previousGoalId: null, startValue: 0 }));
    expect([f.icon, f.color, f.targetDate, f.previousGoalId, f.startValue]).toEqual(['target', 'emerald', '', '', '0,00']);
  });
});

describe('validateGoalForm', () => {
  it('nome vazio ou só espaços', () => {
    expect(validateGoalForm(form({ name: '' }))).toBe('Dê um nome para a meta.');
    expect(validateGoalForm(form({ name: '  ', targetAmount: '' }))).toBe('Dê um nome para a meta.');
  });

  it('valor-alvo vazio, zero ou lixo; R$ 0,01 já vale', () => {
    for (const v of ['', '0,00', 'abc']) expect(validateGoalForm(form({ targetAmount: v }))).toBe('Defina um valor-alvo maior que zero.');
    expect(validateGoalForm(form({ targetAmount: '0,01' }))).toBeNull();
  });
});

describe('buildGoalPayload', () => {
  it('criação: nome aparado, números parseados, vazios viram null/0, sem startValue', () => {
    expect(buildGoalPayload(form({ name: ' Casa ', rate: '' }), false)).toEqual({
      name: 'Casa', icon: 'target', color: 'emerald', targetAmount: 1000, monthlyTarget: 0, expectedAnnualRate: 0,
      mirrorWallet: true, targetDate: null, previousGoalId: null,
    });
  });

  it('criação: saldo fora da carteira só quando positivo', () => {
    expect(buildGoalPayload(form({ manualBalance: '12,50' }), false).manualBalance).toBe(12.5);
    expect('manualBalance' in buildGoalPayload(form({ manualBalance: '0,00' }), false)).toBe(false);
  });

  it('edição: manda startValue e ignora o saldo fora da carteira', () => {
    const p = buildGoalPayload(form({ manualBalance: '50,00', startValue: '', targetDate: '2030-01-01', previousGoalId: 'p1' }), true);
    expect(p).toMatchObject({ startValue: 0, targetDate: '2030-01-01', previousGoalId: 'p1' });
    expect('manualBalance' in p).toBe(false);
  });
});

describe('eligiblePreviousGoals', () => {
  it('tira a própria meta e as que já têm sucessora', () => {
    const all = [goal({ _id: 'g1' }), goal({ _id: 'a', previousGoalId: null }), goal({ _id: 'b', previousGoalId: 'a' })];
    expect(eligiblePreviousGoals(all, 'g1').map((g) => g._id)).toEqual(['b']);
    expect(eligiblePreviousGoals(all).map((g) => g._id)).toEqual(['g1', 'b']);
  });
});

describe('taxas do histórico e formatação', () => {
  it('formatPct usa vírgula e uma casa', () => {
    expect(formatPct(14)).toBe('14,0%');
    expect(formatPct(13.96)).toBe('14,0%');
  });

  it('histórico vira taxa só com janela suficiente e valor', () => {
    expect(walletHistoryRate(walletReturn({ enough: true, value: 14.5 }))).toBe(14.5);
    expect(walletHistoryRate(walletReturn({ enough: true, value: null }))).toBeNull();
    expect(walletHistoryRate(walletReturn())).toBeNull();
    expect(walletHistoryRate(undefined)).toBeNull();
  });

  it('dias de histórico curto, arredondados; nada a dizer com 0 dias ou janela suficiente', () => {
    expect(shortHistoryDays(walletReturn({ days: 40.6 }))).toBe(41);
    expect(shortHistoryDays(walletReturn({ days: 0 }))).toBeNull();
    expect(shortHistoryDays(walletReturn({ enough: true, value: 9 }))).toBeNull();
    expect(shortHistoryDays(undefined)).toBeNull();
  });
});

describe('computeGoalPreview', () => {
  const input = (over: Partial<GoalFormState> = {}) => form({ targetAmount: '100.000,00', monthlyTarget: '1.000,00', rate: '10', ...over });

  it('sem valor-alvo não há projeção', () => {
    expect(computeGoalPreview(input({ targetAmount: '' }), 5000)).toBeNull();
  });

  it('base = carteira (se espelhada) + saldo fora; com caminho há meses e data', () => {
    const p = computeGoalPreview(input({ manualBalance: '500,00' }), 10_000);
    expect(p?.baseline).toBe(10_500);
    expect(Number.isFinite(p?.n)).toBe(true);
    expect(p?.months).toBeGreaterThan(0);
    expect(p?.projDate?.getTime()).toBeGreaterThan(AGORA.getTime());
    expect(p?.required).toBeNull();
    expect(computeGoalPreview(input({ mirrorWallet: false }), 10_000)?.baseline).toBe(0);
  });

  it('sem aporte nem base: sem caminho, sem data', () => {
    const p = computeGoalPreview(input({ mirrorWallet: false, monthlyTarget: '' }), 10_000);
    expect(p).toMatchObject({ baseline: 0, n: Infinity, months: null, projDate: null });
  });

  it('aporte para o prazo: positivo com prazo futuro, null com prazo vencido', () => {
    expect(computeGoalPreview(input({ targetDate: '2030-11-22' }), 10_000)?.required).toBeGreaterThan(0);
    expect(computeGoalPreview(input({ targetDate: '2020-01-01' }), 10_000)?.required).toBeNull();
  });
});
