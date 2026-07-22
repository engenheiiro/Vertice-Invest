/**
 * Auditoria read-only do ranking Buy-and-Hold (estratégia BUY_AND_HOLD) — shadow.
 *
 * Wrapper de linha de comando sobre buyAndHoldService.generateBuyAndHoldRanking().
 * NÃO escreve nada (nem MarketAnalysis, nem DiscardLog, nem config).
 *
 * Uso:
 *   node server/scripts/auditBuyAndHoldShadowRanking.js            # lista + resumo
 *   node server/scripts/auditBuyAndHoldShadowRanking.js --excluded # + motivos de exclusão
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { buyAndHoldService } from '../services/buyAndHoldService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SHOW_EXCLUDED = process.argv.includes('--excluded');

await mongoose.connect(process.env.MONGO_URI);
try {
  const result = await buyAndHoldService.generateBuyAndHoldRanking({ includeExcluded: SHOW_EXCLUDED });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}
