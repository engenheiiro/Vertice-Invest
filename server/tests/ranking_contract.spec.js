import { describe, expect, it } from 'vitest';
import {
  deriveRankingAction,
  finalizeRanking,
  validateRankingContract,
} from '../utils/rankingContract.js';

const item = (ticker, score, quality = 50) => ({
  ticker,
  score,
  action: score >= 70 ? 'BUY' : 'WAIT',
  riskProfile: 'DEFENSIVE',
  metrics: { structural: { quality, valuation: quality, risk: quality } },
});

describe('rankingContract', () => {
  it('rederiva action, aplica desempate estrutural e renumera', () => {
    const out = finalizeRanking([
      { ...item('LOW3', 80, 40), action: 'WAIT' },
      item('HIGH3', 80, 90),
      { ...item('WAIT3', 69), action: 'BUY' },
    ]);
    expect(out.map(x => x.ticker)).toEqual(['HIGH3', 'LOW3', 'WAIT3']);
    expect(out.map(x => x.position)).toEqual([1, 2, 3]);
    expect(out.map(x => x.action)).toEqual(['BUY', 'BUY', 'WAIT']);
    expect(validateRankingContract(out)).toEqual({ ok: true, errors: [] });
  });

  it('preserva previousPosition contra baseline publicado informado', () => {
    const out = finalizeRanking([item('AAA3', 90), item('NEW3', 80)], [
      { ticker: 'AAA3', position: 7 },
    ]);
    expect(out.map(x => x.previousPosition)).toEqual([7, null]);
  });

  it('detecta duplicata e action incoerente', () => {
    const invalid = [
      { ...item('AAA3', 80), position: 1, action: 'WAIT' },
      { ...item('AAA3', 70), position: 2 },
    ];
    const result = validateRankingContract(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('duplicado');
    expect(result.errors.join(' ')).toContain('action incoerente');
    expect(deriveRankingAction(70)).toBe('BUY');
    expect(deriveRankingAction(69)).toBe('WAIT');
  });
});
