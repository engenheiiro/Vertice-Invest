/**
 * Valida e sincroniza o snapshot oficial OIL_GAS_PRODUCER em shadow.
 * Default: dry-run. `--persist` grava apenas stockArchetype/sectorMetrics.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { OIL_GAS_SECTOR_METRICS_1Q26 } from '../config/stockOilGasMetricsSnapshot1Q26.js';
import { validateStockSectorMetrics } from '../schemas/stockSectorMetricsSchemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const persist = new Set(process.argv.slice(2)).has('--persist');
const collectedAt = new Date();
const validated = {};
const errors = {};

for (const [issuer, payload] of Object.entries(OIL_GAS_SECTOR_METRICS_1Q26)) {
  try {
    validated[issuer] = validateStockSectorMetrics({ ...payload, collectedAt });
  } catch (error) {
    errors[issuer] = error.message;
  }
}

const output = {
  mode: persist ? 'PERSIST' : 'DRY_RUN',
  methodologyVersion: 'OFFICIAL_OIL_GAS_1Q26_V1',
  expectedIssuers: Object.keys(OIL_GAS_SECTOR_METRICS_1Q26).length,
  validatedIssuers: Object.keys(validated).length,
  errors,
  results: validated,
  writesPerformed: false,
};

if (persist && Object.keys(errors).length > 0) {
  throw new Error(`Persistencia bloqueada: ${JSON.stringify(errors)}`);
}

if (persist) {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const assets = await MarketAsset.find({ type: 'STOCK' }).select('_id ticker').lean();
    const represented = new Set();
    const operations = [];

    for (const [issuer, metrics] of Object.entries(validated)) {
      const ids = assets
        .filter(asset => String(asset.ticker).slice(0, 4).toUpperCase() === issuer)
        .map(asset => asset._id);
      if (ids.length === 0) continue;
      represented.add(issuer);
      const { archetype, ...sectorMetrics } = metrics;
      operations.push({
        updateMany: {
          filter: { _id: { $in: ids } },
          update: { $set: { stockArchetype: archetype, sectorMetrics } },
        },
      });
    }

    const missingDatabaseIssuers = Object.keys(validated).filter(issuer => !represented.has(issuer));
    if (missingDatabaseIssuers.length > 0) {
      throw new Error(`Persistencia bloqueada: emissores ausentes no MongoDB: ${missingDatabaseIssuers.join(', ')}`);
    }

    const result = operations.length ? await MarketAsset.bulkWrite(operations) : null;
    output.writesPerformed = true;
    output.matched = result?.matchedCount || 0;
    output.modified = result?.modifiedCount || 0;
  } finally {
    await mongoose.disconnect();
  }
}

console.log(JSON.stringify(output, null, 2));
