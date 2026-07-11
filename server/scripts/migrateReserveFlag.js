
/**
 * Migração C1 — flag `isReserve` (Reserva separada).
 *
 * Contexto: até aqui a "reserva" era inferida pelo TYPE do ativo (CASH era
 * sempre reserva; Renda Fixa às vezes era cadastrada como CASH só para "sair da
 * alocação"). Agora a reserva é uma FLAG EXPLÍCITA (`isReserve`) desacoplada do
 * type — RF passa a ser investimento por padrão (entra no donut e no grupo
 * "Renda Fixa"), e qualquer ativo (CASH ou RF) pode ser marcado como reserva.
 *
 * O que este script faz:
 *   1. (SEMPRE) Marca `isReserve=true` em TODO ativo CASH que ainda não tenha a
 *      flag — preserva exatamente o comportamento anterior (CASH = reserva).
 *      Idempotente: filtra `{ type:'CASH', isReserve: { $ne:true } }`, então
 *      reexecutar não faz nada além do que falta.
 *
 *   2. (OPCIONAL, dirigido) `--reclassify=TICKER1,TICKER2` converte ativos hoje
 *      cadastrados como CASH em FIXED_INCOME + isReserve=true — para o caso de
 *      Renda Fixa que foi cadastrada como "cofrinho" CASH só para sair da
 *      alocação. NÃO é automático (não dá para adivinhar quais CASH são "na
 *      verdade RF"): só age nos tickers explicitamente listados. Atenção: o
 *      ativo reclassificado fica sem taxa/índice de RF — configure depois pela
 *      UI se quiser que ele renda. Casa por ticker em QUALQUER carteira do
 *      usuário; para escopar a uma carteira use --wallet=<walletId>.
 *
 * Uso:
 *   node server/scripts/migrateReserveFlag.js --dry
 *   node server/scripts/migrateReserveFlag.js
 *   node server/scripts/migrateReserveFlag.js --reclassify=RESERVA-TESOURO --dry
 *   node server/scripts/migrateReserveFlag.js --reclassify=RESERVA-TESOURO
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import UserAsset from '../models/UserAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const getArg = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : undefined;
};
const reclassifyRaw = getArg('reclassify');
const reclassifyTickers = reclassifyRaw
    ? reclassifyRaw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    : [];
const walletScope = getArg('wallet');

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`🏦 Migração da flag isReserve ${dryRun ? '(DRY RUN)' : ''}...\n`);

        // --- Passo 1: CASH → isReserve=true (universal, idempotente) ---
        const cashFilter = { type: 'CASH', isReserve: { $ne: true } };
        const cashPending = await UserAsset.countDocuments(cashFilter);
        console.log(`1) CASH sem isReserve=true: ${cashPending}`);
        if (cashPending > 0 && !dryRun) {
            const r = await UserAsset.updateMany(cashFilter, { $set: { isReserve: true } });
            console.log(`   → ${r.modifiedCount} ativo(s) CASH marcados como reserva.`);
        } else if (cashPending > 0) {
            console.log('   → (dry) marcaria os ativos acima como reserva.');
        }

        // --- Passo 2: reclassificação dirigida CASH → FIXED_INCOME + reserva ---
        let reclassified = 0;
        if (reclassifyTickers.length > 0) {
            console.log(`\n2) Reclassificar CASH → FIXED_INCOME (reserva) p/ tickers: ${reclassifyTickers.join(', ')}`);
            const filter = { type: 'CASH', ticker: { $in: reclassifyTickers } };
            if (walletScope) filter.wallet = walletScope;
            const targets = await UserAsset.find(filter).select('_id ticker wallet').lean();
            if (targets.length === 0) {
                console.log('   → nenhum ativo CASH encontrado para os tickers informados (nada a fazer).');
            }
            for (const t of targets) {
                console.log(`   • ${t.ticker} (wallet ${t.wallet}) → FIXED_INCOME + isReserve=true`);
                if (!dryRun) {
                    await UserAsset.updateOne(
                        { _id: t._id },
                        { $set: { type: 'FIXED_INCOME', isReserve: true } },
                    );
                }
                reclassified++;
            }
            if (reclassified > 0) {
                console.log('   ⚠️  Ativos reclassificados ficam SEM taxa/índice de RF — ajuste pela UI se quiser rendimento.');
            }
        }

        console.log(`\n📊 Resumo: ${cashPending} CASH pendente(s) de flag, ${reclassified} reclassificado(s).`);
        console.log(dryRun ? '\n✅ DRY RUN concluído (nada foi gravado).' : '\n✅ Migração concluída.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
