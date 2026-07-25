/**
 * Migração — moeda nativa do lançamento (`AssetTransaction.currency`).
 *
 * Contexto: `price`/`totalValue` sempre foram gravados na moeda NATIVA do ativo
 * (US$ para STOCK_US e CRYPTO), mas a transação não guardava qual era. O extrato
 * formatava tudo em R$, então uma compra de US$ 400 aparecia como "R$ 400,00" e
 * a soma do extrato não fechava com o Valor Aplicado da carteira (que converte
 * pelo câmbio). O campo agora existe e é gravado na criação; este script faz o
 * backfill do histórico.
 *
 * Resolução da moeda, em ordem de confiança:
 *   1. UserAsset da MESMA carteira (user + wallet + ticker) — fonte autoritativa,
 *      é exatamente o registro que governa como o lançamento é interpretado.
 *   2. UserAsset do MESMO usuário em outra carteira — o mesmo ticker não muda de
 *      moeda entre carteiras.
 *   3. MarketAsset (catálogo global) — cobre posições já zeradas/removidas, cujo
 *      UserAsset não existe mais. É o que dá alcance ao backfill.
 *   4. Sem resolução → NÃO grava nada. Deixar o campo ausente preserva o fallback
 *      de leitura (resolveTransactionCurrency) em vez de cravar um 'BRL' errado.
 *      Esses tickers são listados no relatório final para conferência manual.
 *
 * Idempotente: só toca lançamentos com `currency` ausente. Reexecutar é seguro e
 * não faz nada além do que ficou pendente. `--force` recalcula TODOS (inclusive
 * os já gravados) — use apenas se a moeda de um ativo foi corrigida no cadastro.
 *
 * Uso:
 *   node server/scripts/migrateTransactionCurrency.js --dry
 *   node server/scripts/migrateTransactionCurrency.js
 *   node server/scripts/migrateTransactionCurrency.js --force --dry
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import AssetTransaction from '../models/AssetTransaction.js';
import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import { resolveAssetCurrency } from '../utils/assetCurrency.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const force = args.includes('--force');

// Lotes para não carregar a coleção inteira nem estourar o BSON do bulkWrite.
const BATCH = 1000;

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`💱 Backfill de moeda em AssetTransaction ${dryRun ? '(DRY RUN)' : ''}${force ? ' [FORCE]' : ''}...\n`);

        const filter = force ? {} : { currency: { $exists: false } };
        const pending = await AssetTransaction.countDocuments(filter);
        const total = await AssetTransaction.countDocuments({});
        console.log(`Lançamentos: ${total} no total, ${pending} a processar.\n`);
        if (pending === 0) {
            console.log('✅ Nada a fazer — todos já têm moeda gravada.');
            await mongoose.disconnect();
            return;
        }

        // Índices de resolução, carregados uma vez.
        // Chave 1: user|wallet|ticker (autoritativa). Chave 2: user|ticker.
        const assets = await UserAsset.find({}).select('user wallet ticker type currency').lean();
        const byWallet = new Map();
        const byUser = new Map();
        for (const a of assets) {
            const cur = resolveAssetCurrency(a);
            byWallet.set(`${a.user}|${a.wallet}|${a.ticker}`, cur);
            byUser.set(`${a.user}|${a.ticker}`, cur);
        }
        const market = await MarketAsset.find({}).select('ticker type currency').lean();
        const byTicker = new Map(market.map((m) => [m.ticker, resolveAssetCurrency(m)]));
        console.log(`Índices: ${byWallet.size} posições, ${byTicker.size} ativos de mercado.\n`);

        const stats = { walletHit: 0, userHit: 0, marketHit: 0, unresolved: 0, brl: 0, usd: 0 };
        const unresolvedTickers = new Map();
        let processed = 0;
        let written = 0;

        // Cursor em lotes: mantém o uso de memória constante em bases grandes.
        const cursor = AssetTransaction.find(filter).select('user wallet ticker currency').lean().cursor();
        let ops = [];

        const flush = async () => {
            if (ops.length === 0) return;
            if (!dryRun) {
                const res = await AssetTransaction.bulkWrite(ops, { ordered: false });
                written += res.modifiedCount || 0;
            } else {
                written += ops.length;
            }
            ops = [];
        };

        for await (const tx of cursor) {
            processed++;
            let currency = byWallet.get(`${tx.user}|${tx.wallet}|${tx.ticker}`);
            if (currency) stats.walletHit++;
            if (!currency) {
                currency = byUser.get(`${tx.user}|${tx.ticker}`);
                if (currency) stats.userHit++;
            }
            if (!currency) {
                currency = byTicker.get(tx.ticker);
                if (currency) stats.marketHit++;
            }
            if (!currency) {
                // Sem fonte confiável: não grava (ver cabeçalho). O extrato continua
                // caindo no fallback de leitura, que é o comportamento atual.
                stats.unresolved++;
                unresolvedTickers.set(tx.ticker, (unresolvedTickers.get(tx.ticker) || 0) + 1);
                continue;
            }
            if (currency === 'USD') stats.usd++; else stats.brl++;
            // Só escreve se de fato muda (relevante no --force).
            if (tx.currency !== currency) {
                ops.push({ updateOne: { filter: { _id: tx._id }, update: { $set: { currency } } } });
            }
            if (ops.length >= BATCH) await flush();
        }
        await flush();

        console.log('=== Resolução ===');
        console.log(`  pela posição da carteira : ${stats.walletHit}`);
        console.log(`  por posição do usuário   : ${stats.userHit}`);
        console.log(`  pelo catálogo de mercado : ${stats.marketHit}`);
        console.log(`  NÃO resolvidos           : ${stats.unresolved}`);
        console.log(`\n=== Moeda atribuída ===`);
        console.log(`  BRL: ${stats.brl}`);
        console.log(`  USD: ${stats.usd}   <- estes são os que o extrato exibia errado`);
        console.log(`\nProcessados: ${processed} | ${dryRun ? 'seriam gravados' : 'gravados'}: ${written}`);

        if (unresolvedTickers.size > 0) {
            console.log(`\n⚠️  ${unresolvedTickers.size} ticker(s) sem moeda determinável (posição removida e fora do catálogo).`);
            console.log('   Ficam sem o campo — o extrato os lê como BRL, igual a hoje. Confira se algum é internacional:');
            [...unresolvedTickers.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30)
                .forEach(([t, c]) => console.log(`     ${t.padEnd(22)} ${c} lançamento(s)`));
        }

        if (dryRun) console.log('\n(dry run — nada foi gravado. Rode sem --dry para aplicar.)');
        else console.log('\n✅ Backfill concluído.');

        await mongoose.disconnect();
    } catch (err) {
        console.error('❌ Falha na migração:', err.message);
        process.exit(1);
    }
};

run();
