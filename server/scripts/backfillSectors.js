
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { backfillSectors } from '../services/sectorBackfillService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Uso:
//   node server/scripts/backfillSectors.js          (aplica as correções)
//   node server/scripts/backfillSectors.js --dry    (apenas mostra o que mudaria)
const dryRun = process.argv.includes('--dry');

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`🩹 Conectado ao MongoDB. Backfill de setores ${dryRun ? '(DRY RUN)' : ''}...`);

        const { scanned, updated, changes } = await backfillSectors({ dryRun });

        console.log(`\n📊 Analisados: ${scanned} | A corrigir: ${updated}\n`);
        changes
            .sort((a, b) => a.type.localeCompare(b.type) || a.ticker.localeCompare(b.ticker))
            .forEach((c) => {
                console.log(`  [${c.type}] ${c.ticker}: "${c.from}" → "${c.to}"`);
            });

        console.log(`\n✅ ${dryRun ? 'Dry run concluído (nada gravado).' : 'Backfill aplicado.'}`);
    } catch (err) {
        console.error('❌ Falha no backfill:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

run();
