/**
 * ZERA A VARIAÇÃO QUE NÃO É DE SESSÃO NENHUMA — dry-run por padrão.
 *
 * `change` é a variação da ÚLTIMA SESSÃO, e só faz sentido colado à cotação que
 * o produziu. Quando o ativo para de ser cotado, o preço congela — mas o `change`
 * congela junto, e continua sendo servido como se fosse de hoje. Medido em
 * 05/09/2026: OIBR4 carregava +30,58% desde março, PNDL11 +94,42% desde maio,
 * HOSI11, DAMA11, GEPA3, BAUH4 e mais uma dúzia na mesma condição.
 *
 * Isso NÃO é o mesmo defeito que `utils/quoteSanity.js` resolve. Lá a fonte se
 * contradiz na hora da cotação e a variação é reancorada no nosso candle; aqui a
 * fonte nunca mais é perguntada, porque o ativo está abaixo do mínimo de liquidez
 * que entra no lote (decisão de projeto, não defeito). Nenhuma cotação futura vai
 * passar por cima desses números — por isso o mutirão.
 *
 * Régua: `updatedAt` mais velho que `--days` (padrão 30, o mesmo horizonte de
 * "preço congelado" da sentinela). Não olha o VALOR da variação de propósito:
 * +0,25% de junho é tão mentiroso quanto +94% de maio, só é menos visível.
 *
 * `previousClose` vai junto: fechamento anterior de quatro meses atrás é lixo da
 * mesma safra, e 0 já é o que o sistema entende por "não temos".
 *
 * Uso:
 *   node server/scripts/cleanStaleChange.js            # só relata (dry-run)
 *   node server/scripts/cleanStaleChange.js --days=45
 *   node server/scripts/cleanStaleChange.js --apply    # grava
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { connectScriptDb } from './lib/scriptDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DAYS = Number(args.find((a) => a.startsWith('--days='))?.split('=')[1] || 30);

const run = async () => {
    await connectScriptDb({ label: 'cleanStaleChange' });

    const corte = new Date(Date.now() - DAYS * 86400000);
    const alvos = await MarketAsset.find({
        isActive: true,
        isBlacklisted: { $ne: true },
        isIgnored: { $ne: true },
        updatedAt: { $lt: corte },
        change: { $ne: 0 },
    }).select('ticker type change previousClose lastPrice updatedAt').sort({ updatedAt: 1 }).lean();

    console.log(`\n🧹 Variação órfã · cotação parada há mais de ${DAYS} dias · ${alvos.length} ativo(s)\n`);
    if (alvos.length === 0) {
        console.log('   Nada a limpar.');
        await mongoose.disconnect();
        return;
    }

    for (const a of alvos) {
        const dias = Math.round((Date.now() - new Date(a.updatedAt).getTime()) / 86400000);
        console.log(`   ${a.ticker.padEnd(10)} ${String(a.type).padEnd(8)} change=${String(Number(a.change).toFixed(2)).padStart(8)}%  parado há ${dias}d`);
    }

    if (!APPLY) {
        console.log('\n   Dry-run: nada foi gravado. Repita com --apply para zerar.');
        await mongoose.disconnect();
        return;
    }

    const res = await MarketAsset.bulkWrite(alvos.map((a) => ({
        updateOne: {
            filter: { ticker: a.ticker },
            // `updatedAt` NÃO é tocado: ele é o relógio da cotação, e renová-lo aqui
            // faria o ativo parecer recém-atualizado para a sentinela de preço
            // congelado — apagando justamente o alarme que trouxe a gente até aqui.
            update: { $set: { change: 0, previousClose: 0 } },
        },
    })));
    console.log(`\n   ✅ ${res.modifiedCount} ativo(s) com a variação zerada.`);
    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
