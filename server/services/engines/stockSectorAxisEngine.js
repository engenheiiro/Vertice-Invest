import {
  METRIC_APPLICABILITY,
  STOCK_ARCHETYPES,
  classifyStockArchetype,
  getStockMetricApplicability,
} from '../../config/stockCalibration.js';

const clamp = value => Math.min(100, Math.max(0, Number(value) || 0));

const higherBetter = (value, floor, target) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clamp(((numeric - floor) / (target - floor)) * 100);
};

const lowerBetter = (value, target, ceiling) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clamp(((ceiling - numeric) / (ceiling - target)) * 100);
};

const averageObserved = parts => {
  const observed = parts.filter(part => Number.isFinite(part.value));
  const weight = observed.reduce((total, part) => total + part.weight, 0);
  if (weight === 0) return { score: 0, components: [] };
  return {
    score: Math.round(observed.reduce((total, part) => total + part.value * part.weight, 0) / weight),
    components: observed.map(part => ({
      metric: part.metric,
      value: Math.round(part.value),
      effectiveWeight: Number((part.weight / weight).toFixed(3)),
    })),
  };
};

const part = (metric, value, weight) => ({ metric, value, weight });

const financialEntry = asset => {
  const metrics = asset.metrics || {};
  return averageObserved([
    part('structuralValuation', clamp(metrics.structural?.valuation), 0.25),
    part('pl', Number(metrics.pl) > 0 ? lowerBetter(metrics.pl, 5, 25) : 0, 0.35),
    part('pvp', Number(metrics.pvp) > 0 ? lowerBetter(metrics.pvp, 0.8, 4) : null, 0.25),
    part('dy', higherBetter(metrics.dy, 0, 8), 0.15),
  ]);
};

const operationalAxes = asset => ({
  durability: Math.round(clamp(asset.metrics?.structural?.quality)),
  entry: Math.round(clamp(asset.metrics?.structural?.valuation)),
  resilience: Math.round(clamp(asset.metrics?.structural?.risk)),
  audit: { methodology: 'STRUCTURAL_BASELINE' },
});

const controlResilience = controlType => ({
  PRIVATE: 100,
  DISPERSED: 90,
  STATE_INDIRECT: 65,
  STATE_DIRECT: 45,
})[controlType] ?? null;

const oilGasEntry = asset => {
  const metrics = asset.metrics || {};
  return averageObserved([
    part('structuralValuation', clamp(metrics.structural?.valuation), 0.40),
    part('evEbitda', Number(metrics.evEbitda) > 0 ? lowerBetter(metrics.evEbitda, 3, 12) : null, 0.35),
    part('pvp', Number(metrics.pvp) > 0 ? lowerBetter(metrics.pvp, 0.8, 3) : null, 0.15),
    part('dy', higherBetter(metrics.dy, 0, 8), 0.10),
  ]);
};

/**
 * Remove somente penalidades de missingness para metricas sem significado no
 * arquetipo. NaN funciona como N/A no scorer; nenhum fundamento e inventado.
 */
export const prepareStockForSectorScoring = asset => {
  const prepared = structuredClone(asset);
  prepared.metrics ||= {};
  prepared.metrics._missing = { ...(prepared.metrics._missing || {}) };
  const applicability = getStockMetricApplicability(prepared);

  for (const [metric, status] of Object.entries(applicability)) {
    if (status !== METRIC_APPLICABILITY.NOT_APPLICABLE) continue;
    if (Object.hasOwn(prepared.metrics, metric)) prepared.metrics[metric] = Number.NaN;
    prepared.metrics._missing[metric] = false;
  }

  return prepared;
};

/**
 * `NaN` é um marcador transitório de N/A aceito pelas fórmulas, mas não é um
 * número BSON válido. Converte apenas números não finitos na saída do scorer;
 * zero e valores negativos legítimos permanecem intactos.
 */
export const normalizeStockScoringOutputForPersistence = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(normalizeStockScoringOutputForPersistence);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    normalizeStockScoringOutputForPersistence(nested),
  ]));
};

/**
 * Confiança única da calibração setorial. A cobertura dos campos obrigatórios é
 * o teto; liquidez, macro em fallback e stale reduzem esse teto sem inventar
 * fundamentos. Arquétipos setoriais usam documentos com data própria e, por
 * isso, não herdam o stale genérico do Fundamentus.
 */
export const calculateStockCalibrationConfidence = (asset, coverage, ratesStale = false) => {
  let confidence = 100;
  const isOperational = coverage?.archetype === STOCK_ARCHETYPES.OPERATIONAL;

  if (isOperational && asset.metrics?._missing?.revenueGrowth) confidence -= 25;
  if (isOperational && (asset.metrics?._missing?.roe || asset.metrics?._missing?.netMargin)) confidence -= 15;
  if ((asset.metrics?.avgLiquidity || 0) < 1_000_000) confidence -= 30;
  if (ratesStale) confidence -= 10;

  const staleDays = asset.metrics?._staleDays;
  if (isOperational) {
    if (Number.isFinite(staleDays) && staleDays > 180) confidence -= 30;
    else if (Number.isFinite(staleDays) && staleDays > 90) confidence -= 15;
    else if (staleDays === null || staleDays === undefined) confidence -= 5;
  }

  const coverageCap = Number.isFinite(coverage?.requiredCoverage)
    ? coverage.requiredCoverage
    : 0;
  return Math.max(0, Math.min(coverageCap, confidence));
};

export const calculateStockShadowAxes = asset => {
  const archetype = classifyStockArchetype(asset);
  if (archetype === STOCK_ARCHETYPES.OPERATIONAL) return operationalAxes(asset);

  const sector = asset.sectorMetrics || {};
  const quality = clamp(asset.metrics?.structural?.quality);
  const risk = clamp(asset.metrics?.structural?.risk);
  let durability;
  let resilience;

  if (archetype === STOCK_ARCHETYPES.BANK) {
    durability = averageObserved([
      part('structuralQuality', quality, 0.25),
      part('roeTtm', higherBetter(sector.roeTtm, 8, 25), 0.30),
      part('earningsGrowth', higherBetter(sector.earningsGrowth, -30, 30), 0.20),
      part('operatingCostRatio', lowerBetter(sector.operatingCostRatio, 30, 100), 0.25),
    ]);
    resilience = averageObserved([
      part('structuralRisk', risk, 0.25),
      part('capitalRatio', higherBetter(sector.capitalRatio, 10.5, 18), 0.30),
      part('delinquencyRatio', lowerBetter(sector.delinquencyRatio, 1, 8), 0.25),
      part('problemAssetsRatio', lowerBetter(sector.problemAssetsRatio, 3, 15), 0.20),
    ]);
  } else if (archetype === STOCK_ARCHETYPES.INSURER) {
    durability = averageObserved([
      part('structuralQuality', quality, 0.25),
      part('recurringEarningsGrowth', higherBetter(sector.recurringEarningsGrowth, -20, 25), 0.25),
      part('combinedRatio', lowerBetter(sector.combinedRatio, 85, 105), 0.30),
      part('premiumGrowth', higherBetter(sector.premiumGrowth, -10, 20), 0.20),
    ]);
    resilience = averageObserved([
      part('structuralRisk', risk, 0.20),
      part('solvencyRatio', higherBetter(sector.solvencyRatio, 100, 200), 0.45),
      part('combinedRatio', lowerBetter(sector.combinedRatio, 85, 105), 0.20),
      part('claimsRatio', lowerBetter(sector.claimsRatio, 45, 80), 0.15),
    ]);
  } else if (archetype === STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR) {
    durability = averageObserved([
      part('structuralQuality', quality, 0.35),
      part('recurringEarningsGrowth', higherBetter(sector.recurringEarningsGrowth, -10, 25), 0.25),
      part('distributionRevenueGrowth', higherBetter(sector.distributionRevenueGrowth, -10, 20), 0.20),
      part('investeeCapitalAdequacy', higherBetter(sector.investeeCapitalAdequacy, 100, 180), 0.20),
    ]);
    resilience = averageObserved([
      part('structuralRisk', risk, 0.35),
      part('investeeCapitalAdequacy', higherBetter(sector.investeeCapitalAdequacy, 100, 180), 0.35),
      part('distributionConcentration', lowerBetter(sector.distributionConcentration, 25, 80), 0.30),
    ]);
  } else if (archetype === STOCK_ARCHETYPES.DIVERSIFIED_HOLDING) {
    durability = averageObserved([
      part('structuralQuality', quality, 0.35),
      part('recurringEarningsGrowth', higherBetter(sector.recurringEarningsGrowth, -10, 25), 0.30),
      part('cashRemittanceCoverage', higherBetter(sector.cashRemittanceCoverage, 70, 120), 0.35),
    ]);
    resilience = averageObserved([
      part('structuralRisk', risk, 0.40),
      part('cashRemittanceCoverage', higherBetter(sector.cashRemittanceCoverage, 70, 120), 0.30),
      part('distributionConcentration', lowerBetter(sector.distributionConcentration, 40, 100), 0.30),
    ]);
  } else if (archetype === STOCK_ARCHETYPES.INSURANCE_BROKER) {
    durability = averageObserved([
      part('structuralQuality', quality, 0.35),
      part('recurringEarningsGrowth', higherBetter(sector.recurringEarningsGrowth, -10, 25), 0.25),
      part('commissionRevenueGrowth', higherBetter(sector.commissionRevenueGrowth, -10, 20), 0.40),
    ]);
    resilience = averageObserved([
      part('structuralRisk', risk, 0.55),
      part('partnerConcentration', lowerBetter(sector.partnerConcentration, 20, 80), 0.45),
    ]);
  } else if (archetype === STOCK_ARCHETYPES.OIL_GAS_PRODUCER) {
    durability = averageObserved([
      part('productionGrowth', higherBetter(sector.productionGrowth, -15, 20), 0.25),
      part('liftingCostUsdBoe', lowerBetter(sector.liftingCostUsdBoe, 6, 25), 0.25),
      part('ebitdaMargin', higherBetter(sector.ebitdaMargin, 25, 70), 0.25),
      part('freeCashFlowMargin', higherBetter(sector.freeCashFlowMargin, 0, 25), 0.15),
      part('provedReserveLifeYears', higherBetter(sector.provedReserveLifeYears, 5, 15), 0.10),
    ]);
    resilience = averageObserved([
      part('netDebtEbitda', lowerBetter(sector.netDebtEbitda, 0.5, 3.5), 0.40),
      part('liftingCostUsdBoe', lowerBetter(sector.liftingCostUsdBoe, 6, 25), 0.25),
      part('freeCashFlowMargin', higherBetter(sector.freeCashFlowMargin, 0, 25), 0.15),
      part('provedReserveLifeYears', higherBetter(sector.provedReserveLifeYears, 5, 15), 0.10),
      part('controlType', controlResilience(sector.controlType), 0.10),
    ]);
  } else {
    return operationalAxes(asset);
  }

  const entry = archetype === STOCK_ARCHETYPES.OIL_GAS_PRODUCER
    ? oilGasEntry(asset)
    : financialEntry(asset);
  return {
    durability: durability.score,
    entry: entry.score,
    resilience: resilience.score,
    audit: {
      methodology: 'SECTOR_AXIS_V1',
      archetype,
      durability: durability.components,
      entry: entry.components,
      resilience: resilience.components,
    },
  };
};
