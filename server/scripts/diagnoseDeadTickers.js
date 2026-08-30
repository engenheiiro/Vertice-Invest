/**
 * Diagnóstico (READ-ONLY) de tickers que não cotam mais — B3 e Exterior.
 *
 * Generaliza o diagnoseB3Failures.js: o problema que sobrou no sync:prod não é
 * mais só da B3. A cada run o `tryReactivateAssets` re-cota TODO ativo inativo
 * não-blacklistado — inclusive papéis mortos por corporate action (fusão,
 * aquisição, troca de ticker) — e o warn "Yahoo falhou para N ativos" reaparece
 * idêntico, run após run, sem que ninguém possa fazer nada com ele.
 *
 * Aqui a decisão sai de PROBE AO VIVO (ver lib/quoteProbe.js), não de memória:
 *   • ✅ RECUPERA    — a fonte responde agora: a falha era throttle transitório.
 *   • 🔍 SEM PREÇO   — símbolo ainda existe na busca, mas nenhuma fonte dá preço.
 *   • 🔁 SUCESSOR    — o símbolo sumiu e a busca por nome aponta outro papel
 *                      (troca de ticker / incorporação).
 *   • ⛔ MORTO       — não existe em Yahoo (quote/chart/search) nem no Google.
 *
 * NÃO grava nada. Para aplicar, use `retireDeadTickers.js`.
 *
 * Uso:
 *   node server/scripts/diagnoseDeadTickers.js                  # todos os inativos
 *   node server/scripts/diagnoseDeadTickers.js --tickers=A,B,C  # alvo explícito
 *   node server/scripts/diagnoseDeadTickers.js --json           # saída p/ máquina
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { SP500_STOCKS } from '../config/sp500List.js';
import { connectScriptDb } from './lib/scriptDb.js';
import { probeTicker, classifyProbe } from './lib/quoteProbe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const tickersArg = args.find((a) => a.startsWith('--tickers='));
const explicit = tickersArg
    ? tickersArg.replace('--tickers=', '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    : null;

const daysAgo = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
    await connectScriptDb({ label: 'diagnoseDeadTickers' });

    const query = explicit ? { ticker: { $in: explicit } } : { isActive: false, isBlacklisted: false };

    const assets = await MarketAsset.find(query)
        .select('ticker name type usSubType isActive isBlacklisted isIgnored failCount lastFailDate lastPrice marketCap liquidity updatedAt')
        .sort({ type: 1, ticker: 1 })
        .lean();

    if (!assets.length) {
        console.log('✅ Nenhum ativo inativo — nada a diagnosticar.');
        await mongoose.disconnect();
        return;
    }

    const heldRows = await UserAsset.aggregate([
        { $match: { ticker: { $in: assets.map((a) => a.ticker) } } },
        { $group: { _id: '$ticker', n: { $sum: 1 } } },
    ]);
    const heldBy = Object.fromEntries(heldRows.map((r) => [r._id, r.n]));
    const inUniverse = new Set(SP500_STOCKS.map((s) => s.ticker));

    if (!asJson) console.log(`\n🔎 Probe ao vivo de ${assets.length} ativos inativos (READ-ONLY)\n`);

    const rows = [];
    for (const a of assets) {
        const p = await probeTicker(a);
        const held = heldBy[a.ticker] || 0;
        const verdict = classifyProbe(a, p);
        rows.push({
            ticker: a.ticker, name: a.name, type: a.type, marketCap: a.marketCap, liquidity: a.liquidity,
            failCount: a.failCount, staleDays: daysAgo(a.updatedAt), held, verdict, probe: p,
            inUniverse: inUniverse.has(a.ticker),
        });
        if (!asJson) {
            const universeNote = a.type === 'STOCK_US' ? (inUniverse.has(a.ticker) ? ' · na lista curada' : ' · FORA da lista curada') : '';
            console.log(`• ${a.ticker.padEnd(9)} [${String(a.type).padEnd(8)}] ${(a.name || 's/nome').slice(0, 34)}`);
            console.log(`    mcap=${a.marketCap || 0} liq=${a.liquidity || 0} fail=${a.failCount} parado=${daysAgo(a.updatedAt)}d${held ? ` 🧷 em ${held} carteira(s)` : ''}${universeNote}`);
            console.log(`    → ${verdict.label}`);
        }
        await sleep(350); // educado com as fontes
    }

    if (asJson) {
        console.log(JSON.stringify(rows, null, 2));
        await mongoose.disconnect();
        return;
    }

    const by = (c) => rows.filter((r) => r.verdict.code === c);
    console.log('\n── Resumo ───────────────────────────────────────────────');
    const groups = [
        ['RECOVERS', '✅ recuperam agora (não mexer)'],
        ['SEARCH_ONLY', '🔍 existem mas sem preço'],
        ['SUCCESSOR', '🔁 provável troca de ticker/incorporação'],
        ['DEAD', '⛔ mortos'],
    ];
    for (const [code, title] of groups) {
        const g = by(code);
        if (g.length) console.log(`${title}: ${g.length} — ${g.map((r) => r.ticker).join(', ')}`);
    }
    const heldAny = rows.filter((r) => r.held > 0);
    if (heldAny.length) console.log(`🧷 em carteira (decidir a dedo): ${heldAny.map((r) => r.ticker).join(', ')}`);
    console.log('\n📌 Aplicar com: node server/scripts/retireDeadTickers.js --tickers=... --apply');
    await mongoose.disconnect();
};

run().catch((e) => {
    console.error('❌ Erro:', e.message);
    process.exit(1);
});
