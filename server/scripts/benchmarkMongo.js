/**
 * Explain read-only das queries de histórico priorizadas na auditoria.
 * BENCHMARK_WALLET_ID é opcional; sem ele usa uma carteira que já possua
 * transações. Nunca imprime ids, tickers ou documentos.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { MONGO_CONNECT_OPTIONS } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : undefined);

const mongoUri = process.env.MONGO_URI;
const walletId = process.env.BENCHMARK_WALLET_ID;
const ticker = String(process.env.BENCHMARK_TICKER || '').trim().toUpperCase();
const limit = Math.max(1, Math.min(200, Number(process.env.BENCHMARK_QUERY_LIMIT) || 20));

if (!mongoUri) throw new Error('MONGO_URI não configurada.');
if (walletId && !mongoose.Types.ObjectId.isValid(walletId)) throw new Error('BENCHMARK_WALLET_ID inválido.');

const findStages = (node, stages = []) => {
  if (!node || typeof node !== 'object') return stages;
  if (typeof node.stage === 'string') stages.push(node.stage);
  for (const value of Object.values(node)) findStages(value, stages);
  return [...new Set(stages)];
};

const summarize = (name, explain) => {
  const stats = explain.executionStats || {};
  return {
    name,
    executionTimeMillis: stats.executionTimeMillis ?? null,
    nReturned: stats.nReturned ?? null,
    totalKeysExamined: stats.totalKeysExamined ?? null,
    totalDocsExamined: stats.totalDocsExamined ?? null,
    stages: findStages(stats.executionStages),
  };
};

try {
  await mongoose.connect(mongoUri, {
    ...MONGO_CONNECT_OPTIONS,
    autoIndex: false,
    minPoolSize: 0,
    maxPoolSize: 2,
    monitorCommands: false,
  });

  const db = mongoose.connection.db;
  const sampledTransaction = walletId
    ? null
    : await db.collection('assettransactions').findOne(
        { wallet: { $type: 'objectId' } },
        { projection: { wallet: 1 } },
      );
  const walletObjectId = walletId ? new mongoose.Types.ObjectId(walletId) : sampledTransaction?.wallet;
  if (!walletObjectId) throw new Error('Nenhuma carteira com transações disponível para o benchmark.');
  const wallet = await db.collection('wallets').findOne({ _id: walletObjectId }, { projection: { user: 1 } });
  if (!wallet?.user) throw new Error('Carteira de benchmark não encontrada.');

  const baseFilter = { user: wallet.user, wallet: walletObjectId };
  const sampledTickerTransaction = ticker
    ? null
    : await db.collection('assettransactions').findOne(baseFilter, { projection: { ticker: 1 } });
  const effectiveTicker = ticker || sampledTickerTransaction?.ticker;
  const queries = [
    {
      name: 'cash-flow-by-wallet',
      cursor: db.collection('assettransactions').find(baseFilter).sort({ date: -1, createdAt: -1 }).limit(limit),
    },
    {
      name: 'wallet-snapshots-ascending',
      cursor: db.collection('walletsnapshots').find(baseFilter).sort({ date: 1 }).limit(limit),
    },
  ];
  if (effectiveTicker) {
    queries.push({
      name: 'transactions-by-ticker',
      cursor: db.collection('assettransactions').find({ ...baseFilter, ticker: effectiveTicker }).sort({ date: -1, createdAt: -1 }).limit(limit),
    });
  }

  const results = [];
  for (const query of queries) results.push(summarize(query.name, await query.cursor.explain('executionStats')));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), limit, results }, null, 2));
} finally {
  await mongoose.disconnect();
}
