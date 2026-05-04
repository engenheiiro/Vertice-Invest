import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EMAIL = process.argv[2];
if (!EMAIL) {
    console.error('Uso: node server/scripts/diagnoseTWRR.js seu@email.com');
    process.exit(1);
}

const UserSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const SnapshotSchema = new mongoose.Schema({}, { strict: false, collection: 'walletsnapshots' });
const AssetSchema = new mongoose.Schema({}, { strict: false, collection: 'userassets' });
const TxSchema = new mongoose.Schema({}, { strict: false, collection: 'assettransactions' });

const User = mongoose.model('DiagUser', UserSchema);
const Snapshot = mongoose.model('DiagSnapshot', SnapshotSchema);
const Asset = mongoose.model('DiagAsset', AssetSchema);
const Tx = mongoose.model('DiagTx', TxSchema);

const fmt = (n) => typeof n === 'number' ? n.toFixed(4) : String(n ?? 'null');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '?';
const fmtCurrency = (n) => typeof n === 'number' ? `R$ ${n.toFixed(2)}` : '?';

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado.\n');

    const user = await User.findOne({ email: EMAIL }).lean();
    if (!user) { console.error(`❌ Usuário "${EMAIL}" não encontrado.`); process.exit(1); }

    console.log(`👤 Usuário: ${user.name} (${user.email}) | Plano: ${user.plan}`);
    console.log(`   ID: ${user._id}\n`);

    // --- 1. Snapshots ---
    const snapshots = await Snapshot.find({ user: user._id })
        .sort({ date: 1 })
        .lean();

    console.log(`📸 Total de Snapshots: ${snapshots.length}`);

    if (snapshots.length > 0) {
        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];
        console.log(`   Primeiro: ${fmtDate(first.date)} | quota=${fmt(first.quotaPrice)} | equity=${fmtCurrency(first.totalEquity)}`);
        console.log(`   Último:   ${fmtDate(last.date)} | quota=${fmt(last.quotaPrice)} | equity=${fmtCurrency(last.totalEquity)}\n`);

        // TWRR atual exibida na tela
        const twrr = last.quotaPrice ? ((last.quotaPrice / 100 - 1) * 100).toFixed(2) : '?';
        console.log(`   📊 TWRR atual calculada: ${twrr}%\n`);

        // Detectar o reset de 06/02/2026
        console.log('🔍 Anomalias: variação de cota > 20% num único dia:');
        let anomalies = 0;
        for (let i = 1; i < snapshots.length; i++) {
            const prev = snapshots[i - 1];
            const curr = snapshots[i];
            if (prev.quotaPrice && curr.quotaPrice && prev.quotaPrice > 0) {
                const change = (curr.quotaPrice - prev.quotaPrice) / prev.quotaPrice;
                if (Math.abs(change) > 0.20) {
                    const wasNull = prev.totalEquity == null ? ' [EQUITY NULO NO ANTERIOR]' : '';
                    console.log(`   ⚠️  ${fmtDate(curr.date)}: quota ${fmt(prev.quotaPrice)} → ${fmt(curr.quotaPrice)} (${(change*100).toFixed(1)}%) | equity: ${fmtCurrency(prev.totalEquity)} → ${fmtCurrency(curr.totalEquity)}${wasNull}`);
                    anomalies++;
                }
            }
        }
        if (anomalies === 0) console.log('   Nenhuma.');

        // --- INVESTIGAR 06/02/2026 especificamente ---
        const resetDate = new Date('2026-02-06');
        const prevDate = new Date('2026-02-05');
        const resetSnap = snapshots.find(s => {
            const d = new Date(s.date);
            return d >= new Date('2026-02-06') && d < new Date('2026-02-07');
        });
        const prevSnap = snapshots.find(s => {
            const d = new Date(s.date);
            return d >= new Date('2026-02-05') && d < new Date('2026-02-06');
        });

        if (resetSnap) {
            console.log(`\n🔴 ANÁLISE DO RESET (06/02/2026):`);
            console.log(`   Snapshot 05/02: ${prevSnap ? `quota=${fmt(prevSnap.quotaPrice)}, equity=${fmtCurrency(prevSnap.totalEquity)}` : 'NÃO ENCONTRADO'}`);
            console.log(`   Snapshot 06/02: quota=${fmt(resetSnap.quotaPrice)}, equity=${fmtCurrency(resetSnap.totalEquity)}`);
            if (!prevSnap) {
                console.log(`   ❗ CAUSA PROVÁVEL: lastSnapshot era null → anti-reset ignorado → quota inicializada em 100`);
            }
            // Calcular fator de correção
            const lastGoodQuota = prevSnap?.quotaPrice ?? 163.575;
            const resetQuota = resetSnap.quotaPrice;
            const factor = lastGoodQuota / resetQuota;
            console.log(`   🔧 Fator de correção necessário: ${factor.toFixed(6)} (${lastGoodQuota.toFixed(4)} / ${resetQuota.toFixed(4)})`);
        }

        // --- INVESTIGAR 29/04/2026 ---
        console.log(`\n🔴 ANÁLISE DA QUEDA DE 29/04/2026:`);
        const snap28 = snapshots.find(s => { const d = new Date(s.date); return d >= new Date('2026-04-28') && d < new Date('2026-04-29'); });
        const snap29 = snapshots.find(s => { const d = new Date(s.date); return d >= new Date('2026-04-29') && d < new Date('2026-04-30'); });

        if (snap28 && snap29) {
            console.log(`   28/04: quota=${fmt(snap28.quotaPrice)}, equity=${fmtCurrency(snap28.totalEquity)}, invested=${fmtCurrency(snap28.totalInvested)}`);
            console.log(`   29/04: quota=${fmt(snap29.quotaPrice)}, equity=${fmtCurrency(snap29.totalEquity)}, invested=${fmtCurrency(snap29.totalInvested)}`);
            const rawReturn = snap28.totalEquity > 0 ? ((snap29.totalEquity - snap28.totalEquity) / snap28.totalEquity) * 100 : 0;
            console.log(`   Variação de equity bruta: ${rawReturn.toFixed(2)}%`);

            // Checar transações nesse dia
            const start29 = new Date('2026-04-29T00:00:00.000Z');
            const end29 = new Date('2026-04-29T23:59:59.999Z');
            const txs29 = await Tx.find({ user: user._id, date: { $gte: start29, $lte: end29 } }).lean();
            if (txs29.length > 0) {
                console.log(`   📋 Transações em 29/04:`);
                txs29.forEach(tx => console.log(`      ${tx.type} ${tx.ticker}: qty=${tx.quantity}, price=${fmt(tx.price)}, total=${fmtCurrency(tx.totalValue)}`));
            } else {
                console.log(`   📋 Nenhuma transação registrada em 29/04.`);
                console.log(`   ❗ Queda sem transação = possível dado de mercado errado (price=0 ou spike)`);
            }
        } else {
            console.log(`   Snapshots de 28/04 ou 29/04 não encontrados.`);
        }

        // --- Últimos 30 snapshots ---
        console.log('\n📊 Últimos 30 snapshots:');
        console.log('   Data        | Quota      | Equity         | Invested       | Dietz Return');
        const recent = snapshots.slice(-30);
        for (let i = 0; i < recent.length; i++) {
            const s = recent[i];
            const prev = i > 0 ? recent[i-1] : null;
            const dietzReturn = prev && prev.quotaPrice > 0 ? ((s.quotaPrice - prev.quotaPrice) / prev.quotaPrice * 100).toFixed(2) + '%' : '—';
            console.log(`   ${fmtDate(s.date).padEnd(12)}| ${fmt(s.quotaPrice).padEnd(11)}| ${fmtCurrency(s.totalEquity).padEnd(15)}| ${fmtCurrency(s.totalInvested).padEnd(15)}| ${dietzReturn}`);
        }
    }

    // --- 2. Ativos atuais ---
    const assets = await Asset.find({ user: user._id }).lean();
    console.log(`\n💼 Ativos (${assets.length}):`);
    let totalCost = 0;
    for (const a of assets) {
        const cost = a.totalCost || 0;
        totalCost += cost;
        console.log(`   ${a.ticker} | qty=${a.quantity} | custo=${fmtCurrency(cost)} | type=${a.type || '?'}`);
    }
    console.log(`   TOTAL CUSTO: ${fmtCurrency(totalCost)}`);

    await mongoose.disconnect();
    console.log('\n✅ Diagnóstico concluído.');
};

run().catch(e => { console.error('❌', e.message); process.exit(1); });
