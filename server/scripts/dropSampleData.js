/**
 * dropSampleData.js
 *
 * Remove o banco de dados de EXEMPLO do MongoDB (`sample_mflix`) que ocupa ~101 MB no
 * cluster Atlas mas NÃO é referenciado em nenhum lugar do projeto (confirmado por grep).
 * Liberação de espaço imediata e sem impacto no app (o app usa o banco `test`).
 *
 * Segurança:
 *   - Valida que o alvo é EXATAMENTE `sample_mflix` (nunca dropa `test`/`admin`/`local`).
 *   - Dry-run por padrão: só reporta o tamanho. Exige `--confirm` para dropar de fato.
 *
 * Uso:
 *   node server/scripts/dropSampleData.js              (dry-run — só relatório)
 *   node server/scripts/dropSampleData.js --confirm    (dropa de fato)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TARGET_DB = 'sample_mflix';
const PROTECTED = new Set(['test', 'admin', 'local', 'config']);
const CONFIRM = process.argv.includes('--confirm');

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

const run = async () => {
    if (!process.env.MONGO_URI) {
        console.error('❌ MONGO_URI não definida no .env');
        process.exit(1);
    }
    if (PROTECTED.has(TARGET_DB)) {
        console.error(`❌ Recusado: "${TARGET_DB}" está na lista protegida.`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`📡 Conectado: ${mongoose.connection.host}\n`);

    const admin = mongoose.connection.db.admin();
    const { databases } = await admin.listDatabases();
    const target = databases.find((d) => d.name === TARGET_DB);

    if (!target) {
        console.log(`ℹ️ Banco "${TARGET_DB}" não existe (já removido?). Nada a fazer.`);
        await mongoose.disconnect();
        process.exit(0);
    }

    const sampleDb = mongoose.connection.useDb(TARGET_DB);
    const stats = await sampleDb.db.stats();
    console.log(`🎯 Alvo: ${TARGET_DB}`);
    console.log(`   Coleções: ${stats.collections}`);
    console.log(`   Data size: ${mb(stats.dataSize)}`);
    console.log(`   Storage size: ${mb(stats.storageSize)}\n`);

    if (!CONFIRM) {
        console.log('🔎 DRY-RUN — nada foi removido. Rode com --confirm para dropar.');
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log(`🗑️ Dropando "${TARGET_DB}"...`);
    await sampleDb.dropDatabase();
    console.log(`✅ "${TARGET_DB}" removido. ~${mb(stats.dataSize)} de Data Size liberados.`);

    await mongoose.disconnect();
    process.exit(0);
};

run().catch((e) => {
    console.error(`❌ Erro: ${e.message}`);
    process.exit(1);
});
