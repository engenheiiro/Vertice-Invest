import { BUY_THRESHOLD } from '../config/financialConstants.js';
import { ANCHOR_HYSTERESIS, ANCHOR_RISK_PROFILE, ANCHOR_STRATEGY } from '../config/buyAndHoldPublication.js';

export const RISK_PROFILES = new Set(['DEFENSIVE', 'MODERATE', 'BOLD']);

export const normalizeRankingTicker = (ticker) => String(ticker || '')
  .toUpperCase()
  .replace('.SA', '')
  .replace(/[^A-Z0-9]/g, '')
  .trim();

export const structuralComposite = (item) => {
  // A lista âncora não tem os eixos estruturais do semanal: ela pontua
  // durabilidade/resiliência/consistência. Este ramo vem PRIMEIRO porque o
  // RankingItemSchema aplica defaults 50/50/50 em `metrics.structural` para
  // qualquer item salvo — inclusive os âncora, que nunca os preencheram. Ler
  // structural primeiro daria composite 50 a todos eles e o desempate viraria
  // "primeiro que apareceu", divergindo da ordem que o motor já produziu.
  const axes = item?.anchor?.axes;
  if (axes) {
    return (
      (Number(axes.durability) || 0)
      + (Number(axes.resilience) || 0)
      + (Number(axes.consistency) || 0)
    ) / 3;
  }
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

/**
 * CONTRATOS DE RANKING POR ESTRATÉGIA.
 *
 * O contrato do semanal (`BUY_HOLD`) é `score >= 70 ⇔ BUY`, derivado
 * centralmente: a `action` é CALCULADA a partir do score, e a validação recusa
 * qualquer divergência. Isso é inviolável e não muda.
 *
 * A estratégia âncora (`BUY_AND_HOLD`) tem outro contrato — mais restritivo, não
 * mais frouxo. Nela um ativo pode ter score alto e ainda assim ficar em
 * AGUARDAR (preço acima do justo, distribuição não coberta pelo FFO, teto de
 * composição da carteira), e pode ficar em COMPRAR com score na banda de
 * permanência da histerese. Derivar `action` do score ali seria errado, e
 * afrouxar a validação do semanal para acomodá-la destruiria a garantia que ela
 * existe para dar. Por isso o contrato é PARAMÉTRICO: cada estratégia declara
 * seu conjunto de perfis e sua própria regra de coerência entre score e action.
 */
export const RANKING_CONTRACTS = Object.freeze({
  BUY_HOLD: Object.freeze({
    profiles: RISK_PROFILES,
    // `action` é derivada do score; qualquer divergência é erro de contrato.
    checkAction: (item) => (
      item.action !== deriveRankingAction(item.score)
        ? 'action incoerente com score'
        : null
    ),
  }),
  [ANCHOR_STRATEGY]: Object.freeze({
    profiles: new Set([ANCHOR_RISK_PROFILE]),
    checkAction: (item) => {
      if (item.action !== 'BUY' && item.action !== 'WAIT') return 'action inválida';
      if (item.action === 'BUY') {
        const score = Number(item.score);
        const held = item.anchor?.hysteresis?.state === 'HELD';
        // COMPRAR abaixo do limiar de entrada só é legítimo pela banda de
        // permanência, e só declarando-a. Sem isso, o limiar de 70 estaria
        // sendo furado em silêncio.
        const floor = held ? ANCHOR_HYSTERESIS.holdScore : BUY_THRESHOLD;
        if (!(score >= floor)) {
          return held
            ? `BUY mantido pela histerese com score abaixo do piso de permanência (${ANCHOR_HYSTERESIS.holdScore})`
            : `BUY com score abaixo do limiar de entrada (${BUY_THRESHOLD})`;
        }
      }
      // AGUARDAR com score alto é legítimo aqui (preço/composição/cobertura),
      // mas precisa dizer por quê — a lista âncora não descarta em silêncio.
      if (item.action === 'WAIT' && !String(item.reason || '').trim()) {
        return 'WAIT sem motivo escrito';
      }
      return null;
    },
  }),
});

export const contractForStrategy = (strategy) => RANKING_CONTRACTS[strategy] || RANKING_CONTRACTS.BUY_HOLD;

/**
 * Ordena, posiciona e (no semanal) deriva a `action`.
 *
 * Na estratégia âncora a `action` vem pronta do motor + histerese e é
 * PRESERVADA: recalculá-la aqui apagaria o freio de preço e a banda de
 * permanência, transformando a lista âncora num screener de score.
 */
export const finalizeRanking = (items, previousRanking = null, { strategy = 'BUY_HOLD' } = {}) => {
  const previous = new Map((previousRanking || []).map(item => [
    normalizeRankingTicker(item.ticker),
    item.position ?? null,
  ]));
  const derivesAction = strategy !== ANCHOR_STRATEGY;

  return (items || [])
    .map(item => (typeof item?.toObject === 'function' ? item.toObject() : { ...item }))
    .map(item => (derivesAction ? { ...item, action: deriveRankingAction(item.score) } : item))
    .sort(compareRankingItems)
    .map((item, index) => ({
      ...item,
      position: index + 1,
      previousPosition: previousRanking
        ? (previous.get(normalizeRankingTicker(item.ticker)) ?? null)
        : (item.previousPosition ?? null),
    }));
};

export const validateRankingContract = (items, { requireNonEmpty = true, strategy = 'BUY_HOLD' } = {}) => {
  const ranking = items || [];
  const contract = contractForStrategy(strategy);
  const errors = [];
  if (requireNonEmpty && ranking.length === 0) errors.push('ranking vazio');

  const seen = new Set();
  ranking.forEach((item, index) => {
    const ticker = normalizeRankingTicker(item.ticker);
    if (!ticker) errors.push(`item ${index + 1} sem ticker`);
    else if (seen.has(ticker)) errors.push(`ticker duplicado: ${ticker}`);
    seen.add(ticker);

    if (!Number.isFinite(Number(item.score))) errors.push(`${ticker || index}: score inválido`);
    if (!contract.profiles.has(item.riskProfile)) errors.push(`${ticker || index}: perfil inválido`);
    const actionError = contract.checkAction(item);
    if (actionError) errors.push(`${ticker || index}: ${actionError}`);
    if (item.position !== index + 1) errors.push(`${ticker || index}: posição incoerente`);
    if (index > 0 && compareRankingItems(ranking[index - 1], item) > 0) {
      errors.push(`${ticker || index}: ordenação incoerente`);
    }
  });

  return { ok: errors.length === 0, errors };
};
