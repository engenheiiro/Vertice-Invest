/**
 * Aposenta (blacklist) tickers que não existem mais em NENHUMA fonte — B3 e Exterior.
 *
 * Sucessor do `blacklistDeadB3.js`, que só cobria STOCK/FII e decidia pelo estado do
 * banco (inativo + stale + failCount). O estado do banco não distingue "morreu" de
 * "provedor engasgou", então a guarda de blue-chip mandava todo papel grande para
 * revisão manual — e a revisão nunca acontecia. Resultado: MMC, HOLX, SEE, CFLT,
 * EXAS, BPAN4, CPLE5 ficaram 4 a 6 meses no limbo, repetindo o mesmo warn a cada
 * sync, sem caminho de saída.
 *
 * Aqui a guarda é o PROBE AO VIVO (lib/quoteProbe.js), não o porte do papel: nada é
 * aposentado sem que Yahoo (quote + chart), Google (todas as bolsas plausíveis) e a
 * busca por nome falhem na hora da execução. Papel grande deixa de ser exceção
 * permanente e passa a ser apenas um papel a mais que precisa provar que morreu.
 *
 * Guardas que permanecem:
 *   - DRY-RUN por padrão; só grava com --apply.
 *   - Ticker detido por usuário nunca é aposentado automaticamente (--force-held
 *     exige nomeá-lo em --tickers).
 *   - Idempotente: só toca em isBlacklisted=false.
 *   - Aposentar NÃO apaga histórico nem posições; é flag de elegibilidade, e o
 *     `--undo` desfaz.
 *
 * Uso:
 *   node server/scripts/retireDeadTickers.js                       # dry-run de todos os inativos
 *   node server/scripts/retireDeadTickers.js --days=90             # exige N dias parado (default 60)
 *   node server/scripts/retireDeadTickers.js --tickers=A,B --apply # alvo explícito
 *   node server/scripts/retireDeadTickers.js --tickers=MMC --successor=MRSH --apply
 *   node server/scripts/retireDeadTickers.js --tickers=X --undo --apply   # reverte
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { connectScriptDb } from './lib/scriptDb.js';
import { probeTicker, classifyProbe, probeHasPrice } from './lib/quoteProbe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const undo = args.includes('--undo');
const forceHeld = args.includes('--force-held');
const valueOf = (flag) => {
    const a = args.find((x) => x.startsWith(`${flag}=`));
    return a ? a.replace(`${flag}=`, '') : null;
};
const explicit = valueOf('--tickers')?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;
const successor = valueOf('--successor')?.trim().toUpperCase() || null;
const STALE_DAYS = Number(valueOf('--days') ?? 60);
const FAIL_MIN = 10; // MAX_FAILURES_BEFORE_BLACKLIST

if (successor && (!explicit || explicit.length !== 1)) {
    console.error('❌ --successor só vale para UM ticker por vez (--tickers=MMC --successor=MRSH).');
    process.exit(1);
}

const daysAgo = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
    await connectScriptDb({ label: 'retireDeadTickers' });

    if (undo) {
        if (!explicit) {
            console.error('❌ --undo exige --tickers=A,B,C (reverter em massa é sempre engano).');
            process.exit(1);
        }
        const docs = await MarketAsset.find({ ticker: { $in: explicit } }).select('ticker isBlacklisted').lean();
        console.log(`\n↩️  Reativando ${docs.length} ticker(s): ${docs.map((d) => d.ticker).join(', ')}`);
        if (apply) {
            const res = await MarketAsset.updateMany(
                { ticker: { $in: explicit } },
                { $set: { isBlacklisted: false, failCount: 0, lastFailDate: null }, $unset: { retiredAt: '', retiredReason: '', successorTicker: '' } },
            );
            console.log(`✅ ${res.modifiedCount} revertido(s) — o próximo sync tenta cotar de novo.`);
        } else {
            console.log('ℹ️  DRY-RUN: rode com --apply para reverter.');
        }
        await mongoose.disconnect();
        return;
    }

    const query = explicit
        ? { ticker: { $in: explicit }, isBlacklisted: false }
        : { isActive: false, isBlacklisted: false, failCount: { $gte: FAIL_MIN } };

    const candidates = await MarketAsset.find(query)
        .select('ticker name type marketCap liquidity failCount isActive updatedAt')
        .sort({ type: 1, ticker: 1 })
        .lean();

    if (!candidates.length) {
        console.log('✅ Nenhum candidato — nada a fazer.');
        await mongoose.disconnect();
        return;
    }

    const heldRows = await UserAsset.aggregate([
        { $match: { ticker: { $in: candidates.map((c) => c.ticker) } } },
        { $group: { _id: '$ticker', n: { $sum: 1 } } },
    ]);
    const heldBy = Object.fromEntries(heldRows.map((r) => [r._id, r.n]));

    console.log(`\n🧹 Aposentadoria de tickers mortos ${apply ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'} | ${candidates.length} candidato(s) | probe ao vivo\n`);

    const toRetire = [];
    const skipped = [];

    for (const a of candidates) {
        const stale = daysAgo(a.updatedAt);
        const held = heldBy[a.ticker] || 0;

        if (!explicit && stale < STALE_DAYS) {
            skipped.push({ a, reason: `parado há ${stale}d (< ${STALE_DAYS}d de quarentena)` });
            continue;
        }
        if (held > 0 && !(explicit && forceHeld)) {
            skipped.push({ a, reason: `🧷 em ${held} carteira(s) — decidir a dedo (--force-held com --tickers)` });
            continue;
        }

        const p = await probeTicker(a);
        const verdict = classifyProbe(a, p);
        await sleep(350);

        if (probeHasPrice(p)) {
            skipped.push({ a, reason: verdict.label });
            continue;
        }
        toRetire.push({ a, stale, verdict, held });
    }

    if (toRetire.length) {
        console.log(`⛔ Aposentar (${toRetire.length}) — sem preço em nenhuma fonte agora:`);
        for (const { a, stale, verdict, held } of toRetire) {
            console.log(`   • ${a.ticker.padEnd(9)} [${String(a.type).padEnd(8)}] parado=${stale}d fail=${a.failCount}${held ? ` 🧷 held=${held}` : ''} — ${a.name || 's/nome'}`);
            console.log(`       ${verdict.label}`);
        }
    }
    if (skipped.length) {
        console.log(`\n🔍 Preservados (${skipped.length}) — NÃO serão tocados:`);
        for (const { a, reason } of skipped) console.log(`   • ${a.ticker.padEnd(9)} — ${reason}`);
    }

    if (apply && toRetire.length) {
        const ops = toRetire.map(({ a, verdict }) => ({
            updateOne: {
                filter: { ticker: a.ticker, isBlacklisted: false },
                update: {
                    $set: {
                        isBlacklisted: true,
                        isActive: false,
                        retiredAt: new Date(),
                        retiredReason: `probe ${new Date().toISOString().slice(0, 10)}: ${verdict.code}`,
                        ...(successor ? { successorTicker: successor } : {}),
                    },
                },
            },
        }));
        const res = await MarketAsset.bulkWrite(ops);
        console.log(`\n✅ ${res.modifiedCount} ticker(s) aposentado(s) (isBlacklisted=true).`);
        if (successor) console.log(`   ↪ sucessor registrado: ${explicit[0]} → ${successor}`);
    } else if (toRetire.length) {
        console.log(`\nℹ️  DRY-RUN: rode com --apply para aposentar os ${toRetire.length} acima.`);
    }

    console.log('\n📌 Aposentar afeta só elegibilidade de ranking/sync; não apaga histórico nem posições.');
    console.log('   Reverter: node server/scripts/retireDeadTickers.js --tickers=X --undo --apply');
    await mongoose.disconnect();
};

run().catch((e) => {
    console.error('❌ Erro:', e.message);
    process.exit(1);
});
