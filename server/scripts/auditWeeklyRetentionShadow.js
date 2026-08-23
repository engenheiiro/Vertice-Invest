/**
 * SHADOW da retenção de assento do ranking semanal (`BUY_HOLD`) — passo 1 do
 * card CARD-HISTERESE-SEMANAL-2026-08-23. É o número que autoriza (ou
 * desautoriza) o resto: replica as últimas N publicações aplicando a retenção e
 * imprime o Jaccard COM e SEM, por classe.
 *
 * SOMENTE LEITURA. Só faz `find`/`aggregate` em MarketAnalysis. Não importa
 * `aiResearchService` nem nenhum caminho que escreva (por isso não precisa
 * neutralizar `DiscardLog.insertMany`, como faz `auditRankingSurfaces.js`): a
 * réplica é feita sobre os documentos JÁ PUBLICADOS, sem re-rodar o scorer.
 *
 * ── COMO A RÉPLICA FUNCIONA ────────────────────────────────────────────────
 *
 * Para cada classe, as publicações (`isRankingPublished: true`) são lidas em
 * ordem cronológica. A cada transição i-1 → i:
 *   - `current`  = o ranking REALMENTE publicado em i (a saída do draft);
 *   - `previous` = a lista CONTRAFACTUAL de i-1 (a réplica é ENCADEADA, porque
 *     a retenção compõe: reter em i-1 muda quem é incumbente em i);
 *   - o universo de onde os ausentes são recuperados vem de `content.fullAuditLog`.
 * O Jaccard "sem" compara publicações observadas consecutivas; o "com" compara
 * listas contrafactuais consecutivas.
 *
 * ── O LIMITE DURO DOS DADOS: `fullAuditLog` VIVE 7 DIAS ────────────────────
 *
 * `cleanupService` roda `$unset content.fullAuditLog` em toda análise com mais
 * de 7 dias (preservando só a mais recente de cada classe): é ~70% da massa da
 * coleção e só a modal admin a lê. Consequência para esta réplica: o UNIVERSO
 * das publicações antigas não existe mais, e a retenção não tem de onde tirar
 * um incumbente que sumiu da lista.
 *
 * Uma transição só é INFORMATIVA quando sobrou universo para ela. O relatório
 * separa as duas coisas e calcula a mediana de manchete sobre as informativas —
 * misturá-las produziria um "com" que é só o "sem" copiado, e um número que o
 * dono não pode usar para decidir. Na prática:
 *   - STOCK/FII/demais: informativas só as últimas ~2 transições;
 *   - BRASIL_10: informativas quase todas, porque o universo dele são as listas
 *     STOCK/FII da mesma rodada (`content.ranking`, que sobrevive 120 dias) e os
 *     candidatos do Brasil 10 são, por construção, top-5 Defensivos — quase
 *     sempre dentro do top-30 da classe.
 *
 * ── AS DUAS APROXIMAÇÕES, E PARA QUE LADO CADA UMA PUXA ────────────────────
 *
 *  (a) `isDefensiveEligible` NÃO é persistido. A réplica trata todo incumbente
 *      como elegível → pode reter alguém que o portão teria barrado →
 *      Jaccard replicado é OTIMISTA nesse eixo. O relatório conta quantas
 *      retenções dependeram dessa suposição.
 *
 *  (b) O score DEFENSIVO de cada ativo não é persistido em separado: o
 *      `fullAuditLog` guarda um score só (o do melhor perfil). Isso afeta o
 *      BRASIL_10, que é montado por score Defensivo. A réplica recupera o que
 *      consegue (ver `recoverDefensiveScore`) e trata o irrecuperável como
 *      NÃO retido → Jaccard replicado é PESSIMISTA nesse eixo. O relatório
 *      conta a cobertura da recuperação.
 *
 * Por isso o número desta réplica é uma ESTIMATIVA de campo, não o valor que o
 * pipeline produzirá. `--live` complementa, e para STOCK/FII é a ÚNICA leitura
 * sem aproximação: mede a transição de hoje com o universo REAL (elegibilidade
 * e scores por perfil incluídos).
 *
 * Uso:
 *   node server/scripts/auditWeeklyRetentionShadow.js
 *   node server/scripts/auditWeeklyRetentionShadow.js --limit=40 --classes=BRASIL_10,STOCK,FII
 *   node server/scripts/auditWeeklyRetentionShadow.js --all      # inclui as classes desligadas
 *   node server/scripts/auditWeeklyRetentionShadow.js --live     # + transição de hoje, sem aproximação
 *   node server/scripts/auditWeeklyRetentionShadow.js --json > shadow.json
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// O .env vive na raiz do repositório; num git worktree ele pode não existir e as
// variáveis vêm do ambiente (node --env-file=.../.env). Silencioso nos dois casos.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const { normalizeRankingTicker, deriveRankingAction } = await import('../utils/rankingContract.js');
const { WEEKLY_HYSTERESIS } = await import('../config/weeklyHysteresis.js');
const {
  applyWeeklyRetention,
  applyBrasil10Retention,
  RETENTION_OUTCOMES,
} = await import('../utils/weeklyRetention.js');

const STRATEGY = 'BUY_HOLD';
const ALL_CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'ETF', 'REIT'];

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = name => argv.includes(`--${name}`);

const LIMIT = Number(flag('limit', 40));
const AS_JSON = has('json');
const LIVE = has('live');
const CLASSES = flag('classes', null)
  ? flag('classes', '').split(',').map(s => s.trim()).filter(Boolean)
  : (has('all') ? ALL_CLASSES : [...WEEKLY_HYSTERESIS.enabledClasses]);

// ── helpers ────────────────────────────────────────────────────────────────

const tickerSet = list => new Set((list || []).map(i => normalizeRankingTicker(i.ticker)).filter(Boolean));

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
};

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const mean = values => (values.length
  ? values.reduce((a, b) => a + b, 0) / values.length
  : null);

const fmt = v => (v === null || v === undefined ? '—' : Number(v).toFixed(3));

/**
 * Reconstrói um "processedAsset" a partir de um item persistido do
 * `fullAuditLog`. `scores` por perfil não é persistido; a única leitura fiel é
 * o par (riskProfile, score) do documento — que, para um ativo FORA do ranking
 * daquela apuração, é exatamente o melhor perfil e o melhor score, que é o que
 * a regra de retenção consulta. Para ações, `stockCalibration.auditByProfile`
 * sobreviveu ao schema (campo Mixed) e devolve os três perfis de verdade.
 */
const asProcessedAsset = (item) => {
  const score = Number(item.score);
  const scores = {};
  const byProfile = item.stockCalibration?.auditByProfile;
  if (byProfile) {
    for (const profile of ['DEFENSIVE', 'MODERATE', 'BOLD']) {
      const entry = byProfile[profile];
      if (!entry) continue;
      const raw = Number(entry.rawScore);
      const cap = Number(entry.maxScoreAllowed);
      if (Number.isFinite(raw)) {
        scores[profile] = Math.round(Number.isFinite(cap) ? Math.min(raw, cap) : raw);
      }
    }
  }
  if (!Object.keys(scores).length && Number.isFinite(score) && item.riskProfile) {
    scores[item.riskProfile] = score;
  }
  return {
    ticker: item.ticker,
    name: item.name,
    type: item.type,
    sector: item.sector,
    scores,
    metrics: item.metrics,
    auditLog: [],
    // (a) não persistido — a réplica assume elegível e conta a suposição.
    isDefensiveEligible: undefined,
    _recoveredFrom: byProfile ? 'CALIBRATION' : 'BEST_PROFILE',
  };
};

/**
 * Score DEFENSIVO de um ticker naquela apuração, para o Brasil 10 — que é
 * montado por score Defensivo mas cujo próprio documento não guarda universo
 * (o `fullAuditLog` do BRASIL_10 é a própria lista de 10). Vem dos documentos
 * STOCK/FII da MESMA rodada, nesta ordem de fidelidade:
 *   1. `stockCalibration.auditByProfile.DEFENSIVE` (exato, só ações);
 *   2. item do `fullAuditLog` cujo melhor perfil JÁ é DEFENSIVE (exato);
 *   3. item do ranking da classe em DEFENSIVE (aproximado: traz a penalidade de
 *      concentração, que o Brasil 10 não aplica → viés para BAIXO, conservador);
 *   4. irrecuperável → o incumbente NÃO é retido.
 */
const recoverDefensiveScore = (entry) => {
  if (!entry) return { score: null, source: 'MISSING' };
  const byProfile = entry.full?.stockCalibration?.auditByProfile?.DEFENSIVE;
  if (byProfile && Number.isFinite(Number(byProfile.rawScore))) {
    const raw = Number(byProfile.rawScore);
    const cap = Number(byProfile.maxScoreAllowed);
    return { score: Math.round(Number.isFinite(cap) ? Math.min(raw, cap) : raw), source: 'CALIBRATION' };
  }
  if (entry.full && entry.full.riskProfile === 'DEFENSIVE' && Number.isFinite(Number(entry.full.score))) {
    return { score: Number(entry.full.score), source: 'FULL_AUDIT_DEFENSIVE' };
  }
  if (entry.ranked && entry.ranked.riskProfile === 'DEFENSIVE' && Number.isFinite(Number(entry.ranked.score))) {
    return { score: Number(entry.ranked.score), source: 'CLASS_RANKING_PENALIZED' };
  }
  return { score: null, source: 'UNRECOVERABLE' };
};

const contractViolations = list => (list || []).filter(
  item => item.action === 'BUY' && Number(item.score) < 70,
).map(item => `${item.ticker}@${item.score}`);

// ── carregamento ───────────────────────────────────────────────────────────

const loadPublications = async (assetClass) => {
  const docs = await MarketAnalysis.find({
    assetClass,
    strategy: STRATEGY,
    isRankingPublished: true,
  })
    .sort({ createdAt: -1 })
    .limit(LIMIT)
    .select('createdAt runId content.ranking content.fullAuditLog')
    .lean();
  return docs.reverse();
};

/** Janela para casar um documento BRASIL_10 com os STOCK/FII da mesma rodada. */
const RUN_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Universo Defensivo por documento BRASIL_10, indexado por ticker normalizado.
 *
 * `runId` só existe nas 12 publicações mais novas (o campo é posterior ao resto
 * do histórico), então casar apenas por ele deixaria 28 das 40 apurações sem
 * universo — e o relatório mediria o nada. O fallback é o documento publicado da
 * classe mais próximo no tempo dentro de `RUN_MATCH_WINDOW_MS`: o batch grava
 * STOCK, FII e BRASIL_10 com segundos de diferença, e duas publicações distintas
 * nunca ficam a menos de duas horas uma da outra.
 */
const buildBrasil10Universes = async (b10Docs) => {
  const oldest = b10Docs[0].createdAt;
  const sideDocs = await MarketAnalysis.find({
    strategy: STRATEGY,
    assetClass: { $in: ['STOCK', 'FII'] },
    isRankingPublished: true,
    createdAt: { $gte: new Date(oldest.getTime() - RUN_MATCH_WINDOW_MS) },
  }).select('runId assetClass createdAt content.ranking content.fullAuditLog').lean();

  const byClass = { STOCK: [], FII: [] };
  for (const doc of sideDocs) byClass[doc.assetClass].push(doc);

  const pick = (assetClass, b10Doc) => {
    const candidates = byClass[assetClass];
    if (b10Doc.runId) {
      const exact = candidates.find(d => d.runId && d.runId === b10Doc.runId);
      if (exact) return { doc: exact, match: 'RUN_ID' };
    }
    let best = null;
    for (const doc of candidates) {
      const dist = Math.abs(doc.createdAt - b10Doc.createdAt);
      if (dist > RUN_MATCH_WINDOW_MS) continue;
      if (!best || dist < best.dist) best = { doc, dist };
    }
    return best ? { doc: best.doc, match: 'NEAREST_TIME' } : null;
  };

  const index = (doc) => {
    const bucket = new Map();
    if (!doc) return bucket;
    for (const item of (doc.content?.fullAuditLog || [])) {
      const key = normalizeRankingTicker(item.ticker);
      if (key) bucket.set(key, { full: item, ranked: null });
    }
    for (const item of (doc.content?.ranking || [])) {
      const key = normalizeRankingTicker(item.ticker);
      if (!key) continue;
      if (bucket.has(key)) bucket.get(key).ranked = item;
      else bucket.set(key, { full: null, ranked: item });
    }
    return bucket;
  };

  const byDoc = new Map();
  for (const b10Doc of b10Docs) {
    const stock = pick('STOCK', b10Doc);
    const fii = pick('FII', b10Doc);
    if (!stock && !fii) continue;
    byDoc.set(String(b10Doc._id), {
      STOCK: index(stock?.doc),
      FII: index(fii?.doc),
      match: stock?.match || fii?.match,
    });
  }
  return byDoc;
};

// ── réplica encadeada ──────────────────────────────────────────────────────

const replayProfiled = (docs) => {
  const observed = [];
  const counter = [];
  const informative = []; // índices das transições que tiveram universo
  const outcomes = {};
  const distinctObserved = new Set();
  const distinctCounter = new Set();
  let retentions = 0;
  let budgetHits = 0;
  let assumedEligible = 0;
  const violations = [];
  const examples = [];

  let prevCounter = docs[0].content?.ranking || [];
  (docs[0].content?.ranking || []).forEach(i => distinctObserved.add(normalizeRankingTicker(i.ticker)));
  prevCounter.forEach(i => distinctCounter.add(normalizeRankingTicker(i.ticker)));

  for (let i = 1; i < docs.length; i += 1) {
    const prevDoc = docs[i - 1];
    const doc = docs[i];
    const current = doc.content?.ranking || [];
    const pool = (doc.content?.fullAuditLog || []).map(asProcessedAsset);

    observed.push(jaccard(tickerSet(prevDoc.content?.ranking), tickerSet(current)));
    current.forEach(item => distinctObserved.add(normalizeRankingTicker(item.ticker)));

    // Sem `fullAuditLog` (limpo após 7 dias) não há universo: a retenção não
    // teria de onde tirar ninguém, e contar essa transição como "com retenção"
    // seria copiar o número "sem" e chamá-lo de resultado.
    const listed = tickerSet(current);
    const hasUniverse = pool.some(a => !listed.has(normalizeRankingTicker(a.ticker)));
    if (hasUniverse) informative.push(observed.length - 1);

    const result = applyWeeklyRetention({
      current,
      previous: prevCounter,
      processedAssets: pool,
      options: { config: WEEKLY_HYSTERESIS },
    });

    counter.push(jaccard(tickerSet(prevCounter), tickerSet(result.ranking)));
    result.ranking.forEach(item => distinctCounter.add(normalizeRankingTicker(item.ticker)));
    retentions += result.retained.length;
    assumedEligible += result.retained.filter(r => r.profile === 'DEFENSIVE').length;
    if (result.counts.budgetExhausted) budgetHits += 1;
    if (hasUniverse) {
      for (const exit of result.exits) outcomes[exit.outcome] = (outcomes[exit.outcome] || 0) + 1;
    }
    violations.push(...contractViolations(result.ranking).map(v => `${doc.createdAt.toISOString().slice(0, 10)} ${v}`));
    for (const r of result.retained.slice(0, 2)) {
      if (examples.length < 6) {
        examples.push(`${doc.createdAt.toISOString().slice(0, 10)} ${r.ticker} ${r.previousScore}→${r.score}`
          + ` (${r.profile}, ${r.action}) desloca ${r.displaced.ticker}@${r.displaced.score}`);
      }
    }
    prevCounter = result.ranking;
  }

  return {
    transitions: observed.length,
    observed,
    counter,
    informative,
    distinctObserved: distinctObserved.size,
    distinctCounter: distinctCounter.size,
    retentions,
    budgetHits,
    assumedEligible,
    outcomes,
    violations,
    examples,
  };
};

const replayBrasil10 = (docs, universesByDoc) => {
  const observed = [];
  const counter = [];
  const informative = [];
  const matches = {};
  const outcomes = {};
  const distinctObserved = new Set();
  const distinctCounter = new Set();
  const recovery = {};
  let retentions = 0;
  let budgetHits = 0;
  let unrecoverable = 0;
  const violations = [];
  const examples = [];

  let prevCounter = docs[0].content?.ranking || [];
  (docs[0].content?.ranking || []).forEach(i => distinctObserved.add(normalizeRankingTicker(i.ticker)));
  prevCounter.forEach(i => distinctCounter.add(normalizeRankingTicker(i.ticker)));

  for (let i = 1; i < docs.length; i += 1) {
    const prevDoc = docs[i - 1];
    const doc = docs[i];
    const current = doc.content?.ranking || [];
    observed.push(jaccard(tickerSet(prevDoc.content?.ranking), tickerSet(current)));
    current.forEach(item => distinctObserved.add(normalizeRankingTicker(item.ticker)));

    const run = universesByDoc.get(String(doc._id));
    if (!run) {
      // Sem os documentos STOCK/FII da rodada não há universo: a apuração passa
      // sem retenção, e o Jaccard contrafactual repete o observado. NÃO é uma
      // transição informativa.
      matches.SEM_UNIVERSO = (matches.SEM_UNIVERSO || 0) + 1;
      counter.push(jaccard(tickerSet(prevCounter), tickerSet(current)));
      prevCounter = current;
      current.forEach(item => distinctCounter.add(normalizeRankingTicker(item.ticker)));
      continue;
    }
    matches[run.match] = (matches[run.match] || 0) + 1;
    informative.push(observed.length - 1);

    const buildUniverse = (bucket) => {
      const assets = [];
      for (const [key, entry] of bucket.entries()) {
        const { score, source } = recoverDefensiveScore(entry);
        recovery[source] = (recovery[source] || 0) + 1;
        if (score === null) continue;
        const ref = entry.full || entry.ranked;
        assets.push({
          ticker: ref.ticker || key,
          name: ref.name,
          type: ref.type,
          sector: ref.sector,
          scores: { DEFENSIVE: score },
          metrics: ref.metrics,
          auditLog: [],
          isDefensiveEligible: undefined, // (a) não persistido
          _defensiveSource: source,
        });
      }
      return assets;
    };

    const stockUniverse = buildUniverse(run.STOCK);
    const fiiUniverse = buildUniverse(run.FII);
    const selectedStock = current.filter(item => item.type !== 'FII');
    const selectedFii = current.filter(item => item.type === 'FII');

    const result = applyBrasil10Retention({
      halves: [
        { selected: selectedStock, universe: stockUniverse },
        { selected: selectedFii, universe: fiiUniverse },
      ],
      previous: prevCounter,
      options: { config: WEEKLY_HYSTERESIS },
    });

    const merged = result.halves.flatMap(h => h.selected)
      .map(item => ({ ...item, action: deriveRankingAction(item.score) }));
    counter.push(jaccard(tickerSet(prevCounter), tickerSet(merged)));
    merged.forEach(item => distinctCounter.add(normalizeRankingTicker(item.ticker)));
    retentions += result.retained.length;
    if (result.counts.budgetExhausted) budgetHits += 1;
    unrecoverable += result.exits.filter(e => e.outcome === RETENTION_OUTCOMES.LEFT_UNIVERSE).length;
    for (const exit of result.exits) outcomes[exit.outcome] = (outcomes[exit.outcome] || 0) + 1;
    violations.push(...contractViolations(merged).map(v => `${doc.createdAt.toISOString().slice(0, 10)} ${v}`));
    for (const r of result.retained.slice(0, 2)) {
      if (examples.length < 6) {
        examples.push(`${doc.createdAt.toISOString().slice(0, 10)} ${r.ticker} ${r.previousScore}→${r.score}`
          + ` (${r.action}) desloca ${r.displaced.ticker}@${r.displaced.score}`);
      }
    }
    prevCounter = merged;
  }

  return {
    transitions: observed.length,
    observed,
    counter,
    informative,
    matches,
    distinctObserved: distinctObserved.size,
    distinctCounter: distinctCounter.size,
    retentions,
    budgetHits,
    unrecoverable,
    recovery,
    outcomes,
    violations,
    examples,
  };
};

// ── transição de hoje, sem aproximação ─────────────────────────────────────

const runLive = async () => {
  // Só aqui o serviço pesado é importado, e com a escrita de DiscardLog
  // neutralizada ANTES do primeiro import — mesmo padrão de auditRankingSurfaces.
  const DiscardLog = (await import('../models/DiscardLog.js')).default;
  DiscardLog.insertMany = async () => [];
  const { aiResearchService, getTop5Defensive } = await import('../services/aiResearchService.js');

  const out = {};
  const classes = ['STOCK', 'FII'];
  const processed = {};

  for (const assetClass of classes) {
    const live = await aiResearchService.calculateRanking(assetClass, STRATEGY);
    processed[assetClass] = live.processedAssets;
    const [published] = await loadPublicationsTail(assetClass, 1);
    if (!published) { out[assetClass] = { skipped: 'sem publicação anterior' }; continue; }
    const previous = published.content?.ranking || [];
    const result = applyWeeklyRetention({
      current: live.ranking,
      previous,
      processedAssets: live.processedAssets,
      options: { config: WEEKLY_HYSTERESIS },
    });
    out[assetClass] = {
      jaccardSem: jaccard(tickerSet(previous), tickerSet(live.ranking)),
      jaccardCom: jaccard(tickerSet(previous), tickerSet(result.ranking)),
      retidos: result.retained.map(r => `${r.ticker} ${r.previousScore}→${r.score} (${r.profile}/${r.action})`),
      saidas: result.exits.map(e => `${e.ticker}: ${e.reason}`),
      tetoEstourado: result.counts.budgetExhausted,
      violacoesDeContrato: contractViolations(result.ranking),
    };
  }

  const [b10Published] = await loadPublicationsTail('BRASIL_10', 1);
  if (b10Published && processed.STOCK && processed.FII) {
    const previous = b10Published.content?.ranking || [];
    const stockTop = getTop5Defensive(processed.STOCK);
    const fiiTop = getTop5Defensive(processed.FII);
    const observed = [...stockTop, ...fiiTop];
    const result = applyBrasil10Retention({
      halves: [
        { selected: stockTop, universe: processed.STOCK },
        { selected: fiiTop, universe: processed.FII },
      ],
      previous,
      options: { config: WEEKLY_HYSTERESIS },
    });
    const merged = result.halves.flatMap(h => h.selected)
      .map(item => ({ ...item, action: deriveRankingAction(item.score) }));
    out.BRASIL_10 = {
      jaccardSem: jaccard(tickerSet(previous), tickerSet(observed)),
      jaccardCom: jaccard(tickerSet(previous), tickerSet(merged)),
      retidos: result.retained.map(r => `${r.ticker} ${r.previousScore}→${r.score} (${r.action})`),
      saidas: result.exits.map(e => `${e.ticker}: ${e.reason}`),
      tetoEstourado: result.counts.budgetExhausted,
      violacoesDeContrato: contractViolations(merged),
    };
  }
  return out;
};

const loadPublicationsTail = async (assetClass, n) => MarketAnalysis.find({
  assetClass, strategy: STRATEGY, isRankingPublished: true,
}).sort({ createdAt: -1 }).limit(n).select('createdAt content.ranking').lean();

// ── main ───────────────────────────────────────────────────────────────────

await connectScriptDb({ label: 'auditWeeklyRetentionShadow' });
try {
  const report = { config: WEEKLY_HYSTERESIS, limit: LIMIT, classes: {} };

  const b10Docs = CLASSES.includes('BRASIL_10') ? await loadPublications('BRASIL_10') : [];
  const b10Universes = b10Docs.length ? await buildBrasil10Universes(b10Docs) : new Map();
  const pickBy = (values, indexes) => indexes.map(i => values[i]);

  for (const assetClass of CLASSES) {
    const docs = assetClass === 'BRASIL_10' ? b10Docs : await loadPublications(assetClass);
    if (docs.length < 2) {
      report.classes[assetClass] = { publicacoes: docs.length, nota: 'menos de 2 publicações — nada a comparar' };
      continue;
    }
    const r = assetClass === 'BRASIL_10'
      ? replayBrasil10(docs, b10Universes)
      : replayProfiled(docs);

    const obsInf = pickBy(r.observed, r.informative);
    const cntInf = pickBy(r.counter, r.informative);

    report.classes[assetClass] = {
      publicacoes: docs.length,
      janela: [docs[0].createdAt, docs[docs.length - 1].createdAt],
      transicoes: r.transitions,
      // Manchete: SÓ as transições que tinham universo para replicar.
      transicoesInformativas: r.informative.length,
      jaccardSem: { mediana: median(obsInf), media: mean(obsInf) },
      jaccardCom: { mediana: median(cntInf), media: mean(cntInf) },
      jaccardJanelaInteira: {
        sem: { mediana: median(r.observed), media: mean(r.observed) },
        com: { mediana: median(r.counter), media: mean(r.counter) },
        nota: 'inclui transições sem universo, onde "com" é necessariamente igual a "sem"',
      },
      tickersDistintos: { sem: r.distinctObserved, com: r.distinctCounter },
      retencoes: r.retentions,
      apuracoesComTetoEstourado: r.budgetHits,
      motivosDeSaida: r.outcomes,
      violacoesDeContrato: r.violations,
      exemplos: r.examples,
      ...(assetClass === 'BRASIL_10'
        ? {
          casamentoDaRodada: r.matches,
          recuperacaoDoScoreDefensivo: r.recovery,
          incumbentesIrrecuperaveis: r.unrecoverable,
        }
        : { retencoesQueAssumiramElegibilidade: r.assumedEligible }),
    };
  }

  if (LIVE) report.hoje = await runLive();

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log('');
    console.log('════ SHADOW — retenção de assento do ranking semanal (BUY_HOLD) ════');
    console.log(`piso de permanência ${WEEKLY_HYSTERESIS.holdScore} · teto ${WEEKLY_HYSTERESIS.maxRetentionShare * 100}% dos assentos`
      + ` · janela: últimas ${LIMIT} publicações`);
    console.log('');
    console.log('classe        pub  transições  Jaccard SEM   Jaccard COM   tickers (sem→com)  retenções');
    console.log('──────────────────────────────────────────────────────────────────────────────────────');
    for (const [assetClass, r] of Object.entries(report.classes)) {
      if (r.nota) { console.log(`${assetClass.padEnd(13)} ${String(r.publicacoes).padStart(3)}  ${r.nota}`); continue; }
      console.log(
        `${assetClass.padEnd(13)} ${String(r.publicacoes).padStart(3)}`
        + `  ${String(`${r.transicoesInformativas}/${r.transicoes}`).padStart(10)}`
        + `  ${fmt(r.jaccardSem.mediana).padStart(11)}`
        + `  ${fmt(r.jaccardCom.mediana).padStart(11)}`
        + `  ${String(`${r.tickersDistintos.sem}→${r.tickersDistintos.com}`).padStart(17)}`
        + `  ${String(r.retencoes).padStart(9)}`,
      );
    }
    console.log('');
    console.log('Jaccard = mediana entre publicações consecutivas, "com" = réplica ENCADEADA.');
    console.log('"transições" = INFORMATIVAS / totais. Só as informativas entram na mediana:');
    console.log('cleanupService apaga content.fullAuditLog após 7 dias, e sem universo a');
    console.log('retenção não tem de onde tirar ninguém — "com" seria só uma cópia de "sem".');
    console.log('');
    for (const [assetClass, r] of Object.entries(report.classes)) {
      if (r.nota) continue;
      console.log(`── ${assetClass} ──`);
      console.log(`  média SEM ${fmt(r.jaccardSem.media)} · média COM ${fmt(r.jaccardCom.media)}`
        + ` · ${r.transicoesInformativas} de ${r.transicoes} transições informativas`);
      console.log(`  janela inteira (diluída): SEM ${fmt(r.jaccardJanelaInteira.sem.mediana)}`
        + ` → COM ${fmt(r.jaccardJanelaInteira.com.mediana)}`);
      if (r.casamentoDaRodada) console.log(`  casamento da rodada: ${JSON.stringify(r.casamentoDaRodada)}`);
      console.log(`  apurações com teto de retenções estourado: ${r.apuracoesComTetoEstourado}`);
      console.log(`  motivos de saída: ${JSON.stringify(r.motivosDeSaida)}`);
      if (r.retencoesQueAssumiramElegibilidade !== undefined) {
        console.log(`  retenções Defensivas que assumiram elegibilidade (aprox. otimista): ${r.retencoesQueAssumiramElegibilidade}`);
      }
      if (r.recuperacaoDoScoreDefensivo) {
        console.log(`  recuperação do score Defensivo: ${JSON.stringify(r.recuperacaoDoScoreDefensivo)}`);
        console.log(`  incumbentes irrecuperáveis (aprox. pessimista): ${r.incumbentesIrrecuperaveis}`);
      }
      console.log(`  COMPRAR com score < 70 na réplica: ${r.violacoesDeContrato.length ? r.violacoesDeContrato.join(', ') : 'nenhum ✓'}`);
      if (r.exemplos.length) {
        console.log('  exemplos de retenção:');
        for (const e of r.exemplos) console.log(`    ${e}`);
      }
      console.log('');
    }
    if (report.hoje) {
      console.log('── HOJE (sem aproximação: universo real, elegibilidade e scores por perfil) ──');
      for (const [assetClass, r] of Object.entries(report.hoje)) {
        if (r.skipped) { console.log(`  ${assetClass}: ${r.skipped}`); continue; }
        console.log(`  ${assetClass}: Jaccard ${fmt(r.jaccardSem)} → ${fmt(r.jaccardCom)}`
          + ` · teto estourado: ${r.tetoEstourado ? 'sim' : 'não'}`
          + ` · COMPRAR<70: ${r.violacoesDeContrato.length ? r.violacoesDeContrato.join(',') : 'nenhum ✓'}`);
        for (const t of r.retidos) console.log(`      retido  ${t}`);
        for (const t of r.saidas) console.log(`      saída   ${t}`);
      }
      console.log('');
    }
  }
} finally {
  await mongoose.disconnect();
}
