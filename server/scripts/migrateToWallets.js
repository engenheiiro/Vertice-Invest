
/**
 * Migração Fase 2 — Múltiplas Carteiras (sub-fase 2.1).
 *
 * Para cada usuário SEM `activeWalletId` ainda setado:
 *   1. Cria (ou reaproveita, se já existir de uma execução anterior) uma Wallet
 *      "padrão" com `isDefault:true`, copiando `walletName` (→ `name`) e os
 *      campos `target*` do próprio User (preserva exatamente a configuração
 *      atual — nada muda pro usuário no dia da virada).
 *   2. Faz o backfill do campo `wallet` em UserAsset, AssetTransaction,
 *      WalletSnapshot, InvestmentGoal e GoalContribution daquele usuário
 *      (filtro `{user, wallet: null}` — casa documentos sem o campo OU com
 *      valor null, então é seguro reexecutar o script quantas vezes precisar).
 *   3. Seta `User.activeWalletId` — só depois do backfill, para que um usuário
 *      com `activeWalletId` já setado seja sinal de "totalmente migrado".
 *
 * Idempotente e resumível: se o script cair no meio, reexecutar completa o que
 * faltou sem duplicar nada nem reprocessar quem já terminou.
 *
 * Uso:
 *   node server/scripts/migrateToWallets.js          (aplica a migração)
 *   node server/scripts/migrateToWallets.js --dry     (apenas relata, não grava)
 *
 * Pré-requisito: os modelos já devem ter o campo `wallet`/`activeWalletId`
 * OPCIONAL (sub-fase 2.1a) — não use este script depois que `wallet` virar
 * required nos modelos (sub-fase 2.1b), pois o schema rejeitaria a leitura
 * intermediária de documentos ainda sem o campo.
 *
 * Requer MONGO_URI no .env.
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

// Coleções que recebem o backfill de `wallet`, na ordem em que aparecem no relatório final.
const BACKFILL_TARGETS = [
    { Model: UserAsset, label: 'UserAsset' },
    { Model: AssetTransaction, label: 'AssetTransaction' },
    { Model: WalletSnapshot, label: 'WalletSnapshot' },
    { Model: InvestmentGoal, label: 'InvestmentGoal' },
    { Model: GoalContribution, label: 'GoalContribution' },
];

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`🗂️  Conectado ao MongoDB. Migração p/ múltiplas carteiras ${dryRun ? '(DRY RUN)' : ''}...`);

        if (!dryRun) await Wallet.syncIndexes(); // modelo novo — garante o índice {user,createdAt}

        // .lean() é OBRIGATÓRIO aqui: `walletName` e os campos `target*` já não
        // existem no schema de User (migraram para Wallet). Um find() hidratado
        // pelo Mongoose (strict mode) descartaria esses paths → leria `undefined`
        // e cada carteira nasceria com a alocação DEFAULT (40/30/20/10) e o nome
        // genérico, PERDENDO a config real de cada usuário. lean() devolve o
        // documento cru do Mongo, com os campos legados preservados.
        const users = await User.find({}).select(
            '_id email walletName activeWalletId targetAllocation targetReserve targetSubAllocation targetMonthlyDividendIncome'
        ).lean();

        let usersMigrated = 0;
        let usersSkipped = 0;
        let walletsCreated = 0;
        let walletsReused = 0;
        const backfillCounts = Object.fromEntries(BACKFILL_TARGETS.map((t) => [t.label, 0]));
        const errors = [];

        for (const user of users) {
            // activeWalletId só é setado por último (passo 3) → já setado = totalmente migrado.
            if (user.activeWalletId) {
                usersSkipped++;
                continue;
            }

            try {
                // Reaproveita a carteira padrão se uma execução anterior já a criou
                // mas caiu antes de setar activeWalletId (resumível).
                let wallet = await Wallet.findOne({ user: user._id, isDefault: true });

                if (wallet) {
                    walletsReused++;
                } else {
                    const walletName = (user.walletName || '').trim() || 'Minha Carteira';
                    if (dryRun) {
                        console.log(`  • [DRY] criaria Wallet "${walletName}" p/ ${user.email}`);
                    } else {
                        wallet = await Wallet.create({
                            user: user._id,
                            name: walletName,
                            isDefault: true,
                            targetAllocation: user.targetAllocation,
                            targetReserve: user.targetReserve,
                            targetSubAllocation: user.targetSubAllocation,
                            targetMonthlyDividendIncome: user.targetMonthlyDividendIncome,
                        });
                    }
                    walletsCreated++;
                }

                const walletId = wallet?._id; // undefined em dry-run — ok, só contamos, nada é gravado

                for (const { Model, label } of BACKFILL_TARGETS) {
                    const filter = { user: user._id, wallet: null };
                    const count = await Model.countDocuments(filter);
                    if (count === 0) continue;
                    if (!dryRun) await Model.updateMany(filter, { $set: { wallet: walletId } });
                    backfillCounts[label] += count;
                }

                if (!dryRun) {
                    await User.updateOne({ _id: user._id }, { $set: { activeWalletId: wallet._id } });
                }

                console.log(`  • ${user.email}: OK`);
                usersMigrated++;
            } catch (err) {
                console.error(`  ❌ ${user.email}: ${err.message}`);
                errors.push({ email: user.email, error: err.message });
            }
        }

        console.log(`\n📊 Usuários: ${users.length} | Migrados: ${usersMigrated} | Já migrados (pulados): ${usersSkipped} | Erros: ${errors.length}`);
        console.log(`📊 Wallets: ${walletsCreated} criadas, ${walletsReused} reaproveitadas`);
        console.log('📊 Documentos com `wallet` preenchido nesta execução:');
        for (const { label } of BACKFILL_TARGETS) {
            console.log(`   - ${label}: ${backfillCounts[label]}`);
        }
        if (errors.length > 0) {
            console.log('\n⚠️ Usuários com erro (não migrados — reexecute o script depois de investigar):');
            errors.forEach((e) => console.log(`   - ${e.email}: ${e.error}`));
        }

        console.log(dryRun ? '\n✅ DRY RUN concluído (nada foi gravado).' : '\n✅ Migração concluída.');
        process.exit(errors.length > 0 ? 1 : 0);
    } catch (error) {
        console.error('❌ Erro geral:', error.message);
        process.exit(1);
    }
};

run();
