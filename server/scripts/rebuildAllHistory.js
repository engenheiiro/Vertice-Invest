/**
 * Reconstrói o histórico patrimonial (WalletSnapshot + cota/TWRR) de TODAS as
 * carteiras a partir das transações reais. Corrige carteiras cujo quotaPrice
 * ficou travado em ~100 (TWRR plano) ou com snapshots corrompidos.
 *
 * Diferente de POST /wallet/fix-snapshots (que só APAGA snapshots ruins), este
 * script recalcula tudo via financialService.rebuildUserHistory.
 *
 * Fase 2 (múltiplas carteiras): o histórico é POR CARTEIRA, não por usuário —
 * um usuário com 2 carteiras gera 2 reconstruções independentes.
 *
 * Uso: npm run rebuild:history
 *      npm run rebuild:history -- --user=<userId>     (todas as carteiras de 1 usuário)
 *      npm run rebuild:history -- --wallet=<walletId>  (1 carteira só)
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

    const userArg = process.argv.find((a) => a.startsWith('--user='));
    const walletArg = process.argv.find((a) => a.startsWith('--wallet='));
    const targetUser = userArg ? userArg.split('=')[1] : null;
    const targetWallet = walletArg ? walletArg.split('=')[1] : null;

    // Só carteiras que têm transações (as únicas com histórico a reconstruir).
    const matchStage = {};
    if (targetUser) matchStage.user = new mongoose.Types.ObjectId(targetUser);
    if (targetWallet) matchStage.wallet = new mongoose.Types.ObjectId(targetWallet);

    const pairs = await AssetTransaction.aggregate([
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      { $group: { _id: { user: '$user', wallet: '$wallet' } } },
    ]);

    if (pairs.length === 0) {
      console.log('Nenhuma carteira com transações encontrada.');
      process.exit(0);
    }

    console.log(`🔧 Reconstruindo histórico de ${pairs.length} carteira(s)...\n`);

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < pairs.length; i++) {
      const { user, wallet } = pairs[i]._id;
      const label = `[${i + 1}/${pairs.length}] user=${user} wallet=${wallet}`;
      try {
        await financialService.rebuildUserHistory(user, wallet);
        ok++;
        console.log(`✅ ${label}`);
      } catch (err) {
        failed++;
        console.error(`❌ ${label} — ${err.message}`);
      }
      // Respiro entre carteiras para não saturar as APIs externas de cotação.
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
