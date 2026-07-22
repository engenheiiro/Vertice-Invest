import { describe, expect, it } from 'vitest';
import { passesBuyAndHoldGate } from '../services/engines/buyAndHoldEngine.js';
import { BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';

// Fixtures ancoradas em dados reais do snapshot 2026-07-20.
const abcb4 = {
  ticker: 'ABCB4', name: 'Banco ABC Brasil S.A.', sector: 'Bancos', stockArchetype: 'BANK', isTier1: false,
  metrics: { marketCap: 6_146_927_400, beta: 0.82, avgLiquidity: 17_453_700, roe: 14.08, structural: { quality: 20, valuation: 100, risk: 60 } },
  sectorMetrics: { roeTtm: 22.19, capitalRatio: 15.83, controlType: 'PRIVATE' },
};

const brav3 = {
  ticker: 'BRAV3', name: 'Brava Energia S.A.', sector: 'Petróleo', stockArchetype: 'OIL_GAS_PRODUCER',
  metrics: { marketCap: 9_128_000_000, beta: 0.80, avgLiquidity: 80_000_000, roe: 2.04, structural: { quality: 0, valuation: 30, risk: 60 } },
  sectorMetrics: { controlType: 'PRIVATE' },
};

const pssa3 = {
  ticker: 'PSSA3', name: 'Porto Seguro S.A.', sector: 'Seguros', stockArchetype: 'INSURER',
  metrics: { marketCap: 35_577_211_000, beta: 0.73, avgLiquidity: 100_000_000, roe: 23.7, structural: { quality: 80, valuation: 55, risk: 80 } },
  sectorMetrics: { solvencyRatio: 152.06, combinedRatio: 88.7, recurringEarningsGrowth: 15, controlType: 'PRIVATE' },
};

describe('passesBuyAndHoldGate', () => {
  it('exclui banco não tier-1 (ABCB4) mesmo com fundamentos fortes', () => {
    const gate = passesBuyAndHoldGate(abcb4, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('banco não tier-1');
  });

  it('exclui setor cíclico (BRAV3 / Petróleo)', () => {
    const gate = passesBuyAndHoldGate(brav3, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('setor cíclico');
  });

  it('aprova seguradora de qualidade no portão (PSSA3)', () => {
    const gate = passesBuyAndHoldGate(pssa3, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
    expect(gate.archetype).toBe('INSURER');
  });

  it('reprova por beta acima do teto', () => {
    const gate = passesBuyAndHoldGate({ ...pssa3, metrics: { ...pssa3.metrics, beta: 1.4 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('beta'))).toBe(true);
  });

  it('reprova por market cap abaixo do piso', () => {
    const gate = passesBuyAndHoldGate({ ...pssa3, metrics: { ...pssa3.metrics, marketCap: 1_000_000_000 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('market cap'))).toBe(true);
  });

  it('respeita allowTickers para setor limítrofe não-cíclico', () => {
    const borderline = {
      ...pssa3, ticker: 'XPTO3', sector: 'Saúde', stockArchetype: 'OPERATIONAL',
      sectorMetrics: { controlType: 'PRIVATE' },
    };
    // 'Saúde' não é cíclico, mas está fora do allowlist de setores âncora.
    expect(passesBuyAndHoldGate(borderline).passed).toBe(false);
    const withAllow = passesBuyAndHoldGate(borderline, { ...BUY_AND_HOLD_CONFIG, allowTickers: ['XPTO3'] });
    expect(withAllow.passed).toBe(true);
  });

  it('respeita denyTickers mesmo com fundamentos aprovados', () => {
    const gate = passesBuyAndHoldGate(pssa3, { ...BUY_AND_HOLD_CONFIG, denyTickers: ['PSSA3'] });
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('denylist manual');
  });
});
