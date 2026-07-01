/**
 * dbSizeReport.js — SOMENTE LEITURA
 * Reporta Data/Storage size do banco atual e das maiores coleções, além da lista de bancos
 * no cluster. Útil para acompanhar a liberação de espaço antes/depois das limpezas.
 *
 * Uso: node server/scripts/dbSizeReport.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const mb = (b) => (b / (1024 * 1024)).toFixed(2).padStart(9) + ' MB';

const run = async () => {
    if (!process.env.MONGO_URI) { console.error('❌ MONGO_URI não definida'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    console.log(`📡 ${mongoose.connection.host}\n`);

    const { databases, totalSize } = await db.admin().listDatabases();
    console.log('🗄️  Bancos no cluster:');
    for (const d of databases) console.log(`   ${d.name.padEnd(16)} ${mb(d.sizeOnDisk || 0)} (disco)`);
    console.log(`   ${'TOTAL (disco)'.padEnd(16)} ${mb(totalSize || 0)}\n`);

    const s = await db.stats();
    console.log(`📊 Banco "${s.db}": Data ${mb(s.dataSize)} | Storage ${mb(s.storageSize)} | Índices ${mb(s.indexSize)}\n`);

    const names = (await db.listCollections().toArray()).map((c) => c.name);
    const rows = [];
    for (const n of names) {
        try { const cs = await db.command({ collStats: n }); rows.push({ n, data: cs.size, storage: cs.storageSize, count: cs.count }); } catch {}
    }
    rows.sort((a, b) => b.data - a.data);
    console.log('📦 Coleções (por Data Size):');
    for (const r of rows.slice(0, 12)) console.log(`   ${r.n.padEnd(22)} Data ${mb(r.data)} | Storage ${mb(r.storage)} | ${r.count} docs`);

    await mongoose.disconnect();
    process.exit(0);
};
run().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
