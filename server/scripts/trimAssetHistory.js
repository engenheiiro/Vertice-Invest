/**
 * trimAssetHistory.js
 *
 * Trunca o array `history` de cada AssetHistory para os últimos ASSET_HISTORY_MAX_POINTS
 * candles (padrão 400 ≈ 1,6 ano). A série é armazenada oldest→newest (ordem do `chart` do
 * Yahoo), então `$slice: -N` mantém os N mais recentes.
 *
 * PORQUÊ: guardávamos ~1.400 candles/ticker (2020→hoje), mas a análise só precisa de ≤252
 * (SMA200 + volatilidade 252d) e os sinais leem 60. Isso inchava `assethistories` para ~161 MB.
 *
 * ISENTOS (mantêm série completa): câmbio USD-BRL (conversão por data na carteira) e
 * benchmarks ^BVSP/^GSPC (TWRR/beta) — ver HISTORY_CAP_EXEMPT_TICKERS.
 *
 * Uso:
 *   node server/scripts/trimAssetHistory.js              (dry-run — só estima)
 *   node server/scripts/trimAssetHistory.js --confirm    (aplica o trim)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import AssetHistory from '../models/AssetHistory.js';
import { ASSET_HISTORY_MAX_POINTS, HISTORY_CAP_EXEMPT_TICKERS } from '../config/financialConstants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const CONFIRM = process.argv.includes('--confirm');
const CAP = ASSET_HISTORY_MAX_POINTS;
const EXEMPT = [...HISTORY_CAP_EXEMPT_TICKERS];
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

const collStats = async () => {
    try {
        const s = await mongoose.connection.db.command({ collStats: 'assethistories' });
        return { dataSize: s.size, storageSize: s.storageSize, count: s.count };
    } catch {
        return null;
    }
};

const run = async () => {
    if (!process.env.MONGO_URI) {
        console.error('❌ MONGO_URI não definida no .env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`📡 Conectado: ${mongoose.connection.host}`);
    console.log(`⚙️ Cap: ${CAP} pontos | Isentos: ${EXEMPT.join(', ')}\n`);

    const before = await collStats();
    if (before) console.log(`📊 Antes: ${before.count} docs | Data ${mb(before.dataSize)} | Storage ${mb(before.storageSize)}\n`);

    // Estimativa: quantos docs excedem o cap e quantos pontos seriam removidos.
    const est = await AssetHistory.aggregate([
        { $match: { ticker: { $nin: EXEMPT } } },
        { $project: { len: { $size: { $ifNull: ['$history', []] } } } },
        { $match: { len: { $gt: CAP } } },
        { $group: { _id: null, docs: { $sum: 1 }, maxLen: { $max: '$len' }, pointsToRemove: { $sum: { $subtract: ['$len', CAP] } } } }
    ]);
    const summary = est[0] || { docs: 0, maxLen: 0, pointsToRemove: 0 };
    console.log(`🔎 Docs acima do cap: ${summary.docs}`);
    console.log(`   Maior série atual: ${summary.maxLen} pontos`);
    console.log(`   Pontos a remover (total): ${summary.pointsToRemove.toLocaleString('pt-BR')}\n`);

    if (!CONFIRM) {
        console.log('🔎 DRY-RUN — nada foi alterado. Rode com --confirm para aplicar.');
        await mongoose.disconnect();
        process.exit(0);
    }

    if (summary.docs === 0) {
        console.log('✅ Nada a fazer — nenhum documento acima do cap.');
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log('✂️ Aplicando trim...');
    const res = await AssetHistory.updateMany(
        {
            ticker: { $nin: EXEMPT },
            $expr: { $gt: [{ $size: { $ifNull: ['$history', []] } }, CAP] }
        },
        { $push: { history: { $each: [], $slice: -CAP } } }
    );
    console.log(`✅ Documentos truncados: ${res.modifiedCount}`);

    const after = await collStats();
    if (before && after) {
        console.log(`\n📊 Depois: ${after.count} docs | Data ${mb(after.dataSize)} | Storage ${mb(after.storageSize)}`);
        console.log(`   Data Size liberado: ${mb(before.dataSize - after.dataSize)}`);
    }
    console.log('\nℹ️ Storage físico (disco) só encolhe após compact; o Data Size lógico já caiu.');

    await mongoose.disconnect();
    process.exit(0);
};

run().catch((e) => {
    console.error(`❌ Erro: ${e.message}`);
    process.exit(1);
});
