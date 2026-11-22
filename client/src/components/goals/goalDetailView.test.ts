import { describe, it, expect } from 'vitest';
import type { Goal, GoalDetail } from '../../services/goals';
import {
  crossedMilestone, milestoneMessage, coachStateOf, buildPremise, buildWhatIf, buildMonthProgress,
  achievedDeltaText, planDeltaOf, valueVsPlanOf, projectedDateLabel, buildStats, buildMonthFacts, contributionMeta,
} from './goalDetailView';

// "Hoje" é passado como argumento: nenhuma conta depende do relógio da máquina.
const NOW = new Date('2026-11-22T12:00:00-03:00');
// O formatador de moeda separa "R$" do número com espaço inseparável.
const sp = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, ' '));

const goal = (over: Partial<Goal> = {}): Goal => ({
  _id: 'g1', name: 'Casa', icon: 'home', color: 'blue', targetAmount: 100000, monthlyTarget: 1000, expectedAnnualRate: 12,
  startDate: '2026-01-01', targetDate: null, startValue: 0, achievedAt: null, lastCelebratedMilestone: 25,
  mirrorWallet: true, manualBalance: 0, status: 'ACTIVE', currentValue: 40000, walletEquity: 40000, remainingAmount: 60000,
  progressPct: 40, monthsRemaining: 30, projectedDate: '2029-05-15T12:00:00Z', plannedDate: '2029-08-15T12:00:00Z',
  planExpectedNow: 38000, valueVsPlan: 2000, dateDeltaMonths: 3, requiredMonthlyForDeadline: null, onTrack: true,
  achieved: false, rateDeltaPp: 0, rateStale: false,
  ...over,
});

const detail = (over: Partial<GoalDetail> = {}): GoalDetail => ({
  goal: goal(), contributions: [],
  currentMonth: { contributions: 400, manual: 0, wallet: 0, totalChange: 0, fromContribution: 400, fromMarket: 150 },
  trajectory: [], monthlyHistory: [], streak: 3, avgContribution3m: 900, walletEquity: 40000, snapshotDate: null,
  rateContext: { suggested: 14, breakdown: [], cdi: 14, ipca: 4.5, ntnbLong: 7, walletReturn: { value: null, days: 0, totalReturnPct: 0, enough: false, capped: false } },
  ...over,
});

describe('marcos', () => {
  it('devolve o maior marco cruzado ainda não comemorado', () => {
    expect(crossedMilestone(goal({ progressPct: 80, lastCelebratedMilestone: 25 }), 0)).toBe(75);
    expect(crossedMilestone(goal({ progressPct: 55, lastCelebratedMilestone: 50 }), 0)).toBeUndefined();
    // O já comemorado nesta sessão (ref) também conta, antes de o servidor gravar.
    expect(crossedMilestone(goal({ progressPct: 55, lastCelebratedMilestone: 0 }), 50)).toBeUndefined();
  });

  it('100% vira conquista; os outros, o percentual', () => {
    expect(milestoneMessage(100)).toBe('🏆 Meta conquistada!');
    expect(milestoneMessage(50)).toBe('🎉 Você cruzou 50% da meta!');
  });
});

describe('coachStateOf', () => {
  it('leva prazo, mês corrente e ritmo para o coach', () => {
    const s = coachStateOf(goal({ targetDate: '2028-01-01' }), detail());
    expect(s).toMatchObject({ hasDeadline: true, fromContribution: 400, fromMarket: 150, streak: 3, avgContribution3m: 900 });
  });
});

describe('buildPremise', () => {
  it('meta conquistada não tem premissa', () => {
    expect(buildPremise(goal({ achieved: true }), NOW)).toBeNull();
  });

  it('rendimento mensal da taxa e a chegada sem rendimento', () => {
    const p = buildPremise(goal(), NOW);
    expect(p?.monthlyYield).toBeCloseTo(40000 * (Math.pow(1.12, 1 / 12) - 1), 6);
    // 60 mil a 1.000/mês sem juros: 60 meses.
    expect(p?.noYield).toEqual({ date: 'novembro de 2031', months: '5 anos' });
  });

  it('sem aporte e sem rendimento nunca chega: sem data', () => {
    expect(buildPremise(goal({ monthlyTarget: 0 }), NOW)?.noYield).toBeNull();
  });
});

describe('buildWhatIf', () => {
  it('sem mexer, é o aporte atual e não há o que adotar', () => {
    const w = buildWhatIf(goal(), null, NOW);
    expect(w).toMatchObject({ pmt: 1000, max: 3000, canAdopt: false, savedLabel: null });
  });

  it('aporte maior antecipa e pode ser adotado; teto mínimo do slider é 1.000', () => {
    const w = buildWhatIf(goal(), 2000, NOW);
    expect(w.canAdopt).toBe(true);
    expect(w.savedLabel).toMatch(/^chega .+ antes$/);
    expect(buildWhatIf(goal({ monthlyTarget: 100 }), null, NOW).max).toBe(1000);
  });

  it('aporte menor não promete antecipação', () => {
    expect(buildWhatIf(goal(), 500, NOW).savedLabel).toBeNull();
  });
});

describe('buildMonthProgress', () => {
  it('quanto falta no mês e a barra proporcional', () => {
    expect(sp(buildMonthProgress(goal(), detail()))).toEqual({ done: 400, hit: false, remainingLabel: 'faltam R$ 600,00', pct: 40 });
  });

  it('batida: selo e barra cheia (nunca acima de 100%)', () => {
    const d = detail({ currentMonth: { contributions: 1500, manual: 0, wallet: 0, totalChange: 0, fromContribution: 0, fromMarket: 0 } });
    expect(buildMonthProgress(goal(), d)).toMatchObject({ hit: true, remainingLabel: '✓ meta do mês batida', pct: 100 });
  });

  it('meta conquistada ou sem aporte planejado não acompanha o mês', () => {
    expect(buildMonthProgress(goal({ achieved: true }), detail())).toBeNull();
    expect(buildMonthProgress(goal({ monthlyTarget: 0 }), detail())).toBeNull();
  });
});

describe('datas contra o plano', () => {
  it('conquistada: antes/depois do previsto, com singular', () => {
    expect(achievedDeltaText(1)).toBe('1 mês antes do previsto');
    expect(achievedDeltaText(-3)).toBe('3 meses depois do previsto');
    expect(achievedDeltaText(0)).toBeNull();
    expect(achievedDeltaText(null)).toBeNull();
  });

  it('em andamento: adiantado, atrasado ou no plano', () => {
    expect(planDeltaOf(3)).toEqual({ kind: 'ahead', label: '3 meses adiantado' });
    expect(planDeltaOf(-14)).toEqual({ kind: 'behind', label: '1a 2m atrasado' });
    expect(planDeltaOf(0)).toEqual({ kind: 'onPlan', label: 'No plano' });
    expect(planDeltaOf(null)).toBeNull();
  });

  it('diferença de valor com sinal; menos de R$ 1 some', () => {
    expect(sp(valueVsPlanOf(2000))).toEqual({ positive: true, label: '+R$ 2.000,00 vs. plano' });
    expect(sp(valueVsPlanOf(-1500))).toEqual({ positive: false, label: '−R$ 1.500,00 vs. plano' });
    expect(valueVsPlanOf(0.4)).toBeNull();
  });

  it('data prevista por extenso, ou traço', () => {
    expect(projectedDateLabel(goal())).toBe('maio de 2029');
    expect(projectedDateLabel(goal({ projectedDate: null }))).toBe('—');
  });
});

describe('buildStats', () => {
  it('sem prazo: ritmo dos últimos 3 meses', () => {
    const [faltam, planejada, aporte, ritmo] = buildStats(goal(), 900);
    expect(faltam).toMatchObject({ label: 'Faltam', value: '2a 6m', accent: undefined });
    expect(planejada.value).toMatch(/ago\.? de 2029/);
    expect(aporte.label).toBe('Aporte/mês');
    expect(ritmo).toMatchObject({ label: 'Ritmo 3m', icon: 'trend', accent: 'text-emerald-400' });
  });

  it('com prazo: necessário por mês; fora do ritmo acende o amarelo', () => {
    const stats = buildStats(goal({ targetDate: '2028-01-01', requiredMonthlyForDeadline: 2500, onTrack: false }), 900);
    expect(stats[3]).toMatchObject({ label: 'Necessário/mês', icon: 'alert', accent: 'text-yellow-400' });
  });

  it('conquistada mostra "Concluída" em verde', () => {
    expect(buildStats(goal({ achieved: true }), 0)[0]).toMatchObject({ value: 'Concluída', accent: 'text-emerald-400' });
  });
});

describe('buildMonthFacts', () => {
  it('sequência com plural e mercado com sinal', () => {
    expect(sp(buildMonthFacts(detail()))).toEqual({ streak: '3 meses seguidos', market: { positive: true, label: '+R$ 150,00' } });
    const negativo = detail({ streak: 1, currentMonth: { contributions: 0, manual: 0, wallet: 0, totalChange: 0, fromContribution: 0, fromMarket: -20 } });
    expect(sp(buildMonthFacts(negativo))).toEqual({ streak: '1 mês seguidos', market: { positive: false, label: '-R$ 20,00' } });
  });

  it('sem sequência e mês parado, nada a mostrar', () => {
    const parado = detail({ streak: 0, currentMonth: { contributions: 0, manual: 0, wallet: 0, totalChange: 0, fromContribution: 0, fromMarket: 0 } });
    expect(buildMonthFacts(parado)).toEqual({ streak: null, market: null });
  });
});

describe('contributionMeta', () => {
  it('data do aporte e a nota, quando houver', () => {
    expect(contributionMeta('2026-11-10T12:00:00Z', 'bônus')).toBe('10/11/2026 · bônus');
    expect(contributionMeta('2026-11-10T12:00:00Z')).toBe('10/11/2026');
  });
});
