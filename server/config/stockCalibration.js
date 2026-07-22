/**
 * Contrato de calibração STOCK em shadow mode.
 *
 * Este módulo não participa do scoring/ranking de produção. Ele formaliza:
 *  - o arquétipo econômico do emissor;
 *  - quais métricas são obrigatórias, opcionais ou não aplicáveis;
 *  - a diferença entre dado ausente e métrica sem significado para o setor.
 */

export const STOCK_ARCHETYPES = Object.freeze({
  OPERATIONAL: 'OPERATIONAL',
  BANK: 'BANK',
  INSURER: 'INSURER',
  INSURANCE_BROKER: 'INSURANCE_BROKER',
  FINANCIAL_HOLDING: 'FINANCIAL_HOLDING',
  INSURANCE_HOLDING_DISTRIBUTOR: 'INSURANCE_HOLDING_DISTRIBUTOR',
  DIVERSIFIED_HOLDING: 'DIVERSIFIED_HOLDING',
  OIL_GAS_PRODUCER: 'OIL_GAS_PRODUCER',
});

export const METRIC_APPLICABILITY = Object.freeze({
  REQUIRED: 'REQUIRED',
  OPTIONAL: 'OPTIONAL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

// Fallback temporário enquanto o arquétipo explícito não existe no MarketAsset.
// O override `asset.stockArchetype` sempre tem precedência sobre esta lista.
const KNOWN_INSURANCE_HOLDINGS = new Set(['BBSE3', 'CXSE3']);
const KNOWN_DIVERSIFIED_HOLDINGS = new Set(['ITSA3', 'ITSA4']);
const KNOWN_INSURANCE_BROKERS = new Set(['WIZC3']);
const KNOWN_OIL_GAS_PRODUCERS = new Set(['PETR3', 'PETR4', 'PRIO3', 'RECV3', 'BRAV3']);

const COMMON = Object.freeze({
  price: METRIC_APPLICABILITY.REQUIRED,
  marketCap: METRIC_APPLICABILITY.REQUIRED,
  avgLiquidity: METRIC_APPLICABILITY.REQUIRED,
  beta: METRIC_APPLICABILITY.OPTIONAL,
  volatility: METRIC_APPLICABILITY.OPTIONAL,
  sma200: METRIC_APPLICABILITY.OPTIONAL,
});

const APPLICABILITY_BY_ARCHETYPE = Object.freeze({
  [STOCK_ARCHETYPES.OPERATIONAL]: Object.freeze({
    ...COMMON,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.REQUIRED,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.REQUIRED,
    revenueGrowth: METRIC_APPLICABILITY.REQUIRED,
    debtToEquity: METRIC_APPLICABILITY.OPTIONAL,
    evEbitda: METRIC_APPLICABILITY.OPTIONAL,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
  }),
  [STOCK_ARCHETYPES.BANK]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.REQUIRED,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.NOT_APPLICABLE,
    revenueGrowth: METRIC_APPLICABILITY.NOT_APPLICABLE,
    debtToEquity: METRIC_APPLICABILITY.NOT_APPLICABLE,
    evEbitda: METRIC_APPLICABILITY.NOT_APPLICABLE,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    roeTtm: METRIC_APPLICABILITY.REQUIRED,
    earningsGrowth: METRIC_APPLICABILITY.REQUIRED,
    delinquencyRatio: METRIC_APPLICABILITY.REQUIRED,
    capitalRatio: METRIC_APPLICABILITY.REQUIRED,
    capitalPrincipalRatio: METRIC_APPLICABILITY.OPTIONAL,
    operatingCostRatio: METRIC_APPLICABILITY.REQUIRED,
    problemAssetsRatio: METRIC_APPLICABILITY.OPTIONAL,
    creditCost: METRIC_APPLICABILITY.OPTIONAL,
    coverageRatio: METRIC_APPLICABILITY.OPTIONAL,
    liquidityCoverage: METRIC_APPLICABILITY.OPTIONAL,
    controlType: METRIC_APPLICABILITY.OPTIONAL,
  }),
  [STOCK_ARCHETYPES.INSURER]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.OPTIONAL,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.OPTIONAL,
    revenueGrowth: METRIC_APPLICABILITY.NOT_APPLICABLE,
    debtToEquity: METRIC_APPLICABILITY.OPTIONAL,
    evEbitda: METRIC_APPLICABILITY.NOT_APPLICABLE,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    recurringEarningsGrowth: METRIC_APPLICABILITY.REQUIRED,
    solvencyRatio: METRIC_APPLICABILITY.REQUIRED,
    combinedRatio: METRIC_APPLICABILITY.REQUIRED,
    claimsRatio: METRIC_APPLICABILITY.OPTIONAL,
    premiumGrowth: METRIC_APPLICABILITY.OPTIONAL,
  }),
  [STOCK_ARCHETYPES.INSURANCE_BROKER]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.OPTIONAL,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.REQUIRED,
    revenueGrowth: METRIC_APPLICABILITY.OPTIONAL,
    debtToEquity: METRIC_APPLICABILITY.OPTIONAL,
    evEbitda: METRIC_APPLICABILITY.OPTIONAL,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    recurringEarningsGrowth: METRIC_APPLICABILITY.REQUIRED,
    commissionRevenueGrowth: METRIC_APPLICABILITY.REQUIRED,
    partnerConcentration: METRIC_APPLICABILITY.OPTIONAL,
  }),
  [STOCK_ARCHETYPES.FINANCIAL_HOLDING]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.OPTIONAL,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.NOT_APPLICABLE,
    revenueGrowth: METRIC_APPLICABILITY.NOT_APPLICABLE,
    debtToEquity: METRIC_APPLICABILITY.OPTIONAL,
    evEbitda: METRIC_APPLICABILITY.NOT_APPLICABLE,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    recurringEarningsGrowth: METRIC_APPLICABILITY.REQUIRED,
    cashRemittanceCoverage: METRIC_APPLICABILITY.REQUIRED,
    capitalAdequacy: METRIC_APPLICABILITY.REQUIRED,
    distributionConcentration: METRIC_APPLICABILITY.OPTIONAL,
    controlType: METRIC_APPLICABILITY.REQUIRED,
  }),
  [STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.OPTIONAL,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.NOT_APPLICABLE,
    revenueGrowth: METRIC_APPLICABILITY.NOT_APPLICABLE,
    debtToEquity: METRIC_APPLICABILITY.OPTIONAL,
    evEbitda: METRIC_APPLICABILITY.NOT_APPLICABLE,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    recurringEarningsGrowth: METRIC_APPLICABILITY.REQUIRED,
    investeeCapitalAdequacy: METRIC_APPLICABILITY.OPTIONAL,
    distributionRevenueGrowth: METRIC_APPLICABILITY.REQUIRED,
    distributionConcentration: METRIC_APPLICABILITY.OPTIONAL,
    controlType: METRIC_APPLICABILITY.REQUIRED,
  }),
  [STOCK_ARCHETYPES.DIVERSIFIED_HOLDING]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.REQUIRED,
    pvp: METRIC_APPLICABILITY.OPTIONAL,
    roe: METRIC_APPLICABILITY.REQUIRED,
    netMargin: METRIC_APPLICABILITY.NOT_APPLICABLE,
    revenueGrowth: METRIC_APPLICABILITY.NOT_APPLICABLE,
    debtToEquity: METRIC_APPLICABILITY.OPTIONAL,
    evEbitda: METRIC_APPLICABILITY.NOT_APPLICABLE,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    recurringEarningsGrowth: METRIC_APPLICABILITY.REQUIRED,
    cashRemittanceCoverage: METRIC_APPLICABILITY.REQUIRED,
    distributionConcentration: METRIC_APPLICABILITY.OPTIONAL,
    controlType: METRIC_APPLICABILITY.REQUIRED,
  }),
  [STOCK_ARCHETYPES.OIL_GAS_PRODUCER]: Object.freeze({
    ...COMMON,
    asOf: METRIC_APPLICABILITY.REQUIRED,
    source: METRIC_APPLICABILITY.REQUIRED,
    sourceDocument: METRIC_APPLICABILITY.REQUIRED,
    methodologyVersion: METRIC_APPLICABILITY.REQUIRED,
    pl: METRIC_APPLICABILITY.OPTIONAL,
    pvp: METRIC_APPLICABILITY.OPTIONAL,
    roe: METRIC_APPLICABILITY.OPTIONAL,
    netMargin: METRIC_APPLICABILITY.NOT_APPLICABLE,
    revenueGrowth: METRIC_APPLICABILITY.NOT_APPLICABLE,
    debtToEquity: METRIC_APPLICABILITY.NOT_APPLICABLE,
    evEbitda: METRIC_APPLICABILITY.OPTIONAL,
    dy: METRIC_APPLICABILITY.OPTIONAL,
    payout: METRIC_APPLICABILITY.OPTIONAL,
    productionGrowth: METRIC_APPLICABILITY.REQUIRED,
    liftingCostUsdBoe: METRIC_APPLICABILITY.REQUIRED,
    ebitdaMargin: METRIC_APPLICABILITY.REQUIRED,
    netDebtEbitda: METRIC_APPLICABILITY.REQUIRED,
    freeCashFlowMargin: METRIC_APPLICABILITY.OPTIONAL,
    provedReserveLifeYears: METRIC_APPLICABILITY.OPTIONAL,
    reserveReplacementRatio: METRIC_APPLICABILITY.OPTIONAL,
    controlType: METRIC_APPLICABILITY.REQUIRED,
  }),
});

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const classifyStockArchetype = (asset = {}) => {
  if (Object.values(STOCK_ARCHETYPES).includes(asset.stockArchetype)) {
    return asset.stockArchetype;
  }

  const ticker = String(asset.ticker || '').trim().toUpperCase();
  if (KNOWN_INSURANCE_HOLDINGS.has(ticker)) return STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR;
  if (KNOWN_DIVERSIFIED_HOLDINGS.has(ticker)) return STOCK_ARCHETYPES.DIVERSIFIED_HOLDING;
  if (KNOWN_INSURANCE_BROKERS.has(ticker)) return STOCK_ARCHETYPES.INSURANCE_BROKER;
  if (KNOWN_OIL_GAS_PRODUCERS.has(ticker)) return STOCK_ARCHETYPES.OIL_GAS_PRODUCER;

  const sector = normalize(asset.sector || asset.metrics?.sector);
  const name = normalize(asset.name);
  if (sector.includes('holding') && sector.includes('financ')) return STOCK_ARCHETYPES.FINANCIAL_HOLDING;
  if (name.includes('seguridade') || name.includes('holding financeira')) return STOCK_ARCHETYPES.FINANCIAL_HOLDING;
  if (name.includes('corretagem de seguros') || sector.includes('corretagem de seguros')) return STOCK_ARCHETYPES.INSURANCE_BROKER;
  if (sector.includes('banco')) return STOCK_ARCHETYPES.BANK;
  if (sector.includes('segur') || sector.includes('previd')) return STOCK_ARCHETYPES.INSURER;
  return STOCK_ARCHETYPES.OPERATIONAL;
};

export const getStockMetricApplicability = (assetOrArchetype) => {
  const archetype = typeof assetOrArchetype === 'string'
    ? assetOrArchetype
    : classifyStockArchetype(assetOrArchetype);
  return APPLICABILITY_BY_ARCHETYPE[archetype] || APPLICABILITY_BY_ARCHETYPE[STOCK_ARCHETYPES.OPERATIONAL];
};

const metricValue = (asset, key) => {
  if (key === 'price') return asset.price ?? asset.currentPrice;
  if (Object.hasOwn(asset.sectorMetrics || {}, key)) return asset.sectorMetrics[key];
  if (Object.hasOwn(asset.metrics?.sectorSpecific || {}, key)) return asset.metrics.sectorSpecific[key];
  return asset.metrics?.[key];
};

const isPresent = (asset, key) => {
  if (asset.metrics?._missing?.[key] === true) return false;
  const value = metricValue(asset, key);
  if (value === null || value === undefined || value === '') return false;
  return typeof value !== 'number' || Number.isFinite(value);
};

export const assessStockMetricCoverage = (asset) => {
  const archetype = classifyStockArchetype(asset);
  const applicability = getStockMetricApplicability(archetype);
  const missingRequired = [];
  const missingOptional = [];
  const notApplicablePresent = [];

  for (const [key, status] of Object.entries(applicability)) {
    const present = isPresent(asset, key);
    if (status === METRIC_APPLICABILITY.REQUIRED && !present) missingRequired.push(key);
    if (status === METRIC_APPLICABILITY.OPTIONAL && !present) missingOptional.push(key);
    if (status === METRIC_APPLICABILITY.NOT_APPLICABLE && present) notApplicablePresent.push(key);
  }

  const requiredCount = Object.values(applicability)
    .filter(status => status === METRIC_APPLICABILITY.REQUIRED).length;
  const observedRequired = requiredCount - missingRequired.length;
  const requiredCoverage = requiredCount === 0 ? 100 : Math.round((observedRequired / requiredCount) * 100);

  return {
    archetype,
    readyForSectorCalibration: missingRequired.length === 0,
    requiredCoverage,
    missingRequired,
    missingOptional,
    notApplicablePresent,
    applicability,
  };
};
