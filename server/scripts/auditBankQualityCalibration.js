/**
 * Medicao read-only complementar: a nota de QUALITY de banco e comparavel com a
 * de uma industria, e quanto do eixo setorial/ancora ja esta saturado?
 *
 * Perguntas:
 *  1. Que fracao de cada arquetipo encosta em quality 100? (comparabilidade)
 *  2. Para a industria, quantos tiram o degrau maximo em CADA um dos 4 insumos?
 *     (a escada de ROE e generosa por desenho, ou so para banco?)
 *  3. Quanto do eixo de durabilidade (setorial e ancora) ja esta saturado para
 *     banco, contando structuralQuality E o proprio ramp de roeTtm?
 *  4. Como ficariam as notas sob escadas candidatas.
 *
 * NAO grava nada.
 * Uso: node server/scripts/auditBankQualityCalibration.js
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

const fmt = (value, digits = 1) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-');
const pad = (v, w) => String(v).padEnd(w);
const padStart = (v, w) => String(v).padStart(w);
const ramp = (value, best, worst) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (worst > best) return Math.max(0, Math.min(100, ((v - best) / (worst - best)) * 100));
  return Math.max(0, Math.min(100, ((best - v) / (best - worst)) * 100));
};

await connectScriptDb({ label: 'auditBankQualityCalibration' });
try {
  const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
  const context = {
    MACRO: macro
      ? { SELIC: macro.selic, IPCA: macro.ipca, RISK_FREE: macro.riskFree, NTNB_LONG: macro.ntnbLong, RATES_STALE: !!macro.ratesStale }
      : { SELIC: 15, IPCA: 4.5, RISK_FREE: 15, NTNB_LONG: 7.25, RATES_STALE: true },
  };
  console.log(`MACRO: SELIC=${fmt(context.MACRO.SELIC)} NTNB_LONG=${fmt(context.MACRO.NTNB_LONG)} stale=${context.MACRO.RATES_STALE}`);

  const raw = await marketDataService.getMarketData('STOCK');
  const all = [];
  for (const asset of raw) {
    const scored = scoringEngine.processAsset(asset, context);
    if (!scored || scored._discarded) continue;
    all.push({
      ticker: asset.ticker,
      archetype: classifyStockArchetype(asset),
      quality: scored.metrics?.structural?.quality,
      m: scored.metrics,
      sector: asset.sectorMetrics || {},
      raw: asset.metrics,
    });
  }

  console.log('\n=== 1. QUALITY 100 POR ARQUETIPO ===');
  console.log(pad('ARQUETIPO', 32) + padStart('n', 5) + padStart('q=100', 7) + padStart('%', 7) + padStart('mediana', 9) + padStart('distintos', 11));
  const byArch = new Map();
  for (const a of all) byArch.set(a.archetype, [...(byArch.get(a.archetype) || []), a]);
  for (const [arch, list] of [...byArch.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const qs = list.map(a => a.quality).sort((x, y) => x - y);
    const hundreds = qs.filter(q => q >= 100).length;
    console.log(
      pad(arch, 32) + padStart(list.length, 5) + padStart(hundreds, 7)
      + padStart(fmt((hundreds / list.length) * 100, 0), 7)
      + padStart(fmt(qs[Math.floor(qs.length / 2)], 0), 9)
      + padStart(new Set(qs).size, 11),
    );
  }

  console.log('\n=== 2. DEGRAU MAXIMO POR INSUMO (so OPERATIONAL, escada industrial) ===');
  const ops = all.filter(a => a.archetype === STOCK_ARCHETYPES.OPERATIONAL);
  const grades = {
    roe: v => (v > 15 ? 100 : v > 10 ? 60 : 0),
    netMargin: v => (v > 10 ? 100 : v > 5 ? 60 : 0),
    debtToEquity: v => (v < 1.0 ? 100 : v < 2.0 ? 60 : -40),
    revenueGrowth: v => (v > 10 ? 100 : v > 5 ? 40 : 0),
  };
  console.log(pad('INSUMO', 16) + padStart('observados', 12) + padStart('nota max', 10) + padStart('%', 7));
  for (const [key, grade] of Object.entries(grades)) {
    const observed = ops.map(a => Number(a.m[key])).filter(Number.isFinite);
    const top = observed.filter(v => grade(v) === 100).length;
    console.log(pad(key, 16) + padStart(observed.length, 12) + padStart(top, 10) + padStart(fmt((top / (observed.length || 1)) * 100, 0), 7));
  }

  const banks = all.filter(a => a.archetype === STOCK_ARCHETYPES.BANK)
    .sort((a, b) => Number(b.sector.roeTtm) - Number(a.sector.roeTtm));

  console.log('\n=== 3. SATURACAO DO EIXO DE DURABILIDADE (BANCO) ===');
  console.log('setorial: 0.25 quality + 0.30 ramp(roeTtm,8,25) + 0.20 growth + 0.25 custoOp');
  console.log('ancora  : 0.40 quality + 0.35 ramp(roeTtm,8,25) + 0.25 growth');
  console.log(pad('TICKER', 8) + padStart('roeTtm', 8) + padStart('QUAL', 6) + padStart('rampROE', 9) + padStart('satSet', 8) + padStart('satAnc', 8));
  for (const b of banks) {
    const rp = ramp(b.sector.roeTtm, 8, 25);
    const qSat = b.quality >= 100 ? 1 : 0;
    const rSat = rp >= 100 ? 1 : 0;
    console.log(
      pad(b.ticker, 8) + padStart(fmt(b.sector.roeTtm), 8) + padStart(fmt(b.quality, 0), 6)
      + padStart(fmt(rp, 0), 9)
      + padStart(fmt((qSat * 0.25 + rSat * 0.30) * 100, 0) + '%', 8)
      + padStart(fmt((qSat * 0.40 + rSat * 0.35) * 100, 0) + '%', 8),
    );
  }

  console.log('\n=== 4. ESCADAS CANDIDATAS SOBRE roeTtm ===');
  const candidates = {
    'ATUAL      >15/>10': v => (v > 15 ? 100 : v > 10 ? 60 : 0),
    'A rescale  >22.5/>15': v => (v > 22.5 ? 100 : v > 15 ? 60 : 0),
    'B 4 degraus>25/>20/>15': v => (v > 25 ? 100 : v > 20 ? 75 : v > 15 ? 45 : 0),
    'C rampa    12->30': v => ramp(v, 12, 30),
  };
  const payoutDelta = p => (p > 100 ? -30 : p > 40 && p < 85 ? 15 : p > 0 && p < 20 ? -5 : 0);
  console.log(pad('TICKER', 8) + padStart('roeTtm', 8) + padStart('pay', 6)
    + Object.keys(candidates).map(k => padStart(k.split(' ')[0], 8)).join(''));
  for (const b of banks) {
    const v = Number(b.sector.roeTtm);
    const d = payoutDelta(Number(b.raw.payout) || 0);
    console.log(
      pad(b.ticker, 8) + padStart(fmt(v), 8) + padStart(d, 6)
      + Object.values(candidates).map(f => padStart(fmt(Math.max(0, Math.min(100, f(v) + d)), 0), 8)).join(''),
    );
  }
  console.log('\n(nota final = degrau + delta de payout, clampado 0-100)');
  for (const [name, f] of Object.entries(candidates)) {
    const finals = banks.map(b => Math.max(0, Math.min(100, f(Number(b.sector.roeTtm)) + payoutDelta(Number(b.raw.payout) || 0))));
    const distinct = new Set(finals.map(x => Math.round(x))).size;
    const hundreds = finals.filter(x => x >= 100).length;
    const zeros = finals.filter(x => x <= 0).length;
    console.log(`${pad(name, 24)} distintos=${padStart(distinct, 3)}/11  em 100=${padStart(hundreds, 3)}  em 0=${padStart(zeros, 3)}  mediana=${padStart(fmt([...finals].sort((a, c) => a - c)[5], 0), 4)}`);
  }
} finally {
  await mongoose.disconnect();
}
