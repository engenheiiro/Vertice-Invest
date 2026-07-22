import { describe, expect, it } from 'vitest';
import {
  assessBankCollectionForPersistence,
  assessBankMetricsPlausibility,
  deriveBankSectorMetrics,
  trailingQuarterDates,
} from '../services/bcbIfDataService.js';

const row = (NomeColuna, Saldo) => ({ NomeColuna, Saldo });

const summary = (netIncome, equity) => [
  row('Lucro Líquido', netIncome),
  row('Patrimônio Líquido', equity),
];

const income = () => [
  row('Resultado de Intermediação Financeira', 100),
  row('Resultado com Perda Esperada', -20),
  row('Rendas de Tarifas Bancárias', 10),
  row('Outras Rendas de Prestação de Serviços', 10),
  row('Resultado com Transações de Pagamento', 0),
  row('Despesas de Pessoal', -20),
  row('Despesas Administrativas', -10),
];

describe('bcbIfDataService', () => {
  it('gera oito datas trimestrais sem look-ahead', () => {
    expect(trailingQuarterDates(202603, 8)).toEqual([
      202603, 202512, 202509, 202506, 202503, 202412, 202409, 202406,
    ]);
  });

  it('deriva ROE TTM, crescimento, eficiência, capital e crédito', () => {
    const metrics = deriveBankSectorMetrics({
      issuer: 'ABCB',
      baseDate: 202603,
      summaryRows: [
        summary(100, 1000), summary(90, 950), summary(80, 900), summary(70, 850),
        summary(60, 800), summary(50, 760), summary(40, 720), summary(30, 680),
      ],
      incomeRows: [income(), income(), income(), income()],
      capitalRows: [
        row('Índice de Basileia', 0.15),
        row('Índice de Capital Principal', 0.12),
      ],
      creditRows: [
        row('Total Geral', 1000),
        row('Inadimplência', 20),
        row('Ativos problemáticos', 50),
      ],
      collectedAt: new Date('2026-07-20T00:00:00Z'),
    });

    expect(metrics.roeTtm).toBeCloseTo(37.78, 2);
    expect(metrics.earningsGrowth).toBeCloseTo(88.89, 2);
    expect(metrics.operatingCostRatio).toBeCloseTo(21.43, 2);
    expect(metrics.capitalRatio).toBe(15);
    expect(metrics.capitalPrincipalRatio).toBe(12);
    expect(metrics.delinquencyRatio).toBe(2);
    expect(metrics.problemAssetsRatio).toBe(5);
    expect(metrics.controlType).toBe('PRIVATE');
    expect(metrics.asOf.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('rejeita coluna ambígua em vez de escolher saldo silenciosamente', () => {
    expect(() => deriveBankSectorMetrics({
      issuer: 'ABCB',
      baseDate: 202603,
      summaryRows: [
        [row('Lucro Líquido', 100), row('Lucro Líquido', 999), row('Patrimônio Líquido', 1000)],
        ...Array.from({ length: 7 }, () => summary(50, 900)),
      ],
      incomeRows: [income(), income(), income(), income()],
      capitalRows: [row('Índice de Basileia', 0.15)],
      creditRows: [row('Total Geral', 1000), row('Inadimplência', 20)],
    })).toThrow(/ambígua/);
  });
  it('separa valor incomum de valor impossivel', () => {
    const unusual = assessBankMetricsPlausibility({
      roeTtm: 52,
      earningsGrowth: 20,
      delinquencyRatio: 3,
      problemAssetsRatio: 5,
      capitalRatio: 15,
      capitalPrincipalRatio: 11,
      operatingCostRatio: 50,
    });
    expect(unusual.ready).toBe(true);
    expect(unusual.warnings.join(' ')).toMatch(/roeTtm/);

    const impossible = assessBankMetricsPlausibility({
      roeTtm: 20,
      earningsGrowth: 20,
      delinquencyRatio: 350,
      capitalRatio: 15,
      operatingCostRatio: 50,
    });
    expect(impossible.ready).toBe(false);
    expect(impossible.errors.join(' ')).toMatch(/delinquencyRatio/);
  });

  it('bloqueia persistencia quando a coleta esta parcial', () => {
    const assessment = assessBankCollectionForPersistence({
      results: {},
      errors: { ABCB: 'timeout' },
    }, {
      ABCB: { institutionCode: 'one' },
      ITUB: { institutionCode: 'two' },
    });
    expect(assessment.ready).toBe(false);
    expect(assessment.errors.join(' ')).toMatch(/coleta parcial/);
    expect(assessment.errors.join(' ')).toMatch(/emissores ausentes/);
  });
});
