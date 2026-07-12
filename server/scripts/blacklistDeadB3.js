
/**
 * Blacklist de tickers B3 genuinamente mortos (deslistados/cancelados).
 *
 * Contexto: no sync:prod, ativos que falham cotação por 10 dias distintos viram
 * isActive=false. Mas "inativo" != "deslistado" — em jul/2026 o fallback do Google
 * estava quebrado (cookie de consentimento / redirect /finance/beta + regex de B3SA3),
 * o que desativou ATÉ blue-chips válidos (B3SA3, a própria bolsa). Depois de corrigir
 * o fallback, o tryReactivateAssets reativa tudo que voltou a cotar; o que SOBRAR
 * inativo por muito tempo é o conjunto de fato morto.
 *
 * ORDEM CORRETA DE USO:
 *   1. Deploy dos fixes de cotação (externalMarketService).
 *   2. Rodar sync:prod (reativa o que é recuperável).
 *   3. SÓ ENTÃO rodar este script — o que continua inativo+stale é o morto real.
 *
 * Critério (objetivo, não depende de decorar corporate actions):
 *   type STOCK|FII, isActive=false, isBlacklisted=false, failCount>=10 e parado
 *   (updatedAt) há >= --days (default 45).
 *
 * Segurança:
 *   - DRY-RUN por padrão. Só grava com --apply.
 *   - Blue-chips (marketCap >= R$1B) NUNCA são auto-blacklistados: um ativo grande
 *     e inativo é suspeito de lacuna de fonte (como foi o B3SA3), não de delisting —
 *     vão para REVISÃO MANUAL.
 *   - Tickers detidos em carteira de algum usuário vão para REVISÃO MANUAL (blacklist
 *     é só de elegibilidade de ranking, mas convém decidir caso a caso).
 *   - Idempotente: reexecutar não muda nada (só toca em isBlacklisted=false).
 *
 * Uso:
 *   node server/scripts/blacklistDeadB3.js                 # dry-run, days=45
 *   node server/scripts/blacklistDeadB3.js --days=60       # dry-run, days=60
 *   node server/scripts/blacklistDeadB3.js --apply         # grava
 *   node server/scripts/blacklistDeadB3.js --tickers=IGBR3,BLUT4 --apply  # alvo explícito
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const daysArg = args.find(a => a.startsWith('--days='));
const tickersArg = args.find(a => a.startsWith('--tickers='));

const STALE_DAYS = daysArg ? Number(daysArg.replace('--days=', '')) : 45;
const FAIL_MIN = 10;               // MAX_FAILURES_BEFORE_BLACKLIST
const BLUE_CHIP_MCAP = 1_000_000_000; // R$1B — mesmo teto da guarda de blue-chip
const explicitTickers = tickersArg
    ? tickersArg.replace('--tickers=', '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
    : null;

const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity;

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`\n🧹 Blacklist de B3 mortos ${apply ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'} | stale>=${STALE_DAYS}d\n`);

        const query = explicitTickers
            ? { ticker: { $in: explicitTickers }, isBlacklisted: false }
            : { type: { $in: ['STOCK', 'FII'] }, isActive: false, isBlacklisted: false, failCount: { $gte: FAIL_MIN } };

        const candidates = await MarketAsset.find(query)
            .select('ticker name type marketCap liquidity failCount isActive updatedAt')
            .lean();

        if (candidates.length === 0) {
            console.log('✅ Nenhum candidato — nada a fazer.');
            process.exit(0);
        }

        // Cruza com carteiras (blacklist de ticker detido merece decisão manual).
        const heldRows = await UserAsset.aggregate([
            { $match: { ticker: { $in: candidates.map(c => c.ticker) } } },
            { $group: { _id: '$ticker', n: { $sum: 1 } } },
        ]);
        const heldBy = Object.fromEntries(heldRows.map(r => [r._id, r.n]));

        const toBlacklist = []; // Tier A — auto
        const manual = [];      // Tier B — revisão

        for (const a of candidates) {
            const stale = daysAgo(a.updatedAt);
            const held = heldBy[a.ticker] || 0;
            // Com --tickers explícito, respeita o alvo (mas ainda protege carteira/blue-chip → manual).
            const staleEnough = explicitTickers ? true : stale >= STALE_DAYS;
            if (!staleEnough) continue;

            if (held > 0) { manual.push({ a, stale, reason: `em ${held} carteira(s)` }); continue; }
            if ((a.marketCap || 0) >= BLUE_CHIP_MCAP) { manual.push({ a, stale, reason: `blue-chip mcap=${a.marketCap} (suspeito de lacuna de fonte, não delisting)` }); continue; }
            toBlacklist.push({ a, stale });
        }

        if (toBlacklist.length) {
            console.log(`⛔ Blacklist (${toBlacklist.length}) — pequenos, inativos e stale:`);
            for (const { a, stale } of toBlacklist) {
                console.log(`   • ${a.ticker.padEnd(8)} [${a.type}] mcap=${a.marketCap} liq=${a.liquidity} fail=${a.failCount} parado=${stale}d — ${a.name || 's/nome'}`);
            }
        }
        if (manual.length) {
            console.log(`\n🔍 Revisão manual (${manual.length}) — NÃO serão tocados:`);
            for (const { a, stale, reason } of manual) {
                console.log(`   • ${a.ticker.padEnd(8)} [${a.type}] parado=${stale}d — ${reason}`);
            }
        }

        if (apply && toBlacklist.length) {
            const ops = toBlacklist.map(({ a }) => ({
                updateOne: { filter: { ticker: a.ticker, isBlacklisted: false }, update: { $set: { isBlacklisted: true } } },
            }));
            const res = await MarketAsset.bulkWrite(ops);
            console.log(`\n✅ ${res.modifiedCount} ativos marcados isBlacklisted=true.`);
        } else if (toBlacklist.length) {
            console.log(`\nℹ️  DRY-RUN: rode com --apply para blacklistar os ${toBlacklist.length} acima.`);
        }

        console.log('\n📌 Blacklist só afeta elegibilidade de ranking/sync; não apaga histórico nem posições.');
        console.log(apply ? '\n✅ Concluído.' : '\n✅ DRY-RUN concluído (nada gravado).');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
