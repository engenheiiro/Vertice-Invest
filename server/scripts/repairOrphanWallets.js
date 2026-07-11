
/**
 * Reparo pontual — documentos que ficaram com `wallet: null` DEPOIS da migração
 * inicial (sub-fase 2.1), porque foram criados num intervalo em que o
 * ambiente/deploy que os gravou ainda não conhecia o campo `wallet` (ex.: cron
 * de snapshot diário rodando código antigo em produção enquanto o dev local já
 * testava o schedulerService novo).
 *
 * Para cada usuário, dois casos por coleção:
 *   1. Sem conflito: o doc órfão (wallet=null) é a ÚNICA cópia daquele registro
 *      → seta `wallet` para a carteira padrão (isDefault:true) do usuário.
 *   2. Conflito (só relevante p/ WalletSnapshot, índice único {wallet,date}):
 *      já existe um snapshot TAGUEADO para a mesma data exata → o órfão é uma
 *      duplicata (mesmo cron rodou 2x, uma vez sem wallet e outra com) →
 *      APAGA o órfão, mantém o tagueado.
 *
 * Uso:
 *   node server/scripts/repairOrphanWallets.js          (aplica)
 *   node server/scripts/repairOrphanWallets.js --dry     (só relata)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import InvestmentGoal from '../models/InvestmentGoal.js';
import GoalContribution from '../models/GoalContribution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.includes('--dry');

// Coleções sem risco de colisão de índice único ao ganhar `wallet` — backfill direto.
const SIMPLE_TARGETS = [
    { Model: UserAsset, label: 'UserAsset' },
    { Model: AssetTransaction, label: 'AssetTransaction' },
    { Model: InvestmentGoal, label: 'InvestmentGoal' },
    { Model: GoalContribution, label: 'GoalContribution' },
];

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`🩹 Reparo de documentos órfãos (wallet=null) ${dryRun ? '(DRY RUN)' : ''}...\n`);

    const users = await User.find({}).select('_id email').lean();
    let totalBackfilled = 0;
    let totalDeleted = 0;

    for (const user of users) {
        const defaultWallet = await Wallet.findOne({ user: user._id, isDefault: true }).lean();
        if (!defaultWallet) continue; // não deveria acontecer pós sub-fase 2.1, mas não é este script que resolve isso.

        for (const { Model, label } of SIMPLE_TARGETS) {
            const filter = { user: user._id, wallet: null };
            const count = await Model.countDocuments(filter);
            if (count === 0) continue;
            console.log(`  • ${user.email} — ${label}: ${count} órfão(s) → carteira padrão "${defaultWallet.name}"`);
            if (!dryRun) await Model.updateMany(filter, { $set: { wallet: defaultWallet._id } });
            totalBackfilled += count;
        }

        // WalletSnapshot: índice único {wallet,date} — precisa checar colisão por data exata.
        const orphanSnapshots = await WalletSnapshot.find({ user: user._id, wallet: null }).select('_id date').lean();
        if (orphanSnapshots.length === 0) continue;

        const dates = orphanSnapshots.map((s) => s.date);
        const taggedSameDates = await WalletSnapshot.find({
            user: user._id,
            wallet: defaultWallet._id,
            date: { $in: dates },
        }).select('date').lean();
        const taggedDateSet = new Set(taggedSameDates.map((d) => d.date.getTime()));

        const toBackfill = orphanSnapshots.filter((s) => !taggedDateSet.has(s.date.getTime()));
        const toDelete = orphanSnapshots.filter((s) => taggedDateSet.has(s.date.getTime()));

        if (toBackfill.length > 0) {
            console.log(`  • ${user.email} — WalletSnapshot: ${toBackfill.length} órfão(s) sem conflito → carteira padrão "${defaultWallet.name}"`);
            if (!dryRun) {
                await WalletSnapshot.updateMany(
                    { _id: { $in: toBackfill.map((s) => s._id) } },
                    { $set: { wallet: defaultWallet._id } },
                );
            }
            totalBackfilled += toBackfill.length;
        }
        if (toDelete.length > 0) {
            console.log(`  • ${user.email} — WalletSnapshot: ${toDelete.length} duplicata(s) (já existe tagueado na mesma data) → APAGAR`);
            toDelete.forEach((s) => console.log(`      - ${s.date.toISOString()}`));
            if (!dryRun) {
                await WalletSnapshot.deleteMany({ _id: { $in: toDelete.map((s) => s._id) } });
            }
            totalDeleted += toDelete.length;
        }
    }

    console.log(`\n📊 Total: ${totalBackfilled} documento(s) recuperado(s) p/ a carteira padrão, ${totalDeleted} duplicata(s) removida(s).`);
    console.log(dryRun ? '\n✅ DRY RUN concluído (nada foi gravado).' : '\n✅ Reparo concluído.');
    process.exit(0);
};

run().catch((e) => { console.error('❌ Erro:', e); process.exit(1); });
