import { describe, expect, it } from 'vitest';
import {
  archetypeFailures,
  curationFailures,
  quantitativeFailures,
  readMetric,
  upper,
} from '../services/engines/buyAndHoldGateRules.js';
import { BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';

const gate = BUY_AND_HOLD_CONFIG.gate;

describe('buyAndHoldGateRules — regras do portão', () => {
  it('normaliza ticker e prefere sectorMetrics preenchido', () => {
    expect(upper(' itub4 ')).toBe('ITUB4');
    expect(readMetric({ sectorMetrics: { roeTtm: 20 }, metrics: { roeTtm: 5 } }, 'roeTtm')).toBe(20);
    expect(readMetric({ sectorMetrics: { roeTtm: null }, metrics: { roeTtm: 5 } }, 'roeTtm')).toBe(5);
  });

  it('curadoria: denylist, setor cíclico e allowlist só fura o setor', () => {
    const config = { ...BUY_AND_HOLD_CONFIG, denyTickers: ['bad3'], allowTickers: ['vale3'] };
    expect(curationFailures('EGIE3', 'Energia Elétrica', config)).toEqual([]);
    expect(curationFailures('BAD3', 'Energia Elétrica', config)).toEqual(['denylist manual']);
    expect(curationFailures('VALE3', 'Mineração', config)).toEqual(['setor cíclico']);
    expect(curationFailures('XPTO3', undefined, config)).toEqual(['setor fora do universo âncora (desconhecido)']);
  });

  it('quantitativas: dado ausente reprova', () => {
    const ok = { marketCap: 1e10, beta: 0.5, avgLiquidity: 1e7, roe: 15 };
    expect(quantitativeFailures({}, ok, 1, gate)).toEqual([]);
    expect(quantitativeFailures({}, {}, 1, gate)).toHaveLength(4);
    expect(quantitativeFailures({}, { ...ok, beta: 1.1 }, 1.2, gate)).toEqual([]);
  });

  it('arquétipo escolhe a régua: Basileia, solvência ou alavancagem', () => {
    expect(archetypeFailures({ sectorMetrics: { capitalRatio: 12, roeTtm: 9 } }, 'BANK', gate)).toEqual([
      'Basileia abaixo de 13', 'ROE recorrente abaixo de 10',
    ]);
    expect(archetypeFailures({ sectorMetrics: { solvencyRatio: 200, combinedRatio: 101 } }, 'INSURER', gate))
      .toEqual(['combined ratio acima de 100']);
    expect(archetypeFailures({ sectorMetrics: { netDebtEbitda: 3.01 } }, 'OPERATIONAL', gate))
      .toEqual(['netDebt/EBITDA acima de 3']);
    expect(archetypeFailures({}, 'OPERATIONAL', gate)).toEqual([]);
  });
});
