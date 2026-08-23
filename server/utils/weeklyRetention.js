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
import { BUY_THRESHOLD } from '../config/financialConstants.js';
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
  WOULD_DROP_BUY: 'WOULD_DROP_BUY',
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
    thesis: `${label}: na lista desde a apuração anterior (score acima do mínimo para manter a vaga)`
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
      // Copy do LEITOR: o que ele precisa saber é que este ativo está na lista
      // por continuidade, não porque o draft o escolheu de novo.
      reason: `Na lista desde a apuração anterior: score ${finalScore} segue acima do mínimo para manter a vaga (${holdScore})`,
    },
  };
};

/**
 * A CATRACA — a guarda que decide se é lícito tirar AQUELE assento.
 *
 * Achado 1 do card de 23/08/2026, medido na primeira apuração real: no Arrojado
 * de ações COGN3 caiu de 73 para 67, foi retido e, para abrir a vaga, deslocou
 * CSED3, que entrava com 72 e COMPRAR. A regra do 70 não caiu — COGN3 publicou
 * AGUARDAR, como o desenho manda — mas a lista ficou pior pela régua dela mesma:
 * saiu um 72/COMPRAR, entrou um 67/AGUARDAR.
 *
 * Não foi azar. A vítima é o menor score NÃO-incumbente, e a própria retenção
 * deixa a lista quase toda de incumbentes: naquele perfil havia SEIS assentos
 * com score menor que o de CSED3, todos protegidos por serem de incumbentes, e
 * CSED3 era o único deslocável. Quanto mais a retenção funciona, mais o único
 * alvo possível passa a ser justamente quem está chegando — e o teto de
 * `maxRetentionShare` não protege disso: ele limita retenções POR APURAÇÃO, não
 * o travamento acumulado.
 *
 * ── A REGRA ESCOLHIDA, E POR QUE NÃO A OUTRA ───────────────────────────────
 *
 * Vale a de ESCOPO ESTREITO: a readmissão é recusada quando a troca REDUZIRIA O
 * NÚMERO DE COMPRAR da lista — deslocado em COMPRAR, retido abaixo do limiar.
 *
 * A alternativa considerada — nunca deslocar assento com score maior que o do
 * retido — fecha a catraca inteira, mas é ESTRITAMENTE mais restritiva (todo
 * caso que ela barra a mais tem deslocado > retido) e cobra caro onde a
 * retenção mais entrega: um incumbente sai do draft justamente quando fica
 * abaixo do corte, e aí TODO assento não-incumbente pontua acima dele. No
 * Brasil 10 desta apuração ela barraria a única retenção — ABCB4 volta com 77
 * deslocando PSSA3, que pontua 79 — devolvendo o Jaccard de 1,000 para 0,818,
 * abaixo da meta de 0,90.
 *
 * Não confundir com relaxar o piso de permanência: `holdScore` continua 62. O
 * que esta guarda muda é A QUEM é lícito tirar o assento.
 *
 * Como a vítima é o MENOR não-incumbente do perfil, `victim` em COMPRAR implica
 * que TODOS os não-incumbentes estão em COMPRAR: não existe outra vítima que
 * salve a troca, e recusar a readmissão é a única saída coerente.
 */
const canDisplace = (retainedItem, victim) => (
  deriveRankingAction(victim?.score) !== 'BUY' || Number(retainedItem?.score) >= BUY_THRESHOLD
);

/**
 * Texto de saída — todo incumbente não retido sai com motivo escrito.
 *
 * A régua da copy é o LEITOR, não o algoritmo. Na primeira apuração real o FII
 * publicou "PSEC11 — Saiu da lista: todos os assentos do perfil Moderado já são
 * de incumbentes", num ativo com score 85: isso descreve o código, e quem lê
 * conclui que o sistema quebrou. Uma saída que o assinante não entende é pior
 * que uma saída sem texto, porque ocupa espaço prometendo explicação.
 *
 * Daí nenhum destes textos citar "incumbente", "assento", "balde de
 * concentração" ou "teto de retenções" — todos dizem o que aconteceu com o
 * ATIVO. "Score" fica, porque é o vocabulário que a própria lista exibe.
 */
export const describeRetentionExit = ({ outcome, score, holdScore, profile, key, displacedTicker }) => {
  const label = PROFILE_LABEL[profile] || profile;
  switch (outcome) {
    case RETENTION_OUTCOMES.LEFT_UNIVERSE:
      return 'Saiu da lista: não apareceu entre os ativos avaliados nesta apuração';
    case RETENTION_OUTCOMES.BELOW_HOLD:
      return `Saiu da lista: score caiu para ${score}, abaixo do mínimo para manter a vaga (${holdScore})`;
    case RETENTION_OUTCOMES.INELIGIBLE:
      return `Saiu da lista: deixou de atender aos critérios do perfil ${label}`;
    case RETENTION_OUTCOMES.SECTOR_CAP:
      return `Saiu da lista: o perfil ${label} já está no limite de ativos de ${key}`;
    case RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT:
      return `Saiu da lista: não havia vaga no perfil ${label} sem tirar outro ativo que já estava na lista`;
    case RETENTION_OUTCOMES.WOULD_DROP_BUY:
      return displacedTicker
        ? `Saiu da lista: manter a vaga custaria a de ${displacedTicker}, que está em COMPRAR`
        : 'Saiu da lista: manter a vaga custaria a de um ativo que está em COMPRAR';
    case RETENTION_OUTCOMES.BUDGET_EXHAUSTED:
      return 'Saiu da lista: nesta apuração outros ativos de score maior ficaram à frente para manter a vaga';
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
    displacedTicker: entry.displacedTicker,
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
 *   4. o teto de retenções da apuração não estourou;
 *   5. a troca não REDUZ o número de COMPRAR da lista (ver `canDisplace`).
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
 * @param {object} [params.options.sectorCapByProfile]  teto do balde POR PERFIL,
 *   para acompanhar o draft da classe quando ele usa um teto próprio (ações:
 *   4 no Defensivo). Tem precedência sobre `sectorCap`.
 * @param {boolean} [params.options.applyConcentrationPenalty=true]  cobrar do
 *   readmitido a mesma dedução de concentração que o draft da classe cobra.
 *   `false` nas classes cujo draft NÃO penaliza (ações).
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
  // Teto do balde: por perfil quando a classe declara um (ações usam 4 no
  // Defensivo, o mesmo override que `buildCompetitiveCohesiveShadowTop10s` passa
  // ao draft), senão o teto único da config. Sem isso a retenção barra uma
  // readmissão que o próprio draft da classe aceitaria montar — duas réguas.
  const sectorCapFor = (profile) => {
    if (relaxSectorConcentration) return Number.POSITIVE_INFINITY;
    const byProfile = Number(options.sectorCapByProfile?.[profile]);
    if (Number.isFinite(byProfile)) return byProfile;
    return Number.isFinite(options.sectorCap) ? options.sectorCap : config.sectorCap;
  };
  // A dedução de concentração é da RÉGUA DA CLASSE, não da retenção: em ações o
  // draft decide por cap e não reescreve a avaliação fundamental depois da
  // seleção (stockCalibrationShadowEngine), então cobrar -5 de um readmitido
  // colocaria na mesma lista um item pagando o que nenhum outro pagou — e -5 é
  // o bastante para virar 72 em 67, convertendo COMPRAR em AGUARDAR pelo caminho
  // que o motor da classe recusa usar. O módulo compartilhado
  // (utils/concentrationPenalty.js) igualou a TABELA; esta opção iguala o QUANDO.
  const penalizesConcentration = options.applyConcentrationPenalty !== false;

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
    if (occupancy >= sectorCapFor(profile)) {
      profileSeats.splice(victimIdx, 0, victim); // desfaz
      rejected.push({ ...candidate, score, profile, key, outcome: RETENTION_OUTCOMES.SECTOR_CAP });
      continue;
    }

    const isFII = candidate.asset.type === 'FII';
    const penalty = penalizesConcentration
      ? concentrationPenaltyFor({
        sectorCount: occupancy,
        managerCount: isFII ? managerCount(profile, getFiiManager(candidate.asset.ticker)) : 0,
        isFII,
        relaxSectorConcentration,
      })
      : 0;
    const item = buildRetainedItem({
      asset: candidate.asset,
      profile,
      score,
      penalty,
      previous: candidate.prev,
      holdScore,
      displaced: victim,
    });
    if (!canDisplace(item, victim)) {
      profileSeats.splice(victimIdx, 0, victim); // desfaz
      rejected.push({
        ...candidate, score, profile, displacedTicker: victim.ticker,
        outcome: RETENTION_OUTCOMES.WOULD_DROP_BUY,
      });
      continue;
    }
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
    // Mesma guarda da catraca do caso geral (ver `canDisplace`): aqui a metade é
    // de cinco assentos, então trocar um COMPRAR por um AGUARDAR pesa ainda mais.
    if (!canDisplace(item, victim)) {
      half.selected.splice(victimIdx, 0, victim); // desfaz
      rejected.push({
        ...candidate, displacedTicker: victim.ticker,
        outcome: RETENTION_OUTCOMES.WOULD_DROP_BUY,
      });
      continue;
    }
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
