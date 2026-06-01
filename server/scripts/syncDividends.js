/**
 * Backfill de proventos (DividendEvent).
 *
 * Busca o histórico de dividendos de todos os tickers presentes nas carteiras
 * (UserAsset) e popula a coleção DividendEvent. Resolve carteiras existentes que
 * estavam com "Proventos" zerados por falta de ingestão.
 *
 * Uso: npm run sync:dividends
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import UserAsset from '../models/UserAsset.js';
import { financialService } from '../services/financialService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado ao MongoDB...\n');

    // Tickers distintos elegíveis a proventos (exclui cripto/renda fixa/caixa).
    const assets = await UserAsset.find({
      type: { $nin: ['CRYPTO', 'FIXED_INCOME', 'CASH'] },
    }).select('ticker type');

    const uniq = new Map();
    assets.forEach((a) => { if (!uniq.has(a.ticker)) uniq.set(a.ticker, { ticker: a.ticker, type: a.type }); });
    const list = [...uniq.values()];

    if (list.length === 0) {
      console.log('Nenhum ativo elegível a proventos encontrado nas carteiras.');
      process.exit(0);
    }

    console.log(`🔎 Buscando proventos de ${list.length} ticker(s): ${list.map((a) => a.ticker).join(', ')}\n`);

    const { tickers, events } = await financialService.syncDividends(list);

    console.log(`\n✅ Concluído: ${events} novo(s) evento(s) de provento em ${tickers} ticker(s).`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro no sync de proventos:', err.message);
    process.exit(1);
  }
};

run();
