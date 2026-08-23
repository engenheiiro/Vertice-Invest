/**
 * Medicao read-only: a nota de QUALITY de banco cabe na MESMA distribuicao das
 * acoes operacionais, contra as quais ela e ordenada no ranking?
 *
 * O ranking ordena banco e industria na mesma lista. Se a regua de banco (um
 * insumo) produzir uma distribuicao mais extrema que a da industria (media de
 * quatro insumos), a comparacao passa a premiar/punir por arquetipo em vez de
 * por fundamento. Este script mede os percentis dos dois lados e simula onde
 * cada par de extremos (floor, cap) da rampa colocaria os bancos.
 *
 * NAO grava nada.
 * Uso: node server/scripts/auditQualityComparability.js
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

const fmt = (v, d = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '-');
const pad = (v, w) => String(v).padEnd(w);
const padStart = (v, w) => String(v).padStart(w);
const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))] : null);

await connectScriptDb({ label: 'auditQualityComparability' });
try {
  const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
  const context = {
    MACRO: macro
      ? { SELIC: macro.selic, IPCA: macro.ipca, RISK_FREE: macro.riskFree, NTNB_LONG: macro.ntnbLong, RATES_STALE: !!macro.ratesStale }
      : { SELIC: 15, IPCA: 4.5, RISK_FREE: 15, NTNB_LONG: 7.25, RATES_STALE: true },
  };

  const raw = await marketDataService.getMarketData('STOCK');
  const ops = [];
  const banks = [];
  for (const asset of raw) {
    const scored = scoringEngine.processAsset(asset, context);
    if (!scored || scored._discarded) continue;
    const archetype = classifyStockArchetype(asset);
    const quality = scored.metrics?.structural?.quality;
    if (archetype === STOCK_ARCHETYPES.OPERATIONAL) ops.push(quality);
    if (archetype === STOCK_ARCHETYPES.BANK) {
      banks.push({ ticker: asset.ticker, roeTtm: Number(asset.sectorMetrics?.roeTtm), payout: Number(asset.metrics?.payout) || 0 });
    }
  }
  ops.sort((a, b) => a - b);
  banks.sort((a, b) => b.roeTtm - a.roeTtm);

  console.log('\n=== PERCENTIS DE QUALITY: OPERACIONAL (a regua de comparacao) ===');
  console.log(`n=${ops.length}`);
  for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    console.log(`  p${padStart(Math.round(p * 100), 3)} = ${padStart(fmt(q(ops, p), 0), 4)}`);
  }
  console.log(`  fracao em 100: ${fmt((ops.filter(x => x >= 100).length / ops.length) * 100, 0)}%`);
  console.log(`  fracao em 0  : ${fmt((ops.filter(x => x <= 0).length / ops.length) * 100, 0)}%`);
  console.log(`  fracao <= 20 : ${fmt((ops.filter(x => x <= 20).length / ops.length) * 100, 0)}%`);

  const payoutDelta = p => (p > 100 ? -30 : p > 40 && p < 85 ? 15 : p > 0 && p < 20 ? -5 : 0);
  const simulate = (floor, cap) => banks.map(b => {
    const base = Math.max(0, Math.min(100, ((b.roeTtm - floor) / (cap - floor)) * 100));
    return { ticker: b.ticker, quality: Math.max(0, Math.min(100, base + payoutDelta(b.payout))) };
  });

  console.log('\n=== SIMULACAO DE EXTREMOS DA RAMPA ===');
  console.log('cada linha: mediana / minimo / maximo / distintos / em 100 / em 0 / maior distancia entre dois bancos');
  console.log(pad('floor-cap', 12) + padStart('mediana', 9) + padStart('min', 6) + padStart('max', 6)
    + padStart('distint', 9) + padStart('em100', 7) + padStart('<=20', 6) + padStart('amplitude', 11));
  const candidates = [[12, 30], [10, 35], [8, 35], [10, 40], [8, 40], [5, 35], [12, 25], [15, 30]];
  for (const [floor, cap] of candidates) {
    const sim = simulate(floor, cap).map(s => s.quality).sort((a, b) => a - b);
    console.log(
      pad(`${floor}-${cap}`, 12)
      + padStart(fmt(q(sim, 0.5), 0), 9)
      + padStart(fmt(sim[0], 0), 6)
      + padStart(fmt(sim[sim.length - 1], 0), 6)
      + padStart(new Set(sim.map(Math.round)).size, 9)
      + padStart(sim.filter(x => x >= 100).length, 7)
      + padStart(sim.filter(x => x <= 20).length, 6)
      + padStart(fmt(sim[sim.length - 1] - sim[0], 0), 11),
    );
  }

  console.log('\n=== NOTAS POR BANCO EM CADA CANDIDATO ===');
  console.log(pad('TICKER', 8) + padStart('roeTtm', 8) + candidates.map(([f, c]) => padStart(`${f}-${c}`, 8)).join(''));
  for (const b of banks) {
    console.log(
      pad(b.ticker, 8) + padStart(fmt(b.roeTtm), 8)
      + candidates.map(([f, c]) => padStart(fmt(simulate(f, c).find(s => s.ticker === b.ticker).quality, 0), 8)).join(''),
    );
  }
} finally {
  await mongoose.disconnect();
}
