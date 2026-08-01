/**
 * Backfill idempotente da classe econômica de ETFs da B3.
 *
 * Uso:
 *   node server/scripts/migrateEtfAllocationClass.js          # dry-run
 *   node server/scripts/migrateEtfAllocationClass.js --apply  # persiste
 *
 * Não altera type, currency, quantidades, custos nem transações.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { BR_ETF_LIST } from '../config/brEtfList.js';
import { resolveAllocationClass } from '../utils/assetAllocation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida.');
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const classification = BR_ETF_LIST.map((asset) => ({
    ticker: asset.ticker,
    allocationClass: resolveAllocationClass({ ...asset, type: 'ETF' }),
  }));
  const tickers = classification.map((asset) => asset.ticker);

  const [marketBefore, positionsBefore] = await Promise.all([
    db.collection('marketassets').countDocuments({
      ticker: { $in: tickers },
      $or: classification.map(({ ticker, allocationClass }) => ({ ticker, allocationClass: { $ne: allocationClass } })),
    }),
    db.collection('userassets').countDocuments({
      type: 'ETF',
      ticker: { $in: tickers },
      $or: classification.map(({ ticker, allocationClass }) => ({ ticker, allocationClass: { $ne: allocationClass } })),
    }),
  ]);

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: ${marketBefore} MarketAsset(s) e ${positionsBefore} posição(ões) precisam de atualização.`);

  if (apply) {
    const marketOps = classification.map(({ ticker, allocationClass }) => ({
      updateOne: { filter: { ticker, type: 'ETF' }, update: { $set: { allocationClass } } },
    }));
    const positionOps = classification.map(({ ticker, allocationClass }) => ({
      updateMany: { filter: { ticker, type: 'ETF' }, update: { $set: { allocationClass, updatedAt: new Date() } } },
    }));
    const [marketResult, positionResult] = await Promise.all([
      db.collection('marketassets').bulkWrite(marketOps, { ordered: false }),
      db.collection('userassets').bulkWrite(positionOps, { ordered: false }),
    ]);
    console.log(`Atualizados: ${marketResult.modifiedCount} MarketAsset(s), ${positionResult.modifiedCount} posição(ões).`);
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(`Falha no backfill: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
