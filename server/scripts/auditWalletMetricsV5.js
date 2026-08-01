/**
 * Auditoria somente leitura do motor de snapshots V5.
 *
 * Uso:
 *   node server/scripts/auditWalletMetricsV5.js --email=x@y.com --wallet="Carteira" --run-id=id
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import WalletSnapshotBackup from '../models/WalletSnapshotBackup.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import { calculateSharpeRatio } from '../utils/mathUtils.js';
import { isTwrrReturnAnomalous, snapshotInstantForDay } from '../utils/walletSnapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const valueOf = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1).trim();
const email = valueOf('--email')?.toLowerCase();
const walletName = valueOf('--wallet');
const runId = valueOf('--run-id');

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida');
  if (!email || !walletName) throw new Error('Informe --email e --wallet');
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email }).select('_id email').lean();
  if (!user) throw new Error(`Usuário não encontrado: ${email}`);
  const wallet = await Wallet.findOne({ user: user._id, name: walletName }).lean();
  if (!wallet) throw new Error(`Carteira não encontrada: ${walletName}`);

  const snapshots = await WalletSnapshot.find({ wallet: wallet._id }).sort({ date: 1 }).lean();
  const recent = snapshots.slice(-30);
  const returns = recent.slice(1).map((snapshot, index) => (
    ((snapshot.quotaPrice / recent[index].quotaPrice) - 1) * 100
  ));
  const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
  const cdi = macro?.cdi || macro?.selic || 14.25;
  const badInstants = snapshots.filter((snapshot) => (
    new Date(snapshot.date).getTime() !== snapshotInstantForDay(snapshot.dayKey).getTime()
  ));

  const [duplicates, allSnapshots, indexes, legacyCount, backupCount, histories] = await Promise.all([
    WalletSnapshot.aggregate([
      { $match: { dayKey: { $type: 'string' } } },
      { $group: { _id: { wallet: '$wallet', dayKey: '$dayKey' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
    WalletSnapshot.find({}).sort({ wallet: 1, date: 1 }).lean(),
    WalletSnapshot.collection.indexes(),
    WalletSnapshot.countDocuments({ $or: [{ dayKey: null }, { calculationVersion: { $ne: 5 } }] }),
    runId ? WalletSnapshotBackup.countDocuments({ runId }) : Promise.resolve(null),
    AssetHistory.find({ ticker: { $in: ['BTC', 'BTC-USD', 'ETH', 'ETH-USD'] } }).lean(),
  ]);

  let anomalousDailyReturns = 0;
  let previous = null;
  for (const snapshot of allSnapshots) {
    if (!previous || String(previous.wallet) !== String(snapshot.wallet)) {
      previous = snapshot;
      continue;
    }
    const dailyReturn = (snapshot.quotaPrice / previous.quotaPrice) - 1;
    if (isTwrrReturnAnomalous(dailyReturn)) anomalousDailyReturns++;
    previous = snapshot;
  }

  const last = snapshots.at(-1);
  console.log(JSON.stringify({
    wallet: {
      id: String(wallet._id),
      snapshots: snapshots.length,
      firstDay: snapshots[0]?.dayKey || null,
      lastDay: last?.dayKey || null,
      lastDateUtc: last?.date || null,
      lastDateBrazil: last?.date
        ? new Date(last.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : null,
      equity: last?.totalEquity || 0,
      twrrPercent: Number(((((last?.quotaPrice || 100) / 100) - 1) * 100).toFixed(4)),
      sharpe: Number(calculateSharpeRatio(returns, cdi).toFixed(4)),
      cdi,
      version5: snapshots.every((snapshot) => snapshot.calculationVersion === 5),
      invalidClosingInstants: badInstants.length,
    },
    global: {
      snapshots: allSnapshots.length,
      legacySnapshots: legacyCount,
      duplicateDayKeys: duplicates.length,
      anomalousDailyReturns,
      backupCount,
      dayKeyIndex: indexes.find((index) => index.name === 'wallet_1_dayKey_1') || null,
    },
    cryptoHistory: histories.map((history) => ({
      ticker: history.ticker,
      closeOn2026_07_30: history.history.find((point) => point.date === '2026-07-30')?.close || null,
      lastPoint: history.history.at(-1) || null,
    })),
  }, null, 2));
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
