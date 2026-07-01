/**
 * backupCollections.js — safety net (usa-e-descarta)
 *
 * Faz backup por streaming (cursor → NDJSON gzip) das coleções passadas por argumento,
 * gravando em um diretório de saída. Serve de rollback antes de operações destrutivas
 * (trim de assethistories / cleanup de marketanalyses) quando mongodump não está instalado.
 *
 * Uso:
 *   node server/scripts/backupCollections.js <outDir> assethistories marketanalyses
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const [outDir, ...collections] = process.argv.slice(2);
if (!outDir || collections.length === 0) {
    console.error('Uso: node server/scripts/backupCollections.js <outDir> <col1> [col2 ...]');
    process.exit(1);
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

const run = async () => {
    if (!process.env.MONGO_URI) { console.error('❌ MONGO_URI não definida'); process.exit(1); }
    fs.mkdirSync(outDir, { recursive: true });

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`📡 Conectado: ${mongoose.connection.host}`);
    console.log(`📁 Saída: ${outDir}\n`);

    for (const name of collections) {
        const file = path.join(outDir, `${name}.ndjson.gz`);
        const gzip = zlib.createGzip();
        const out = fs.createWriteStream(file);
        gzip.pipe(out);

        const cursor = mongoose.connection.db.collection(name).find({}, { raw: false });
        let count = 0;
        for await (const doc of cursor) {
            if (!gzip.write(JSON.stringify(doc) + '\n')) {
                await new Promise((r) => gzip.once('drain', r));
            }
            count++;
        }
        await new Promise((r) => gzip.end(r));
        await new Promise((r) => out.on('finish', r));
        const size = fs.statSync(file).size;
        console.log(`✅ ${name}: ${count} docs → ${file} (${mb(size)})`);
    }

    await mongoose.disconnect();
    process.exit(0);
};

run().catch((e) => { console.error(`❌ Erro: ${e.message}`); process.exit(1); });
