import { describe, expect, it } from 'vitest';
import { validateStockSectorMetrics } from '../schemas/stockSectorMetricsSchemas.js';
import { NON_BANK_SECTOR_METRICS_1Q26 } from '../config/stockSectorMetricsSnapshot1Q26.js';

const provenance = {
  asOf: '2026-03-31',
  source: 'Relações com Investidores',
  sourceDocument: 'https://example.com/results.pdf',
  methodologyVersion: 'TEST_V1',
};

describe('contratos de métricas setoriais STOCK', () => {
  it('aceita payload bancário completo e preserva proveniência', () => {
    const parsed = validateStockSectorMetrics({
      archetype: 'BANK',
      ...provenance,
      roeTtm: 24.8,
      earningsGrowth: 13.2,
      delinquencyRatio: 1.9,
      capitalRatio: 14.8,
      operatingCostRatio: 37.1,
    });
    expect(parsed.archetype).toBe('BANK');
    expect(parsed.asOf).toBeInstanceOf(Date);
    expect(parsed.sourceDocument).toContain('https://');
  });

  it('rejeita banco sem qualidade de crédito ou capital', () => {
    expect(() => validateStockSectorMetrics({
      archetype: 'BANK',
      ...provenance,
      roeTtm: 24.8,
      earningsGrowth: 13.2,
      operatingCostRatio: 37.1,
    })).toThrow();
  });

  it('aceita seguradora operacional com solvência e subscrição', () => {
    const parsed = validateStockSectorMetrics({
      archetype: 'INSURER',
      ...provenance,
      recurringEarningsGrowth: 11,
      solvencyRatio: 180,
      combinedRatio: 92,
      claimsRatio: 58,
    });
    expect(parsed.combinedRatio).toBe(92);
  });

  it('distingue holding financeira de seguradora operacional', () => {
    const parsed = validateStockSectorMetrics({
      archetype: 'FINANCIAL_HOLDING',
      ...provenance,
      recurringEarningsGrowth: 11.2,
      cashRemittanceCoverage: 120,
      capitalAdequacy: 160,
      distributionConcentration: 65,
      controlType: 'STATE_INDIRECT',
    });
    expect(parsed.controlType).toBe('STATE_INDIRECT');
    expect(parsed).not.toHaveProperty('combinedRatio');
  });

  it('distingue holding de seguros/distribuicao de holding diversificada', () => {
    const insuranceHolding = validateStockSectorMetrics({
      archetype: 'INSURANCE_HOLDING_DISTRIBUTOR',
      ...provenance,
      recurringEarningsGrowth: 11.2,
      investeeCapitalAdequacy: 125.8,
      distributionRevenueGrowth: 3.1,
      distributionConcentration: 39.4,
      controlType: 'STATE_INDIRECT',
    });
    const diversified = validateStockSectorMetrics({
      archetype: 'DIVERSIFIED_HOLDING',
      ...provenance,
      recurringEarningsGrowth: 17,
      cashRemittanceCoverage: 107.9,
      distributionConcentration: 98.4,
      controlType: 'PRIVATE',
    });
    expect(insuranceHolding).toHaveProperty('investeeCapitalAdequacy', 125.8);
    expect(insuranceHolding).not.toHaveProperty('cashRemittanceCoverage');
    expect(diversified).toHaveProperty('cashRemittanceCoverage', 107.9);
    expect(diversified).not.toHaveProperty('investeeCapitalAdequacy');
  });

  it('aceita corretora sem métricas prudenciais de seguradora', () => {
    const parsed = validateStockSectorMetrics({
      archetype: 'INSURANCE_BROKER',
      ...provenance,
      recurringEarningsGrowth: 12,
      commissionRevenueGrowth: 8,
      partnerConcentration: 64,
    });
    expect(parsed.archetype).toBe('INSURANCE_BROKER');
    expect(parsed).not.toHaveProperty('combinedRatio');
  });

  it('rejeita campos desconhecidos para evitar ingestão silenciosamente errada', () => {
    expect(() => validateStockSectorMetrics({
      archetype: 'INSURER',
      ...provenance,
      recurringEarningsGrowth: 11,
      solvencyRatio: 180,
      combinedRatio: 92,
      genericRevenueGrowth: 999,
    })).toThrow();
  });
  it('valida integralmente o snapshot oficial nao bancario do 1T26', () => {
    for (const payload of Object.values(NON_BANK_SECTOR_METRICS_1Q26)) {
      expect(() => validateStockSectorMetrics(payload)).not.toThrow();
    }
  });
});
