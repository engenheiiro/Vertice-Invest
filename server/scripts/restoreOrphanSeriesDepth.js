/**
 * Restaura séries VIVAS que estão piores que a cópia sob a chave legada.
 *
 * Quando a fonte externa degrada para um ticker, a gravação por substituição do
 * timeSeriesWorker trocava a série boa pelo que viesse — e a série encurtada não
 * volta sozinha, porque `isHistoryStale` só olha a data do último candle: um
 * único candle recente parece uma série em dia. A gravação por mescla fecha a
 * porta para novos casos; este script recupera os que já aconteceram.
 *
 * Caso confirmado em 22/08/2026: `HSRE11` tinha 1 candle enquanto `HSRE11.SA`,
 * chave da convenção anterior ao `historyStorageKey`, guardava 623 até 30/07. A
 * fonte, consultada ao vivo, devolve 1 candle — a cópia legada é a única que tem
 * o histórico.
 *
 * ESCOPO DELIBERADAMENTE ESTREITO: só age quando a série viva está AUSENTE ou
 * PIOR que a órfã (menos candles, ou último candle mais antigo). Não toca nas
 * órfãs que apenas guardam período mais antigo que a viva — em 22/08/2026 são
 * 160 documentos, e aprofundá-las é decisão de custo de armazenamento (a catraca
 * de `mergeCandleSeries` fixaria a profundidade), não de correção de defeito.
 *
 * A órfã NUNCA é apagada: ela continua sendo a cópia de segurança do que se
 * restaurou. Apagar é outra decisão, e não é desta ferramenta.
 *
 * Uso:
 *   node server/scripts/restoreOrphanSeriesDepth.js            # dry-run
 *   node server/scripts/restoreOrphanSeriesDepth.js --apply    # grava
 */
import mongoose from 'mongoose';
import { connectScriptDb } from './lib/scriptDb.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import { historyStorageKey, mergeCandleSeries } from '../utils/assetHistory.js';
import { ASSET_HISTORY_MAX_POINTS } from '../config/financialConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');

const resumo = (history) => {
    const candles = Array.isArray(history) ? history : [];
    let primeiro = null;
    let ultimo = null;
    for (const c of candles) {
        if (!c?.date) continue;
        if (!primeiro || c.date < primeiro) primeiro = c.date;
        if (!ultimo || c.date > ultimo) ultimo = c.date;
    }
    return { n: candles.length, primeiro, ultimo };
};

await connectScriptDb({ label: 'restoreOrphanSeriesDepth' });
try {
    console.log(`\n🚑 Resgate de séries ${APPLY ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}\n`);

    const [assets, docs] = await Promise.all([
        MarketAsset.find({}).select('ticker type').lean(),
        AssetHistory.find({}).select('ticker history').lean(),
    ]);

    const donoPorChave = new Map();
    for (const a of assets) {
        const key = historyStorageKey(a.ticker, a.type);
        if (key) donoPorChave.set(key, a);
    }
    const porTicker = new Map(docs.map(d => [d.ticker, d]));

    // Chave viva correspondente a uma órfã, quando dá para deduzir.
    const vivaDe = (ticker) => {
        if (/\.SA$/i.test(ticker)) {
            const base = ticker.replace(/\.SA$/i, '').toUpperCase();
            return donoPorChave.has(base) ? base : null;
        }
        const cripto = historyStorageKey(ticker, 'CRYPTO');
        return cripto !== ticker && donoPorChave.has(cripto) ? cripto : null;
    };

    const resgates = [];
    for (const doc of docs) {
        if (donoPorChave.has(doc.ticker)) continue; // não é órfã
        const vivaKey = vivaDe(doc.ticker);
        if (!vivaKey) continue;

        const orfa = resumo(doc.history);
        if (orfa.n === 0) continue;
        const vivaDoc = porTicker.get(vivaKey);
        const viva = resumo(vivaDoc?.history);

        // O sinal de DEFEITO é a viva não alcançar o fim da órfã: a órfã está
        // congelada desde a troca de convenção, então a viva ficar atrás dela só
        // acontece quando o caminho vivo parou de trazer dado.
        //
        // Ter menos candles que a órfã NÃO entra aqui de propósito: é o estado
        // esperado de quase todas (o cap só se aplica à chave viva) e trataria 138
        // documentos de profundidade como se fossem avaria.
        const quebrada = viva.n === 0 || !viva.ultimo || viva.ultimo < orfa.ultimo;
        if (!quebrada) continue;

        const mesclada = mergeCandleSeries(vivaDoc?.history || [], doc.history, {
            // Teto que comporta as duas: sem isso a catraca (max(cap, viva)) cortaria
            // justamente a profundidade que viemos restaurar.
            maxPoints: Math.max(ASSET_HISTORY_MAX_POINTS, orfa.n, viva.n),
        });
        resgates.push({ orfaKey: doc.ticker, vivaKey, orfa, viva, mesclada: resumo(mesclada), history: mesclada });
    }

    if (!resgates.length) {
        console.log('✅ Nenhuma série viva está pior que a cópia legada — nada a resgatar.\n');
    } else {
        console.log(`Encontrados ${resgates.length}:\n`);
        for (const r of resgates) {
            console.log(`   • ${r.vivaKey.padEnd(10)} viva ${String(r.viva.n).padStart(5)} candles ${r.viva.primeiro ?? '—'}→${r.viva.ultimo ?? '—'}`);
            console.log(`     ${''.padEnd(10)} órfã ${String(r.orfa.n).padStart(5)} candles ${r.orfa.primeiro}→${r.orfa.ultimo}   (${r.orfaKey})`);
            console.log(`     ${''.padEnd(10)} →    ${String(r.mesclada.n).padStart(5)} candles ${r.mesclada.primeiro}→${r.mesclada.ultimo}\n`);
        }
    }

    if (APPLY && resgates.length) {
        for (const r of resgates) {
            // `lastUpdated` NÃO é renovado: nada foi buscado da fonte agora, e mentir
            // aqui é o mesmo "touch" que já congelou séries antes. `lastCheckedAt`
            // idem — quem mede visita do worker é o worker.
            await AssetHistory.updateOne(
                { ticker: r.vivaKey },
                { $set: { history: r.history } },
                { upsert: true },
            );
            console.log(`   ✅ ${r.vivaKey}: ${r.viva.n} → ${r.mesclada.n} candles`);
        }
        console.log(`\n✅ ${resgates.length} série(s) restaurada(s). As órfãs foram preservadas.\n`);
    } else if (resgates.length) {
        console.log('ℹ️  DRY-RUN: rode com --apply para gravar.\n');
    }
} finally {
    await mongoose.disconnect();
}
