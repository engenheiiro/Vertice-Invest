/**
 * repairSnapshots.js
 *
 * Repara resets indevidos da cota (quotaPrice) no histórico de snapshots.
 *
 * Uso (DRY-RUN — só mostra o que seria feito):
 *   node server/scripts/repairSnapshots.js dev02@gmail.com
 *
 * Uso (APLICA A CORREÇÃO):
 *   node server/scripts/repairSnapshots.js dev02@gmail.com --confirm
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EMAIL = process.argv[2];
const CONFIRM = process.argv.includes('--confirm');

if (!EMAIL) {
    console.error('Uso: node server/scripts/repairSnapshots.js <email> [--confirm]');
    process.exit(1);
}

const UserSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const SnapshotSchema = new mongoose.Schema({}, { strict: false, collection: 'walletsnapshots' });

const User = mongoose.model('RepairUser', UserSchema);
const Snapshot = mongoose.model('RepairSnapshot', SnapshotSchema);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '?';
const fmt = (n) => typeof n === 'number' ? n.toFixed(4) : String(n ?? 'null');

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado.\n');

    const user = await User.findOne({ email: EMAIL }).lean();
    if (!user) { console.error(`❌ Usuário "${EMAIL}" não encontrado.`); process.exit(1); }
    console.log(`👤 ${user.name} (${user.email}) | ID: ${user._id}\n`);

    const snapshots = await Snapshot.find({ user: user._id }).sort({ date: 1 }).lean();
    if (snapshots.length < 2) {
        console.log('❌ Menos de 2 snapshots — nada a reparar.');
        process.exit(0);
    }

    // --- Detectar todos os resets: dias em que a quota caiu > 30% para perto de 100 ---
    const resets = [];
    for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1];
        const curr = snapshots[i];
        if (!prev.quotaPrice || !curr.quotaPrice || prev.quotaPrice <= 0) continue;
        const change = (curr.quotaPrice - prev.quotaPrice) / prev.quotaPrice;
        // Reset indevido: queda > 30% e cota resultante entre 95 e 105 (zona do "100 inicial")
        if (change < -0.30 && curr.quotaPrice >= 95 && curr.quotaPrice <= 105) {
            resets.push({ index: i, prev, curr, change });
        }
    }

    if (resets.length === 0) {
        console.log('✅ Nenhum reset indevido detectado. Histórico parece íntegro.');
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log(`🔴 ${resets.length} reset(s) indevido(s) detectado(s):\n`);
    for (const r of resets) {
        console.log(`   📅 ${fmtDate(r.curr.date)}`);
        console.log(`      Antes:  quota=${fmt(r.prev.quotaPrice)} (${fmtDate(r.prev.date)})`);
        console.log(`      Depois: quota=${fmt(r.curr.quotaPrice)}`);
        console.log(`      Queda:  ${(r.change * 100).toFixed(1)}%`);
    }

    // --- Calcular o plano de correção acumulado ---
    // Cada reset precisa de um multiplicador. Se houver múltiplos resets, eles se encadeiam.
    // Estratégia: para cada segmento entre resets, calcular o fator e aplicar ao segmento.

    console.log('\n📐 Plano de correção:\n');

    // Constrói os segmentos de aplicação:
    // Cada reset define onde começa um novo segmento incorreto.
    // Multiplier acumulado = produto de todos os fatores anteriores.
    let segments = [];
    let cumulativeFactor = 1;

    for (let r = 0; r < resets.length; r++) {
        const resetIdx = resets[r].index;
        const lastGoodQuota = resets[r].prev.quotaPrice;
        const resetQuota = resets[r].curr.quotaPrice;
        const factor = lastGoodQuota / resetQuota;
        cumulativeFactor *= factor;

        const endIdx = r + 1 < resets.length ? resets[r + 1].index - 1 : snapshots.length - 1;

        segments.push({
            fromDate: resets[r].curr.date,
            toDate: snapshots[endIdx].date,
            fromIdx: resetIdx,
            toIdx: endIdx,
            factor: cumulativeFactor,
            count: endIdx - resetIdx + 1,
        });

        console.log(`   Segmento ${r + 1}: ${fmtDate(resets[r].curr.date)} → ${fmtDate(snapshots[endIdx].date)}`);
        console.log(`      Fator: ${lastGoodQuota.toFixed(4)} / ${resetQuota.toFixed(4)} = ${factor.toFixed(6)}`);
        console.log(`      Fator acumulado: ${cumulativeFactor.toFixed(6)}`);
        console.log(`      Snapshots afetados: ${endIdx - resetIdx + 1}`);
    }

    // --- Preview: primeiros e últimos valores afetados ---
    console.log('\n📊 Preview das correções (primeiros 5 + últimos 5 afetados):\n');

    const allAffected = [];
    for (const seg of segments) {
        for (let i = seg.fromIdx; i <= seg.toIdx; i++) {
            allAffected.push({ snap: snapshots[i], factor: seg.factor });
        }
    }

    const preview = [
        ...allAffected.slice(0, 5),
        allAffected.length > 10 ? null : undefined,
        ...allAffected.slice(-5),
    ].filter(x => x !== undefined);

    let lastShown = -1;
    for (const item of preview) {
        if (item === null) {
            console.log('   ...');
            continue;
        }
        const { snap, factor } = item;
        const corrected = snap.quotaPrice * factor;
        console.log(`   ${fmtDate(snap.date)}: ${fmt(snap.quotaPrice)} → ${fmt(corrected)} (×${factor.toFixed(4)})`);
    }

    // TWRR final após correção
    const lastSnap = snapshots[snapshots.length - 1];
    const isAffected = allAffected.some(a => String(a.snap._id) === String(lastSnap._id));
    if (isAffected) {
        const lastFactor = allAffected.find(a => String(a.snap._id) === String(lastSnap._id)).factor;
        const correctedLast = lastSnap.quotaPrice * lastFactor;
        const twrrBefore = ((lastSnap.quotaPrice / 100 - 1) * 100).toFixed(2);
        const twrrAfter = ((correctedLast / 100 - 1) * 100).toFixed(2);
        console.log(`\n💡 Impacto na TWRR exibida:`);
        console.log(`   Antes:  ${twrrBefore}% (quota=${fmt(lastSnap.quotaPrice)})`);
        console.log(`   Depois: ${twrrAfter}% (quota=${fmt(correctedLast)})`);
    }

    console.log(`\nTotal de snapshots a corrigir: ${allAffected.length}`);

    if (!CONFIRM) {
        console.log('\n⚠️  DRY-RUN — nenhuma alteração foi feita.');
        console.log('   Para aplicar: node server/scripts/repairSnapshots.js ' + EMAIL + ' --confirm');
        await mongoose.disconnect();
        process.exit(0);
    }

    // --- APLICAR CORREÇÃO ---
    console.log('\n🔧 Aplicando correções...');

    let updated = 0;
    for (const { snap, factor } of allAffected) {
        const correctedQuota = snap.quotaPrice * factor;
        await Snapshot.updateOne(
            { _id: snap._id },
            { $set: { quotaPrice: correctedQuota } }
        );
        updated++;
        if (updated % 50 === 0) process.stdout.write(`   ${updated}/${allAffected.length}...\r`);
    }

    console.log(`\n✅ ${updated} snapshots corrigidos com sucesso.`);

    // Verificação final
    const lastFixed = await Snapshot.findOne({ user: user._id }).sort({ date: -1 }).lean();
    const finalTWRR = ((lastFixed.quotaPrice / 100 - 1) * 100).toFixed(2);
    console.log(`\n📊 TWRR final após reparo: ${finalTWRR}% (quota=${fmt(lastFixed.quotaPrice)})`);

    await mongoose.disconnect();
    console.log('✅ Reparo concluído.');
};

run().catch(e => { console.error('❌', e.message); process.exit(1); });
