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
 * Aqui a guarda é a MEDIDA AO VIVO, não o porte do papel: papel grande deixa de ser
 * exceção permanente e passa a ser apenas um papel a mais que precisa provar que
 * morreu. Duas evidências, com precedência clara:
 *
 *   1. **Pregão da B3** (lib/b3Activity.js) — para papel da B3, decide sozinha. O
 *      arquivo oficial lista o que foi NEGOCIADO; zero negócios em 10 pregões é
 *      símbolo extinto, e um único negócio já impede a aposentadoria.
 *   2. **Probe nas fontes** (lib/quoteProbe.js) — decide para o que não é da B3, e
 *      em qualquer caso é o que sugere o SUCESSOR na troca de símbolo.
 *
 * A ordem importa porque o probe tem um falso positivo caro: o `chart` do Yahoo
 * devolve o último candle dentro da janela pedida e o Google serve o último preço
 * conhecido por tempo indeterminado. Em 04/09/2026 esse eco jurava que NGRD3, TRAD3
 * e HSRE11 estavam vivos; os três tinham ZERO negócios nos 10 pregões anteriores.
 * Preço em cache não é papel negociando.
 *
 * O probe passou a DATAR o eco em 05/09/2026, e com isso o falso positivo deixa
 * de depender da precedência da B3 para ser contido — o que valia só para papel
 * brasileiro passou a valer para o exterior, que não tem arquivo de pregão. Foi
 * o que faltava para AVB, EQR (fusão → VMRK) e EA (fechou capital): os três
 * saíam daqui como "✅ RECUPERA — falha transitória" enquanto o último negócio
 * era de agosto. Ver `probeProvesTrading` em lib/quoteProbe.js.
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
 *   node server/scripts/retireDeadTickers.js --sessions=20         # janela de pregões da B3 (default 10)
 *   node server/scripts/retireDeadTickers.js --tickers=A,B --apply # alvo explícito
 *   node server/scripts/retireDeadTickers.js --tickers=MMC --successor=MRSH --apply
 *   node server/scripts/retireDeadTickers.js --successors=GUAR3:RIAA3,PETZ3:AUAU3 --apply
 *   node server/scripts/retireDeadTickers.js --tickers=X --reason="encerrou as atividades" --apply
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
import { probeTicker, classifyProbe } from './lib/quoteProbe.js';
import { loadB3Window, b3Activity, b3Label, isB3Type } from './lib/b3Activity.js';

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
const explicitFlag = valueOf('--tickers')?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;
const successor = valueOf('--successor')?.trim().toUpperCase() || null;
/**
 * Mapa OLD:NEW para a onda de renomeação — em 04/09/2026 foram nove pares no
 * mesmo levantamento (AXIA6→AXIA3, GUAR3→RIAA3, PETZ3→AUAU3, CVBI11→PCIP11…).
 * Continua sendo um par explícito por ticker, que é a guarda que importa: o que
 * `--successor` proíbe é herdar sucessor por lote, não nomear vários de uma vez.
 */
const successorMap = Object.fromEntries(
    (valueOf('--successors') || '')
        .split(',').map((par) => par.trim().toUpperCase()).filter(Boolean)
        .map((par) => par.split(':').map((x) => x.trim()))
        .filter(([de, para]) => de && para),
);
const temMapa = Object.keys(successorMap).length > 0;
/**
 * O MOTIVO EM PORTUGUÊS, quando ele é sabido — e só então.
 *
 * O `retiredReason` automático diz o que MEDIMOS ("probe 2026-09-05: DEAD_B3"),
 * que é a verdade disponível quando ninguém sabe o que houve. Mas quando o dono
 * sabe o fato — "encerrou as atividades", "concluiu a venda dos empreendimentos
 * para liquidação definitiva" — gravar só a medição joga fora a única informação
 * que não dá para reconstruir depois: `DEAD_B3` convida alguém a re-sondar o
 * papel daqui a seis meses; "encerrou as atividades" encerra o assunto.
 *
 * O motivo NÃO substitui o veredito, vem junto: o que se soube e o que se mediu
 * são coisas diferentes e as duas envelhecem juntas melhor do que sozinhas.
 *
 * Exige --tickers pelo mesmo motivo do --successor: um motivo por evento
 * societário. Herdado por uma varredura automática, ele atribuiria a história de
 * um fundo a todos os outros da leva.
 */
const reason = valueOf('--reason')?.trim() || null;
const STALE_DAYS = Number(valueOf('--days') ?? 60);
// Janela de pregões da B3. 10 é folgado para o papel ilíquido de verdade — no
// levantamento de 04/09/2026, EQMA3B (3 negócios/dia) apareceu em 6 dos 10.
const B3_SESSIONS = Number(valueOf('--sessions') ?? 10);
const FAIL_MIN = 10; // MAX_FAILURES_BEFORE_BLACKLIST

// Nomear o sucessor já diz qual ticker aposentar — repetir em --tickers seria
// só uma chance a mais de os dois discordarem.
const explicit = explicitFlag
    || (temMapa ? Object.keys(successorMap) : null);

if (successor && temMapa) {
    console.error('❌ Use --successor (um par) OU --successors (vários), não os dois.');
    process.exit(1);
}
if (successor && (!explicit || explicit.length !== 1)) {
    console.error('❌ --successor só vale para UM ticker por vez (--tickers=MMC --successor=MRSH).');
    process.exit(1);
}
if (reason && !explicit) {
    console.error('❌ --reason exige --tickers: motivo é do evento societário, não da varredura.');
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
                // isActive volta junto: a baixa desativa (o --apply grava os dois), então
                // reverter só o isBlacklisted deixava o papel fora da fila de cotação
                // esperando a varredura de reativação notar. Desfazer é desfazer tudo.
                { $set: { isBlacklisted: false, isActive: true, failCount: 0, lastFailDate: null }, $unset: { retiredAt: '', retiredReason: '', successorTicker: '' } },
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

    // Uma leitura do arquivo por pregão, reaproveitada por todos os candidatos.
    const janela = await loadB3Window({ sessions: B3_SESSIONS });
    if (janela.length) {
        console.log(`📄 Pregões da B3 na janela: ${janela.map((d) => d.dia.slice(5)).join(', ')}\n`);
    } else {
        console.log('⚠️  Sem arquivo da B3 na janela — papel da B3 volta a ser decidido só pelo probe.\n');
    }

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

        // Papel da B3: o pregão decide, nos dois sentidos. O probe fica só com o
        // que ele faz bem — apontar o sucessor quando o símbolo trocou.
        const b3 = isB3Type(a.type) ? b3Activity(a.ticker, janela) : { conclusive: false };
        if (b3.conclusive) {
            if (b3.traded > 0) {
                skipped.push({ a, reason: b3Label(b3) });
                continue;
            }
            toRetire.push({
                a,
                stale,
                held,
                verdict: {
                    code: verdict.code === 'SUCCESSOR' ? 'SUCCESSOR' : 'DEAD_B3',
                    label: `${b3Label(b3)}${verdict.code === 'SUCCESSOR' ? ` · ${verdict.label}` : ''}`,
                },
            });
            continue;
        }

        // Preserva SÓ quando o probe prova negociação recente. Antes a guarda era
        // `probeHasPrice`, e preço não é prova: o `meta` do Yahoo e a página do
        // Google servem a última cotação de um símbolo extinto indefinidamente.
        // A troca não afrouxa nada — o que não prova vida ainda precisa passar
        // pelas mesmas guardas (detido em carteira, quarentena, --apply).
        if (verdict.code === 'RECOVERS') {
            skipped.push({ a, reason: verdict.label });
            continue;
        }
        toRetire.push({ a, stale, verdict, held });
    }

    if (toRetire.length) {
        console.log(`⛔ Aposentar (${toRetire.length}) — sem negócio na B3 (ou sem preço em fonte alguma, fora da B3):`);
        for (const { a, stale, verdict, held } of toRetire) {
            console.log(`   • ${a.ticker.padEnd(9)} [${String(a.type).padEnd(8)}] parado=${stale}d fail=${a.failCount}${held ? ` 🧷 held=${held}` : ''} — ${a.name || 's/nome'}`);
            console.log(`       ${verdict.label}`);
            if (reason) console.log(`       📝 motivo a registrar: ${reason}`);
            if (successorMap[a.ticker]) console.log(`       ↪ sucessor a registrar: ${successorMap[a.ticker]}`);
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
                        retiredReason: [reason, `probe ${new Date().toISOString().slice(0, 10)}: ${verdict.code}`]
                            .filter(Boolean).join(' · '),
                        ...(successorMap[a.ticker] || successor
                            ? { successorTicker: successorMap[a.ticker] || successor }
                            : {}),
                    },
                },
            },
        }));
        const res = await MarketAsset.bulkWrite(ops);
        console.log(`\n✅ ${res.modifiedCount} ticker(s) aposentado(s) (isBlacklisted=true).`);
        if (successor) console.log(`   ↪ sucessor registrado: ${explicit[0]} → ${successor}`);
        for (const [de, para] of Object.entries(successorMap)) {
            if (toRetire.some((r) => r.a.ticker === de)) console.log(`   ↪ sucessor registrado: ${de} → ${para}`);
        }
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
