/**
 * runCleanupNow.js
 *
 * Dispara `runStorageCleanup()` uma vez, manualmente, contra o banco atual — para reclamar
 * espaço já, sem esperar o cron diário (job 12 do schedulerService). Aplica a regra Balanced:
 * remove MarketAnalysis > 120 dias, tira `fullAuditLog` de análises > 7 dias (exceto o
 * relatório mais recente por classe), e limpa AlgorithmPerformance/AuditLog > 90 dias.
 *
 * Reporta o Data Size de `marketanalyses` antes/depois.
 *
 * Uso:
 *   node server/scripts/runCleanupNow.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { runStorageCleanup } from '../services/cleanupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

const collStats = async (name) => {
    try {
        const s = await mongoose.connection.db.command({ collStats: name });
        return { dataSize: s.size, count: s.count };
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
    console.log(`📡 Conectado: ${mongoose.connection.host}\n`);

    const before = await collStats('marketanalyses');
    if (before) console.log(`📊 marketanalyses antes: ${before.count} docs | Data ${mb(before.dataSize)}\n`);

    const stats = await runStorageCleanup();
    console.log('\n📋 Resultado:', JSON.stringify(stats, null, 2));

    const after = await collStats('marketanalyses');
    if (before && after) {
        console.log(`\n📊 marketanalyses depois: ${after.count} docs | Data ${mb(after.dataSize)}`);
        console.log(`   Data Size liberado: ${mb(before.dataSize - after.dataSize)}`);
    }

    await mongoose.disconnect();
    process.exit(0);
};

run().catch((e) => {
    console.error(`❌ Erro: ${e.message}`);
    process.exit(1);
});
