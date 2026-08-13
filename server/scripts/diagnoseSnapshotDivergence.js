/**
 * Diagnóstico read-only da divergência entre os DOIS caminhos que geram
 * WalletSnapshot:
 *
 *   1) Diário  — schedulerService.persistUserSnapshotForDay (source: DAILY)
 *      marca o patrimônio pelas cotações CORRENTES (priceMap) e encadeia a cota
 *      a partir do ÚLTIMO SNAPSHOT existente.
 *   2) Rebuild — financialService.rebuildUserHistory (source: REBUILD)
 *      marca o patrimônio pelos candles históricos (AssetHistory) e encadeia a
 *      cota dia-calendário a dia-calendário.
 *
 * O script NÃO persiste nada (rebuild em dryRun). Ele alinha as duas séries por
 * dayKey e mostra em QUE DIAS a razão entre as cotas se move — que é onde a
 * divergência nasce.
 *
 * Uso:
 *   node server/scripts/diagnoseSnapshotDivergence.js <email> [--wallet="Nome"] [--top=25]
 *   VERTICE_ENV_PATH=D:/Github/Vertice-Invest/.env node server/scripts/... (worktree)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: process.env.VERTICE_ENV_PATH || path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const EMAIL = args.find((a) => !a.startsWith('--'));
const walletArg = args.find((a) => a.startsWith('--wallet='))?.split('=').slice(1).join('=');
const TOP = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] || 25);

if (!EMAIL) {
    console.error('Uso: node server/scripts/diagnoseSnapshotDivergence.js <email> [--wallet="Nome"] [--top=25]');
    process.exit(1);
}

const { financialService } = await import('../services/financialService.js');
const { default: User } = await import('../models/User.js');
const { default: Wallet } = await import('../models/Wallet.js');
const { default: WalletSnapshot } = await import('../models/WalletSnapshot.js');
const { default: AssetTransaction } = await import('../models/AssetTransaction.js');
const { default: DividendEvent } = await import('../models/DividendEvent.js');
const { default: UserAsset } = await import('../models/UserAsset.js');
const { brazilDayKey } = await import('../utils/walletSnapshot.js');

const n2 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—');
const n4 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(4) : '—');
const pct = (v) => (Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(4)}%` : '—');

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado (modo leitura + rebuild dryRun).\n');

    const user = await User.findOne({ email: EMAIL }).lean();
    if (!user) throw new Error(`Usuário ${EMAIL} não encontrado.`);

    const wallets = await Wallet.find({ user: user._id }).lean();
    if (wallets.length === 0) throw new Error('Usuário sem carteiras.');
    const wallet = walletArg ? wallets.find((w) => w.name === walletArg) : wallets[0];
    if (!wallet) throw new Error(`Carteira "${walletArg}" não encontrada. Disponíveis: ${wallets.map((w) => w.name).join(', ')}`);

    console.log(`👤 ${user.email} | 💼 ${wallet.name} (${wallet._id})\n`);

    // ---------- 1. Série GRAVADA ----------
    const stored = await WalletSnapshot.find({ wallet: wallet._id }).sort({ date: 1 }).lean();
    const bySource = stored.reduce((acc, s) => { acc[s.source || '(sem source)'] = (acc[s.source || '(sem source)'] || 0) + 1; return acc; }, {});
    const byVersion = stored.reduce((acc, s) => { acc[s.calculationVersion ?? '(sem versão)'] = (acc[s.calculationVersion ?? '(sem versão)'] || 0) + 1; return acc; }, {});
    console.log(`📸 Snapshots gravados: ${stored.length}`);
    console.log(`   por source:  ${JSON.stringify(bySource)}`);
    console.log(`   por versão:  ${JSON.stringify(byVersion)}`);
    if (stored.length) {
        console.log(`   janela: ${stored[0].dayKey || brazilDayKey(stored[0].date)} → ${stored.at(-1).dayKey || brazilDayKey(stored.at(-1).date)}`);
        // calculatedAt agrupado por dia revela se a série foi escrita de uma vez
        // (rebuild em lote) ou dia a dia (cron diário de verdade).
        const calcDays = new Map();
        stored.forEach((s) => {
            const k = s.calculatedAt ? brazilDayKey(s.calculatedAt) : '(sem calculatedAt)';
            calcDays.set(k, (calcDays.get(k) || 0) + 1);
        });
        const lote = [...calcDays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log(`   calculatedAt (top 5 dias): ${lote.map(([d, c]) => `${d}×${c}`).join(', ')}`);
    }
    console.log('');

    // ---------- 2. Série do REBUILD (dryRun) ----------
    const rebuilt = await financialService.rebuildUserHistory(user._id, wallet._id, { dryRun: true });
    console.log(`🔁 Snapshots do rebuild (dryRun): ${rebuilt.length}`);
    if (rebuilt.length) console.log(`   janela: ${rebuilt[0].dayKey} → ${rebuilt.at(-1).dayKey}`);
    console.log('');

    const storedMap = new Map(stored.map((s) => [s.dayKey || brazilDayKey(s.date), s]));
    const rebuiltMap = new Map(rebuilt.map((s) => [s.dayKey, s]));

    const onlyStored = [...storedMap.keys()].filter((k) => !rebuiltMap.has(k));
    const onlyRebuilt = [...rebuiltMap.keys()].filter((k) => !storedMap.has(k));
    console.log(`📅 Dias só na série GRAVADA:  ${onlyStored.length}${onlyStored.length ? ` (ex.: ${onlyStored.slice(0, 8).join(', ')})` : ''}`);
    console.log(`📅 Dias só no REBUILD:        ${onlyRebuilt.length}${onlyRebuilt.length ? ` (ex.: ${onlyRebuilt.slice(0, 8).join(', ')})` : ''}\n`);

    // ---------- 3. Onde a razão entre as cotas se move ----------
    const common = [...storedMap.keys()].filter((k) => rebuiltMap.has(k)).sort();
    if (common.length === 0) throw new Error('Nenhum dia em comum entre as séries.');

    const rows = common.map((day) => {
        const s = storedMap.get(day);
        const r = rebuiltMap.get(day);
        return {
            day,
            qs: s.quotaPrice, qr: r.quotaPrice,
            es: s.totalEquity, er: r.totalEquity,
            is: s.totalInvested, ir: r.totalInvested,
            ds: s.totalDividends, dr: r.totalDividends,
            ratio: r.quotaPrice > 0 ? s.quotaPrice / r.quotaPrice : NaN,
        };
    });

    // Retorno diário implícito de cada série, comparado só quando os dois lados
    // têm o MESMO dia anterior — senão estaríamos comparando janelas diferentes.
    const drift = [];
    for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        const rs = prev.qs > 0 ? cur.qs / prev.qs - 1 : NaN;
        const rr = prev.qr > 0 ? cur.qr / prev.qr - 1 : NaN;
        const gap = rs - rr;
        if (Number.isFinite(gap)) drift.push({ ...cur, rs, rr, gap, prevDay: prev.day });
    }

    const first = rows[0];
    const last = rows.at(-1);
    console.log('═══ RESUMO ═══');
    console.log(`Primeiro dia comum ${first.day}: cota gravada ${n4(first.qs)} × rebuild ${n4(first.qr)} (razão ${n4(first.ratio)})`);
    console.log(`Último  dia comum ${last.day}: cota gravada ${n4(last.qs)} × rebuild ${n4(last.qr)} (razão ${n4(last.ratio)})`);
    console.log(`Equity  último dia: gravado R$ ${n2(last.es)} × rebuild R$ ${n2(last.er)} (Δ R$ ${n2(last.es - last.er)})`);
    console.log(`Invested último dia: gravado R$ ${n2(last.is)} × rebuild R$ ${n2(last.ir)} (Δ R$ ${n2(last.is - last.ir)})`);
    console.log(`Proventos último dia: gravado R$ ${n2(last.ds)} × rebuild R$ ${n2(last.dr)} (Δ R$ ${n2(last.ds - last.dr)})\n`);

    const totalGap = drift.reduce((a, d) => a + Math.abs(d.gap), 0);
    console.log(`Σ |gap de retorno diário| = ${pct(totalGap)} distribuído em ${drift.length} dias.`);
    const bigGaps = drift.filter((d) => Math.abs(d.gap) > 0.0005);
    console.log(`Dias com gap > 0,05%: ${bigGaps.length} (concentram ${pct(bigGaps.reduce((a, d) => a + Math.abs(d.gap), 0))} do total)\n`);

    // ---------- 4. Top ofensores, com contexto ----------
    const top = [...drift].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, TOP);
    console.log(`═══ TOP ${top.length} DIAS DE DIVERGÊNCIA ═══`);
    console.log('data       | ret gravado | ret rebuild |     gap | equity grav.  | equity rebu.  | contexto');
    for (const d of top) {
        const dayStart = new Date(`${d.day}T00:00:00.000-03:00`);
        const dayEnd = new Date(`${d.day}T23:59:59.999-03:00`);
        const txs = await AssetTransaction.find({ user: user._id, wallet: wallet._id, date: { $gte: dayStart, $lte: dayEnd } }).lean();
        const [y, m, dd] = d.day.split('-').map(Number);
        const exDate = new Date(Date.UTC(y, m - 1, dd));
        const divs = await DividendEvent.find({ date: exDate }).lean();
        const ctx = [];
        if (txs.length) ctx.push(`${txs.length} tx (${txs.map((t) => `${t.type} ${t.ticker}`).join(', ')})`);
        if (divs.length) ctx.push(`${divs.length} provento(s) ex-date`);
        if (d.prevDay !== prevBusinessGuess(d.day)) ctx.push(`dia anterior comum = ${d.prevDay}`);
        console.log(
            `${d.day} | ${pct(d.rs).padStart(11)} | ${pct(d.rr).padStart(11)} | ${pct(d.gap).padStart(8)} | ${n2(d.es).padStart(13)} | ${n2(d.er).padStart(13)} | ${ctx.join(' · ') || '—'}`,
        );
    }

    // ---------- 5. Composição atual da carteira ----------
    const assets = await UserAsset.find({ user: user._id, wallet: wallet._id }).lean();
    console.log(`\n💼 Posições (${assets.length}): ${assets.map((a) => `${a.ticker}[${a.type}${a.currency && a.currency !== 'BRL' ? '/' + a.currency : ''}]`).join(', ')}`);

    await mongoose.disconnect();
};

// Dia útil anterior "esperado" — só para marcar buracos na série no relatório.
const prevBusinessGuess = (dayStr) => {
    const d = new Date(`${dayStr}T12:00:00.000Z`);
    do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
};

run().catch((e) => { console.error('❌', e.stack || e.message); process.exit(1); });
