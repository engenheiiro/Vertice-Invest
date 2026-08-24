/**
 * Auditoria de UMA apuração do ranking — card CARD-VALIDACAO-SYNC-2026-08-23.
 *
 * Responde aos SETE gatilhos de "crítico" do card contra o que o `sync:prod`
 * acabou de gravar, com veredito por classe e um resumo final CRÍTICO/LIMPO.
 * A definição de crítico é fechada: um achado só entra se altera a lista que o
 * assinante vê ou impede a publicação. Tudo mais é ruído operacional e fica de
 * fora de propósito — este script não é um diagnóstico geral do sync.
 *
 * Gatilhos (numerados como no card):
 *   1. BUY com score < 70 em qualquer classe de `BUY_HOLD`.
 *   2. Ranking vazio, ou queda > 30% dos itens contra a apuração anterior.
 *   3. Invariante de ordenação/posição/duplicidade quebrado.
 *   4. Ativo DENTRO da lista com fundamento acima de 36h.
 *   5. `[ERROS]` > 0 no `server/logs/sync-report.txt`.
 *   6. Portão de fundamentos reprovado (`lastSyncStats` + ingestionHealth).
 *   7. Contaminação entre estratégias (campos de uma na outra).
 *
 * SOMENTE LEITURA. Nenhum `save/update/insert/bulkWrite/delete`, nenhum publish,
 * nenhum scheduler: só `find` em MarketAnalysis/MarketAsset/SystemConfig e a
 * leitura do TXT do relatório. Não importa `aiResearchService` — lê o que foi
 * PERSISTIDO, que é exatamente o que a publicação levaria ao ar; recalcular ao
 * vivo auditaria outra coisa.
 *
 * Uso:
 *   node server/scripts/auditRankingRun.js
 *   AUDIT_JSON_OUT=caminho.json node server/scripts/auditRankingRun.js
 *
 * O JSON vai para ARQUIVO, nunca para o stdout: os logs do Winston sujam o
 * stdout deste processo e quebrariam qualquer parser a jusante.
 *
 * Saída de processo: 0 = LIMPO, 1 = CRÍTICO, 2 = falha do próprio auditor.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { normalizeRankingTicker, validateRankingContract, compareRankingItems } =
  await import('../utils/rankingContract.js');
const { BUY_THRESHOLD } = await import('../config/financialConstants.js');
const { ANCHOR_STRATEGY } = await import('../config/buyAndHoldPublication.js');
const {
  FUNDAMENTALS_HEALTH_MAX_AGE_HOURS,
  validateFundamentusIngestion,
  validateFundamentalsPublicationHealth,
} = await import('../utils/ingestionHealth.js');

const WEEKLY_STRATEGY = 'BUY_HOLD';
const CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'REIT', 'ETF'];
/** Gatilho 2: queda de mais de 30% dos itens contra a apuração anterior. */
const COUNT_DROP_LIMIT = 0.30;
const SYNC_REPORT = path.resolve(__dirname, '../logs/sync-report.txt');
const JSON_OUT = process.env.AUDIT_JSON_OUT || '';

// Só os campos que os sete gatilhos usam. `content.fullAuditLog` fica de fora de
// propósito: é a parte pesada do documento e nenhum gatilho olha para ela.
const RANKING_FIELDS = [
  'assetClass', 'createdAt', 'isRankingPublished', 'retentionExits', 'anchorExits',
  'content.ranking.ticker', 'content.ranking.score', 'content.ranking.action',
  'content.ranking.position', 'content.ranking.riskProfile', 'content.ranking.type',
  'content.ranking.reason', 'content.ranking.retention', 'content.ranking.anchor',
  'content.ranking.metrics.structural',
].join(' ');

const hours = (ms) => ms / 3600000;
const fmtAge = (ms) => `${hours(ms).toFixed(1)}h`;

/**
 * Sempre pela chave do índice `{ assetClass, strategy, createdAt: -1 }`: um
 * `find().sort()` fora dele estoura o limite de memória do Mongo nesta coleção.
 */
const latestAnalyses = (assetClass, strategy, limit) => MarketAnalysis
  .find({ assetClass, strategy })
  .sort({ createdAt: -1 })
  .limit(limit)
  .select(RANKING_FIELDS)
  .lean();

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
};
const tickerSet = (list) => new Set((list || []).map((i) => normalizeRankingTicker(i.ticker)).filter(Boolean));

/** Gatilho 5 — contagem da seção `[ERROS]` do relatório do sync. */
const readSyncErrors = () => {
  if (!fs.existsSync(SYNC_REPORT)) {
    return { found: false, errors: null, warnings: null, perfAlerts: null, mtime: null, lines: [] };
  }
  const text = fs.readFileSync(SYNC_REPORT, 'utf8');
  const section = (label) => {
    const header = new RegExp(`^\\[${label}\\] \\((\\d+)\\)`, 'm');
    const match = text.match(header);
    if (!match) return { count: null, lines: [] };
    const rest = text.slice(match.index + match[0].length).split('\n').slice(1);
    const lines = [];
    for (const line of rest) {
      if (/^\[[A-ZÇÃÕÉÍÚ ]+\] \(\d+\)/.test(line) || /^═|^─{5,}/.test(line)) break;
      if (line.trim()) lines.push(line.trim());
    }
    return { count: Number(match[1]), lines };
  };
  const errs = section('ERROS');
  return {
    found: true,
    errors: errs.count,
    lines: errs.lines,
    warnings: section('AVISOS OPERACIONAIS').count,
    perfAlerts: section('ALERTAS DE PERFORMANCE').count,
    mtime: fs.statSync(SYNC_REPORT).mtime,
  };
};

/** Gatilho 6 — o mesmo portão que bloqueia a publicação, lido do banco. */
const auditFundamentalsGate = async (now) => {
  const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' })
    .select('lastSyncStats').lean();
  const stats = config?.lastSyncStats || null;
  const ingestion = stats?.fundamentals ? validateFundamentusIngestion(stats.fundamentals) : null;
  const perClass = {};
  for (const assetClass of CLASSES) {
    perClass[assetClass] = validateFundamentalsPublicationHealth(assetClass, stats, now);
  }
  return {
    healthy: stats?.fundamentalsHealthy === true,
    errorCode: stats?.errorCode || null,
    timestamp: stats?.timestamp || null,
    ageHours: stats?.timestamp ? hours(now - new Date(stats.timestamp)) : null,
    ingestionOk: ingestion ? ingestion.ok : null,
    ingestionReason: ingestion?.reason || null,
    counts: stats?.fundamentals
      ? Object.fromEntries(Object.entries(stats.fundamentals)
        .map(([key, value]) => [key, `${value.accepted}/${value.parsed}`]))
      : null,
    perClass,
  };
};

/**
 * Gatilho 7 — contaminação entre estratégias, nas duas direções: o semanal não
 * pode carregar campo da âncora, nem a âncora campo do semanal.
 */
const auditCrossContamination = async () => {
  const out = [];
  for (const [strategy, itemField, docField] of [
    [WEEKLY_STRATEGY, 'anchor', 'anchorExits'],
    [ANCHOR_STRATEGY, 'retention', 'retentionExits'],
  ]) {
    for (const assetClass of CLASSES) {
      const [doc] = await latestAnalyses(assetClass, strategy, 1);
      if (!doc) continue;
      const dirty = (doc.content?.ranking || []).filter((i) => i[itemField] != null).map((i) => i.ticker);
      const docDirty = (doc[docField] || []).length;
      if (dirty.length || docDirty) {
        out.push({
          strategy, assetClass, campo: itemField, campoDoc: docField,
          itens: dirty.slice(0, 10), totalItens: dirty.length, saidas: docDirty,
        });
      }
    }
  }
  return out;
};

/** Gatilho 4 — idade do fundamento de cada ativo QUE ESTÁ na lista. */
const buildFundamentalsIndex = async () => {
  const assets = await MarketAsset.find({})
    .select('ticker lastFundamentalsDate updatedAt').lean();
  const index = new Map();
  for (const asset of assets) {
    const key = normalizeRankingTicker(asset.ticker);
    if (!key) continue;
    // `updatedAt` é fallback declarado: cripto e ETF nunca recebem
    // `lastFundamentalsDate` (não passam pelo Fundamentus nem pelo scraper US),
    // e sem o fallback toda a classe apareceria como "sem fundamento".
    const at = asset.lastFundamentalsDate || asset.updatedAt || null;
    const previous = index.get(key);
    if (!previous || (at && new Date(at) > new Date(previous.at || 0))) {
      index.set(key, { at, viaFallback: !asset.lastFundamentalsDate });
    }
  }
  return index;
};

const auditClass = (assetClass, current, previous, fundamentals, now) => {
  const criticals = [];
  if (!current) {
    return {
      classe: assetClass, itens: 0, comprar: 0, itensAnterior: null, createdAt: null,
      retidos: 0, saidasRetencao: 0,
      criticals: [`gatilho 2: nenhuma apuração ${WEEKLY_STRATEGY} encontrada`],
    };
  }
  const ranking = current.content?.ranking || [];

  // Gatilho 1 — o contrato inviolável do 70.
  const buyBelow = ranking
    .filter((i) => i.action === 'BUY' && Number(i.score) < BUY_THRESHOLD)
    .map((i) => `${i.ticker}@${Number(i.score).toFixed(1)}`);
  if (buyBelow.length) {
    criticals.push(`gatilho 1: BUY com score < ${BUY_THRESHOLD}: ${buyBelow.join(', ')}`);
  }

  // Gatilho 2 — lista vazia ou encolhimento abrupto.
  const previousCount = previous?.content?.ranking?.length ?? null;
  if (ranking.length === 0) {
    criticals.push('gatilho 2: ranking vazio');
  } else if (previousCount) {
    const drop = (previousCount - ranking.length) / previousCount;
    if (drop > COUNT_DROP_LIMIT) {
      criticals.push(
        `gatilho 2: itens caíram de ${previousCount} para ${ranking.length} `
        + `(-${(drop * 100).toFixed(0)}%, limite ${COUNT_DROP_LIMIT * 100}%)`,
      );
    }
  }

  // Gatilho 3 — ordenação, posição, duplicidade e coerência de perfil/action.
  const contract = validateRankingContract(ranking, {
    strategy: WEEKLY_STRATEGY,
    requireNonEmpty: false,
  });
  if (!contract.ok) {
    // O erro de `action` já saiu no gatilho 1; aqui fica o resto do invariante.
    const rest = contract.errors.filter((e) => !/action incoerente/.test(e));
    if (rest.length) criticals.push(`gatilho 3: ${rest.slice(0, 8).join('; ')}`);
  }
  // Monotonia explícita: o contrato usa o comparador com desempate estrutural, e
  // o card pede o cheque direto do score decrescente.
  const outOfOrder = [];
  for (let i = 1; i < ranking.length; i += 1) {
    if ((Number(ranking[i - 1].score) || 0) < (Number(ranking[i].score) || 0)) {
      outOfOrder.push(`${ranking[i - 1].ticker}@${ranking[i - 1].score} antes de ${ranking[i].ticker}@${ranking[i].score}`);
    } else if (compareRankingItems(ranking[i - 1], ranking[i]) > 0 && contract.ok) {
      outOfOrder.push(`${ranking[i - 1].ticker} x ${ranking[i].ticker} (desempate estrutural)`);
    }
  }
  if (outOfOrder.length) {
    criticals.push(`gatilho 3: score fora de ordem: ${outOfOrder.slice(0, 5).join('; ')}`);
  }

  // Gatilho 4 — fundamento velho DENTRO da lista. Fora da lista não conta: é o
  // item pendente da blacklist da B3, explicitamente fora deste card.
  const maxAgeMs = FUNDAMENTALS_HEALTH_MAX_AGE_HOURS * 3600000;
  const stale = [];
  const missing = [];
  for (const item of ranking) {
    const entry = fundamentals.get(normalizeRankingTicker(item.ticker));
    if (!entry?.at) { missing.push(item.ticker); continue; }
    const age = now - new Date(entry.at);
    if (age > maxAgeMs) stale.push(`${item.ticker} (${fmtAge(age)}${entry.viaFallback ? ', via updatedAt' : ''})`);
  }
  if (stale.length) {
    criticals.push(
      `gatilho 4: ${stale.length} item(ns) na lista com fundamento acima de `
      + `${FUNDAMENTALS_HEALTH_MAX_AGE_HOURS}h: ${stale.slice(0, 8).join(', ')}`,
    );
  }
  if (missing.length) {
    criticals.push(`gatilho 4: ${missing.length} item(ns) na lista sem MarketAsset: ${missing.slice(0, 8).join(', ')}`);
  }

  return {
    classe: assetClass,
    itens: ranking.length,
    comprar: ranking.filter((i) => i.action === 'BUY').length,
    itensAnterior: previousCount,
    createdAt: current.createdAt,
    retidos: ranking.filter((i) => i.retention).length,
    saidasRetencao: (current.retentionExits || []).length,
    criticals,
  };
};

/** Brasil 10 — 5 ações + 5 FIIs, e giro contra a última publicação de verdade. */
const auditBrasil10 = async (current) => {
  const ranking = current?.content?.ranking || [];
  const criticals = [];
  const stocks = ranking.filter((i) => i.type !== 'FII').length;
  const fiis = ranking.filter((i) => i.type === 'FII').length;
  if (ranking.length && (stocks !== 5 || fiis !== 5)) {
    criticals.push(`gatilho 2: composição ${stocks} ações + ${fiis} FIIs (esperado 5 + 5)`);
  }
  const [published] = await MarketAnalysis
    .find({ assetClass: 'BRASIL_10', strategy: WEEKLY_STRATEGY, isRankingPublished: true })
    .sort({ createdAt: -1 }).limit(1).select(RANKING_FIELDS)
    .lean();
  return {
    composicao: `${stocks} ações + ${fiis} FIIs`,
    jaccard: published ? jaccard(tickerSet(published.content?.ranking), tickerSet(ranking)) : null,
    publicacaoBase: published?.createdAt || null,
    criticals,
  };
};

const pad = (value, width, right = false) => {
  const text = String(value);
  return right ? text.padStart(width) : text.padEnd(width);
};

let exitCode = 2;
await connectScriptDb({ label: 'auditRankingRun' });
try {
  const now = new Date();
  const fundamentals = await buildFundamentalsIndex();
  const sync = readSyncErrors();
  const gate = await auditFundamentalsGate(now);
  const contamination = await auditCrossContamination();

  const report = {
    geradoEm: now.toISOString(), classes: [], sync, gate, contamination, criticals: [],
  };

  for (const assetClass of CLASSES) {
    const [current, previous] = await latestAnalyses(assetClass, WEEKLY_STRATEGY, 2);
    const row = auditClass(assetClass, current, previous, fundamentals, now);
    if (assetClass === 'BRASIL_10') {
      const extra = await auditBrasil10(current);
      row.composicao = extra.composicao;
      row.jaccard = extra.jaccard;
      row.publicacaoBase = extra.publicacaoBase;
      row.criticals.push(...extra.criticals);
    }
    report.classes.push(row);
  }

  // Gatilhos globais (5, 6, 7) — valem para a apuração inteira.
  if (!sync.found) {
    report.criticals.push('gatilho 5: server/logs/sync-report.txt não encontrado — sync não rodou?');
  } else if (sync.errors === null) {
    report.criticals.push('gatilho 5: seção [ERROS] ausente no relatório do sync');
  } else if (sync.errors > 0) {
    report.criticals.push(`gatilho 5: ${sync.errors} erro(s) no sync: ${sync.lines.slice(0, 5).join(' | ')}`);
  }
  if (!gate.healthy) {
    report.criticals.push(`gatilho 6: fundamentos BR não saudáveis (${gate.errorCode || 'sem código'})`);
  }
  if (gate.ingestionOk === false) {
    report.criticals.push(`gatilho 6: validateFundamentusIngestion reprovou — ${gate.ingestionReason}`);
  }
  for (const [assetClass, result] of Object.entries(gate.perClass)) {
    if (!result.ok) report.criticals.push(`gatilho 6 (${assetClass}): ${result.reason}`);
  }
  for (const hit of contamination) {
    report.criticals.push(
      `gatilho 7: ${hit.strategy}/${hit.assetClass} contaminado — ${hit.totalItens} item(ns) `
      + `com \`${hit.campo}\` e ${hit.saidas} \`${hit.campoDoc}\``,
    );
  }
  report.criticals.push(...report.classes.flatMap((c) => c.criticals.map((m) => `${c.classe}: ${m}`)));

  report.veredito = report.criticals.length ? 'CRÍTICO' : 'LIMPO';
  exitCode = report.criticals.length ? 1 : 0;

  const buyBelowCount = report.classes
    .reduce((n, c) => n + c.criticals.filter((m) => m.startsWith('gatilho 1')).length, 0);

  console.log('');
  console.log('════ AUDITORIA DA APURAÇÃO — somente leitura ════');
  console.log(`relatório do sync: ${sync.found ? sync.mtime.toISOString() : 'AUSENTE'}`
    + ` · erros ${sync.errors ?? '?'} · avisos ${sync.warnings ?? '?'} · alertas perf ${sync.perfAlerts ?? '?'}`);
  console.log(`portão de fundamentos: ${gate.healthy ? 'ok' : 'REPROVADO'}`
    + ` · ingestão ${gate.ingestionOk === null ? '—' : (gate.ingestionOk ? 'ok' : 'REPROVADA')}`
    + ` · ${gate.counts ? Object.entries(gate.counts).map(([k, v]) => `${k} ${v}`).join(' · ') : 'sem stats'}`
    + ` · idade ${gate.ageHours === null ? '—' : `${gate.ageHours.toFixed(1)}h`}`);
  console.log(`contaminação entre estratégias: ${contamination.length ? 'ENCONTRADA' : 'nenhuma'}`);
  console.log('');
  console.log('classe       itens  anterior  COMPRAR  retidos  saídas  gerado em            crítico');
  console.log('──────────────────────────────────────────────────────────────────────────────────────');
  for (const c of report.classes) {
    console.log(
      `${pad(c.classe, 12)}${pad(c.itens, 5, true)}  ${pad(c.itensAnterior ?? '—', 8, true)}`
      + `  ${pad(c.comprar, 7, true)}  ${pad(c.retidos, 7, true)}  ${pad(c.saidasRetencao, 6, true)}`
      + `  ${pad(c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 19) : '—', 19)}`
      + `  ${c.criticals.length ? `SIM (${c.criticals.length})` : 'não'}`,
    );
  }
  const b10 = report.classes.find((c) => c.classe === 'BRASIL_10');
  if (b10) {
    console.log('');
    console.log(`Brasil 10: ${b10.composicao} · Jaccard `
      + `${b10.jaccard === null ? '—' : b10.jaccard.toFixed(3)} contra a publicação de `
      + `${b10.publicacaoBase ? new Date(b10.publicacaoBase).toISOString().slice(0, 10) : '—'}`);
  }
  console.log('');
  if (report.criticals.length) {
    for (const item of report.criticals) console.log(`  ✖ ${item}`);
    console.log('');
  }
  console.log(`VEREDITO: ${report.veredito}`
    + `${report.veredito === 'LIMPO' ? '' : ` — ${report.criticals.length} achado(s)`}`);
  console.log(`Contrato do ${BUY_THRESHOLD}: COMPRAR com score abaixo do limiar — `
    + `${buyBelowCount === 0 ? 'NENHUM em nenhuma classe' : 'HÁ VIOLAÇÃO'}`);
  console.log('');

  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(report, null, 1));
    console.log(`JSON: ${path.resolve(JSON_OUT)}`);
  }
} finally {
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
}
process.exit(exitCode);
