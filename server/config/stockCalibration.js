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

/**
 * Arquétipos cujo balanço é PRUDENCIAL, não industrial: o passivo é o próprio
 * negócio (depósitos, provisões técnicas), então alavancagem contábil e margem
 * líquida no padrão de indústria simplesmente não são publicadas.
 *
 * Existe além da matriz de aplicabilidade porque a matriz responde "esta métrica
 * vale para este arquétipo?" e aqui a pergunta é outra: "um ZERO neste campo é
 * medição ou é campo em branco?". Para uma indústria, `debtToEquity = 0` é uma
 * medição legítima (empresa sem dívida). Para um banco, é o campo vazio — e lido
 * como medição vira "Estrutura de Capital Excelente", que foi exatamente o
 * defeito corrigido em agosto/2026.
 */
export const FINANCIAL_ARCHETYPES = Object.freeze([
  STOCK_ARCHETYPES.BANK,
  STOCK_ARCHETYPES.INSURER,
  STOCK_ARCHETYPES.INSURANCE_BROKER,
  STOCK_ARCHETYPES.FINANCIAL_HOLDING,
  STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR,
  STOCK_ARCHETYPES.DIVERSIFIED_HOLDING,
]);

export const isFinancialArchetype = archetype => FINANCIAL_ARCHETYPES.includes(archetype);

/**
 * Métricas que o SCORER GENÉRICO (scoringEngine) deve tratar como AUSENTES para
 * o arquétipo — o emissor não as publica, ou publica um número que não é
 * comparável ao da mesma métrica numa indústria.
 *
 * NÃO confunda com `APPLICABILITY_BY_ARCHETYPE` acima. Aquela matriz responde
 * "de quais métricas o EIXO SETORIAL deste arquétipo é feito?" e por isso marca
 * `netMargin`/`debtToEquity` como N/A para uma petroleira — não porque uma
 * petroleira não tenha margem ou dívida (tem, e são as duas informativas), mas
 * porque o eixo dela prefere `ebitdaMargin` e `netDebtEbitda`. Reusar aquela
 * matriz aqui derruba a qualidade da PRIO3 de 90 para 60 apagando dois
 * fundamentos perfeitamente legítimos, e apaga da PRIO3 o crescimento de receita
 * de +35,96% que o perfil ARROJADO tinha todo direito de premiar — medido em
 * 22/08/2026.
 *
 * A pergunta AQUI é outra: "este número existe e significa a mesma coisa que
 * significaria numa indústria?". Só o balanço prudencial (banco, seguradora) e a
 * consolidação de holding respondem "não".
 *
 * Fora desta tabela a métrica é tratada como PRESENTE e vale nota. Métrica
 * inaplicável vira AUSENTE — peso redistribuído, nunca nota máxima nem zero, e
 * nunca a PENALIDADE de missingness de um dado que ninguém deixou de coletar.
 */
export const SCORING_NOT_APPLICABLE = Object.freeze({
  // Passivo é o próprio negócio (depósitos): não há "dívida/patrimônio" a
  // comparar. "Receita" de banco oscila com intermediação e marcação, margem
  // líquida no padrão industrial não é publicada, e EBITDA de banco não existe.
  [STOCK_ARCHETYPES.BANK]: Object.freeze(['netMargin', 'debtToEquity', 'revenueGrowth', 'evEbitda']),
  // Provisões técnicas ocupam o lugar da dívida e não há EBITDA de seguradora.
  // Margem sobre prêmios e CRESCIMENTO DE PRÊMIOS, esses sim, são leitura
  // legítima — prêmio emitido é receita de verdade.
  [STOCK_ARCHETYPES.INSURER]: Object.freeze(['debtToEquity', 'evEbitda']),
  // Holdings: o consolidado mistura contabilidade prudencial com industrial.
  [STOCK_ARCHETYPES.FINANCIAL_HOLDING]: Object.freeze(['netMargin', 'debtToEquity', 'revenueGrowth', 'evEbitda']),
  [STOCK_ARCHETYPES.INSURANCE_HOLDING_DISTRIBUTOR]: Object.freeze(['netMargin', 'debtToEquity', 'revenueGrowth', 'evEbitda']),
  [STOCK_ARCHETYPES.DIVERSIFIED_HOLDING]: Object.freeze(['netMargin', 'debtToEquity', 'revenueGrowth', 'evEbitda']),
  // Corretora de seguros e produtora de óleo e gás são, para efeito desta régua,
  // empresas operacionais: margem, alavancagem e crescimento significam o de sempre.
});

/** Lista (nunca `undefined`) de métricas inaplicáveis ao arquétipo. */
export const getScoringNotApplicableMetrics = archetype => SCORING_NOT_APPLICABLE[archetype] || [];

export const isStructuralQualityMetricApplicable = (archetype, metric) => (
  !getScoringNotApplicableMetrics(archetype).includes(metric)
);

/**
 * Onde vive o ROE RECORRENTE por arquétipo, quando existe fonte melhor que o
 * ROE contábil do Fundamentus. Hoje só banco: o IF.data do BCB publica `roeTtm`,
 * e o portão âncora e o eixo de durabilidade JÁ o preferem — o scoringEngine era
 * o único lugar que ainda lia o número deprimido (BBAS3 7,99% contra 13,54%).
 */
export const RECURRING_ROE_FIELD_BY_ARCHETYPE = Object.freeze({
  [STOCK_ARCHETYPES.BANK]: 'roeTtm',
});

/**
 * Régua do ROE RECORRENTE, em rampa contínua (`floor` → nota 0, `cap` → nota 100).
 *
 * Existe porque trocar a FONTE do ROE sem trocar a RÉGUA junto deixou a nota de
 * qualidade de banco sem poder de separação. A escada industrial de
 * `QUALITY_GRADES.roe` (>15 → 100, >10 → 60) foi calibrada para o ROE CONTÁBIL,
 * e o recorrente é sistematicamente ~1,5× maior (razão medida na base em
 * 23/08/2026: mediana 1,52; faixa 1,44–1,98). Aplicar a escada antiga ao número
 * novo faz 10 dos 11 bancos empatarem em 100.
 *
 * RAMPA e não degrau, ao contrário de todo o resto do bloco de qualidade, porque
 * o número de insumos colapsou. Uma indústria é avaliada por quatro métricas: os
 * degraus de cada uma se somam na média e produzem uma grade fina (22 notas
 * distintas entre 179 ações operacionais, medido). Um banco é avaliado por UMA —
 * margem, alavancagem e crescimento de receita são inaplicáveis ao balanço
 * prudencial (ver SCORING_NOT_APPLICABLE) — e sem média não há o que suavizar a
 * quantização: três degraus viram três notas possíveis para o setor inteiro. A
 * rampa devolve resolução equivalente onde a contagem de métricas não permite
 * obtê-la por composição.
 *
 * `floor: 12` fica logo abaixo do juro básico: banco que não bate o risk-free
 * com capital próprio não é "qualidade", é ciclo ruim. `cap: 30` é o topo útil
 * medido — acima disso a distribuição rarefaz (p75 = 32,4 e máximo 51,9, sem
 * nada entre 34,7 e 49,1) e ROE extra deixa de informar sobre durabilidade.
 *
 * PENDÊNCIA anotada, não resolvida aqui: `stockSectorAxisEngine` e
 * `buyAndHoldEngine` avaliam o MESMO `roeTtm` por `higherBetter(roeTtm, 8, 25)`,
 * uma rampa cujo teto de 25 fica ABAIXO do terceiro quartil medido — ela satura
 * 4 dos 11 bancos. Migrar aquelas duas para esta constante é mudança de ranking
 * própria e merece commit próprio.
 */
export const RECURRING_ROE_SCALE_BY_ARCHETYPE = Object.freeze({
  [STOCK_ARCHETYPES.BANK]: Object.freeze({ floor: 12, cap: 30 }),
});

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
