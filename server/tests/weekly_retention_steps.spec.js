/**
 * Peças da retenção semanal (utils/weeklyRetentionSteps.js), uma a uma. O
 * comportamento composto está travado em weekly_retention.spec.js e na
 * caracterização; aqui ficam os contratos de cada passo.
 */
import { describe, it, expect } from 'vitest';
import {
  RETENTION_OUTCOMES,
  indexUniverse,
  partitionIncumbents,
  findVictimIndex,
  admitOverVictim,
  runRetentionLoop,
  retentionFrame,
  retentionResult,
} from '../utils/weeklyRetentionSteps.js';

const WEEKLY = { holdScore: 62, maxRetentionShare: 0.3, sectorCap: 3 };

describe('weeklyRetentionSteps', () => {
  it('indexUniverse normaliza o ticker e guarda a primeira ocorrência', () => {
    const first = { ticker: 'petr4.SA', name: 'primeiro' };
    const map = indexUniverse([first, { ticker: 'PETR4', name: 'segundo' }, null, { ticker: '' }]);
    expect([...map.keys()]).toEqual(['PETR4']);
    expect(map.get('PETR4')).toBe(first);
  });

  it('partitionIncumbents ignora os listados e ordena candidatos por score, depois composto estrutural', () => {
    const baseline = new Map([['A', {}], ['B', {}], ['C', {}], ['D', {}], ['E', {}]]);
    const structural = q => ({ structural: { quality: q, valuation: q, risk: q } });
    const assets = {
      B: { score: 70, asset: { metrics: structural(50) } },
      C: { score: 70, asset: { metrics: structural(80) } },
      D: { score: 90, asset: {} },
    };
    const classify = ticker => (assets[ticker] ? { candidate: { ticker, ...assets[ticker] } } : { miss: { ticker } });
    const { candidates, misses } = partitionIncumbents(baseline, new Set(['A']), classify);
    expect(candidates.map(c => c.ticker)).toEqual(['D', 'C', 'B']);
    expect(misses).toEqual([{ ticker: 'E' }]);
  });

  it('findVictimIndex escolhe o menor score não-incumbente e, no empate, o primeiro', () => {
    const baseline = new Map([['INC3', {}]]);
    const seats = [{ ticker: 'X1', score: 75 }, { ticker: 'INC3', score: 40 }, { ticker: 'X2', score: 60 }, { ticker: 'X3', score: 60 }];
    expect(findVictimIndex(seats, baseline)).toBe(2);
    expect(findVictimIndex([{ ticker: 'INC3', score: 1 }], baseline)).toBe(-1);
  });

  it('admitOverVictim recusa trocar um COMPRAR por um AGUARDAR e devolve a vítima ao mesmo índice', () => {
    const victim = { ticker: 'NEW3', score: 72 };
    const seats = [{ ticker: 'A', score: 80 }, { ticker: 'B', score: 90 }];
    const candidate = { ticker: 'OLD3', score: 67, asset: { ticker: 'OLD3' }, prev: null };
    const out = admitOverVictim({ seats, victimIdx: 1, victim, candidate, profile: 'BOLD', penalty: 0, holdScore: 62 });
    expect(out.rejected).toMatchObject({ outcome: RETENTION_OUTCOMES.WOULD_DROP_BUY, displacedTicker: 'NEW3' });
    expect(seats.map(s => s.ticker)).toEqual(['A', 'NEW3', 'B']);
  });

  it('admitOverVictim aceita o retido em COMPRAR, cobra a penalidade e o põe no fim', () => {
    const seats = [{ ticker: 'A', score: 80 }];
    const candidate = { ticker: 'OLD3', score: 80, asset: { ticker: 'OLD3', name: 'Old' }, prev: { riskProfile: 'MODERATE', score: 75 } };
    const out = admitOverVictim({
      seats, victimIdx: 0, victim: { ticker: 'NEW3', score: 72 }, candidate, profile: 'DEFENSIVE', penalty: 5, holdScore: 62,
    });
    expect(out.retained).toMatchObject({ ticker: 'OLD3', rawScore: 80, penalty: 5, score: 75, action: 'BUY', previousProfile: 'MODERATE' });
    expect(seats.map(s => s.ticker)).toEqual(['A', 'OLD3']);
  });

  it('runRetentionLoop para de tentar ao atingir o teto e marca o resto como BUDGET_EXHAUSTED', () => {
    const attempts = [];
    const loop = runRetentionLoop([{ ticker: 'A' }, { ticker: 'B' }, { ticker: 'C' }], 1, (c) => {
      attempts.push(c.ticker);
      return { retained: { ticker: c.ticker } };
    });
    expect(attempts).toEqual(['A']);
    expect(loop.budgetExhausted).toBe(true);
    expect(loop.rejected.map(r => r.outcome)).toEqual(['BUDGET_EXHAUSTED', 'BUDGET_EXHAUSTED']);
  });

  it('retentionFrame pula a primeira apuração e a lista vazia; retentionResult conta o que recebeu', () => {
    expect(retentionFrame(null, 10, WEEKLY)).toEqual({ bootstrap: true, maxRetentions: 3, skip: true });
    expect(retentionFrame(new Map(), 0, WEEKLY).skip).toBe(true);
    expect(retentionFrame(new Map(), 10, WEEKLY).skip).toBe(false);
    const out = retentionResult({ ranking: [] }, { exits: [{}], retained: [{}, {}], bootstrap: false, seats: 7, maxRetentions: 2 });
    expect(Object.keys(out)).toEqual(['ranking', 'exits', 'retained', 'bootstrap', 'counts']);
    expect(out.counts).toEqual({ seats: 7, retained: 2, exits: 1, maxRetentions: 2, budgetExhausted: false });
  });
});
