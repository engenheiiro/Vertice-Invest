/**
 * Diagnóstico READ-ONLY da divergência entre:
 *   (a) "Variação Hoje" do card  = Σ (valorAgora − valorInícioDoDia reconstruído
 *       a partir do % de variação de cada ativo)   [walletController.processWalletAsset]
 *   (b) ΔPatrimônio real          = equityAgora − equity do WalletSnapshot de ontem
 *       [schedulerService.computeEquityAt, marcado no FECHAMENTO do candle]
 *
 * Não grava nada. Uso:
 *   node server/scripts/diagnoseDayVariation.js <email> [--wallet="Nome"] [--day=YYYY-MM-DD]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.VERTICE_ENV_PATH || path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const EMAIL = args.find((a) => !a.startsWith('--'));
const walletArg = args.find((a) => a.startsWith('--wallet='))?.split('=').slice(1).join('=');
const DAY = args.find((a) => a.startsWith('--day='))?.split('=')[1] || null;
if (!EMAIL) { console.error('Uso: node server/scripts/diagnoseDayVariation.js <email>'); process.exit(1); }

const { default: User } = await import('../models/User.js');
const { default: Wallet } = await import('../models/Wallet.js');
const { default: WalletSnapshot } = await import('../models/WalletSnapshot.js');
const { default: UserAsset } = await import('../models/UserAsset.js');
const { default: MarketAsset } = await import('../models/MarketAsset.js');
const { default: AssetHistory } = await import('../models/AssetHistory.js');
const { default: SystemConfig } = await import('../models/SystemConfig.js');
const { buildWalletPayload } = await import('../controllers/walletController.js');
const { loadSnapshotContext, computeEquityAt } = await import('../services/schedulerService.js');
const { historyStorageKey } = await import('../utils/assetHistory.js');

const f = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—');
const pad = (s, n, right = false) => right ? String(s).padStart(n) : String(s).padEnd(n);

await mongoose.connect(process.env.MONGO_URI);
console.log('📡 conectado (somente leitura)\n');

const user = await User.findOne({ email: EMAIL }).lean();
if (!user) throw new Error(`usuário ${EMAIL} não encontrado`);
const wallets = await Wallet.find({ user: user._id }).lean();
const wallet = walletArg ? wallets.find(w => w.name === walletArg) : (wallets.find(w => w.isDefault) || wallets[0]);
console.log(`Carteira: ${wallet.name} (${wallet._id})  |  carteiras do usuário: ${wallets.map(w => w.name).join(', ')}\n`);

// ---------- 1. Snapshots recentes gravados ----------
const snaps = await WalletSnapshot.find({ wallet: wallet._id }).sort({ date: -1 }).limit(6).lean();
console.log('=== SNAPSHOTS GRAVADOS (mais recentes) ===');
console.log(pad('dayKey', 12) + pad('source', 10) + pad('equity', 13, true) + pad('invested', 13, true) + pad('divid', 10, true) + pad('profit', 12, true) + pad('quota', 11, true) + '  calculatedAt');
for (const s of snaps) {
  console.log(pad(s.dayKey || '—', 12) + pad(s.source || '—', 10) + pad(f(s.totalEquity), 13, true) + pad(f(s.totalInvested), 13, true)
    + pad(f(s.totalDividends), 10, true) + pad(f(s.profit), 12, true) + pad(f(s.quotaPrice, 4), 11, true)
    + '  ' + (s.calculatedAt ? new Date(s.calculatedAt).toISOString() : '—'));
}
const prev = snaps.find(s => s.dayKey === DAY) || snaps[0];
console.log();

// ---------- 2. Payload ao vivo (o que o card mostra) ----------
const live = await buildWalletPayload(user._id, wallet._id);
const k = live.kpis;
console.log('=== KPIs AO VIVO (card) ===');
console.log(`equity=${f(k.totalEquity)}  invested=${f(k.totalInvested)}  result=${f(k.totalResult)}  dayVariation=${f(k.dayVariation)} (${f(k.dayVariationPercent, 3)}%)  dividends=${f(k.totalDividends)}`);
console.log(`usdRate=${f(live.meta.usdRate, 4)}`);
const cfg = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
console.log(`SystemConfig.dollar=${f(cfg?.dollar, 4)}  dollarChange=${f(cfg?.dollarChange, 4)}%  cdi=${f(cfg?.cdi,4)}  selic=${f(cfg?.selic,4)}  macro updatedAt=${cfg?.updatedAt ? new Date(cfg.updatedAt).toISOString() : '—'}`);
console.log();

// ---------- 3. Conta de cabeça ----------
console.log('=== A CONTA QUE NÃO FECHA ===');
console.log(`equity hoje (live)          = ${f(k.totalEquity)}`);
console.log(`equity ontem (snapshot ${prev.dayKey}) = ${f(prev.totalEquity)}`);
console.log(`Δ real                      = ${f(k.totalEquity - prev.totalEquity)}`);
console.log(`Variação Hoje do card       = ${f(k.dayVariation)}`);
console.log(`>>> BURACO                  = ${f(k.dayVariation - (k.totalEquity - prev.totalEquity))}`);
console.log();

// ---------- 4. Reconstrução ativo a ativo ----------
const positions = await UserAsset.find({ user: user._id, wallet: wallet._id });
const active = positions.filter(p => p.quantity > 0 || p.type === 'CASH' || p.type === 'FIXED_INCOME');
const ctx = await loadSnapshotContext(prev.dayKey, { ensureDayCandles: false });

console.log(`=== ATIVO A ATIVO  (snapshot day = ${prev.dayKey}) ===`);
console.log(pad('ticker', 12) + pad('tipo', 14) + pad('vlrOntem(snap)', 15, true) + pad('vlrInício(card)', 16, true)
  + pad('vlrAgora', 13, true) + pad('gap', 11, true) + pad('day%', 9, true) + '  fonte/priceDate');

let sumSnap = 0, sumStart = 0, sumNow = 0;
const rows = [];
for (const a of active) {
  // MESMA regua do snapshot: brCalcDate = meia-noite UTC do dia.
  const one = computeEquityAt([a], { ...ctx, calcDate: new Date(`${prev.dayKey}T00:00:00.000Z`) });
  const todayKey2 = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
  const todayAcc = computeEquityAt([a], { ...ctx, calcDate: new Date(`${todayKey2}T00:00:00.000Z`) });
  const liveAsset = live.assets.find(x => x.ticker === a.ticker);
  const now = liveAsset ? liveAsset.totalValue : 0;
  const dayPct = liveAsset ? liveAsset.dayChangePct : 0;
  const start = now / (1 + dayPct / 100);
  const mkt = await MarketAsset.findOne({ ticker: a.ticker }).select('price previousClose change priceDate updatedAt').lean();
  const hkey = historyStorageKey(a.ticker, a.type);
  const hist = hkey ? await AssetHistory.findOne({ ticker: hkey }).select('history').lean() : null;
  const candles = (hist?.history || []).slice(-3).map(h => `${h.date.slice(5)}=${Number(h.close).toFixed(2)}`).join(' ');
  sumSnap += one.totalEquity; sumStart += start; sumNow += now;
  rows.push({ ticker: a.ticker, type: a.type, snap: one.totalEquity, start, now, gap: start - one.totalEquity, dayPct,
    acc31: one.totalEquity, accHoje: todayAcc.totalEquity,
    meta: liveAsset?.pricingSource ? `${liveAsset.pricingSource} pu=${liveAsset.priceDate || '—'} | acc31=${f(one.totalEquity)} accHoje=${f(todayAcc.totalEquity)}` : (mkt ? `px=${f(mkt.price,4)} prevC=${f(mkt.previousClose,4)} chg=${f(mkt.change,3)}% pd=${mkt.priceDate || '—'} | ${candles}` : '—') });
}
rows.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));
for (const r of rows) {
  console.log(pad(r.ticker, 12) + pad(r.type, 14) + pad(f(r.snap), 15, true) + pad(f(r.start), 16, true)
    + pad(f(r.now), 13, true) + pad(f(r.gap), 11, true) + pad(f(r.dayPct, 3), 9, true) + '  ' + r.meta);
}
console.log('-'.repeat(120));
console.log(pad('TOTAIS', 26) + pad(f(sumSnap), 15, true) + pad(f(sumStart), 16, true) + pad(f(sumNow), 13, true) + pad(f(sumStart - sumSnap), 11, true));
console.log();
console.log(`equity snapshot GRAVADO = ${f(prev.totalEquity)}  |  recomputado agora com o MESMO código = ${f(sumSnap)}  |  drift = ${f(sumSnap - prev.totalEquity)}`);
console.log(`(drift ≠ 0 significa que recalcular ontem HOJE dá outro número — candle/PU/câmbio mudaram depois da gravação)`);

await mongoose.disconnect();
