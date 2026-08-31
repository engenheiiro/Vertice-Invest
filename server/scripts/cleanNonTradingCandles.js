/**
 * Remove candles datados em dia SEM PREGÃO das séries de `AssetHistory`.
 *
 * Em 30/08/2026 — um DOMINGO — a fonte devolveu, para 18 FIIs ilíquidos, uma
 * linha datada naquele domingo repetindo o preço de quinta (a barra "viva" que o
 * Yahoo às vezes emite para ticker sem negócio). A gravação aceitou.
 *
 * O estrago não é o preço errado em si: `isHistoryStale` decide a re-busca só
 * pela DATA do último candle, então a série passou a parecer fresquíssima e o
 * worker das 18:30 nunca mais buscou nada — visitava (`lastCheckedAt` renovado)
 * e pulava (`lastUpdated` parado no domingo). Série congelada num preço falso,
 * sem cura espontânea: por isso ela não volta sozinha depois que a guarda de
 * `isStorableCandleDate` fecha a porta para novos casos. Este script limpa os
 * que já entraram.
 *
 * Critério: EXATAMENTE o de `isStorableCandleDate` — importado, nunca reescrito
 * aqui, para o script e a gravação não divergirem. Na prática, fim de semana e
 * data absurda no futuro, e só nas classes de pregão seg–sex. Feriado NÃO entra
 * (a B3 e a NYSE não fecham nos mesmos dias).
 *
 * Série cuja classe não é conhecida (órfã de chave legada, câmbio, benchmark sem
 * MarketAsset) é REPORTADA e não tocada: sem saber a classe não dá para saber se
 * o dia era de pregão, e apagar no escuro seria perda de dado nosso.
 *
 * Uso:
 *   node server/scripts/cleanNonTradingCandles.js            # dry-run
 *   node server/scripts/cleanNonTradingCandles.js --apply    # grava
 */
import mongoose from 'mongoose';
import { connectScriptDb } from './lib/scriptDb.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { historyStorageKey, isStorableCandleDate, WEEKDAY_ONLY_TYPES } from '../utils/assetHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');

const ultimaData = (candles) => {
    let ultimo = null;
    for (const c of candles || []) {
        if (c?.date && (!ultimo || c.date > ultimo)) ultimo = c.date;
    }
    return ultimo;
};

await connectScriptDb({ label: 'cleanNonTradingCandles' });
try {
    console.log(`\n🧹 Candles em dia sem pregão ${APPLY ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}\n`);

    // Classe por chave de série. As duas fontes somadas: o universo de pesquisa
    // (MarketAsset) e as posições reais (UserAsset), que podem ter ticker que o
    // universo não cobre.
    const [universo, posicoes, docs] = await Promise.all([
        MarketAsset.find({}).select('ticker type').lean(),
        UserAsset.find({}).select('ticker type').lean(),
        AssetHistory.find({}).select('ticker history').lean(),
    ]);

    const typeByKey = new Map();
    for (const a of [...universo, ...posicoes]) {
        const key = historyStorageKey(a?.ticker, a?.type);
        if (key && a?.type && !typeByKey.has(key)) typeByKey.set(key, a.type);
    }

    const alvos = [];
    const semClasse = [];
    for (const doc of docs) {
        const type = typeByKey.get(doc.ticker);
        if (!type) {
            // Só interessa reportar a órfã que TEM candle de fim de semana; as
            // demais não são suspeitas de nada.
            const suspeitos = (doc.history || []).filter(
                (c) => c?.date && !isStorableCandleDate(c.date, 'STOCK'));
            if (suspeitos.length) semClasse.push({ ticker: doc.ticker, n: suspeitos.length });
            continue;
        }
        if (!WEEKDAY_ONLY_TYPES.has(String(type).trim().toUpperCase())) continue;

        const historia = doc.history || [];
        const manter = [];
        const remover = [];
        for (const c of historia) {
            if (c?.date && isStorableCandleDate(c.date, type)) manter.push(c);
            else if (c?.date) remover.push(c);
        }
        if (remover.length) {
            alvos.push({
                ticker: doc.ticker,
                type,
                manter,
                remover,
                antes: ultimaData(historia),
                depois: ultimaData(manter),
            });
        }
    }

    if (!alvos.length) {
        console.log('✅ Nenhum candle em dia sem pregão nas séries de classe conhecida.\n');
    } else {
        console.log(`Encontradas ${alvos.length} série(s) com candle inválido:\n`);
        for (const a of alvos) {
            const datas = a.remover.map((c) => `${c.date} (${c.close})`).join(', ');
            console.log(`   • ${a.ticker.padEnd(10)} ${String(a.type).padEnd(9)} remove ${a.remover.length}: ${datas}`);
            console.log(`     ${''.padEnd(10)} último candle ${a.antes} → ${a.depois}   (${a.manter.length} candles restam)`);
        }
        console.log('');
    }

    if (semClasse.length) {
        console.log(`⚠️  ${semClasse.length} série(s) SEM classe conhecida têm candle de fim de semana — não tocadas:`);
        for (const s of semClasse) console.log(`   • ${s.ticker.padEnd(14)} ${s.n} candle(s)`);
        console.log('   (câmbio e benchmark negociam fora do pregão da B3; confira antes de agir.)\n');
    }

    if (APPLY && alvos.length) {
        for (const a of alvos) {
            await AssetHistory.updateOne(
                { ticker: a.ticker },
                {
                    $set: { history: a.manter },
                    // `lastCheckedAt` é REMOVIDO de propósito: a fila do worker ordena
                    // por ele e trata ausente como "nunca visitado", então estas séries
                    // vão para a frente da fila e recuperam o candle real que o candle
                    // falso vinha impedindo. `lastUpdated` fica como está — nada foi
                    // buscado da fonte agora, e renová-lo seria o mesmo "touch" que já
                    // congelou séries antes.
                    $unset: { lastCheckedAt: '' },
                },
            );
            console.log(`   ✅ ${a.ticker}: ${a.remover.length} candle(s) removido(s), último agora ${a.depois}`);
        }
        console.log(`\n✅ ${alvos.length} série(s) limpa(s). O próximo run do timeSeriesWorker as re-busca.\n`);
    } else if (alvos.length) {
        console.log('ℹ️  DRY-RUN: rode com --apply para gravar.\n');
    }
} finally {
    await mongoose.disconnect();
}
