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
 *
 * As peças (gate, vítima, catraca, textos de saída) moram em
 * `weeklyRetentionSteps.js`; aqui ficam as duas composições e o que é próprio de
 * cada uma.
 */

import { normalizeRankingTicker } from './rankingContract.js';
import { concentrationPenaltyFor } from './concentrationPenalty.js';
import { WEEKLY_HYSTERESIS } from '../config/weeklyHysteresis.js';
import { getConcentrationKey } from '../config/sectorTaxonomy.js';
import { getFiiManager } from '../config/fiiManagerMap.js';
import {
  RETENTION_PROFILES,
  RETENTION_OUTCOMES,
  isEligibleForProfile,
  profileScore,
  bestEligibleProfile,
  toRetentionBaseline,
  indexUniverse,
  leftUniverse,
  partitionIncumbents,
  findVictimIndex,
  reject,
  admitOverVictim,
  runRetentionLoop,
  buildExits,
  retentionFrame,
  retentionResult,
} from './weeklyRetentionSteps.js';

export {
  PROFILE_LABEL,
  RETENTION_PROFILES,
  RETENTION_OUTCOMES,
  isEligibleForProfile,
  bestEligibleProfile,
  describeRetentionExit,
  toRetentionBaseline,
} from './weeklyRetentionSteps.js';

// Teto do balde: por perfil quando a classe declara um (ações usam 4 no
// Defensivo, o mesmo override que `buildCompetitiveCohesiveShadowTop10s` passa
// ao draft), senão o teto único da config. Sem isso a retenção barra uma
// readmissão que o próprio draft da classe aceitaria montar — duas réguas.
const sectorCapResolver = (options, config, relaxSectorConcentration) => (profile) => {
  if (relaxSectorConcentration) return Number.POSITIVE_INFINITY;
  const byProfile = Number(options.sectorCapByProfile?.[profile]);
  if (Number.isFinite(byProfile)) return byProfile;
  return Number.isFinite(options.sectorCap) ? options.sectorCap : config.sectorCap;
};

const weeklySettings = (options) => {
  const config = options.config || WEEKLY_HYSTERESIS;
  const relaxSectorConcentration = !!options.relaxSectorConcentration;
  return {
    config,
    holdScore: config.holdScore,
    profiles: options.profiles || RETENTION_PROFILES,
    relaxSectorConcentration,
    sectorCapFor: sectorCapResolver(options, config, relaxSectorConcentration),
    // A dedução de concentração é da RÉGUA DA CLASSE, não da retenção: em ações o
    // draft decide por cap e não reescreve a avaliação fundamental depois da
    // seleção (stockCalibrationShadowEngine), então cobrar -5 de um readmitido
    // colocaria na mesma lista um item pagando o que nenhum outro pagou — e -5 é
    // o bastante para virar 72 em 67, convertendo COMPRAR em AGUARDAR pelo caminho
    // que o motor da classe recusa usar. O módulo compartilhado
    // (utils/concentrationPenalty.js) igualou a TABELA; esta opção iguala o QUANDO.
    penalizesConcentration: options.applyConcentrationPenalty !== false,
  };
};

/** Estado mutável dos assentos por perfil; perfis fora da lista vão para o fim. */
const groupSeatsByProfile = (current, profiles) => {
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
  return { seatsByProfile, order: [...profiles, ...extraProfiles] };
};

const bucketCount = (seats, key) => seats.filter(item => getConcentrationKey(item) === key).length;
const managerCount = (seats, manager) => seats
  .filter(item => item.type === 'FII' && getFiiManager(item.ticker) === manager).length;

/** Incumbente ausente → candidato pelo MELHOR perfil elegível, ou saída imediata. */
const classifyWeekly = (universe, { profiles, holdScore }) => (ticker, prev) => {
  const asset = universe.get(ticker);
  if (!asset) return { miss: leftUniverse(ticker, prev) };
  const best = bestEligibleProfile(asset, profiles);
  if (!best) {
    return {
      miss: {
        ticker, prev, asset, score: null,
        outcome: RETENTION_OUTCOMES.INELIGIBLE,
        profile: prev?.riskProfile || profiles[0],
      },
    };
  }
  if (best.score < holdScore) {
    return {
      miss: {
        ticker, prev, asset, score: best.score,
        outcome: RETENTION_OUTCOMES.BELOW_HOLD, profile: best.profile,
      },
    };
  }
  return { candidate: { ticker, prev, asset, score: best.score, profile: best.profile } };
};

const readmissionPenalty = (asset, seats, occupancy, settings) => {
  if (!settings.penalizesConcentration) return 0;
  const isFII = asset.type === 'FII';
  return concentrationPenaltyFor({
    sectorCount: occupancy,
    managerCount: isFII ? managerCount(seats, getFiiManager(asset.ticker)) : 0,
    isFII,
    relaxSectorConcentration: settings.relaxSectorConcentration,
  });
};

const attemptWeekly = ({ baseline, seatsByProfile, ...settings }) => (candidate) => {
  const { profile } = candidate;
  const profileSeats = seatsByProfile.get(profile) || [];
  const victimIdx = findVictimIndex(profileSeats, baseline);
  if (victimIdx === -1) return reject(candidate, RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT);

  // Abre a vaga ANTES de medir o balde: se a vítima ocupava o mesmo balde do
  // candidato, a saída dela é justamente o que libera o espaço.
  const [victim] = profileSeats.splice(victimIdx, 1);
  const key = getConcentrationKey(candidate.asset);
  const occupancy = bucketCount(profileSeats, key);
  if (occupancy >= settings.sectorCapFor(profile)) {
    profileSeats.splice(victimIdx, 0, victim); // desfaz
    return reject(candidate, RETENTION_OUTCOMES.SECTOR_CAP, { key });
  }
  const penalty = readmissionPenalty(candidate.asset, profileSeats, occupancy, settings);
  return admitOverVictim({
    seats: profileSeats, victimIdx, victim, candidate, profile, penalty, holdScore: settings.holdScore,
  });
};

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
  const settings = weeklySettings(options);
  const baseline = toRetentionBaseline(previous);
  const seats = current.length;
  const frame = retentionFrame(baseline, seats, settings.config);
  if (frame.skip) return retentionResult({ ranking: current }, { ...frame, seats });

  // Quem já está na lista desta apuração — por ticker normalizado, jamais por
  // (ticker, perfil): trocar de Defensivo para Moderado é retenção, não saída.
  const listed = new Set(current.map(item => normalizeRankingTicker(item.ticker)));
  const universe = indexUniverse(processedAssets);
  const { seatsByProfile, order } = groupSeatsByProfile(current, settings.profiles);

  const { candidates, misses } = partitionIncumbents(baseline, listed, classifyWeekly(universe, settings));
  const loop = runRetentionLoop(
    candidates,
    frame.maxRetentions,
    attemptWeekly({ ...settings, baseline, seatsByProfile }),
  );

  // Toda saída de incumbente sai com motivo escrito — inclusive as que a
  // retenção recusou. Uma lista que perde um nome em silêncio é pior que uma que
  // o segura: o assinante montou posição com base nela.
  const exits = buildExits([...misses, ...loop.rejected], settings.holdScore);
  const ranking = order.flatMap(profile => seatsByProfile.get(profile) || []);

  return retentionResult({ ranking }, {
    exits,
    retained: loop.retained,
    bootstrap: frame.bootstrap,
    seats,
    maxRetentions: frame.maxRetentions,
    budgetExhausted: loop.budgetExhausted,
  });
};

/**
 * Cada incumbente ausente é procurado no universo da SUA metade — um FII nunca
 * disputa assento de ação, e vice-versa: as metades são fixas por design.
 */
const classifyBrasil10 = (universes, holdScore) => (ticker, prev) => {
  const halfIdx = universes.findIndex(map => map.has(ticker));
  if (halfIdx === -1) return { miss: leftUniverse(ticker, prev) };
  const asset = universes[halfIdx].get(ticker);
  if (!isEligibleForProfile(asset, 'DEFENSIVE')) {
    return { miss: { ticker, prev, asset, score: null, outcome: RETENTION_OUTCOMES.INELIGIBLE } };
  }
  const score = profileScore(asset, 'DEFENSIVE');
  if (score === null || score < holdScore) {
    return { miss: { ticker, prev, asset, score, outcome: RETENTION_OUTCOMES.BELOW_HOLD } };
  }
  return { candidate: { ticker, prev, asset, score, halfIdx } };
};

const attemptBrasil10 = (state, baseline, holdScore) => (candidate) => {
  const half = state[candidate.halfIdx];
  const victimIdx = findVictimIndex(half.selected, baseline);
  if (victimIdx === -1) return reject(candidate, RETENTION_OUTCOMES.NO_DISPLACEABLE_SEAT);
  const [victim] = half.selected.splice(victimIdx, 1);
  // Mesma guarda da catraca do caso geral (ver `canDisplace`): aqui a metade é
  // de cinco assentos, então trocar um COMPRAR por um AGUARDAR pesa ainda mais.
  return admitOverVictim({
    seats: half.selected,
    victimIdx,
    victim,
    candidate,
    profile: 'DEFENSIVE',
    penalty: 0, // Brasil 10 não penaliza concentração, por design
    holdScore,
  });
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

  const state = halves.map(half => ({ ...half, selected: [...(half.selected || [])] }));
  const seats = state.reduce((sum, half) => sum + half.selected.length, 0);
  const frame = retentionFrame(baseline, seats, config);
  if (frame.skip) return retentionResult({ halves: state }, { ...frame, seats });

  const listed = new Set(
    state.flatMap(half => half.selected.map(item => normalizeRankingTicker(item.ticker))),
  );
  const universes = state.map(half => indexUniverse(half.universe || []));

  const { candidates, misses } = partitionIncumbents(baseline, listed, classifyBrasil10(universes, holdScore));
  const loop = runRetentionLoop(candidates, frame.maxRetentions, attemptBrasil10(state, baseline, holdScore));
  const exits = buildExits([...misses, ...loop.rejected], holdScore, 'DEFENSIVE');

  return retentionResult({ halves: state }, {
    exits,
    retained: loop.retained,
    bootstrap: frame.bootstrap,
    seats,
    maxRetentions: frame.maxRetentions,
    budgetExhausted: loop.budgetExhausted,
  });
};
