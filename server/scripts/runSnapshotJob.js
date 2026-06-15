// Snapshot Patrimonial Diário — executável standalone para Render Cron Job.
// Conecta ao Mongo, roda runDailySnapshot e finaliza (process.exit), de forma
// independente do web service (que pode hibernar). Uso: `npm run snapshot:prod`.
// Flag opcional `--force` ignora a verificação de dia útil.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDailySnapshot } from '../services/schedulerService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const p of ['../../.env', '../.env']) {
  if (!process.env.MONGO_URI) dotenv.config({ path: path.resolve(__dirname, p) });
}

const run = async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida.');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('info: ⏰ Script: Snapshot Diário - Iniciado');

    const force = process.argv.includes('--force');
    const res = await runDailySnapshot(force);

    console.log(`info: ✅ Snapshot Diário - Finalizado: ${JSON.stringify(res)}`);
    process.exit(0);
  } catch (error) {
    console.error(`error: ❌ Snapshot Diário - Erro Fatal: ${error.message}`);
    process.exit(1);
  }
};

run();
