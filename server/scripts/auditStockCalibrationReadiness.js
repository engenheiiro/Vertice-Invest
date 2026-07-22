/**
 * Auditoria read-only de prontidão para STOCK_BH_SHADOW_V1.
 * Não calcula/publica ranking e não persiste alterações.
 * Uso: node server/scripts/auditStockCalibrationReadiness.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { assessStockMetricCoverage } from '../config/stockCalibration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TARGETS = new Set(['ITUB4', 'BBSE3', 'ABCB4', 'BBDC4', 'ITSA4', 'PSSA3', 'CXSE3', 'BBAS3']);

const missingFlags = asset => ({
  pl: !asset.pl,
  marketCap: !asset.marketCap,
  roe: !asset.roe,
  netMargin: !asset.netMargin,
  revenueGrowth: !asset.revenueGrowth,
  evEbitda: !asset.evEbitda,
  beta: !asset.beta,
});

const toCalibrationAsset = asset => ({
  ticker: asset.ticker,
  name: asset.name,
  sector: asset.sector,
  stockArchetype: asset.stockArchetype,
  price: asset.lastPrice,
  sectorMetrics: asset.sectorMetrics || {},
  metrics: {
    marketCap: asset.marketCap,
    avgLiquidity: asset.avgLiquidity || asset.liquidity,
    pl: asset.pl,
    pvp: asset.p_vp,
    roe: asset.roe,
    netMargin: asset.netMargin,
    revenueGrowth: asset.revenueGrowth,
    debtToEquity: asset.debtToEquity,
    evEbitda: asset.evEbitda,
    dy: asset.dy,
    payout: asset.payout,
    beta: asset.beta,
    volatility: asset.volatility,
    sma200: asset.sma200,
    _missing: missingFlags(asset),
  },
});

const increment = (target, key) => {
  target[key] = (target[key] || 0) + 1;
};

await mongoose.connect(process.env.MONGO_URI);
try {
  const assets = await MarketAsset.find({
    type: 'STOCK',
    isActive: true,
    isIgnored: false,
    isBlacklisted: false,
  }).lean();

  const summary = {};
  const targets = [];
  const financialUniverse = [];

  for (const raw of assets) {
    const asset = toCalibrationAsset(raw);
    const coverage = assessStockMetricCoverage(asset);
    const bucket = summary[coverage.archetype] ||= {
      total: 0,
      ready: 0,
      coverageTotal: 0,
      missingRequired: {},
    };
    bucket.total += 1;
    bucket.coverageTotal += coverage.requiredCoverage;
    if (coverage.readyForSectorCalibration) bucket.ready += 1;
    for (const metric of coverage.missingRequired) increment(bucket.missingRequired, metric);

    if (TARGETS.has(asset.ticker)) {
      targets.push({
        ticker: asset.ticker,
        sector: asset.sector,
        archetype: coverage.archetype,
        ready: coverage.readyForSectorCalibration,
        requiredCoverage: coverage.requiredCoverage,
        missingRequired: coverage.missingRequired,
        notApplicablePresent: coverage.notApplicablePresent,
      });
    }

    if (coverage.archetype !== 'OPERATIONAL') {
      financialUniverse.push({
        ticker: asset.ticker,
        name: asset.name,
        sector: asset.sector,
        archetype: coverage.archetype,
        ready: coverage.readyForSectorCalibration,
        requiredCoverage: coverage.requiredCoverage,
      });
    }
  }

  for (const bucket of Object.values(summary)) {
    bucket.averageRequiredCoverage = bucket.total
      ? Number((bucket.coverageTotal / bucket.total).toFixed(1))
      : 0;
    delete bucket.coverageTotal;
  }

  console.log(JSON.stringify({
    version: 'STOCK_BH_SHADOW_V1',
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    assets: assets.length,
    summary,
    financialUniverse: financialUniverse.sort((a, b) => (
      a.archetype.localeCompare(b.archetype) || a.ticker.localeCompare(b.ticker)
    )),
    targets: targets.sort((a, b) => a.ticker.localeCompare(b.ticker)),
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
