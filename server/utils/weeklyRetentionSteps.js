/**
 * Passos da retenção de assento do ranking semanal — as peças puras que
 * `utils/weeklyRetention.js` compõe em `applyWeeklyRetention` (rankings por
 * perfil) e `applyBrasil10Retention` (Brasil 10). Nada aqui faz I/O.
 *
 * O porquê da retenção, e o que ela NÃO faz (nunca toca em `action`), está no
 * cabeçalho de `weeklyRetention.js`.
 */

import { deriveRankingAction, normalizeRankingTicker } from './rankingContract.js';
import { BUY_THRESHOLD } from '../config/financialConstants.js';
import { CONCENTRATION_SCORE_FLOOR } from './concentrationPenalty.js';
import { weeklyRetentionBudget } from '../config/weeklyHysteresis.js';

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
export const profileScore = (asset, profile) => {
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
export const buildRetainedItem = ({ asset, profile, score, penalty, previous, holdScore, displaced }) => {
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

/** Universo processado indexado por ticker normalizado; a PRIMEIRA ocorrência vence. */
export const indexUniverse = (assets) => {
  const map = new Map();
  for (const asset of assets) {
    const key = normalizeRankingTicker(asset?.ticker);
    if (key && !map.has(key)) map.set(key, asset);
  }
  return map;
};

/** Saída de quem não está mais no universo avaliado. */
export const leftUniverse = (ticker, prev) => (
  { ticker, prev, outcome: RETENTION_OUTCOMES.LEFT_UNIVERSE, asset: null, score: null }
);

/**
 * Separa os incumbentes AUSENTES da lista desta apuração em candidatos à
 * retenção e saídas imediatas. `classify(ticker, prev)` devolve `{ candidate }`
 * ou `{ miss }`. Quem já está listado — por ticker normalizado, jamais por
 * (ticker, perfil) — não é nem um nem outro.
 */
export const partitionIncumbents = (baseline, listed, classify) => {
  const candidates = [];
  const misses = [];
  for (const [ticker, prev] of baseline.entries()) {
    if (listed.has(ticker)) continue;
    const { candidate, miss } = classify(ticker, prev);
    if (miss) misses.push(miss);
    else candidates.push(candidate);
  }
  // Do mais forte ao mais fraco: o teto de retenções corta a cauda, não o topo.
  candidates.sort((a, b) => (b.score - a.score)
    || (structuralComposite(b.asset) - structuralComposite(a.asset)));
  return { candidates, misses };
};

/**
 * Vítima: o MENOR score entre os NÃO-incumbentes dos assentos. Incumbente nunca
 * é deslocado por outro incumbente. `-1` quando todos são incumbentes.
 */
export const findVictimIndex = (seats, baseline) => {
  let victimIdx = -1;
  for (let i = 0; i < seats.length; i += 1) {
    if (baseline.has(normalizeRankingTicker(seats[i].ticker))) continue;
    if (victimIdx === -1 || seats[i].score < seats[victimIdx].score) victimIdx = i;
  }
  return victimIdx;
};

/** Recusa de um candidato, com o desfecho e os campos que o texto de saída usa. */
export const reject = (candidate, outcome, extra = {}) => ({ rejected: { ...candidate, ...extra, outcome } });

const retainedRecord = ({ candidate, profile, penalty, item, victim }) => ({
  ticker: candidate.ticker,
  name: candidate.asset.name || candidate.prev?.name || null,
  profile,
  previousProfile: candidate.prev?.riskProfile ?? null,
  previousScore: candidate.prev?.score ?? null,
  rawScore: candidate.score,
  penalty,
  score: item.score,
  action: item.action,
  displaced: { ticker: victim.ticker, score: victim.score },
});

/**
 * Último passo da readmissão: com a vítima já fora de `seats`, monta o item
 * retido e cobra a catraca (`canDisplace`). Recusada, a vítima volta para o
 * mesmo índice; aceita, o retido ocupa o fim da lista do perfil.
 */
export const admitOverVictim = ({ seats, victimIdx, victim, candidate, profile, penalty, holdScore }) => {
  const item = buildRetainedItem({
    asset: candidate.asset,
    profile,
    score: candidate.score,
    penalty,
    previous: candidate.prev,
    holdScore,
    displaced: victim,
  });
  if (!canDisplace(item, victim)) {
    seats.splice(victimIdx, 0, victim); // desfaz
    return reject(candidate, RETENTION_OUTCOMES.WOULD_DROP_BUY, { displacedTicker: victim.ticker });
  }
  seats.push(item);
  return { retained: retainedRecord({ candidate, profile, penalty, item, victim }) };
};

/**
 * Percorre os candidatos (já ordenados) até o teto de retenções da apuração.
 * `attempt(candidate)` devolve `{ retained }` ou `{ rejected }`; passado o teto,
 * o resto sai como BUDGET_EXHAUSTED sem tentativa.
 */
export const runRetentionLoop = (candidates, maxRetentions, attempt) => {
  const retained = [];
  const rejected = [];
  let budgetExhausted = false;
  for (const candidate of candidates) {
    if (retained.length >= maxRetentions) {
      budgetExhausted = true;
      rejected.push({ ...candidate, outcome: RETENTION_OUTCOMES.BUDGET_EXHAUSTED });
      continue;
    }
    const result = attempt(candidate);
    if (result.retained) retained.push(result.retained);
    else rejected.push(result.rejected);
  }
  return { retained, rejected, budgetExhausted };
};

const buildExitEntry = (entry, holdScore, fallbackProfile) => ({
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
});

/** Toda saída de incumbente, com motivo escrito, na ordem da publicação anterior. */
export const buildExits = (entries, holdScore, fallbackProfile) => entries
  .map(entry => buildExitEntry(entry, holdScore, fallbackProfile))
  .sort((a, b) => (a.previousPosition ?? Number.MAX_SAFE_INTEGER)
    - (b.previousPosition ?? Number.MAX_SAFE_INTEGER));

/**
 * Orçamento da apuração e se há o que reter: nada na primeira apuração
 * (`bootstrap`, baseline `null`) nem com a lista vazia.
 */
export const retentionFrame = (baseline, seats, config) => {
  const bootstrap = baseline === null;
  const maxRetentions = weeklyRetentionBudget(seats, config);
  return { bootstrap, maxRetentions, skip: bootstrap || seats === 0 };
};

/**
 * Cauda comum do resultado das duas retenções — `head` traz a lista (`ranking`
 * ou `halves`) e vem primeiro, como sempre veio.
 */
export const retentionResult = (head, { exits = [], retained = [], bootstrap, seats, maxRetentions, budgetExhausted = false }) => ({
  ...head,
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
});
