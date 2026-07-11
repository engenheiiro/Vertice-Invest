import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EMAIL = process.argv[2];
if (!EMAIL) { console.error('Uso: node auditWallet.js email [--wallet=<id>]'); process.exit(1); }
const walletArg = process.argv.find((a) => a.startsWith('--wallet='));
const onlyWalletId = walletArg ? walletArg.split('=')[1] : null;

const U = mongoose.model('U', new mongoose.Schema({}, { strict: false, collection: 'users' }));
const W = mongoose.model('WW', new mongoose.Schema({}, { strict: false, collection: 'wallets' }));
const Snap = mongoose.model('S', new mongoose.Schema({}, { strict: false, collection: 'walletsnapshots' }));
const Asset = mongoose.model('A', new mongoose.Schema({}, { strict: false, collection: 'userassets' }));
const Tx = mongoose.model('T', new mongoose.Schema({}, { strict: false, collection: 'assettransactions' }));
const Cfg = mongoose.model('C', new mongoose.Schema({}, { strict: false, collection: 'systemconfigs' }));

const brl = (n) => (typeof n === 'number') ? `R$ ${n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}` : String(n);
const d = (x) => x ? new Date(x).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?';

// Conta dias úteis entre duas datas (igual mathUtils/dateUtils, simplificado: seg-sex)
const countBusinessDays = (start, end) => {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0,0,0,0);
  const e = new Date(end);
  e.setHours(0,0,0,0);
  while (cur < e) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await U.findOne({ email: EMAIL }).lean();
  if (!user) { console.error('Usuário não encontrado'); process.exit(1); }

  console.log(`\n==== ${user.name} <${user.email}> | plano=${user.plan} | id=${user._id} ====`);
  console.log(`criado: ${d(user.createdAt)} | activeWalletId=${user.activeWalletId||'—'}`);

  const cfg = await Cfg.findOne({ key: 'MACRO_INDICATORS' }).lean();
  const cdi = (cfg?.cdi && cfg.cdi > 0) ? cfg.cdi : (cfg?.selic || 11.25);
  const usd = cfg?.dollar || 5.75;
  console.log(`MACRO: cdi=${cdi}% selic=${cfg?.selic} dollar=${usd}`);

  // Fase 2: cada carteira tem seu próprio histórico/posições — auditado em separado
  // (misturar carteiras no mesmo relatório mascararia divergências entre elas).
  let wallets = await W.find({ user: user._id }).sort({ createdAt: 1 }).lean();
  if (onlyWalletId) wallets = wallets.filter((w) => String(w._id) === onlyWalletId);
  if (wallets.length === 0) { console.log('\n(nenhuma carteira encontrada)'); await mongoose.disconnect(); return; }

  console.log(`\nCarteiras (${wallets.length}): ${wallets.map((w) => `${w.name}${w.isDefault ? ' [default]' : ''}${String(w._id) === String(user.activeWalletId) ? ' [ativa]' : ''} (${w._id})`).join(' | ')}`);

  for (const wallet of wallets) {
    console.log(`\n${'='.repeat(70)}\nCARTEIRA: ${wallet.name} (${wallet._id})\n${'='.repeat(70)}`);

    // ---- TRANSAÇÕES ----
    const txs = await Tx.find({ user: user._id, wallet: wallet._id }).sort({ date: 1, createdAt: 1 }).lean();
    console.log(`\n---- TRANSAÇÕES (${txs.length}) ----`);
    let netFlow = 0;
    for (const t of txs) {
      const signed = t.type === 'BUY' ? t.totalValue : -t.totalValue;
      netFlow += signed;
      console.log(`  ${d(t.date)} | ${t.type} ${t.ticker} | qty=${t.quantity} price=${t.price} total=${brl(t.totalValue)} | acumulado=${brl(netFlow)} | ${t.notes||''}`);
      console.log(`        date(UTC ISO)=${new Date(t.date).toISOString()} | createdAt=${t.createdAt?new Date(t.createdAt).toISOString():'?'}`);
    }
    console.log(`  >>> Net aportado (BUY-SELL): ${brl(netFlow)}`);

    // ---- ATIVOS (UserAsset) ----
    const assets = await Asset.find({ user: user._id, wallet: wallet._id }).lean();
    console.log(`\n---- ATIVOS / POSIÇÕES (${assets.length}) ----`);
    const today = new Date();
    let liveEquity = 0, liveInvested = 0;
    for (const a of assets) {
      console.log(`\n  [${a.ticker}] type=${a.type} qty=${a.quantity} totalCost=${brl(a.totalCost)} avgRate=${a.fixedIncomeRate} startDate=${d(a.startDate)} currency=${a.currency||'BRL'}`);
      console.log(`     realizedProfit=${a.realizedProfit} fifoRealized=${a.fifoRealizedProfit}`);
      if (a.taxLots && a.taxLots.length) {
        console.log(`     taxLots (${a.taxLots.length}):`);
        a.taxLots.forEach(l => console.log(`        ${d(l.date)} qty=${l.quantity} price=${l.price}`));
      }

      // Recalcular valor atual igual ao walletController
      if (a.type === 'CASH' || a.type === 'FIXED_INCOME') {
        const rawRate = a.fixedIncomeRate > 0 ? a.fixedIncomeRate : 100;
        const selicDaily = Math.pow(1 + (cdi/100), 1/252);
        let eff = 1;
        if (rawRate > 50) eff = ((selicDaily - 1) * (rawRate/100)) + 1;
        else eff = Math.pow(1 + (rawRate/100), 1/252);

        let cur = 0;
        const lots = (a.taxLots && a.taxLots.length) ? a.taxLots : [{ date: a.startDate || a.createdAt, quantity: a.quantity, price: a.totalCost/a.quantity }];
        for (const lot of lots) {
          const bd = countBusinessDays(new Date(lot.date), today);
          let cf = Math.pow(eff, bd);
          if (!isFinite(cf) || cf < 1) cf = 1;
          if (a.type === 'CASH') cur += lot.quantity * cf;
          else cur += lot.quantity * lot.price * cf;
        }
        const mult = (a.currency === 'USD') ? usd : 1;
        console.log(`     => valor atual estimado (compounded ${rawRate>50?rawRate+'%CDI':rawRate+'%aa'}): ${brl(cur*mult)} | dias úteis desde lote(s)`);
        liveEquity += cur * mult;
        liveInvested += a.totalCost * mult;
      } else {
        console.log(`     (ativo de mercado — valor depende de cotação ao vivo, não recalculado aqui)`);
        liveInvested += a.totalCost;
      }
    }
    console.log(`\n  >>> EQUITY estimado AGORA (apenas CASH/RF): ${brl(liveEquity)}`);
    console.log(`  >>> INVESTED (soma totalCost): ${brl(liveInvested)}`);

    // ---- SNAPSHOTS ----
    const snaps = await Snap.find({ user: user._id, wallet: wallet._id }).sort({ date: 1 }).lean();
    console.log(`\n---- SNAPSHOTS (${snaps.length}) ----`);
    console.log(`  Data                  | quota    | equity        | invested      | dividends | TWRR`);
    for (const s of snaps) {
      const twrr = s.quotaPrice ? ((s.quotaPrice/100 - 1)*100).toFixed(3)+'%' : '?';
      console.log(`  ${d(s.date).padEnd(21)}| ${String((s.quotaPrice??0).toFixed(4)).padEnd(8)} | ${brl(s.totalEquity).padEnd(13)} | ${brl(s.totalInvested).padEnd(13)} | ${brl(s.totalDividends||0).padEnd(9)} | ${twrr}`);
    }

    if (snaps.length) {
      const last = snaps[snaps.length-1];
      console.log(`\n  >>> Último snapshot: ${d(last.date)} | TWRR exibida = ${((last.quotaPrice/100-1)*100).toFixed(3)}%`);
      console.log(`  >>> Último snapshot equity=${brl(last.totalEquity)} vs equity recalc AGORA=${brl(liveEquity)} (diferença=${brl(liveEquity-last.totalEquity)})`);
      console.log(`  >>> Último snapshot invested=${brl(last.totalInvested)} vs soma totalCost AGORA=${brl(liveInvested)} (diferença=${brl(liveInvested-last.totalInvested)})`);
    }
  }

  await mongoose.disconnect();
  console.log('\n==== fim ====');
};
run().catch(e => { console.error('ERRO:', e); process.exit(1); });
