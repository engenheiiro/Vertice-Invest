/**
 * Re-encadeia a cota (TWRR) dos snapshots EXISTENTES, creditando os proventos que
 * o cálculo antigo vazava (ver bug do "vazamento de proventos": no dia-ex o preço
 * cai, mas o provento recebido nunca entrava na cota → distribuição virava
 * prejuízo-fantasma).
 *
 * Diferente de `rebuild:history`, este script NÃO reconstrói preços: mantém o
 * `totalEquity` real gravado dia a dia (fonte mais confiável que o AssetHistory,
 * que pode estar stale) e recalcula APENAS o `quotaPrice`, usando:
 *   - fluxo EXATO do dia (transações BUY/SELL reais), e
 *   - renda do dia (DividendEvent com ex-date no intervalo × quantidade em carteira
 *     naquele momento, deduplicada por identidade canônica).
 *
 * Modo padrão = DRY-RUN (compara cota antiga × nova, sem gravar).
 * Uso:
 *   node scripts/rechainQuota.js                 # dry-run, todas as contas (resumo)
 *   node scripts/rechainQuota.js --user=<id>     # dry-run detalhado de uma conta
 *   node scripts/rechainQuota.js --limit=20      # dry-run numa amostra
 *   node scripts/rechainQuota.js --apply         # GRAVA o quotaPrice recalculado
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import WalletSnapshot from '../models/WalletSnapshot.js';
import AssetTransaction from '../models/AssetTransaction.js';
import DividendEvent from '../models/DividendEvent.js';
import { calculateDailyDietz } from '../utils/mathUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Dia-calendário BR (YYYY-MM-DD) de um instante — snapshots/transações são
// ancorados no dia de São Paulo (snapshot grava 23:59 BRT).
const brDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(d));
// Dia-calendário UTC — DividendEvent.date é normalizado à meia-noite UTC da ex-date,
// então o dia da ex-date é o dia UTC do instante (ver financialService.normalizeDividendDate).
const utcDay = (d) => new Date(d).toISOString().slice(0, 10);
const up = (t) => String(t || '').toUpperCase();

/**
 * Recalcula a série de cotas de um usuário a partir dos snapshots existentes.
 * Retorna { snaps, oldQuota, newQuota[], maxDailyJump, income, flow } ou null.
 */
const rechainUser = async (userId) => {
    const snaps = await WalletSnapshot.find({ user: userId }).sort({ date: 1 }).lean();
    if (snaps.length < 2) return null;

    const txs = await AssetTransaction.find({ user: userId }).sort({ date: 1 }).lean();
    const tickers = [...new Set(txs.map((t) => up(t.ticker)))];
    const divs = tickers.length
        ? await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: 1 }).lean()
        : [];

    // Lista única de eventos (tx + provento) na mesma linha do tempo de dia-calendário.
    // TX e DIV usam dia UTC: ambos são gravados à meia-noite UTC do dia-calendário
    // pretendido (tx do usuário em "02/07" → 2024-07-02T00:00Z) e o rebuild atribui
    // a posição pelo toDateKey/UTC — usar brDay aqui deslocaria o fluxo 1 dia e criava
    // spikes (fluxo num dia, equity refletindo a posição só no dia seguinte). O
    // snapshot, esse sim, é lido em dia BR (grava 23:59 BRT). Empate: TX antes de DIV.
    const events = [];
    for (const t of txs) {
        events.push({ dayKey: utcDay(t.date), order: 0, kind: t.type, ticker: up(t.ticker), qty: t.quantity, value: t.totalValue });
    }
    const seenDiv = new Set();
    for (const d of divs) {
        const key = `${up(d.ticker)}|${utcDay(d.date)}|${d.type || 'DIVIDEND'}`; // identidade canônica
        if (seenDiv.has(key)) continue; // dedup multi-fonte (mesmo provento, valor levemente distinto)
        seenDiv.add(key);
        events.push({ dayKey: utcDay(d.date), order: 1, kind: 'DIV', ticker: up(d.ticker), amount: d.amount });
    }
    events.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : a.order - b.order));

    const qty = new Map();
    let quota = 100;
    let prevEquity = 0;
    let evIdx = 0;
    let totalIncome = 0;
    let totalFlow = 0;
    let maxDailyJump = 0;
    const newQuota = new Array(snaps.length);

    for (let i = 0; i < snaps.length; i++) {
        const dayKey = brDay(snaps[i].date);
        let dayFlow = 0;
        let income = 0;

        // Todos os eventos ainda não processados com dia <= hoje pertencem, por
        // construção, ao intervalo (snapshot anterior, este snapshot].
        while (evIdx < events.length && events[evIdx].dayKey <= dayKey) {
            const ev = events[evIdx];
            if (ev.kind === 'BUY') {
                qty.set(ev.ticker, (qty.get(ev.ticker) || 0) + ev.qty);
                dayFlow += ev.value;
            } else if (ev.kind === 'SELL') {
                qty.set(ev.ticker, (qty.get(ev.ticker) || 0) - ev.qty);
                dayFlow -= ev.value;
            } else if (ev.kind === 'DIV') {
                const held = qty.get(ev.ticker) || 0;
                if (held > 0) income += held * ev.amount;
            }
            evIdx++;
        }

        const equity = snaps[i].totalEquity || 0;
        if (prevEquity > 0 || dayFlow > 0 || income > 0) {
            const r = calculateDailyDietz(prevEquity, equity, dayFlow, income);
            // Mesmo circuit breaker do path diário: descarta variação absurda (dado sujo).
            if (r > -0.5 && r < 0.5) {
                quota *= 1 + r;
                if (Math.abs(r) > maxDailyJump) maxDailyJump = Math.abs(r);
            }
        }
        newQuota[i] = quota;
        totalIncome += income;
        totalFlow += dayFlow;
        prevEquity = equity;
    }

    return {
        snaps,
        oldQuota: snaps[snaps.length - 1].quotaPrice || 100,
        newQuotaLast: newQuota[newQuota.length - 1],
        newQuota,
        maxDailyJump,
        totalIncome,
        totalFlow,
    };
};

const pct = (q) => ((q / 100 - 1) * 100);
const pad = (s, n) => String(s).padStart(n);

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado.\n');

    const apply = process.argv.includes('--apply');
    const userArg = process.argv.find((a) => a.startsWith('--user='));
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    const targetUser = userArg ? userArg.split('=')[1] : null;
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

    let userIds = targetUser
        ? [targetUser]
        : (await WalletSnapshot.distinct('user')).map((id) => String(id));
    if (limit) userIds = userIds.slice(0, limit);

    console.log(`${apply ? '💾 APLICANDO' : '🔍 DRY-RUN'} — ${userIds.length} conta(s)\n`);
    console.log('user                     | snaps | TWRR antigo | TWRR novo | Δpp     | renda R$ | maxΔdia');
    console.log('-------------------------|-------|-------------|-----------|---------|----------|--------');

    let changed = 0;
    let flagged = 0;
    for (const userId of userIds) {
        let res;
        try {
            res = await rechainUser(userId);
        } catch (e) {
            console.log(`${userId} | ERRO: ${e.message}`);
            continue;
        }
        if (!res) continue;

        const oldT = pct(res.oldQuota);
        const newT = pct(res.newQuotaLast);
        const delta = newT - oldT;
        const jump = res.maxDailyJump * 100;
        const flag = jump > 20 ? ' ⚠️' : '';
        if (Math.abs(delta) > 0.01) changed++;
        if (jump > 20) flagged++;

        console.log(
            `${String(userId).padEnd(24)} | ${pad(res.snaps.length, 5)} | ${pad(oldT.toFixed(2) + '%', 11)} | ${pad(newT.toFixed(2) + '%', 9)} | ${pad((delta >= 0 ? '+' : '') + delta.toFixed(2), 7)} | ${pad(res.totalIncome.toFixed(0), 8)} | ${pad(jump.toFixed(1) + '%', 6)}${flag}`
        );

        if (apply) {
            const ops = res.snaps.map((s, i) => ({
                updateOne: {
                    filter: { _id: s._id },
                    update: { $set: { quotaPrice: Math.round(res.newQuota[i] * 1e4) / 1e4 } },
                },
            }));
            for (let i = 0; i < ops.length; i += 5000) {
                await WalletSnapshot.bulkWrite(ops.slice(i, i + 5000));
            }
        }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`Contas com mudança de cota: ${changed} | com salto diário > 20% (revisar): ${flagged}`);
    console.log(apply ? '✅ Gravado.' : '🔍 Dry-run — nada gravado. Rode com --apply para persistir.');
    await mongoose.disconnect();
};

run().catch((e) => { console.error('❌', e); process.exit(1); });
