/**
 * Reconstrói o histórico patrimonial (WalletSnapshot + cota/TWRR) de TODAS as
 * contas a partir das transações reais. Corrige carteiras cujo quotaPrice ficou
 * travado em ~100 (TWRR plano) ou com snapshots corrompidos.
 *
 * Diferente de POST /wallet/fix-snapshots (que só APAGA snapshots ruins), este
 * script recalcula tudo via financialService.rebuildUserHistory.
 *
 * Uso: npm run rebuild:history
 *      npm run rebuild:history -- --user=<userId>   (uma conta só)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import AssetTransaction from '../models/AssetTransaction.js';
import { financialService } from '../services/financialService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado ao MongoDB...\n');

    // Permite reconstruir uma conta específica: --user=<id>
    const userArg = process.argv.find((a) => a.startsWith('--user='));
    const targetUser = userArg ? userArg.split('=')[1] : null;

    // Só contas que têm transações (as únicas com histórico a reconstruir).
    const userIds = targetUser
      ? [targetUser]
      : (await AssetTransaction.distinct('user')).map((id) => id.toString());

    if (userIds.length === 0) {
      console.log('Nenhuma conta com transações encontrada.');
      process.exit(0);
    }

    console.log(`🔧 Reconstruindo histórico de ${userIds.length} conta(s)...\n`);

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const label = `[${i + 1}/${userIds.length}] ${userId}`;
      try {
        await financialService.rebuildUserHistory(userId);
        ok++;
        console.log(`✅ ${label}`);
      } catch (err) {
        failed++;
        console.error(`❌ ${label} — ${err.message}`);
      }
      // Respiro entre contas para não saturar as APIs externas de cotação.
      await sleep(300);
    }

    console.log(`\n🏁 Concluído: ${ok} reconstruída(s), ${failed} com erro.`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('❌ Erro no rebuild de histórico:', err.message);
    process.exit(1);
  }
};

run();
