/**
 * Retenção de ASSENTO do ranking semanal (estratégia `BUY_HOLD`). Função PURA —
 * sem I/O.
 *
 * Ver `config/weeklyHysteresis.js` para o porquê. Em uma frase: o draft é
 * recomputado do zero a cada apuração e decide os assentos puramente pelo score
 * do instante, então um ativo que cai de 71 para 69 perde a vaga para um que
 * subiu de 68 para 70 — sem que nada tenha acontecido com nenhuma das duas
 * empresas. Em 40 publicações o Brasil 10 girou 34 tickers numa lista de dez.
 *
 * ── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────
 *
 * Ele NÃO toca em `action`. `score >= 70 ⇔ COMPRAR` continua valendo item a
 * item, derivado por `deriveRankingAction`, e é o `validateRankingContract` do
 * semanal quem o cobra. Um incumbente retido com score 65 sai daqui **na
 * lista**, rotulado **AGUARDAR** — visível, com o motivo, e sem virar COMPRAR
 * indevido. É por isso que este módulo NÃO espelha `anchorHysteresis.js`, onde
 * um COMPRAR com score 65 é legítimo declarando `HELD`: lá o contrato de
 * ranking é outro.
 *
 * ── IDENTIDADE ENTRE APURAÇÕES ─────────────────────────────────────────────
 *
 * A chave do baseline é o TICKER NORMALIZADO dentro da classe, nunca
 * (ticker, perfil). Um ativo que sai do Defensivo e reaparece no Moderado é
 * RETENÇÃO, não saída + entrada: foram 55 trocas de perfil em ações e 73 em
 * FIIs nas 40 publicações medidas, e chavear por perfil fabricaria 128 saídas
 * fantasmas — inflando exatamente a métrica que este módulo existe para
 * reduzir. O assinante segura um ticker, não um perfil. A mesma chave
 * (`normalizeRankingTicker`) já é a de `calculateRankingDelta`.
 *
 * A regra "um perfil por ticker" continua intocada: ela é sobre a saída de cada
 * apuração, não sobre identidade entre apurações.
 */

import { deriveRankingAction, normalizeRankingTicker } from './rankingContract.js';
import { concentrationPenaltyFor, CONCENTRATION_SCORE_FLOOR } from './concentrationPenalty.js';
import { WEEKLY_HYSTERESIS, weeklyRetentionBudget } from '../config/weeklyHysteresis.js';
import { getConcentrationKey } from '../config/sectorTaxonomy.js';
import { getFiiManager } from '../config/fiiManagerMap.js';

/** Rótulo humano dos perfis, para os motivos de saída. */
export const PROFILE_LABEL = Object.freeze({
  DEFENSIVE: 'Defensivo',
  MODERATE: 'Moderado',
  BOLD: 'Arrojado',
});

/** Ordem canônica dos perfis do semanal. */
export const RETENTION_PROFILES = Object.freeze(['DEFENSIVE', 'MODERATE', 'BOLD']);

/** Desfecho de cada incumbente, para agregar no shadow sem parsear texto. */
export const RETENTION_OUTCOMES = Object.freeze({
  RETAINED: 'RETAINED',
  LEFT_UNIVERSE: 'LEFT_UNIVERSE',
  BELOW_HOLD: 'BELOW_HOLD',
  INELIGIBLE: 'INELIGIBLE',
  SECTOR_CAP: 'SECTOR_CAP',
  NO_DISPLACEABLE_SEAT: 'NO_DISPLACEABLE_SEAT',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
});

const structuralComposite = (asset) => {
  const s = asset?.metrics?.structural;
  if (!s) return 0;
  return ((Number(s.quality) || 0) + (Number(s.valuation) || 0) + (Number(s.risk) || 0)) / 3;
};

/**
 * O gate por perfil. Só o Defensivo tem portão de elegibilidade
 * (`isEligibleForDefensive`, materializado em `isDefensiveEligible` pelo
 * scoringEngine); Moderado e Arrojado aceitam qualquer ativo processado — a
 * mesma leitura que o draft de calibração faz em `eligibleByProfile`.
 */
export const isEligibleForProfile = (asset, profile) => (
  profile === 'DEFENSIVE' ? asset?.isDefensiveEligible !== false : true
);

/** Score do ativo naquele perfil; `null` quando o motor não o produziu. */
const profileScore = (asset, profile) => {
  const raw = Number(asset?.scores?.[profile]);
  return Number.isFinite(raw) ? raw : null;
};

/**
 * Melhor perfil ELEGÍVEL do ativo, ou `null` se ele não passa em nenhum. Perder
 * o portão é fato novo sobre o ativo, não ruído de medição: a saída é imediata e
 * independe do score.
 */
export const bestEligibleProfile = (asset, profiles = RETENTION_PROFILES) => {
  let best = null;
  for (const profile of profiles) {
    if (!isEligibleForProfile(asset, profile)) continue;
    const score = profileScore(asset, profile);
    if (score === null) continue;
    if (!best || score > best.score) best = { profile, score };
  }
  return best;
};

/** Item no formato que o draft produz — o sort/posição adiante não vê diferença. */
const buildRetainedItem = ({ asset, profile, score, penalty, previous, holdScore, displaced }) => {
  const finalScore = penalty > 0 ? Math.max(CONCENTRATION_SCORE_FLOOR, score - penalty) : score;
  const label = PROFILE_LABEL[profile] || profile;
  return {
    ...asset,
    riskProfile: profile,
    score: finalScore,
    // NUNCA um valor próprio: a ação do semanal é derivada do score, ponto.
    action: deriveRankingAction(finalScore),
    tier: 'GOLD',
    thesis: `${label}: assento mantido (incumbente acima do piso de permanência)`
      + (penalty > 0 ? ` | [Penalidade Concentração: -${penalty}]` : ''),
    auditLog: [
      ...(asset.auditLog || []),
      ...(penalty > 0
        ? [{ factor: 'Penalidade de Concentração', points: -penalty, type: 'penalty', category: 'Risco' }]
        : []),
    ],
    retention: {
      retained: true,
      holdScore,
      previousPosition: previous?.position ?? null,
      previousScore: previous?.score ?? null,
      previousProfile: previous?.riskProfile ?? null,
      displaced: displaced ? { ticker: displaced.ticker, score: displaced.score } : null,
      reason: `Assento mantido: score ${finalScore} segue acima do piso de permanência (${holdScore})`,
    },
  };
};

/** Texto de saída — todo incumbente não retido sai com motivo escrito. */
export const describeRetentionExit = ({ outcome, score, holdScore, profile, key }) => {
  const label = PROFILE_LABEL[profile] || profile;
  switch (outcome) {
    case RETENTION_OUTCOMES.LEFT_UNIVERSE:
      return 'Saiu da lista: não apareceu entre os ativos avaliados nesta apuração';
    case RETENTION_OUTCOMES.BELOW_HOLD:
      return `Saiu da lista: score caiu para ${score}, abaixo do piso de permanência (${holdScore})`;
    case RETENTION_OUTCOMES.INELIGIBLE:
      return `Saiu da lista: deixou de ser elegível ao perfil ${label}`;
    case RETENTION_OUTCOMES.SECTOR_CAP:
      return `Saiu da lista: teto de concentração do balde ${key} no perfil ${label}`;
    case RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT:
      return `Saiu da lista: todos os assentos do perfil ${label} já são de incumbentes`;
    case RETENTION_OUTCOMES.BUDGET_EXHAUSTED:
      return 'Saiu da lista: teto de retenções da apuração';
    default:
      return 'Saiu da lista';
  }
};

/**
 * Normaliza o baseline em `Map<tickerNormalizado, {ticker, name, position, score, action, riskProfile}>`.
 * Aceita o Map pronto (de `loadPublishedRankingBaseline`) ou o array cru do
 * documento anterior. `null`/`undefined` significa "não há publicação anterior".
 */
export const toRetentionBaseline = (previous) => {
  if (previous === null || previous === undefined) return null;
  if (previous instanceof Map) return previous;
  const map = new Map();
  for (const item of previous) {
    const ticker = normalizeRankingTicker(item?.ticker);
    if (!ticker) continue;
    map.set(ticker, {
      ticker: item.ticker,
      name: item.name ?? null,
      position: item.position ?? null,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      action: item.action ?? null,
      riskProfile: item.riskProfile ?? null,
    });
  }
  return map;
};

const buildExits = (entries, holdScore, fallbackProfile) => entries.map(entry => ({
  ticker: entry.ticker,
  name: entry.asset?.name || entry.prev?.name || null,
  reason: describeRetentionExit({
    outcome: entry.outcome,
    score: entry.score ?? null,
    holdScore,
    profile: entry.profile || fallbackProfile || entry.prev?.riskProfile,
    key: entry.key,
  }),
  outcome: entry.outcome,
  score: entry.score ?? null,
  previousScore: entry.prev?.score ?? null,
  previousPosition: entry.prev?.position ?? null,
})).sort((a, b) => (a.previousPosition ?? Number.MAX_SAFE_INTEGER)
  - (b.previousPosition ?? Number.MAX_SAFE_INTEGER));

/**
 * RETENÇÃO DE ASSENTO — rankings por perfil (STOCK, FII e qualquer classe que
 * passe pelo draft competitivo).
 *
 * Um incumbente ausente do novo ranking é readmitido quando, CUMULATIVAMENTE:
 *   1. o melhor score dele entre os perfis elegíveis é >= `holdScore`;
 *   2. ele ainda passa no gate do perfil em que entraria;
 *   3. o balde de concentração daquele perfil comporta mais um;
 *   4. o teto de retenções da apuração não estourou.
 *
 * Readmitir desloca o MENOR score NÃO-INCUMBENTE do perfil — ninguém é
 * readmitido por cima de outro incumbente, e o número de assentos por perfil não
 * muda. Os candidatos são processados do maior score para o menor, de modo que,
 * quando o teto morde, quem fica é o incumbente mais forte.
 *
 * @param {object} params
 * @param {Array} params.current  ranking já draftado e penalizado desta apuração.
 * @param {Map|Array|null} params.previous  publicação anterior da MESMA classe.
 *   `null`/`undefined` = primeira apuração (`bootstrap`: não retém ninguém).
 * @param {Array} params.processedAssets  universo processado (com `scores` por
 *   perfil e `isDefensiveEligible`) — de onde os ausentes são recuperados.
 * @param {object} [params.options]
 * @param {object} [params.options.config]  WEEKLY_HYSTERESIS ou equivalente.
 * @param {Array}  [params.options.profiles]  perfis considerados.
 * @param {number} [params.options.sectorCap]  sobrepõe o teto do balde.
 * @param {boolean} [params.options.relaxSectorConcentration]  ranking mono-setor.
 * @returns {{ranking:Array, exits:Array, retained:Array, bootstrap:boolean, counts:object}}
 */
export const applyWeeklyRetention = ({
  current = [],
  previous = null,
  processedAssets = [],
  options = {},
} = {}) => {
  const config = options.config || WEEKLY_HYSTERESIS;
  const { holdScore } = config;
  const profiles = options.profiles || RETENTION_PROFILES;
  const relaxSectorConcentration = !!options.relaxSectorConcentration;
  const sectorCap = relaxSectorConcentration
    ? Number.POSITIVE_INFINITY
    : (Number.isFinite(options.sectorCap) ? options.sectorCap : config.sectorCap);

  const baseline = toRetentionBaseline(previous);
  const bootstrap = baseline === null;
  const seats = current.length;
  const maxRetentions = weeklyRetentionBudget(seats, config);

  if (bootstrap || seats === 0) {
    return {
      ranking: current,
      exits: [],
      retained: [],
      bootstrap,
      counts: { seats, retained: 0, exits: 0, maxRetentions, budgetExhausted: false },
    };
  }

  // Quem já está na lista desta apuração — por ticker normalizado, jamais por
  // (ticker, perfil): trocar de Defensivo para Moderado é retenção, não saída.
  const listed = new Set(current.map(item => normalizeRankingTicker(item.ticker)));
  const universe = new Map();
  for (const asset of processedAssets) {
    const key = normalizeRankingTicker(asset?.ticker);
    if (key && !universe.has(key)) universe.set(key, asset);
  }

  // Estado mutável dos assentos por perfil.
  const seatsByProfile = new Map();
  const extraProfiles = [];
  for (const profile of profiles) seatsByProfile.set(profile, []);
  for (const item of current) {
    const profile = item.riskProfile;
    if (!seatsByProfile.has(profile)) {
      seatsByProfile.set(profile, []);
      extraProfiles.push(profile);
    }
    seatsByProfile.get(profile).push(item);
  }

  const bucketCount = (profile, key) => (seatsByProfile.get(profile) || [])
    .filter(item => getConcentrationKey(item) === key).length;
  const managerCount = (profile, manager) => (seatsByProfile.get(profile) || [])
    .filter(item => item.type === 'FII' && getFiiManager(item.ticker) === manager).length;

  // Candidatos: incumbentes ausentes da lista desta apuração, do mais forte ao
  // mais fraco (o teto de retenções corta a cauda, não o topo).
  const candidates = [];
  const misses = [];
  for (const [ticker, prev] of baseline.entries()) {
    if (listed.has(ticker)) continue;
    const asset = universe.get(ticker);
    if (!asset) {
      misses.push({ ticker, prev, outcome: RETENTION_OUTCOMES.LEFT_UNIVERSE, asset: null, score: null });
      continue;
    }
    const best = bestEligibleProfile(asset, profiles);
    if (!best) {
      misses.push({
        ticker, prev, asset, score: null,
        outcome: RETENTION_OUTCOMES.INELIGIBLE,
        profile: prev?.riskProfile || profiles[0],
      });
      continue;
    }
    if (best.score < holdScore) {
      misses.push({
        ticker, prev, asset, score: best.score,
        outcome: RETENTION_OUTCOMES.BELOW_HOLD, profile: best.profile,
      });
      continue;
    }
    candidates.push({ ticker, prev, asset, best });
  }
  candidates.sort((a, b) => (b.best.score - a.best.score)
    || (structuralComposite(b.asset) - structuralComposite(a.asset)));

  const retained = [];
  const rejected = [];
  let budgetExhausted = false;

  for (const candidate of candidates) {
    const { profile, score } = candidate.best;
    if (retained.length >= maxRetentions) {
      budgetExhausted = true;
      rejected.push({ ...candidate, score, profile, outcome: RETENTION_OUTCOMES.BUDGET_EXHAUSTED });
      continue;
    }
    const profileSeats = seatsByProfile.get(profile) || [];

    // Vítima: o MENOR score entre os NÃO-incumbentes do perfil. Incumbente nunca
    // é deslocado por outro incumbente.
    let victimIdx = -1;
    for (let i = 0; i < profileSeats.length; i += 1) {
      if (baseline.has(normalizeRankingTicker(profileSeats[i].ticker))) continue;
      if (victimIdx === -1 || profileSeats[i].score < profileSeats[victimIdx].score) victimIdx = i;
    }
    if (victimIdx === -1) {
      rejected.push({ ...candidate, score, profile, outcome: RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT });
      continue;
    }

    // Abre a vaga ANTES de medir o balde: se a vítima ocupava o mesmo balde do
    // candidato, a saída dela é justamente o que libera o espaço.
    const [victim] = profileSeats.splice(victimIdx, 1);
    const key = getConcentrationKey(candidate.asset);
    const occupancy = bucketCount(profile, key);
    if (occupancy >= sectorCap) {
      profileSeats.splice(victimIdx, 0, victim); // desfaz
      rejected.push({ ...candidate, score, profile, key, outcome: RETENTION_OUTCOMES.SECTOR_CAP });
      continue;
    }

    const isFII = candidate.asset.type === 'FII';
    const penalty = concentrationPenaltyFor({
      sectorCount: occupancy,
      managerCount: isFII ? managerCount(profile, getFiiManager(candidate.asset.ticker)) : 0,
      isFII,
      relaxSectorConcentration,
    });
    const item = buildRetainedItem({
      asset: candidate.asset,
      profile,
      score,
      penalty,
      previous: candidate.prev,
      holdScore,
      displaced: victim,
    });
    profileSeats.push(item);

    retained.push({
      ticker: candidate.ticker,
      name: candidate.asset.name || candidate.prev?.name || null,
      profile,
      previousProfile: candidate.prev?.riskProfile ?? null,
      previousScore: candidate.prev?.score ?? null,
      rawScore: score,
      penalty,
      score: item.score,
      action: item.action,
      displaced: { ticker: victim.ticker, score: victim.score },
    });
  }

  // Toda saída de incumbente sai com motivo escrito — inclusive as que a
  // retenção recusou. Uma lista que perde um nome em silêncio é pior que uma que
  // o segura: o assinante montou posição com base nela.
  const exits = buildExits([...misses, ...rejected], holdScore);

  const ranking = [...profiles, ...extraProfiles]
    .flatMap(profile => seatsByProfile.get(profile) || []);

  return {
    ranking,
    exits,
    retained,
    bootstrap,
    counts: {
      seats,
      retained: retained.length,
      exits: exits.length,
      maxRetentions,
      budgetExhausted,
    },
  };
};

/**
 * RETENÇÃO DE ASSENTO — Brasil 10.
 *
 * O Brasil 10 não passa pelo draft: ele é, e continua sendo, os 5 melhores FIIs
 * Defensivos + as 5 melhores ações Defensivas. Por isso ganha um passo próprio,
 * com três diferenças em relação ao caso geral:
 *   - o perfil é sempre DEFENSIVE, e o gate é `isDefensiveEligible` — aqui não
 *     existe "cair para o Moderado", então perder o portão é saída de verdade;
 *   - não há balde de concentração (a lista é curinga, não carteira) e por isso
 *     também não há penalidade de concentração;
 *   - os assentos são de DUAS metades fixas (5 ações + 5 FIIs) que a retenção
 *     não pode desbalancear, mas o TETO de retenções é do pool de 10 (3), como
 *     manda o guard-rail. Daí as metades serem explícitas aqui, em vez de a
 *     retenção rodar duas vezes com meio orçamento cada.
 *
 * @param {object} params
 * @param {Array<{selected:Array, universe:Array}>} params.halves  cada metade com
 *   os assentos escolhidos e o universo processado de onde tirá-los.
 * @param {Map|Array|null} params.previous  publicação BRASIL_10 anterior.
 * @param {object} [params.options]
 * @returns {{halves:Array, exits:Array, retained:Array, bootstrap:boolean, counts:object}}
 */
export const applyBrasil10Retention = ({
  halves = [],
  previous = null,
  options = {},
} = {}) => {
  const config = options.config || WEEKLY_HYSTERESIS;
  const { holdScore } = config;
  const baseline = toRetentionBaseline(previous);
  const bootstrap = baseline === null;

  const state = halves.map(half => ({ ...half, selected: [...(half.selected || [])] }));
  const seats = state.reduce((sum, half) => sum + half.selected.length, 0);
  const maxRetentions = weeklyRetentionBudget(seats, config);

  if (bootstrap || seats === 0) {
    return {
      halves: state,
      exits: [],
      retained: [],
      bootstrap,
      counts: { seats, retained: 0, exits: 0, maxRetentions, budgetExhausted: false },
    };
  }

  const listed = new Set(
    state.flatMap(half => half.selected.map(item => normalizeRankingTicker(item.ticker))),
  );

  // Cada incumbente ausente é procurado no universo da SUA metade — um FII nunca
  // disputa assento de ação, e vice-versa: as metades são fixas por design.
  const universes = state.map((half) => {
    const map = new Map();
    for (const asset of (half.universe || [])) {
      const key = normalizeRankingTicker(asset?.ticker);
      if (key && !map.has(key)) map.set(key, asset);
    }
    return map;
  });

  const candidates = [];
  const misses = [];
  for (const [ticker, prev] of baseline.entries()) {
    if (listed.has(ticker)) continue;
    const halfIdx = universes.findIndex(map => map.has(ticker));
    if (halfIdx === -1) {
      misses.push({ ticker, prev, outcome: RETENTION_OUTCOMES.LEFT_UNIVERSE, asset: null, score: null });
      continue;
    }
    const asset = universes[halfIdx].get(ticker);
    if (!isEligibleForProfile(asset, 'DEFENSIVE')) {
      misses.push({ ticker, prev, asset, score: null, outcome: RETENTION_OUTCOMES.INELIGIBLE });
      continue;
    }
    const score = profileScore(asset, 'DEFENSIVE');
    if (score === null || score < holdScore) {
      misses.push({ ticker, prev, asset, score, outcome: RETENTION_OUTCOMES.BELOW_HOLD });
      continue;
    }
    candidates.push({ ticker, prev, asset, score, halfIdx });
  }
  candidates.sort((a, b) => (b.score - a.score)
    || (structuralComposite(b.asset) - structuralComposite(a.asset)));

  const retained = [];
  const rejected = [];
  let budgetExhausted = false;

  for (const candidate of candidates) {
    if (retained.length >= maxRetentions) {
      budgetExhausted = true;
      rejected.push({ ...candidate, outcome: RETENTION_OUTCOMES.BUDGET_EXHAUSTED });
      continue;
    }
    const half = state[candidate.halfIdx];
    let victimIdx = -1;
    for (let i = 0; i < half.selected.length; i += 1) {
      if (baseline.has(normalizeRankingTicker(half.selected[i].ticker))) continue;
      if (victimIdx === -1 || half.selected[i].score < half.selected[victimIdx].score) victimIdx = i;
    }
    if (victimIdx === -1) {
      rejected.push({ ...candidate, outcome: RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT });
      continue;
    }
    const [victim] = half.selected.splice(victimIdx, 1);
    const item = buildRetainedItem({
      asset: candidate.asset,
      profile: 'DEFENSIVE',
      score: candidate.score,
      penalty: 0, // Brasil 10 não penaliza concentração, por design
      previous: candidate.prev,
      holdScore,
      displaced: victim,
    });
    half.selected.push(item);
    retained.push({
      ticker: candidate.ticker,
      name: candidate.asset.name || candidate.prev?.name || null,
      profile: 'DEFENSIVE',
      previousProfile: candidate.prev?.riskProfile ?? null,
      previousScore: candidate.prev?.score ?? null,
      rawScore: candidate.score,
      penalty: 0,
      score: item.score,
      action: item.action,
      displaced: { ticker: victim.ticker, score: victim.score },
    });
  }

  const exits = buildExits([...misses, ...rejected], holdScore, 'DEFENSIVE');

  return {
    halves: state,
    exits,
    retained,
    bootstrap,
    counts: {
      seats,
      retained: retained.length,
      exits: exits.length,
      maxRetentions,
      budgetExhausted,
    },
  };
};
