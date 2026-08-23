/**
 * Snapshot read-only de TODAS as superficies que um ajuste de scoring alcanca:
 * semanal STOCK / STOCK_US / FII, Brasil 10 e a lista ancora BUY_AND_HOLD.
 *
 * Serve ao ritual de 'medir o raio de alcance antes de commitar': rode uma vez
 * no HEAD, aplique a mudanca, rode de novo e compare os dois JSON.
 *
 * NAO grava nada. calculateRanking() persiste DiscardLog no caminho normal, e
 * por isso o insertMany e neutralizado ANTES do primeiro import do servico --
 * se algum dia surgir outra escrita ali dentro, ela precisa ser neutralizada
 * aqui do mesmo jeito, senao este script deixa de ser read-only.
 *
 * Uso: node server/scripts/auditRankingSurfaces.js > antes.json
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DiscardLog = (await import('../models/DiscardLog.js')).default;
DiscardLog.insertMany = async () => [];

const { aiResearchService, buildBrasil10 } = await import('../services/aiResearchService.js');
const { buyAndHoldService } = await import('../services/buyAndHoldService.js');

await connectScriptDb({ label: 'auditRankingSurfaces' });
try {
  const row = item => ({
    p: item.position, t: item.ticker, s: item.score,
    a: item.action, prof: item.riskProfile,
    q: item.metrics?.structural?.quality,
    v: item.metrics?.structural?.valuation,
    r: item.metrics?.structural?.risk,
  });

  const stock = await aiResearchService.calculateRanking('STOCK', 'BUY_HOLD');
  const stockUs = await aiResearchService.calculateRanking('STOCK_US', 'BUY_HOLD');
  const b10stock = await aiResearchService.calculateRanking('BRASIL_10', 'BUY_HOLD');
  const fii = await aiResearchService.calculateRanking('FII', 'BUY_HOLD');
  const brasil10 = buildBrasil10(
    b10stock.processedAssets.filter(a => a.type === 'STOCK'),
    b10stock.processedAssets.filter(a => a.type === 'FII'),
  );
  const anchor = await buyAndHoldService.generateBuyAndHoldRanking({ includeExcluded: true });

  console.log(JSON.stringify({
    STOCK: stock.ranking.map(row),
    STOCK_scoresAll: stock.processedAssets
      .map(a => ({ t: a.ticker, D: a.scores.DEFENSIVE, M: a.scores.MODERATE, B: a.scores.BOLD,
                   q: a.metrics?.structural?.quality, v: a.metrics?.structural?.valuation, r: a.metrics?.structural?.risk }))
      .sort((a, b) => a.t.localeCompare(b.t)),
    STOCK_US: stockUs.ranking.map(row),
    FII: fii.ranking.map(row),
    BRASIL_10: brasil10.map(row),
    ANCHOR: anchor.ranking.map(i => ({ p: i.position, t: i.ticker, s: i.score, a: i.action, axes: i.axes })),
    ANCHOR_excluded: (anchor.excluded || []).map(i => i.ticker).sort(),
  }, null, 1));
} finally {
  await mongoose.disconnect();
}
