/**
 * Correção de índices reescopados na Fase 2 (Múltiplas Carteiras).
 *
 * A migração `migrateToWallets.js` moveu os documentos para o campo `wallet`, mas só
 * chamou `Wallet.syncIndexes()` — os índices LEGADOS user-scoped das outras coleções
 * ficaram no banco (`autoIndex` cria os que faltam, mas nunca dropa os obsoletos). O
 * caso mais grave é `UserAsset.user_1_ticker_1` (ÚNICO), que impede o mesmo ticker em
 * carteiras diferentes e derruba o cadastro com `E11000 duplicate key`.
 *
 * Este script roda `syncIndexes()` nos models reescopados — reconcilia o banco EXATAMENTE
 * com o schema atual: dropa índices obsoletos e cria os que faltam. Idempotente: rodar de
 * novo quando já sincronizado é no-op. Não destrutivo (mexe só em índices, nunca em dados).
 *
 * Uso:
 *   node server/scripts/fixWalletScopedIndexes.js          (aplica)
 *   node server/scripts/fixWalletScopedIndexes.js --dry     (só relata, não altera)
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import InvestmentGoal from '../models/InvestmentGoal.js';
import GoalContribution from '../models/GoalContribution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.includes('--dry');

// Models cujo escopo de índice mudou de user- para wallet- na Fase 2.
const MODELS = [
  { Model: UserAsset, label: 'UserAsset' },
  { Model: AssetTransaction, label: 'AssetTransaction' },
  { Model: WalletSnapshot, label: 'WalletSnapshot' },
  { Model: InvestmentGoal, label: 'InvestmentGoal' },
  { Model: GoalContribution, label: 'GoalContribution' },
];

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI não definida.');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`🗂️  Conectado a ${mongoose.connection.host}. Reconciliando índices ${dryRun ? '(DRY RUN)' : ''}...\n`);

    for (const { Model, label } of MODELS) {
      const before = await Model.collection.indexes().catch(() => []);
      const beforeNames = before.map((i) => i.name);

      // syncIndexes() do schema descreve o alvo. Em dry-run, apenas comparamos com
      // diffIndexes() (não altera nada); senão aplicamos.
      if (dryRun) {
        const diff = await Model.diffIndexes();
        const toDrop = (diff.toDrop || []).length ? diff.toDrop : ['—'];
        const toCreate = (diff.toCreate || []).length ? diff.toCreate.map((i) => JSON.stringify(i)) : ['—'];
        console.log(`• ${label}`);
        console.log(`    índices atuais: ${beforeNames.join(', ')}`);
        console.log(`    [DRY] dropar:  ${toDrop.join(', ')}`);
        console.log(`    [DRY] criar:   ${toCreate.join(', ')}\n`);
        continue;
      }

      const dropped = await Model.syncIndexes();
      const after = await Model.collection.indexes().catch(() => []);
      console.log(`• ${label}`);
      console.log(`    dropados: ${dropped.length ? dropped.join(', ') : '—'}`);
      console.log(`    índices finais: ${after.map((i) => i.name).join(', ')}\n`);
    }

    console.log(dryRun ? '✅ DRY RUN concluído (nada foi alterado).' : '✅ Índices reconciliados.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
};

run();
