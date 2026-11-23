/**
 * Peças da confiança da calibração setorial STOCK
 * (`calculateStockCalibrationConfidence` em stockSectorAxisEngine.js).
 *
 * Cada peça devolve um DESCONTO (pontos a subtrair de 100) ou um TETO. A
 * composição — e a regra de que vale o MENOR entre cobertura, descontos e a
 * confiança legada — mora na função principal; ver no CLAUDE.md "Desconto de
 * confiança em AÇÕES é cumulativo" antes de mexer em qualquer número aqui.
 */

const LOW_LIQUIDITY_FLOOR = 1_000_000;

const missingFundamentalsDiscount = missing => {
  let discount = 0;
  if (missing?.revenueGrowth) discount += 25;
  if (missing?.roe || missing?.netMargin) discount += 15;
  return discount;
};

// Fundamentos do Fundamentus sem data contam como levemente velhos; com data,
// o desconto sobe em degraus de 90 e 180 dias.
const staleFundamentalsDiscount = staleDays => {
  if (Number.isFinite(staleDays) && staleDays > 180) return 30;
  if (Number.isFinite(staleDays) && staleDays > 90) return 15;
  if (staleDays === null || staleDays === undefined) return 5;
  return 0;
};

/**
 * Desconto que só o arquétipo OPERATIONAL sofre: lacuna de crescimento/ROE/margem
 * e fundamentos velhos. Os arquétipos setoriais usam documentos com data própria.
 */
export const operationalDiscount = metrics => (
  missingFundamentalsDiscount(metrics?._missing) + staleFundamentalsDiscount(metrics?._staleDays)
);

export const liquidityDiscount = metrics => ((metrics?.avgLiquidity || 0) < LOW_LIQUIDITY_FLOOR ? 30 : 0);

/** A cobertura dos campos obrigatórios é o teto; sem cobertura medida, zero. */
export const coverageCap = coverage => (
  Number.isFinite(coverage?.requiredCoverage) ? coverage.requiredCoverage : 0
);

/**
 * Teto vindo do scorer legado. Ausente (null/undefined) ou não numérico não
 * limita (100). Atenção: `''` vira 0 por `Number('')` e derruba o teto a zero.
 */
export const legacyConfidenceCap = legacyConfidence => {
  if (legacyConfidence === null || legacyConfidence === undefined) return 100;
  const legacy = Number(legacyConfidence);
  return Number.isFinite(legacy) ? legacy : 100;
};
