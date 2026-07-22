import { describe, expect, it } from 'vitest';
import {
  METRIC_APPLICABILITY,
  STOCK_ARCHETYPES,
  assessStockMetricCoverage,
  classifyStockArchetype,
  getStockMetricApplicability,
} from '../config/stockCalibration.js';
import {
  buildCohesiveShadowTop10,
  buildCompetitiveCohesiveShadowTop10s,
  calibrateStockCandidate,
  composeCohesiveShadowScore,
} from '../services/engines/stockCalibrationShadowEngine.js';
import MarketAnalysis from '../models/MarketAnalysis.js';

const baseMetrics = {
  marketCap: 100e9,
  avgLiquidity: 100e6,
  beta: 1,
  volatility: 20,
  sma200: 100,
  pl: 10,
  pvp: 1.5,
  roe: 20,
  netMargin: 0,
  revenueGrowth: 0,
  debtToEquity: 0,
  evEbitda: 0,
  dy: 6,
  payout: 50,
  _missing: {},
};

describe('matriz de aplicabilidade STOCK', () => {
  it('classifica bancos, seguradoras e holdings financeiras', () => {
    expect(classifyStockArchetype({ ticker: 'ITUB4', sector: 'Bancos' })).toBe(STOCK_ARCHETYPES.BANK);
    expect(classifyStockArchetype({ ticker: 'PSSA3', sector: 'Seguros' })).toBe(STOCK_ARCHETYPES.INSURER);
    expect(classifyStockArchetype({ ticker: 'WIZC3', sector: 'Seguros' })).toBe(STOCK_ARCHETYPES.INSURANCE_BROKER);
    expect(classifyStockArchetype({ ticker: 'BBSE3', sector: 'Seguros' })).toBe(STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR);
    expect(classifyStockArchetype({ ticker: 'ITSA4', sector: 'Bancos' })).toBe(STOCK_ARCHETYPES.DIVERSIFIED_HOLDING);
    expect(classifyStockArchetype({ ticker: 'PETR4', sector: 'Petroleo' })).toBe(STOCK_ARCHETYPES.OIL_GAS_PRODUCER);
  });

  it('não trata netMargin/revenueGrowth genéricos como obrigatórios para banco', () => {
    const matrix = getStockMetricApplicability(STOCK_ARCHETYPES.BANK);
    expect(matrix.netMargin).toBe(METRIC_APPLICABILITY.NOT_APPLICABLE);
    expect(matrix.revenueGrowth).toBe(METRIC_APPLICABILITY.NOT_APPLICABLE);

    const coverage = assessStockMetricCoverage({
      ticker: 'ITUB4', sector: 'Bancos', price: 40,
      metrics: { ...baseMetrics, _missing: { netMargin: true, revenueGrowth: true } },
      sectorMetrics: {
        asOf: new Date('2026-06-30'),
        source: 'RI Itaú',
        sourceDocument: 'https://example.com/itau-1t26.pdf',
        roeTtm: 24,
        earningsGrowth: 12,
        delinquencyRatio: 1.9,
        capitalRatio: 14.8,
        operatingCostRatio: 37.1,
        methodologyVersion: 'BCB_IFDATA_V1',
      },
    });
    expect(coverage.missingRequired).not.toContain('netMargin');
    expect(coverage.missingRequired).not.toContain('revenueGrowth');
    expect(coverage.readyForSectorCalibration).toBe(true);
  });

  it('mantém margem e crescimento obrigatórios para empresa operacional', () => {
    const coverage = assessStockMetricCoverage({
      ticker: 'TEST3', sector: 'Varejo', price: 20,
      metrics: { ...baseMetrics, _missing: { netMargin: true, revenueGrowth: true } },
    });
    expect(coverage.missingRequired).toEqual(expect.arrayContaining(['netMargin', 'revenueGrowth']));
    expect(coverage.readyForSectorCalibration).toBe(false);
  });

  it('não declara holding pronta sem métricas próprias', () => {
    const coverage = assessStockMetricCoverage({
      ticker: 'BBSE3', sector: 'Seguros', price: 40, metrics: baseMetrics,
    });
    expect(coverage.archetype).toBe(STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR);
    expect(coverage.missingRequired).toEqual(expect.arrayContaining([
      'recurringEarningsGrowth', 'distributionRevenueGrowth', 'controlType',
    ]));
    expect(coverage.readyForSectorCalibration).toBe(false);
  });

  it('não exige solvência ou índice combinado de corretora de seguros', () => {
    const matrix = getStockMetricApplicability(STOCK_ARCHETYPES.INSURANCE_BROKER);
    expect(matrix).not.toHaveProperty('solvencyRatio');
    expect(matrix).not.toHaveProperty('combinedRatio');
    expect(matrix.partnerConcentration).toBe(METRIC_APPLICABILITY.OPTIONAL);
  });

  it('exige fundamentos operacionais comparaveis para produtora de oleo e gas', () => {
    const matrix = getStockMetricApplicability(STOCK_ARCHETYPES.OIL_GAS_PRODUCER);
    expect(matrix.revenueGrowth).toBe(METRIC_APPLICABILITY.NOT_APPLICABLE);
    expect(matrix.debtToEquity).toBe(METRIC_APPLICABILITY.NOT_APPLICABLE);

    const coverage = assessStockMetricCoverage({
      ticker: 'PETR4', sector: 'Petroleo', price: 40, metrics: baseMetrics,
      sectorMetrics: {
        asOf: new Date('2026-03-31'),
        source: 'Petrobras RI',
        sourceDocument: 'https://example.com/petr-1t26.pdf',
        methodologyVersion: 'OFFICIAL_OIL_GAS_1Q26_V1',
        productionGrowth: 16.4,
        liftingCostUsdBoe: 6.4,
        ebitdaMargin: 49.7,
        netDebtEbitda: 1.43,
        controlType: 'STATE_DIRECT',
      },
    });

    expect(coverage.readyForSectorCalibration).toBe(true);
    expect(coverage.missingRequired).not.toContain('revenueGrowth');
    expect(coverage.missingRequired).not.toContain('netMargin');
  });
});

describe('Top 10 shadow coeso', () => {
  it('compõe um único score e preserva monotonicidade dos eixos', () => {
    const lower = composeCohesiveShadowScore({
      profile: 'DEFENSIVE', durability: 70, entry: 60, resilience: 80,
    });
    const higher = composeCohesiveShadowScore({
      profile: 'DEFENSIVE', durability: 80, entry: 60, resilience: 80,
    });
    expect(higher.score).toBeGreaterThan(lower.score);
    expect(Object.keys(higher)).not.toContain('qualityRanking');
    expect(['BUY', 'WAIT']).toContain(higher.action);
  });

  it('usa confiança como teto, sem criar uma segunda recomendação', () => {
    const result = composeCohesiveShadowScore({
      profile: 'DEFENSIVE', durability: 100, entry: 100, resilience: 100, dataConfidence: 59,
    });
    expect(result.score).toBe(70);
    expect(result.action).toBe('BUY');
    expect(result.audit.maxScoreAllowed).toBe(70);
  });

  it('ancora os eixos ao score de perfil para nao inflar a escala de BUY', () => {
    const result = composeCohesiveShadowScore({
      profile: 'DEFENSIVE',
      durability: 100,
      entry: 100,
      resilience: 100,
      baselineScore: 50,
      dataConfidence: 100,
    });

    expect(result.score).toBe(60);
    expect(result.action).toBe('WAIT');
    expect(result.audit.axisScore).toBe(100);
    expect(result.audit.blendWeights).toEqual({ baseline: 0.8, axes: 0.2 });
  });

  it('usa eixos setoriais como fonte primaria para OIL_GAS com cobertura completa', () => {
    const [candidate] = [{
      ticker: 'PETR4',
      name: 'Petrobras',
      sector: 'Petroleo',
      type: 'STOCK',
      archetype: STOCK_ARCHETYPES.OIL_GAS_PRODUCER,
      axes: { durability: 76, entry: 96, resilience: 72 },
      currentScores: { DEFENSIVE: 0, MODERATE: 57, BOLD: 0 },
      dataConfidence: 100,
      coverage: { readyForSectorCalibration: true },
      eligibleByProfile: { DEFENSIVE: false, MODERATE: true, BOLD: false },
      metrics: { structural: { quality: 15, valuation: 100, risk: 80 } },
    }];

    const result = buildCompetitiveCohesiveShadowTop10s([candidate]);
    const row = result.profiles.MODERATE.ranking[0];
    const audit = result.profiles.MODERATE.adminAudit[0];

    expect(row.score).toBe(77);
    expect(row.action).toBe('BUY');
    expect(audit.blendWeights).toEqual({ baseline: 0.2, axes: 0.8 });
    expect(result.selectedItems[0].stockCalibration.version).toBe('STOCK_BH_SHADOW_V3');
    expect(result.calibratedAssets[0].scores.MODERATE).toBe(77);
  });

  it('mantem o score da auditoria completa igual ao usado pelo draft', () => {
    const candidate = {
      ticker: 'AUDT3',
      name: 'Auditavel',
      sector: 'Industria',
      type: 'STOCK',
      axes: { durability: 80, entry: 60, resilience: 70 },
      currentScores: { DEFENSIVE: 75, MODERATE: 70, BOLD: 65 },
      dataConfidence: 100,
      coverage: { readyForSectorCalibration: true, requiredCoverage: 100 },
      eligibleByProfile: { DEFENSIVE: true, MODERATE: true, BOLD: true },
      metrics: { structural: { quality: 80, valuation: 60, risk: 70 } },
      processedAsset: {
        ticker: 'AUDT3',
        auditLog: [{ factor: 'Legado', points: 10, type: 'base', category: 'Perfil Defensivo' }],
      },
    };

    const calibrated = calibrateStockCandidate(candidate);
    const draft = buildCompetitiveCohesiveShadowTop10s([candidate]);
    const selected = draft.selectedItems[0];

    expect(selected.score).toBe(calibrated.scores.DEFENSIVE);
    expect(selected.auditLog.some(entry => entry.factor === 'Legado')).toBe(false);
    expect(selected.auditLog.some(entry => entry.factor.startsWith('Durabilidade'))).toBe(true);
  });

  it('mantem ativo sem cobertura na auditoria, mas o exclui do draft', () => {
    const candidate = {
      ticker: 'GAP3',
      axes: { durability: 100, entry: 100, resilience: 100 },
      currentScores: { DEFENSIVE: 100, MODERATE: 100, BOLD: 100 },
      coverage: { readyForSectorCalibration: false, missingRequired: ['roe'] },
      processedAsset: { ticker: 'GAP3', auditLog: [] },
    };

    const result = buildCompetitiveCohesiveShadowTop10s([candidate]);
    expect(result.selectedItems).toHaveLength(0);
    expect(result.calibratedAssets).toHaveLength(1);
    expect(result.calibratedAssets[0].scores).toEqual({ DEFENSIVE: 0, MODERATE: 0, BOLD: 0 });
    expect(result.calibratedAssets[0].stockCalibration.eligible).toBe(false);
  });

  it('persiste o ativo calibrado sem numeros BSON invalidos', () => {
    const result = buildCompetitiveCohesiveShadowTop10s([{
      ticker: 'PERS3',
      name: 'Persistivel',
      sector: 'Bancos',
      type: 'STOCK',
      axes: { durability: 80, entry: 80, resilience: 80 },
      currentScores: { DEFENSIVE: 80, MODERATE: 70, BOLD: 60 },
      dataConfidence: 100,
      coverage: { readyForSectorCalibration: true, requiredCoverage: 100 },
      eligibleByProfile: { DEFENSIVE: true, MODERATE: true, BOLD: true },
      metrics: {
        netMargin: null,
        revenueGrowth: null,
        structural: { quality: 80, valuation: 80, risk: 80 },
      },
      processedAsset: { ticker: 'PERS3', auditLog: [] },
    }]);
    const document = new MarketAnalysis({
      assetClass: 'STOCK',
      strategy: 'BUY_HOLD',
      content: {
        ranking: result.selectedItems,
        fullAuditLog: result.calibratedAssets,
      },
    });

    expect(document.validateSync()).toBeUndefined();
  });

  it('retorna uma única lista pública, ordenada, única e limitada a 10', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ticker: `T${String(index).padStart(2, '0')}3`,
      name: `Ativo ${index}`,
      sector: 'Teste',
      durability: 90 - index,
      entry: 80 - index,
      resilience: 85 - index,
      dataConfidence: 100,
    }));
    candidates.push({ ...candidates[0], durability: 10, entry: 10, resilience: 10 });

    const result = buildCohesiveShadowTop10(candidates, 'DEFENSIVE');
    expect(result.ranking).toHaveLength(10);
    expect(new Set(result.ranking.map(item => item.ticker)).size).toBe(10);
    expect(result.ranking.map(item => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.ranking.every((item, index, rows) => index === 0 || rows[index - 1].score >= item.score)).toBe(true);
    expect(result.ranking[0]).not.toHaveProperty('durability');
    expect(result.ranking[0]).not.toHaveProperty('entry');
    expect(result.ranking[0]).not.toHaveProperty('resilience');
    expect(result.adminAudit[0]).toHaveProperty('axes');
  });

  it('não força quota de BUY para completar o Top 10', () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      ticker: `W${index}3`, durability: 40, entry: 30, resilience: 50, dataConfidence: 100,
    }));
    const result = buildCohesiveShadowTop10(candidates, 'DEFENSIVE');
    expect(result.ranking).toHaveLength(10);
    expect(result.ranking.every(item => item.action === 'WAIT')).toBe(true);
  });

  it('não publica candidato setorial sem cobertura mínima', () => {
    const result = buildCohesiveShadowTop10([
      {
        ticker: 'READY3', durability: 80, entry: 80, resilience: 80,
        coverage: { readyForSectorCalibration: true },
      },
      {
        ticker: 'GAP3', durability: 100, entry: 100, resilience: 100,
        coverage: { readyForSectorCalibration: false },
      },
    ], 'DEFENSIVE');
    expect(result.ranking.map(item => item.ticker)).toEqual(['READY3']);
  });

  it('faz draft dos tres perfis sem repetir ticker', () => {
    const sectors = [
      'Bancos', 'Elétricas', 'Mineração', 'Construção Civil',
      'Varejo', 'Indústria', 'Tecnologia', 'Saúde',
    ];
    const candidates = Array.from({ length: 40 }, (_, index) => ({
      ticker: `D${String(index).padStart(2, '0')}3`,
      name: `Ativo ${index}`,
      sector: sectors[index % sectors.length],
      type: 'STOCK',
      axes: { durability: 80, entry: 75, resilience: 70 },
      currentScores: {
        DEFENSIVE: 90 - index * 0.5,
        MODERATE: 88 - index * 0.4,
        BOLD: 86 - index * 0.3,
      },
      dataConfidence: 100,
      coverage: { readyForSectorCalibration: true },
      eligibleByProfile: { DEFENSIVE: true, MODERATE: true, BOLD: true },
      metrics: { structural: { quality: 80, valuation: 75, risk: 70 } },
    }));

    const result = buildCompetitiveCohesiveShadowTop10s(candidates);
    const allTickers = Object.values(result.profiles)
      .flatMap(profile => profile.ranking.map(item => item.ticker));

    expect(result.selectedTotal).toBe(30);
    expect(result.uniqueTickers).toBe(30);
    expect(new Set(allTickers).size).toBe(30);
    expect(result.profiles.DEFENSIVE.ranking).toHaveLength(10);
    expect(result.profiles.MODERATE.ranking).toHaveLength(10);
    expect(result.profiles.BOLD.ranking).toHaveLength(10);
  });

  it('nao reduz score nem action por concentracao depois do draft STOCK', () => {
    const candidates = ['A', 'B', 'C', 'D'].map((prefix, index) => ({
      ticker: `${prefix}FIN3`,
      name: prefix,
      sector: 'Bancos',
      type: 'STOCK',
      axes: { durability: 80, entry: 80, resilience: 80 },
      currentScores: { DEFENSIVE: 80 - index, MODERATE: 0, BOLD: 0 },
      dataConfidence: 100,
      coverage: { readyForSectorCalibration: true },
      eligibleByProfile: { DEFENSIVE: true, MODERATE: true, BOLD: true },
      metrics: { structural: { quality: 80, valuation: 80, risk: 80 } },
    }));

    const result = buildCompetitiveCohesiveShadowTop10s(candidates);
    const fourth = result.profiles.DEFENSIVE.ranking.find(item => item.ticker === 'DFIN3');
    const audit = result.profiles.DEFENSIVE.adminAudit.find(item => item.ticker === 'DFIN3');

    expect(fourth.score).toBe(78);
    expect(fourth.action).toBe('BUY');
    expect(audit.concentrationPenalty).toBe(0);
  });
});
