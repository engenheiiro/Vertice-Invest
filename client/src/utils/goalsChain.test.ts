import { describe, it, expect } from 'vitest';
import type { Goal } from '../services/goals';
import {
  buildChains,
  collapsibleAchievedCount,
  journeyTitle,
  partitionChains,
  summarizeGoals,
  toRenderItems,
} from './goalsChain';

const WALLET = 21037.68;

/** Meta espelhada na carteira, o padrão do produto. */
const makeGoal = (over: Partial<Goal> & { _id: string }): Goal =>
  ({
    name: 'Meta',
    icon: 'target',
    color: 'emerald',
    targetAmount: 1000,
    monthlyTarget: 500,
    expectedAnnualRate: 10,
    startDate: '2026-01-01',
    startValue: 0,
    lastCelebratedMilestone: 0,
    previousGoalId: null,
    mirrorWallet: true,
    manualBalance: 0,
    status: 'ACTIVE',
    currentValue: WALLET,
    walletEquity: WALLET,
    remainingAmount: 0,
    progressPct: 100,
    monthsRemaining: 0,
    projectedDate: null,
    plannedDate: null,
    planExpectedNow: 0,
    valueVsPlan: 0,
    dateDeltaMonths: null,
    requiredMonthlyForDeadline: null,
    onTrack: true,
    achieved: false,
    ...over,
  }) as Goal;

/** Jornada encadeada: cada meta aponta para a anterior. */
const makeChain = (ids: string[], over: (i: number) => Partial<Goal> = () => ({})) =>
  ids.map((id, i) =>
    makeGoal({ _id: id, previousGoalId: i === 0 ? null : ids[i - 1], ...over(i) }),
  );

describe('buildChains', () => {
  it('encadeia as metas na ordem de previousGoalId', () => {
    const goals = makeChain(['a', 'b', 'c']);
    expect(buildChains(goals).map((c) => c.map((g) => g._id))).toEqual([['a', 'b', 'c']]);
  });

  it('separa jornadas independentes', () => {
    const goals = [...makeChain(['a', 'b']), ...makeChain(['x', 'y', 'z'])];
    expect(buildChains(goals).map((c) => c.map((g) => g._id))).toEqual([
      ['a', 'b'],
      ['x', 'y', 'z'],
    ]);
  });

  it('trata como avulsa a meta cuja anterior foi excluída', () => {
    const goals = [makeGoal({ _id: 'orfa', previousGoalId: 'sumiu' })];
    expect(buildChains(goals)).toEqual([[goals[0]]]);
  });

  it('não trava se previousGoalId formar um ciclo', () => {
    const a = makeGoal({ _id: 'a', previousGoalId: 'b' });
    const b = makeGoal({ _id: 'b', previousGoalId: 'a' });
    const chains = buildChains([a, b]);
    expect(chains.flat()).toHaveLength(2);
  });
});

describe('summarizeGoals — acumulado com várias jornadas', () => {
  it('conta o patrimônio UMA vez, não uma por jornada', () => {
    // 3 jornadas espelhadas: o usuário tem WALLET, não 3 × WALLET.
    const goals = [
      ...makeChain(['a1', 'a2']),
      ...makeChain(['b1', 'b2', 'b3']),
      ...makeChain(['c1']),
    ];
    const summary = summarizeGoals(goals, buildChains(goals));
    expect(summary.totalCurrent).toBe(WALLET);
  });

  it('soma o saldo manual de cada jornada por cima do patrimônio', () => {
    const espelhada = makeChain(['a1', 'a2']);
    const manual = [
      makeGoal({
        _id: 'm1',
        mirrorWallet: false,
        manualBalance: 5000,
        currentValue: 5000,
        walletEquity: 0,
      }),
    ];
    const goals = [...espelhada, ...manual];
    const summary = summarizeGoals(goals, buildChains(goals));
    expect(summary.totalCurrent).toBe(WALLET + 5000);
  });

  it('soma apenas o alvo final de cada jornada, não os marcos do caminho', () => {
    const goals = makeChain(['a', 'b', 'c'], (i) => ({ targetAmount: [1000, 5000, 20000][i] }));
    const summary = summarizeGoals(goals, buildChains(goals));
    expect(summary.totalTarget).toBe(20000);
  });

  it('zera o acumulado quando nenhuma meta espelha a carteira', () => {
    const goals = [
      makeGoal({ _id: 'm1', mirrorWallet: false, currentValue: 0, walletEquity: 0 }),
    ];
    expect(summarizeGoals(goals, buildChains(goals)).totalCurrent).toBe(0);
  });
});

describe('partitionChains', () => {
  const done = { achieved: true, status: 'ACHIEVED' as const };

  it('separa jornadas vencidas das vivas', () => {
    const viva = makeChain(['v1', 'v2'], (i) => (i === 0 ? done : { monthsRemaining: 5 }));
    const vencida = makeChain(['c1', 'c2'], () => done);
    const { ongoing, completed } = partitionChains([vencida, viva]);
    expect(ongoing.map((c) => c[0]._id)).toEqual(['v1']);
    expect(completed.map((c) => c[0]._id)).toEqual(['c1']);
  });

  it('põe na frente a jornada que chega primeiro ao alvo', () => {
    const longe = makeChain(['x'], () => ({ monthsRemaining: 40 }));
    const perto = makeChain(['y'], () => ({ monthsRemaining: 3 }));
    const meio = makeChain(['z'], () => ({ monthsRemaining: 12 }));
    const { ongoing } = partitionChains([longe, perto, meio]);
    expect(ongoing.map((c) => c[0]._id)).toEqual(['y', 'z', 'x']);
  });

  it('joga para o fim quem não tem ritmo definido', () => {
    // monthsRemaining null = aporte não sustenta o alvo; não pode furar a fila.
    const semRitmo = makeChain(['n'], () => ({ monthsRemaining: null }));
    const comRitmo = makeChain(['s'], () => ({ monthsRemaining: 99 }));
    const { ongoing } = partitionChains([semRitmo, comRitmo]);
    expect(ongoing.map((c) => c[0]._id)).toEqual(['s', 'n']);
  });

  it('ordena as vencidas da conquista mais recente para a mais antiga', () => {
    const velha = makeChain(['old'], () => ({ ...done, achievedAt: '2026-01-10' }));
    const nova = makeChain(['new'], () => ({ ...done, achievedAt: '2026-08-01' }));
    const { completed } = partitionChains([velha, nova]);
    expect(completed.map((c) => c[0]._id)).toEqual(['new', 'old']);
  });

  it('mede o horizonte pela meta viva, não pela última da cadeia', () => {
    // Cadeia com marcos batidos no início: quem manda é a 1ª não conquistada.
    const chain = makeChain(['a', 'b', 'c'], (i) =>
      i === 0 ? done : { monthsRemaining: i === 1 ? 2 : 80 },
    );
    const outra = makeChain(['z'], () => ({ monthsRemaining: 10 }));
    const { ongoing } = partitionChains([outra, chain]);
    expect(ongoing[0][0]._id).toBe('a');
  });
});

describe('toRenderItems', () => {
  it('dá linha própria à jornada e agrupa avulsas de 3 em 3', () => {
    const jornada = makeChain(['j1', 'j2']);
    const avulsas = ['s1', 's2', 's3', 's4'].map((id) => [makeGoal({ _id: id })]);
    const items = toRenderItems([jornada, ...avulsas]);
    expect(items.map((i) => [i.type, i.goals.length])).toEqual([
      ['chain', 2],
      ['singles', 3],
      ['singles', 1],
    ]);
  });
});

describe('journeyTitle', () => {
  it('usa o nome que o usuário deu à jornada', () => {
    const chain = makeChain(['a', 'b'], () => ({ journey: { _id: 'j1', name: 'Aposentadoria' } }));
    expect(journeyTitle(chain)).toBe('Aposentadoria');
  });

  it('basta um marco vinculado — cadeia legada com vínculo parcial', () => {
    const chain = makeChain(['a', 'b', 'c'], (i) =>
      i === 1 ? { journey: { _id: 'j1', name: 'Casa própria' } } : {},
    );
    expect(journeyTitle(chain)).toBe('Casa própria');
  });

  it('sem jornada, cai no nome da meta final', () => {
    const chain = makeChain(['a', 'b'], (i) => ({ name: i === 1 ? 'Primeiro 50 MIL' : 'Primeiro MIL' }));
    expect(journeyTitle(chain)).toBe('Primeiro 50 MIL');
  });

  it('jornada nula não vira título vazio', () => {
    const chain = makeChain(['a', 'b'], (i) => ({ journey: null, name: i === 1 ? 'Alvo final' : 'x' }));
    expect(journeyTitle(chain)).toBe('Alvo final');
  });
});

describe('collapsibleAchievedCount', () => {
  const done = { achieved: true, status: 'ACHIEVED' as const };

  it('recolhe a corrida inicial de conquistadas', () => {
    const chain = makeChain(['a', 'b', 'c', 'd', 'e', 'f'], (i) => (i < 4 ? done : {}));
    expect(collapsibleAchievedCount(chain)).toBe(4);
  });

  it('não recolhe quando há uma conquistada no meio da jornada', () => {
    // Recolher fora do início embaralharia a ordem que as setas afirmam.
    const chain = makeChain(['a', 'b', 'c'], (i) => (i === 0 || i === 2 ? done : {}));
    expect(collapsibleAchievedCount(chain)).toBe(0);
  });

  it('mantém o último marco à vista na jornada 100% concluída', () => {
    const chain = makeChain(['a', 'b', 'c', 'd'], () => done);
    expect(collapsibleAchievedCount(chain)).toBe(3);
  });

  it('não oferece recolher um card só', () => {
    const chain = makeChain(['a', 'b', 'c'], (i) => (i === 0 ? done : {}));
    expect(collapsibleAchievedCount(chain)).toBe(0);
  });

  it('não oferece nada quando nenhuma foi conquistada', () => {
    expect(collapsibleAchievedCount(makeChain(['a', 'b', 'c']))).toBe(0);
  });
});
