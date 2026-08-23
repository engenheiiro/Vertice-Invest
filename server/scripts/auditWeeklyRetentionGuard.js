/**
 * Medição dos AJUSTES da retenção de assento — card
 * CARD-RETENCAO-AJUSTES-2026-08-23. Roda o motor nas 7 classes contra o banco e
 * imprime os critérios de aceite 1 a 4, mais a comparação entre a guarda de
 * escopo estreito (a escolhida) e a alternativa conservadora.
 *
 * SOMENTE LEITURA. Nenhum `save/update/insert/bulkWrite/delete`, nenhum publish,
 * nenhum scheduler: só `calculateRanking` (que lê MarketAsset e SystemConfig) e
 * `find` em MarketAnalysis. A única escrita do caminho de `calculateRanking` é o
 * `DiscardLog.insertMany`, NEUTRALIZADO antes do primeiro import do serviço —
 * mesmo padrão de `auditWeeklyRetentionShadow.js`.
 *
 * Uso:
 *   node server/scripts/auditWeeklyRetentionGuard.js
 *   node server/scripts/auditWeeklyRetentionGuard.js --json
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { normalizeRankingTicker, finalizeRanking, validateRankingContract } =
  await import('../utils/rankingContract.js');
const { WEEKLY_HYSTERESIS } = await import('../config/weeklyHysteresis.js');
const { BUY_THRESHOLD } = await import('../config/financialConstants.js');

// Escrita neutralizada ANTES do import do serviço pesado.
const DiscardLog = (await import('../models/DiscardLog.js')).default;
DiscardLog.insertMany = async () => [];
const { aiResearchService, buildBrasil10, loadPublishedRankingBaseline } =
  await import('../services/aiResearchService.js');

const STRATEGY = 'BUY_HOLD';
const AS_JSON = process.argv.includes('--json');

const tickers = list => new Set((list || []).map(i => normalizeRankingTicker(i.ticker)).filter(Boolean));
const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
};
const baselineList = baseline => (baseline ? [...baseline.values()] : []);

/** Itens que violariam a regra inviolável, já com a `action` derivada. */
const buyBelowThreshold = (ranking) => finalizeRanking(ranking, null, { strategy: STRATEGY })
  .filter(i => i.action === 'BUY' && Number(i.score) < BUY_THRESHOLD)
  .map(i => `${i.ticker}@${i.score}`);

/**
 * Contrafactual da regra ALTERNATIVA (nunca deslocar assento com score maior
 * que o do retido), calculado sobre as retenções que a regra escolhida deixou
 * passar. Aproximação declarada: não simula a cascata (barrar uma retenção
 * libera orçamento para a seguinte), então é um LIMITE SUPERIOR do Jaccard dela.
 */
const alternativeRule = (audit, ranking, baseline) => {
  const blocked = (audit?.retained || []).filter(r => Number(r.displaced?.score) > Number(r.score));
  if (!blocked.length) return { blocked: [], jaccard: null };
  const out = new Set(blocked.map(r => normalizeRankingTicker(r.ticker)));
  const back = blocked.map(r => ({ ticker: r.displaced.ticker }));
  const counter = [...(ranking || []).filter(i => !out.has(normalizeRankingTicker(i.ticker))), ...back];
  return {
    blocked: blocked.map(r => `${r.ticker}@${r.score} deslocaria ${r.displaced.ticker}@${r.displaced.score}`),
    jaccard: jaccard(tickers(baselineList(baseline)), tickers(counter)),
  };
};

const summarize = (assetClass, ranking, audit, baseline) => {
  const finalized = finalizeRanking(ranking, null, { strategy: STRATEGY });
  const guardExits = (audit?.exits || []).filter(e => e.outcome === 'WOULD_DROP_BUY');
  return {
    classe: assetClass,
    itens: ranking.length,
    comprar: finalized.filter(i => i.action === 'BUY').length,
    jaccard: baseline ? jaccard(tickers(baselineList(baseline)), tickers(ranking)) : null,
    contratoOk: validateRankingContract(finalized, { strategy: STRATEGY, requireNonEmpty: false }).ok,
    buyAbaixoDe70: buyBelowThreshold(ranking),
    retidos: (audit?.retained || []).map(r => (
      `${r.ticker} ${r.previousScore}→${r.score} (${r.profile}/${r.action})`
      + (r.displaced ? ` desloca ${r.displaced.ticker}@${r.displaced.score}` : '')
    )),
    // Achado 1: quem a guarda barrou, e o texto que o assinante lê.
    barradosPelaGuarda: guardExits.map(e => `${e.ticker}@${e.score} — ${e.reason}`),
    // Achado 1, troca que reduziria COMPRAR: tem de ser SEMPRE zero.
    trocasQueReduziriamComprar: (audit?.retained || []).filter(r => (
      Number(r.displaced?.score) >= BUY_THRESHOLD && Number(r.score) < BUY_THRESHOLD
    )).map(r => `${r.ticker}@${r.score} x ${r.displaced.ticker}@${r.displaced.score}`),
    regraAlternativa: alternativeRule(audit, ranking, baseline),
    saidas: (audit?.exits || []).map(e => `${e.ticker}: ${e.reason}`),
  };
};

await connectScriptDb({ label: 'auditWeeklyRetentionGuard' });
const report = { config: WEEKLY_HYSTERESIS, classes: [] };
try {
  const processed = {};
  for (const assetClass of ['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'REIT', 'ETF']) {
    const live = await aiResearchService.calculateRanking(assetClass, STRATEGY);
    processed[assetClass] = live.processedAssets;
    report.classes.push(summarize(assetClass, live.ranking, live.retentionAudit, live.baseline));
  }

  const b10Baseline = await loadPublishedRankingBaseline('BRASIL_10', STRATEGY);
  let b10Audit = null;
  const b10 = buildBrasil10(processed.STOCK, processed.FII, {
    previous: b10Baseline,
    strategy: STRATEGY,
    onRetentionAudit: a => { b10Audit = a; },
  });
  report.classes.push({
    ...summarize('BRASIL_10', b10, b10Audit, b10Baseline),
    metades: `${b10.filter(i => i.type !== 'FII').length} ações + ${b10.filter(i => i.type === 'FII').length} FIIs`,
  });

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log('');
    console.log('════ AJUSTES DA RETENÇÃO — apuração ao vivo, somente leitura ════');
    console.log('classe      itens  COMPRAR  Jaccard  contrato  BUY<70  retidos  barrados');
    console.log('─────────────────────────────────────────────────────────────────────────');
    for (const c of report.classes) {
      console.log(
        `${c.classe.padEnd(11)} ${String(c.itens).padStart(5)}`
        + `  ${String(c.comprar).padStart(7)}`
        + `  ${(c.jaccard === null ? '—' : c.jaccard.toFixed(3)).padStart(7)}`
        + `  ${(c.contratoOk ? 'ok' : 'FALHA').padStart(8)}`
        + `  ${String(c.buyAbaixoDe70.length).padStart(6)}`
        + `  ${String(c.retidos.length).padStart(7)}`
        + `  ${String(c.barradosPelaGuarda.length).padStart(8)}`,
      );
    }
    console.log('');
    for (const c of report.classes) {
      if (!c.retidos.length && !c.barradosPelaGuarda.length && !c.saidas.length) continue;
      console.log(`── ${c.classe} ${'─'.repeat(Math.max(0, 60 - c.classe.length))}`);
      for (const r of c.retidos) console.log(`   retido:   ${r}`);
      for (const b of c.barradosPelaGuarda) console.log(`   BARRADO:  ${b}`);
      for (const s of c.saidas) console.log(`   saída:    ${s}`);
      if (c.regraAlternativa.jaccard !== null) {
        console.log(`   regra alternativa barraria ${c.regraAlternativa.blocked.length}: `
          + `Jaccard cairia para ${c.regraAlternativa.jaccard.toFixed(3)} (limite superior)`);
        for (const b of c.regraAlternativa.blocked) console.log(`     · ${b}`);
      }
      console.log('');
    }
    const violacoes = report.classes.flatMap(c => c.buyAbaixoDe70);
    const reduz = report.classes.flatMap(c => c.trocasQueReduziriamComprar);
    console.log(`CRITÉRIO 1 — BUY com score < ${BUY_THRESHOLD}: ${violacoes.length ? violacoes.join(', ') : 'nenhum'}`);
    console.log(`CRITÉRIO 2 — trocas que reduzem COMPRAR: ${reduz.length ? reduz.join(', ') : 'nenhuma'}`);
    const b10row = report.classes.find(c => c.classe === 'BRASIL_10');
    console.log(`CRITÉRIO 3 — Brasil 10: Jaccard ${b10row.jaccard?.toFixed(3)} (${b10row.metades})`);
  }
} finally {
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
}
