/**
 * Coleta oficial IFData para bancos listados.
 * Default: dry-run. Use --persist somente após revisar a saída.
 *
 * Uso:
 *   node server/scripts/syncBankIfDataShadow.js --base=202603
 *   node server/scripts/syncBankIfDataShadow.js --base=202603 --persist
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { BANK_IFDATA_ISSUERS, issuerRootFromTicker } from '../config/bankIfDataMap.js';
import {
  assessBankCollectionForPersistence,
  fetchBankSectorMetricsUniverse,
} from '../services/bcbIfDataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = new Set(process.argv.slice(2));
const baseArg = [...args].find(arg => arg.startsWith('--base='));
const baseDate = Number(baseArg?.split('=')[1]);
const persist = args.has('--persist');
const reconcile = args.has('--reconcile') || persist;

if (!/^\d{6}$/.test(String(baseDate))) {
  throw new Error('Informe a data-base trimestral, por exemplo --base=202603');
}

const collection = await fetchBankSectorMetricsUniverse({ baseDate });
const validation = assessBankCollectionForPersistence(collection);
const output = {
  mode: persist ? 'PERSIST' : 'DRY_RUN',
  baseDate,
  methodologyVersion: collection.methodologyVersion,
  collected: Object.keys(collection.results).length,
  failed: Object.keys(collection.errors).length,
  errors: collection.errors,
  results: Object.fromEntries(Object.entries(collection.results).map(([issuer, metrics]) => [issuer, {
    institutionCode: BANK_IFDATA_ISSUERS[issuer].institutionCode,
    metrics,
  }])),
  validation,
  writesPerformed: false,
};

if (reconcile) {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const assets = await MarketAsset.find({ type: 'STOCK' })
      .select('_id ticker roe isActive stockArchetype sectorMetrics')
      .lean();
    const bankAssets = assets.filter(asset => BANK_IFDATA_ISSUERS[issuerRootFromTicker(asset.ticker)]);
    const representedIssuers = [...new Set(bankAssets.map(asset => issuerRootFromTicker(asset.ticker)))].sort();
    const missingDatabaseIssuers = Object.keys(BANK_IFDATA_ISSUERS)
      .filter(issuer => !representedIssuers.includes(issuer));

    output.reconciliation = {
      databaseAssets: bankAssets.length,
      representedIssuers: representedIssuers.length,
      missingDatabaseIssuers,
      assets: bankAssets
        .map(asset => {
          const issuer = issuerRootFromTicker(asset.ticker);
          const officialRoe = collection.results[issuer]?.roeTtm;
          const currentRoe = Number.isFinite(Number(asset.roe)) ? Number(asset.roe) : null;
          const roeDeltaPp = currentRoe != null && officialRoe != null
            ? Number((officialRoe - currentRoe).toFixed(2))
            : null;
          return {
            ticker: asset.ticker,
            active: asset.isActive,
            currentGenericRoe: currentRoe,
            officialPrudentialRoeTtm: officialRoe ?? null,
            roeDeltaPp,
            reviewRoeDivergence: roeDeltaPp != null && Math.abs(roeDeltaPp) > 10,
            currentShadowMethodology: asset.sectorMetrics?.methodologyVersion || null,
          };
        })
        .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    };

    if (!persist) {
      process.exitCode = validation.ready && missingDatabaseIssuers.length === 0 ? 0 : 1;
    } else {
      if (!validation.ready) {
        throw new Error(`Persistencia bloqueada pelo guard IFData: ${validation.errors.join('; ')}`);
      }
      if (missingDatabaseIssuers.length > 0) {
        throw new Error(`Persistencia bloqueada: emissores sem ativo no banco: ${missingDatabaseIssuers.join(', ')}`);
      }

    const operations = [];

    for (const [issuer, metrics] of Object.entries(collection.results)) {
      const ids = assets
        .filter(asset => issuerRootFromTicker(asset.ticker) === issuer)
        .map(asset => asset._id);
      if (ids.length === 0) continue;
      const { archetype, ...sectorMetrics } = metrics;
      operations.push({
        updateMany: {
          filter: { _id: { $in: ids } },
          update: { $set: { stockArchetype: archetype, sectorMetrics } },
        },
      });
    }

    const result = operations.length ? await MarketAsset.bulkWrite(operations) : null;
    output.writesPerformed = true;
    output.matched = result?.matchedCount || 0;
    output.modified = result?.modifiedCount || 0;
    }
  } finally {
    await mongoose.disconnect();
  }
}

console.log(JSON.stringify(output, null, 2));
