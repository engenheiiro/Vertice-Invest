/**
 * Remove séries de cripto gravadas sob o ticker NU (ex.: 'BTC'), órfãs desde que
 * `historyStorageKey` passou a namespacear cripto pelo símbolo do provedor
 * ('BTC-USD').
 *
 * Por que existem: antes da convenção, o worker gravava a série em
 * AssetHistory.ticker = 'BTC'. Depois dela, todo leitor e todo escritor passaram
 * a resolver a chave por `historyStorageKey(ticker, type)` — os documentos
 * antigos deixaram de ser lidos E de ser atualizados no mesmo dia. Em 22/08/2026
 * eram 48 séries congeladas em 30-31/07/2026, ~19 mil candles mortos.
 *
 * Por que isso não é (mais) um bug de leitura: os consumidores que consultam
 * AssetHistory por ticker cru — signalEngine/Radar Alpha, generateRadarReport,
 * buyAndHoldService — filtram STOCK/FII/STOCK_US, classes em que a chave crua É
 * a canônica. Os que tocam cripto (timeSeriesWorker, walletDayCandleService,
 * loadDayCloses do snapshot, marketController, financialService) já passam pela
 * `historyStorageKey`. Ou seja: ninguém lê estes documentos. Eles só poluem
 * diagnóstico — a própria sentinela de saúde precisa de um parágrafo explicando
 * por que MATIC/RNDR/IMX/GRT/TAO não contam.
 *
 * Segurança (apagar série histórica é irreversível):
 *   - DRY-RUN por padrão. Só grava com --apply.
 *   - Só apaga quando a série CANÔNICA existe, está pelo menos tão recente
 *     quanto a órfã e tem pelo menos tantos candles quanto ela. Qualquer órfã
 *     que carregue dado que a canônica não tem vai para REVISÃO MANUAL.
 *   - Só considera ticker que é de fato um MarketAsset type=CRYPTO. Documento
 *     solto de outra classe não é tocado.
 *   - Idempotente: reexecutar não encontra mais nada.
 *
 * Uso:
 *   node server/scripts/pruneOrphanCryptoSeries.js            # dry-run
 *   node server/scripts/pruneOrphanCryptoSeries.js --apply    # apaga
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import { historyStorageKey } from '../utils/assetHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.slice(2).includes('--apply');

const resumo = (doc) => {
    const candles = Array.isArray(doc?.history) ? doc.history : [];
    let last = null;
    for (const c of candles) if (!last || (c?.date && c.date > last)) last = c?.date || last;
    return { n: candles.length, last };
};

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`\n🧹 Séries de cripto órfãs ${apply ? '(APLICANDO)' : '(DRY-RUN — nada será apagado)'}\n`);

        const cryptos = await MarketAsset.find({ type: 'CRYPTO' }).select('ticker').lean();
        const bases = [...new Set(cryptos.map((a) => String(a.ticker || '').toUpperCase()).filter(Boolean))];
        const canonicalOf = new Map(bases.map((b) => [b, historyStorageKey(b, 'CRYPTO')]));
        // Um ticker cujo canônico é ele mesmo não é órfão de nada.
        const candidatos = bases.filter((b) => canonicalOf.get(b) !== b);

        const docs = await AssetHistory.find({
            ticker: { $in: [...candidatos, ...candidatos.map((b) => canonicalOf.get(b))] },
        }).select('ticker history lastUpdated').lean();
        const byTicker = new Map(docs.map((d) => [d.ticker, d]));

        const apagar = [];
        const manual = [];

        for (const base of candidatos) {
            const orfa = byTicker.get(base);
            if (!orfa) continue;
            const canonKey = canonicalOf.get(base);
            const canon = byTicker.get(canonKey);
            const o = resumo(orfa);
            const c = resumo(canon);

            if (!canon) { manual.push({ base, canonKey, o, c, motivo: 'série canônica NÃO existe' }); continue; }
            if (!c.last || !o.last || c.last < o.last) {
                manual.push({ base, canonKey, o, c, motivo: `canônica mais atrasada (${c.last} < ${o.last})` });
                continue;
            }
            if (c.n < o.n) {
                manual.push({ base, canonKey, o, c, motivo: `canônica mais rasa (${c.n} < ${o.n} candles)` });
                continue;
            }
            apagar.push({ base, canonKey, o, c });
        }

        if (apagar.length) {
            console.log(`⛔ Órfãs a apagar (${apagar.length}) — canônica existe, mais recente e mais profunda:`);
            for (const { base, canonKey, o, c } of apagar) {
                console.log(`   • ${base.padEnd(7)} ${String(o.n).padStart(5)} candles até ${o.last}   →  ${canonKey.padEnd(11)} ${String(c.n).padStart(5)} candles até ${c.last}`);
            }
            const candles = apagar.reduce((s, x) => s + x.o.n, 0);
            console.log(`   Total: ${apagar.length} documentos, ${candles} candles.`);
        } else {
            console.log('✅ Nenhuma órfã elegível.');
        }

        if (manual.length) {
            console.log(`\n🔍 Revisão manual (${manual.length}) — NÃO serão tocadas:`);
            for (const { base, canonKey, o, c, motivo } of manual) {
                console.log(`   • ${base.padEnd(7)} órfã ${o.n} candles até ${o.last} | ${canonKey} ${c.n} candles até ${c.last ?? '—'} — ${motivo}`);
            }
        }

        if (apply && apagar.length) {
            const res = await AssetHistory.deleteMany({ ticker: { $in: apagar.map((x) => x.base) } });
            console.log(`\n✅ ${res.deletedCount} séries órfãs apagadas.`);
        } else if (apagar.length) {
            console.log('\nℹ️  DRY-RUN: rode com --apply para apagar.');
        }

        console.log(apply ? '\n✅ Concluído.' : '\n✅ DRY-RUN concluído (nada gravado).');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
