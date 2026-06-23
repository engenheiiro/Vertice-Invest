/**
 * Re-roda APENAS o batch de ranking (aiResearchService.runBatchAnalysis) contra os
 * dados já sincronizados no DB — sem re-scraping nem séries temporais.
 * Uso pontual após um sync cujo scrape concluiu mas o save do ranking falhou.
 * Uso: node server/scripts/runRankingOnly.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { aiResearchService } from '../services/aiResearchService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'local_sync';

const run = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida.');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('info: ℹ️ Conexão DB estabelecida. Rodando runBatchAnalysis...');
    await aiResearchService.runBatchAnalysis(null);
    console.log('info: ✅ Ranking regerado e salvo.');
    await mongoose.disconnect();
    process.exit(0);
};

run().catch(e => { console.error('❌ Erro:', e.message); process.exit(1); });
