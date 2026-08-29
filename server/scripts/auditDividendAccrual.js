/**
 * Diagnóstico READ-ONLY: por que "Proventos Acumulados" muda entre duas
 * carteiras do mesmo usuário (ex.: importada da B3 x backup do Investidor10).
 *
 * Compara, por carteira e por ticker, os DOIS números que hoje coexistem:
 *  - KPI  = financialService.calculateUserDividends().totalAllTime
 *           → soma eventos com ex-date >= PRIMEIRA COMPRA, multiplicando cada um
 *             pela quantidade de HOJE.
 *  - ACC  = financialService.accruedDividendsThroughDay(hoje)
 *           → soma por ex-date com a quantidade que a carteira TINHA no dia.
 *
 * Uso: node server/scripts/auditDividendAccrual.js email [--wallet=<id>]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { financialService } = await import('../services/financialService.js');
const { default: UserAsset } = await import('../models/UserAsset.js');
const { default: AssetTransaction } = await import('../models/AssetTransaction.js');
const { default: DividendEvent } = await import('../models/DividendEvent.js');
const { default: User } = await import('../models/User.js');
const { default: Wallet } = await import('../models/Wallet.js');
const { default: WalletSnapshot } = await import('../models/WalletSnapshot.js');

const EMAIL = process.argv[2];
if (!EMAIL) { console.error('Uso: node auditDividendAccrual.js email [--wallet=<id>]'); process.exit(1); }
const walletArg = process.argv.find((a) => a.startsWith('--wallet='));
const onlyWalletId = walletArg ? walletArg.split('=')[1] : null;

const brl = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dk = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const run = async () => {
  await connectScriptDb({ label: 'auditDividendAccrual' });
  const user = await User.findOne({ email: EMAIL }).lean();
  if (!user) { console.error('Usuário não encontrado'); process.exit(1); }

  let wallets = await Wallet.find({ user: user._id }).sort({ createdAt: 1 }).lean();
  if (onlyWalletId) wallets = wallets.filter((w) => String(w._id) === onlyWalletId);

  const today = new Date().toISOString().slice(0, 10);

  for (const w of wallets) {
    console.log(`\n================ ${w.name} (${w._id}) ================`);
    const assets = await UserAsset.find({ user: user._id, wallet: w._id }).lean();
    const relevant = assets.filter((a) => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type) && a.quantity > 0);
    const txs = await AssetTransaction.find({ user: user._id, wallet: w._id }).sort({ date: 1 }).lean();

    const kpi = await financialService.calculateUserDividends(user._id, w._id);
    const acc = await financialService.accruedDividendsThroughDay(user._id, w._id, today);

    console.log(`lançamentos: ${txs.length} | 1º lançamento: ${dk(txs[0]?.date)} | ativos c/ provento: ${relevant.length}`);
    console.log(`KPI  (calculateUserDividends.totalAllTime): ${brl(kpi.totalAllTime)}`);
    console.log(`ACC  (accruedDividendsThroughDay hoje)   : ${brl(acc)}`);
    console.log(`DIFF (KPI - ACC)                          : ${brl(kpi.totalAllTime - acc)}`);

    const snap = await WalletSnapshot.findOne({ user: user._id, wallet: w._id }).sort({ date: -1 }).lean();
    if (snap) console.log(`último snapshot ${dk(snap.date)}: totalDividends=${brl(snap.totalDividends)}`);

    // --- por ticker ---
    const tickers = relevant.map((a) => a.ticker);
    const events = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: 1 }).lean();
    const byTicker = new Map();
    events.forEach((e) => {
      if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, []);
      byTicker.get(e.ticker).push(e);
    });

    const rows = [];
    for (const a of relevant) {
      const tTxs = txs.filter((t) => t.ticker === a.ticker);
      const firstBuy = tTxs.find((t) => t.type === 'BUY');
      const firstBuyKey = firstBuy ? dk(firstBuy.date) : null;
      if (!firstBuyKey) continue;

      const evs = (byTicker.get(a.ticker) || []).filter((e) => dk(e.date) >= firstBuyKey);
      const seen = new Set();
      let kpiT = 0, accT = 0, count = 0;
      let qty = 0, ti = 0;
      const ordered = [...evs].sort((x, y) => new Date(x.date) - new Date(y.date));
      for (const e of ordered) {
        const key = `${a.ticker}|${dk(e.date)}|${e.type || 'DIVIDEND'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const day = dk(e.date);
        while (ti < tTxs.length && dk(tTxs[ti].date) <= day) {
          qty += (tTxs[ti].type === 'SELL' ? -1 : 1) * tTxs[ti].quantity;
          if (qty < 1e-8) qty = 0;
          ti++;
        }
        kpiT += a.quantity * e.amount;
        accT += qty * e.amount;
        count++;
      }
      rows.push({ ticker: a.ticker, firstBuy: firstBuyKey, qtyHoje: a.quantity, nTx: tTxs.length, eventos: count, kpi: kpiT, acc: accT });
    }

    rows.sort((x, y) => (y.kpi - y.acc) - (x.kpi - x.acc));
    console.log('\nticker    1ª compra   qtdHoje   nTx  evts        KPI          ACC         DIFF');
    for (const r of rows) {
      console.log(
        `${r.ticker.padEnd(9)} ${r.firstBuy.padEnd(11)} ${String(r.qtyHoje).padStart(7)} ${String(r.nTx).padStart(4)} ${String(r.eventos).padStart(5)} ` +
        `${brl(r.kpi).padStart(12)} ${brl(r.acc).padStart(12)} ${brl(r.kpi - r.acc).padStart(12)}`
      );
    }
  }

  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
