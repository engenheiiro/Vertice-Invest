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
 * ISENTOS (mantêm série completa):
 *  · câmbio USD-BRL e benchmarks ^BVSP/^GSPC/^IXIC/^IFIX — ver HISTORY_CAP_EXEMPT_TICKERS;
 *  · TODO ticker presente em UserAsset, resolvido em tempo de execução (ver abaixo).
 *
 * A isenção da CARTEIRA não é conservadorismo: é o inverso de um bug já corrigido.
 * O rebuild de histórico precisa que a série alcance a data da PRIMEIRA COMPRA; série
 * curta fazia todo o período anterior ao cap ser marcado pelo preço de custo, com TWRR
 * falsa (guard fail-closed em financialService._loadPriceCacheMap). Por isso
 * `walletDayCandleService` grava `slice(-max(CAP, existente))` — uma catraca que nunca
 * encurta a série de quem está em carteira. Truncar aqui desfaz a catraca em uma linha.
 *
 * Medição de 22/08/2026 antes de blindar: dos 278 documentos acima do cap, 17 eram
 * posições em carteira — PETR4, ITSA4, CMIG4, SHUL4, BOVA11, IVVB11, 6 FIIs e as três
 * criptos (BTC-USD, ETH-USD e USDC-USD, com 2.426 candles cada; em cripto, que negocia
 * todo dia, 400 candles são ~13 meses de calendário). Seriam 22.060 pontos apagados
 * exatamente onde a carteira precisa deles.
 *
 * E não há pressa de espaço: a coleção estava em 78,6 MB de dataSize / 60,2 MB de
 * storage na mesma medição — metade dos ~161 MB que motivaram o cap. Rodar isto sem
 * necessidade é risco sem prêmio.
 *
 * NÃO trunque para "consertar" comparação entre ativos: profundidade desigual é
 * permanente (a catraca da carteira garante isso) e quem compara séries de ativos
 * diferentes deve truncar na LEITURA — ver maxDrawdownPct em utils/assetHistory.js.
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
import UserAsset from '../models/UserAsset.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { ASSET_HISTORY_MAX_POINTS, HISTORY_CAP_EXEMPT_TICKERS } from '../config/financialConstants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const CONFIRM = process.argv.includes('--confirm');
const CAP = ASSET_HISTORY_MAX_POINTS;
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

/**
 * Chaves de série de todo ticker em UserAsset, de TODOS os usuários.
 *
 * Sem filtrar por `quantity > 0` de propósito: posição zerada continua no histórico
 * da carteira, e o rebuild ainda precisa dos candles do período em que ela existiu.
 * Filtrar por quantidade protegeria a carteira de hoje e desprotegeria a de ontem.
 */
const walletHistoryKeys = async () => {
    const holdings = await UserAsset.find({}).select('ticker type').lean();
    const keys = new Set();
    for (const holding of holdings) {
        const key = historyStorageKey(holding.ticker, holding.type);
        if (key) keys.add(key);
    }
    return keys;
};

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

    // A isenção da carteira é resolvida ANTES de qualquer contagem, para que o
    // dry-run mostre exatamente o que o --confirm faria. Se a leitura do UserAsset
    // falhar, aborta: truncar sem saber o que está em carteira é o pior desfecho.
    let walletKeys;
    try {
        walletKeys = await walletHistoryKeys();
    } catch (e) {
        console.error(`❌ Não foi possível ler as posições em carteira (${e.message}).`);
        console.error('   Abortando: sem essa lista o trim apagaria a profundidade que o rebuild da carteira exige.');
        await mongoose.disconnect();
        process.exit(1);
    }
    const EXEMPT = [...new Set([...HISTORY_CAP_EXEMPT_TICKERS, ...walletKeys])];
    console.log(`⚙️ Cap: ${CAP} pontos`);
    console.log(`   Isentos fixos: ${[...HISTORY_CAP_EXEMPT_TICKERS].join(', ')}`);
    console.log(`   Isentos por carteira (${walletKeys.size}): ${[...walletKeys].join(', ')}\n`);

    const before = await collStats();
    if (before) console.log(`📊 Antes: ${before.count} docs | Data ${mb(before.dataSize)} | Storage ${mb(before.storageSize)}\n`);

    // Quanto a isenção de carteira está de fato segurando — número que justifica a
    // regra existir, e que dispara o alerta se um dia alguém encurtar a lista.
    const protegidos = await AssetHistory.aggregate([
        { $match: { ticker: { $in: [...walletKeys] } } },
        { $project: { len: { $size: { $ifNull: ['$history', []] } } } },
        { $match: { len: { $gt: CAP } } },
        { $group: { _id: null, docs: { $sum: 1 }, points: { $sum: { $subtract: ['$len', CAP] } } } },
    ]);
    const prot = protegidos[0] || { docs: 0, points: 0 };
    console.log(`🛡️ Preservados por estarem em carteira: ${prot.docs} docs | ${prot.points.toLocaleString('pt-BR')} pontos\n`);

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
