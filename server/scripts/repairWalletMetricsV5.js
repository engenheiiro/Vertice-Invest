/**
 * Migra snapshots/TWRR para o motor V5.
 *
 * Default = dry-run (históricos de mercado podem ser preenchidos no cache, mas
 * WalletSnapshot não é alterado).
 *
 * Uso:
 *   node server/scripts/repairWalletMetricsV5.js --email=x@y.com
 *   node server/scripts/repairWalletMetricsV5.js --apply --email=x@y.com
 *   node server/scripts/repairWalletMetricsV5.js --apply
 *   node server/scripts/repairWalletMetricsV5.js --rollback=<runId>
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import WalletSnapshotBackup from '../models/WalletSnapshotBackup.js';
import AssetTransaction from '../models/AssetTransaction.js';
import { financialService } from '../services/financialService.js';
import { isTwrrReturnAnomalous } from '../utils/walletSnapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const emailArg = args.find((a) => a.startsWith('--email='))?.slice(8).trim().toLowerCase();
const walletArg = args.find((a) => a.startsWith('--wallet='))?.slice(9).trim();
const rollbackRunId = args.find((a) => a.startsWith('--rollback='))?.slice(11).trim();
const runId = args.find((a) => a.startsWith('--run-id='))?.slice(9).trim()
  || `wallet-v5-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

const twrr = (snap) => snap?.quotaPrice ? ((snap.quotaPrice / 100) - 1) * 100 : 0;
const finite = (n) => Number.isFinite(Number(n));

const validateSnapshots = (snapshots) => {
  const errors = [];
  const days = new Set();
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    if (!s.dayKey || days.has(s.dayKey)) errors.push(`dayKey inválido/duplicado: ${s.dayKey}`);
    days.add(s.dayKey);
    if (![s.totalEquity, s.totalInvested, s.quotaPrice].every(finite)) errors.push(`número não-finito em ${s.dayKey}`);
    if (s.totalEquity < 0 || s.totalInvested < 0 || s.quotaPrice <= 0) errors.push(`valor negativo/zero em ${s.dayKey}`);
    if (s.calculationVersion !== 5) errors.push(`versão incorreta em ${s.dayKey}`);
    if (i > 0) {
      const daily = (s.quotaPrice / snapshots[i - 1].quotaPrice) - 1;
      if (isTwrrReturnAnomalous(daily)) errors.push(`retorno anômalo ${(daily * 100).toFixed(2)}% em ${s.dayKey}`);
    }
  }
  return [...new Set(errors)];
};

const transactionFingerprint = async (walletId) => {
  const [count, last] = await Promise.all([
    AssetTransaction.countDocuments({ wallet: walletId }),
    AssetTransaction.findOne({ wallet: walletId }).sort({ createdAt: -1, _id: -1 }).select('_id createdAt').lean(),
  ]);
  return `${count}|${last?._id || ''}|${last?.createdAt?.toISOString?.() || ''}`;
};

const backupWallet = async (userId, walletId, snapshots) => {
  if (snapshots.length === 0) return;
  const docs = snapshots.map((snapshot) => ({
    runId,
    user: userId,
    wallet: walletId,
    originalId: snapshot._id,
    snapshot,
  }));
  for (let i = 0; i < docs.length; i += 500) {
    await WalletSnapshotBackup.insertMany(docs.slice(i, i + 500), { ordered: true });
  }
};

const rollback = async () => {
  const backups = await WalletSnapshotBackup.find({ runId: rollbackRunId }).sort({ wallet: 1, 'snapshot.date': 1 }).lean();
  if (backups.length === 0) throw new Error(`Backup não encontrado: ${rollbackRunId}`);
  const grouped = new Map();
  for (const row of backups) {
    const key = String(row.wallet);
    if (!grouped.has(key)) grouped.set(key, { user: row.user, snapshots: [] });
    grouped.get(key).snapshots.push(row.snapshot);
  }
  for (const [walletId, data] of grouped) {
    await financialService._persistSnapshots(data.user, walletId, data.snapshots);
    console.log(`ROLLBACK OK wallet=${walletId} snapshots=${data.snapshots.length}`);
  }
};

const ensureSnapshotDayIndex = async () => {
  const duplicates = await WalletSnapshot.aggregate([
    { $match: { dayKey: { $type: 'string' } } },
    { $group: { _id: { wallet: '$wallet', dayKey: '$dayKey' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]);
  if (duplicates.length > 0) {
    throw new Error(`dayKey duplicado antes da migração: ${JSON.stringify(duplicates)}`);
  }
  await WalletSnapshot.collection.createIndex(
    { wallet: 1, dayKey: 1 },
    {
      unique: true,
      partialFilterExpression: { dayKey: { $type: 'string' } },
      name: 'wallet_1_dayKey_1',
    },
  );
};

const selectWallets = async () => {
  const query = {};
  if (walletArg) query._id = walletArg;
  if (emailArg) {
    const user = await User.findOne({ email: emailArg }).select('_id email').lean();
    if (!user) throw new Error(`Usuário não encontrado: ${emailArg}`);
    query.user = user._id;
  }
  return Wallet.find(query).sort({ user: 1, createdAt: 1 }).lean();
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida');
  await mongoose.connect(process.env.MONGO_URI);
  if (rollbackRunId) {
    await rollback();
    return;
  }

  if (apply) await ensureSnapshotDayIndex();

  const wallets = await selectWallets();
  console.log(`MODE=${apply ? 'APPLY' : 'DRY-RUN'} runId=${runId} wallets=${wallets.length}`);
  let ok = 0;
  let failed = 0;

  for (const wallet of wallets) {
    try {
      const beforeFingerprint = await transactionFingerprint(wallet._id);
      const oldSnapshots = await WalletSnapshot.find({ wallet: wallet._id }).sort({ date: 1 }).lean();
      const newSnapshots = await financialService.rebuildUserHistory(wallet.user, wallet._id, { dryRun: true });
      const errors = validateSnapshots(newSnapshots);
      const oldLast = oldSnapshots.at(-1);
      const newLast = newSnapshots.at(-1);
      console.log(JSON.stringify({
        wallet: String(wallet._id),
        name: wallet.name,
        oldCount: oldSnapshots.length,
        newCount: newSnapshots.length,
        oldTwrr: Number(twrr(oldLast).toFixed(4)),
        newTwrr: Number(twrr(newLast).toFixed(4)),
        oldEquity: oldLast?.totalEquity || 0,
        newEquity: newLast?.totalEquity || 0,
        lastDay: newLast?.dayKey || null,
        validationErrors: errors,
      }));
      if (errors.length > 0) throw new Error(errors.join('; '));

      if (apply) {
        const afterFingerprint = await transactionFingerprint(wallet._id);
        if (afterFingerprint !== beforeFingerprint) throw new Error('Carteira mudou durante o cálculo; apply abortado');
        await backupWallet(wallet.user, wallet._id, oldSnapshots);
        try {
          await financialService._persistSnapshots(wallet.user, wallet._id, newSnapshots);
          const persisted = await WalletSnapshot.find({ wallet: wallet._id }).sort({ date: 1 }).lean();
          const persistedErrors = validateSnapshots(persisted);
          const quotaMismatch = Math.abs((persisted.at(-1)?.quotaPrice || 0) - (newSnapshots.at(-1)?.quotaPrice || 0)) > 0.0001;
          if (persisted.length !== newSnapshots.length || persistedErrors.length > 0 || quotaMismatch) {
            throw new Error(`Validação pós-write falhou: ${persistedErrors.join('; ') || 'contagem/cota divergente'}`);
          }
        } catch (writeError) {
          // O replace principal já é transacional; esta restauração cobre
          // também uma falha detectada somente na validação pós-commit.
          await financialService._persistSnapshots(wallet.user, wallet._id, oldSnapshots);
          throw writeError;
        }
      }
      ok++;
    } catch (error) {
      failed++;
      console.error(`FAIL wallet=${wallet._id}: ${error.message}`);
    }
  }

  console.log(`SUMMARY ok=${ok} failed=${failed} runId=${runId}`);
  if (failed > 0) process.exitCode = 1;
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
