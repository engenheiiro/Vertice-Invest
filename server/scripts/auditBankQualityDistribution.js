/**
 * Medicao read-only da distribuicao de QUALITY dos bancos.
 *
 * Responde as perguntas que precedem qualquer recalibracao da escada de ROE:
 *  - qual a distribuicao real de `sectorMetrics.roeTtm` (recorrente, IF.data/BCB)
 *    contra `metrics.roe` (contabil, Fundamentus) no universo BANK;
 *  - quantos bancos empatam em cada valor de `structural.quality` hoje;
 *  - quanto da nota vem do degrau de ROE e quanto vem do payout.
 *
 * NAO grava nada: o unico caminho de escrita do pipeline (DiscardLog.insertMany)
 * e neutralizado antes do primeiro import do scorer.
 *
 * Uso: node server/scripts/auditBankQualityDistribution.js
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

const { default: SystemConfig } = await import('../models/SystemConfig.js');
const { marketDataService } = await import('../services/marketDataService.js');
const { scoringEngine } = await import('../services/engines/scoringEngine.js');
const { classifyStockArchetype, STOCK_ARCHETYPES } = await import('../config/stockCalibration.js');

const fmt = (value, digits = 2) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-');
const pad = (value, width) => String(value).padEnd(width);
const padStart = (value, width) => String(value).padStart(width);

await connectScriptDb({ label: 'auditBankQualityDistribution' });
try {
  const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
  const context = {
    MACRO: macro
      ? { SELIC: macro.selic, IPCA: macro.ipca, RISK_FREE: macro.riskFree, NTNB_LONG: macro.ntnbLong, RATES_STALE: !!macro.ratesStale }
      : { SELIC: 15, IPCA: 4.5, RISK_FREE: 15, NTNB_LONG: 7.25, RATES_STALE: true },
  };

  const raw = await marketDataService.getMarketData('STOCK');
  const rows = [];
  const universe = [];

  for (const asset of raw) {
    const archetype = classifyStockArchetype(asset);
    const scored = scoringEngine.processAsset(asset, context);
    if (!scored || scored._discarded) continue;
    const quality = scored.metrics?.structural?.quality;
    universe.push({ ticker: asset.ticker, archetype, quality });
    if (archetype !== STOCK_ARCHETYPES.BANK) continue;

    const roeTtm = Number(asset.sectorMetrics?.roeTtm);
    const roeBook = Number(asset.metrics?.roe);
    const roeMissing = asset.metrics?._missing?.roe === true;
    const payout = Number(asset.metrics?.payout) || 0;
    const grade = value => (value > 15 ? 100 : value > 10 ? 60 : 0);
    const payoutDelta = payout > 100 ? -30 : payout > 40 && payout < 85 ? 15 : payout > 0 && payout < 20 ? -5 : 0;

    rows.push({
      ticker: asset.ticker,
      roeTtm: Number.isFinite(roeTtm) ? roeTtm : null,
      roeBook: roeMissing || !Number.isFinite(roeBook) ? null : roeBook,
      payout,
      payoutDelta,
      gradeRecurring: Number.isFinite(roeTtm) ? grade(roeTtm) : null,
      gradeBook: roeMissing || !Number.isFinite(roeBook) ? null : grade(roeBook),
      quality,
      valuation: scored.metrics?.structural?.valuation,
      risk: scored.metrics?.structural?.risk,
      scoreDef: scored.scores?.DEFENSIVE,
      scoreMod: scored.scores?.MODERATE,
      scoreBold: scored.scores?.BOLD,
      capitalRatio: Number(asset.sectorMetrics?.capitalRatio),
      delinquencyRatio: Number(asset.sectorMetrics?.delinquencyRatio),
      operatingCostRatio: Number(asset.sectorMetrics?.operatingCostRatio),
      earningsGrowth: Number(asset.sectorMetrics?.earningsGrowth),
    });
  }

  rows.sort((a, b) => (b.roeTtm ?? -1) - (a.roeTtm ?? -1));

  console.log('\n=== UNIVERSO ===');
  console.log(`STOCK processados (nao descartados): ${universe.length} | BANK: ${rows.length}`);

  console.log('\n=== BANCOS: ROE RECORRENTE x ROE CONTABIL x QUALITY ===');
  console.log(
    pad('TICKER', 8) + padStart('roeTtm', 8) + padStart('roeBook', 9) + padStart('razao', 7)
    + padStart('nota', 6) + padStart('notaBk', 7) + padStart('payout', 8) + padStart('dPay', 6)
    + padStart('QUAL', 6) + padStart('VAL', 5) + padStart('RISK', 6)
    + padStart('DEF', 5) + padStart('MOD', 5) + padStart('BOLD', 6),
  );
  for (const r of rows) {
    const ratio = r.roeTtm !== null && r.roeBook ? r.roeTtm / r.roeBook : null;
    console.log(
      pad(r.ticker, 8)
      + padStart(fmt(r.roeTtm), 8)
      + padStart(fmt(r.roeBook), 9)
      + padStart(ratio === null ? '-' : fmt(ratio), 7)
      + padStart(r.gradeRecurring ?? '-', 6)
      + padStart(r.gradeBook ?? '-', 7)
      + padStart(fmt(r.payout, 1), 8)
      + padStart(r.payoutDelta, 6)
      + padStart(fmt(r.quality, 0), 6)
      + padStart(fmt(r.valuation, 0), 5)
      + padStart(fmt(r.risk, 0), 6)
      + padStart(fmt(r.scoreDef, 0), 5)
      + padStart(fmt(r.scoreMod, 0), 5)
      + padStart(fmt(r.scoreBold, 0), 6),
    );
  }

  const sortedTtm = rows.filter(r => r.roeTtm !== null).map(r => r.roeTtm).sort((a, b) => a - b);
  const sortedBook = rows.filter(r => r.roeBook !== null).map(r => r.roeBook).sort((a, b) => a - b);
  const ratios = rows.filter(r => r.roeTtm !== null && r.roeBook).map(r => r.roeTtm / r.roeBook).sort((a, b) => a - b);
  const quantile = (list, q) => (list.length === 0 ? null : list[Math.min(list.length - 1, Math.floor(q * (list.length - 1)))]);

  console.log('\n=== DISTRIBUICAO DE ROE ===');
  const line = (label, list) => console.log(
    pad(label, 22)
    + ` n=${padStart(list.length, 3)}`
    + `  min=${padStart(fmt(list[0]), 7)}`
    + `  p25=${padStart(fmt(quantile(list, 0.25)), 7)}`
    + `  mediana=${padStart(fmt(quantile(list, 0.5)), 7)}`
    + `  p75=${padStart(fmt(quantile(list, 0.75)), 7)}`
    + `  max=${padStart(fmt(list[list.length - 1]), 7)}`,
  );
  line('roeTtm (recorrente)', sortedTtm);
  line('roe (contabil)', sortedBook);
  line('razao ttm/contabil', ratios);

  console.log('\n=== DEGRAU DA ESCADA ATUAL (>15 -> 100, >10 -> 60, senao 0) ===');
  const bucket = get => {
    const counts = { 100: 0, 60: 0, 0: 0, ausente: 0 };
    for (const r of rows) {
      const g = get(r);
      if (g === null) counts.ausente += 1;
      else counts[g] += 1;
    }
    return counts;
  };
  const byRec = bucket(r => r.gradeRecurring);
  const byBook = bucket(r => r.gradeBook);
  console.log(`recorrente (em uso): 100 -> ${byRec[100]} | 60 -> ${byRec[60]} | 0 -> ${byRec[0]} | ausente -> ${byRec.ausente}`);
  console.log(`contabil (anterior): 100 -> ${byBook[100]} | 60 -> ${byBook[60]} | 0 -> ${byBook[0]} | ausente -> ${byBook.ausente}`);

  console.log('\n=== EMPATES DE QUALITY (BANCOS) ===');
  const tie = new Map();
  for (const r of rows) tie.set(r.quality, [...(tie.get(r.quality) || []), r.ticker]);
  [...tie.entries()].sort((a, b) => b[0] - a[0]).forEach(([q, tickers]) => {
    console.log(`${padStart(q, 4)}: ${padStart(tickers.length, 2)} ativo(s)  ${tickers.join(', ')}`);
  });
  console.log(`valores distintos de quality entre ${rows.length} bancos: ${tie.size}`);

  console.log('\n=== EMPATES DE QUALITY (TODO O UNIVERSO STOCK, referencia) ===');
  const tieAll = new Map();
  for (const a of universe) tieAll.set(a.quality, (tieAll.get(a.quality) || 0) + 1);
  console.log(`valores distintos de quality entre ${universe.length} acoes: ${tieAll.size}`);
  const top = [...tieAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`notas mais repetidas: ${top.map(([q, n]) => `${q}(x${n})`).join('  ')}`);

  console.log('\n=== EIXOS SETORIAIS (discriminacao alternativa) ===');
  console.log(pad('TICKER', 8) + padStart('capital', 9) + padStart('inadimp', 9) + padStart('custoOp', 9) + padStart('lucroCr', 9));
  for (const r of rows) {
    console.log(
      pad(r.ticker, 8)
      + padStart(fmt(r.capitalRatio), 9)
      + padStart(fmt(r.delinquencyRatio), 9)
      + padStart(fmt(r.operatingCostRatio), 9)
      + padStart(fmt(r.earningsGrowth), 9),
    );
  }
} finally {
  await mongoose.disconnect();
}
