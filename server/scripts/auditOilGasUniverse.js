/**
 * Inventario read-only do universo brasileiro de petroleo e gas.
 * Nao calcula ranking e nao persiste alteracoes.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import MarketAsset from '../models/MarketAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

await mongoose.connect(process.env.MONGO_URI);
try {
  const rows = await MarketAsset.find({
    type: 'STOCK',
    isActive: true,
    isIgnored: false,
    isBlacklisted: false,
    $or: [
      { sector: /Petr|Óleo|Oleo|Gás|Gas/i },
      { ticker: { $in: ['PETR3', 'PETR4', 'PRIO3', 'RECV3', 'BRAV3', 'ENAT3', 'RRRP3'] } },
    ],
  }).select([
    'ticker', 'name', 'sector', 'lastPrice', 'marketCap', 'avgLiquidity', 'liquidity',
    'pl', 'pvp', 'p_vp', 'roe', 'netMargin', 'revenueGrowth', 'dy', 'debtToEquity',
    'netDebt', 'evEbitda', 'stockArchetype', 'sectorMetrics',
  ].join(' ')).lean();

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    total: rows.length,
    assets: rows.sort((a, b) => a.ticker.localeCompare(b.ticker)),
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
