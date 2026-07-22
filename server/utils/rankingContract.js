import { BUY_THRESHOLD } from '../config/financialConstants.js';

export const RISK_PROFILES = new Set(['DEFENSIVE', 'MODERATE', 'BOLD']);

export const normalizeRankingTicker = (ticker) => String(ticker || '')
  .toUpperCase()
  .replace('.SA', '')
  .replace(/[^A-Z0-9]/g, '')
  .trim();

export const structuralComposite = (item) => {
  const structural = item?.metrics?.structural;
  if (!structural) return 0;
  return (
    (Number(structural.quality) || 0)
    + (Number(structural.valuation) || 0)
    + (Number(structural.risk) || 0)
  ) / 3;
};

export const compareRankingItems = (a, b) => {
  const scoreDiff = (Number(b?.score) || 0) - (Number(a?.score) || 0);
  if (scoreDiff !== 0) return scoreDiff;
  return structuralComposite(b) - structuralComposite(a);
};

export const deriveRankingAction = (score) => (
  Number(score) >= BUY_THRESHOLD ? 'BUY' : 'WAIT'
);

export const finalizeRanking = (items, previousRanking = null) => {
  const previous = new Map((previousRanking || []).map(item => [
    normalizeRankingTicker(item.ticker),
    item.position ?? null,
  ]));

  return (items || [])
    .map(item => (typeof item?.toObject === 'function' ? item.toObject() : { ...item }))
    .map(item => ({ ...item, action: deriveRankingAction(item.score) }))
    .sort(compareRankingItems)
    .map((item, index) => ({
      ...item,
      position: index + 1,
      previousPosition: previousRanking
        ? (previous.get(normalizeRankingTicker(item.ticker)) ?? null)
        : (item.previousPosition ?? null),
    }));
};

export const validateRankingContract = (items, { requireNonEmpty = true } = {}) => {
  const ranking = items || [];
  const errors = [];
  if (requireNonEmpty && ranking.length === 0) errors.push('ranking vazio');

  const seen = new Set();
  ranking.forEach((item, index) => {
    const ticker = normalizeRankingTicker(item.ticker);
    if (!ticker) errors.push(`item ${index + 1} sem ticker`);
    else if (seen.has(ticker)) errors.push(`ticker duplicado: ${ticker}`);
    seen.add(ticker);

    if (!Number.isFinite(Number(item.score))) errors.push(`${ticker || index}: score inválido`);
    if (!RISK_PROFILES.has(item.riskProfile)) errors.push(`${ticker || index}: perfil inválido`);
    if (item.action !== deriveRankingAction(item.score)) {
      errors.push(`${ticker || index}: action incoerente com score`);
    }
    if (item.position !== index + 1) errors.push(`${ticker || index}: posição incoerente`);
    if (index > 0 && compareRankingItems(ranking[index - 1], item) > 0) {
      errors.push(`${ticker || index}: ordenação incoerente`);
    }
  });

  return { ok: errors.length === 0, errors };
};
