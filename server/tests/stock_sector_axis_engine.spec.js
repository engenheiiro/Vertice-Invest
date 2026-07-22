import { describe, expect, it } from 'vitest';
import {
  calculateStockCalibrationConfidence,
  calculateStockShadowAxes,
  normalizeStockScoringOutputForPersistence,
  prepareStockForSectorScoring,
} from '../services/engines/stockSectorAxisEngine.js';

const base = {
  ticker: 'TEST3',
  metrics: {
    pl: 10,
    pvp: 1.5,
    dy: 6,
    structural: { quality: 60, valuation: 60, risk: 60 },
  },
};

describe('stockSectorAxisEngine', () => {
  it('converte apenas numeros nao finitos antes de persistir', () => {
    const normalized = normalizeStockScoringOutputForPersistence({
      metrics: { netMargin: Number.NaN, evEbitda: Infinity, debt: 0, growth: -5 },
      auditLog: [{ points: 10 }],
    });
    expect(normalized.metrics).toEqual({ netMargin: null, evEbitda: null, debt: 0, growth: -5 });
    expect(normalized.auditLog).toEqual([{ points: 10 }]);
  });
  it('usa cobertura como teto e reduz confiança por liquidez e macro stale', () => {
    const confidence = calculateStockCalibrationConfidence(
      { metrics: { avgLiquidity: 500_000, _staleDays: 10, _missing: {} } },
      { archetype: 'OPERATIONAL', requiredCoverage: 80 },
      true,
    );
    expect(confidence).toBe(60);
  });
  it('marca como N/A apenas metricas inaplicaveis a bancos', () => {
    const prepared = prepareStockForSectorScoring({
      ticker: 'ITUB4',
      sector: 'Bancos',
      stockArchetype: 'BANK',
      metrics: {
        netMargin: 0,
        revenueGrowth: 0,
        roe: 22,
        _missing: { netMargin: true, revenueGrowth: true, roe: false },
      },
    });

    expect(Number.isNaN(prepared.metrics.netMargin)).toBe(true);
    expect(Number.isNaN(prepared.metrics.revenueGrowth)).toBe(true);
    expect(prepared.metrics._missing.netMargin).toBe(false);
    expect(prepared.metrics._missing.revenueGrowth).toBe(false);
    expect(prepared.metrics.roe).toBe(22);
  });

  it('melhora resiliencia bancaria quando capital sobe e inadimplencia cai', () => {
    const weaker = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'BANK',
      sectorMetrics: {
        roeTtm: 20, earningsGrowth: 10, operatingCostRatio: 50,
        capitalRatio: 12, delinquencyRatio: 6, problemAssetsRatio: 10,
      },
    });
    const stronger = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'BANK',
      sectorMetrics: {
        roeTtm: 20, earningsGrowth: 10, operatingCostRatio: 50,
        capitalRatio: 18, delinquencyRatio: 1, problemAssetsRatio: 3,
      },
    });
    expect(stronger.resilience).toBeGreaterThan(weaker.resilience);
  });

  it('premia seguradora com menor indice combinado', () => {
    const weak = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'INSURER',
      sectorMetrics: { recurringEarningsGrowth: 10, solvencyRatio: 180, combinedRatio: 104, claimsRatio: 70 },
    });
    const strong = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'INSURER',
      sectorMetrics: { recurringEarningsGrowth: 10, solvencyRatio: 180, combinedRatio: 88, claimsRatio: 50 },
    });
    expect(strong.durability).toBeGreaterThan(weak.durability);
    expect(strong.resilience).toBeGreaterThan(weak.resilience);
  });

  it('nao usa solvencia para holding diversificada', () => {
    const result = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'DIVERSIFIED_HOLDING',
      sectorMetrics: {
        recurringEarningsGrowth: 17,
        cashRemittanceCoverage: 108,
        distributionConcentration: 98,
        solvencyRatio: 999,
      },
    });
    expect(result.audit.resilience.map(item => item.metric)).not.toContain('solvencyRatio');
  });

  it('premia produtora com menor lifting cost e menor alavancagem', () => {
    const weaker = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'OIL_GAS_PRODUCER',
      sectorMetrics: {
        productionGrowth: 5,
        liftingCostUsdBoe: 22,
        ebitdaMargin: 45,
        netDebtEbitda: 3,
        freeCashFlowMargin: 8,
        controlType: 'PRIVATE',
      },
    });
    const stronger = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'OIL_GAS_PRODUCER',
      sectorMetrics: {
        productionGrowth: 5,
        liftingCostUsdBoe: 8,
        ebitdaMargin: 45,
        netDebtEbitda: 0.8,
        freeCashFlowMargin: 8,
        controlType: 'PRIVATE',
      },
    });

    expect(stronger.durability).toBeGreaterThan(weaker.durability);
    expect(stronger.resilience).toBeGreaterThan(weaker.resilience);
    expect(stronger.audit.entry.map(item => item.metric)).not.toContain('pl');
  });

  it('separa risco de controle estatal da eficiencia operacional', () => {
    const common = {
      productionGrowth: 15,
      liftingCostUsdBoe: 7,
      ebitdaMargin: 55,
      netDebtEbitda: 1,
      freeCashFlowMargin: 15,
    };
    const state = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'OIL_GAS_PRODUCER',
      sectorMetrics: { ...common, controlType: 'STATE_DIRECT' },
    });
    const privateProducer = calculateStockShadowAxes({
      ...base,
      stockArchetype: 'OIL_GAS_PRODUCER',
      sectorMetrics: { ...common, controlType: 'PRIVATE' },
    });

    expect(state.durability).toBe(privateProducer.durability);
    expect(state.resilience).toBeLessThan(privateProducer.resilience);
  });
});
