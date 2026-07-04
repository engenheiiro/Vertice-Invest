/**
 * Remove Transactions duplicadas pelo mesmo pagamento (gatewayId) e constrói o
 * índice único {gatewayId} (sparse) que garante a idempotência de webhook/sync.
 *
 * PORQUÊ: entregas duplicadas do webhook do Mercado Pago (normais no protocolo)
 * criavam duas Transactions para o MESMO pagamento — creditando o plano em dobro
 * e duplicando o registro de cobrança. A correção (webhookController/subscription
 * controller) usa Transaction.create() como barreira ATÔMICA: o índice único em
 * gatewayId faz a 2ª entrega falhar com E11000. Mas o índice NÃO consegue ser
 * criado enquanto houver duplicatas pré-existentes (o próprio createIndex falha
 * com E11000, silenciosamente, deixando a barreira inerte). Este script limpa o
 * passivo e então sincroniza o índice.
 *
 * Sobrevivente: o registro mais ANTIGO de cada gatewayId (primeiro crédito).
 * Os removidos são despejados em JSON (backup) antes do delete.
 *
 * Uso:
 *   node scripts/cleanDuplicateTransactions.js --dry-run   (só relatório)
 *   node scripts/cleanDuplicateTransactions.js             (aplica + sincroniza índice)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Transaction from '../models/Transaction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const run = async () => {
    const isDryRun = process.argv.includes('--dry-run');

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`📡 Conectado ao MongoDB${isDryRun ? '  [DRY-RUN — nada será alterado]' : ''}\n`);

        // Grupos de gatewayId (string, não-nulo) com mais de um documento.
        const dupGroups = await Transaction.aggregate([
            { $match: { gatewayId: { $type: 'string' } } },
            { $group: { _id: '$gatewayId', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $sort: { count: -1 } },
        ]);

        const idsToDelete = [];
        const deletedBackup = [];

        for (const g of dupGroups) {
            // Mais antigo primeiro = sobrevivente; o resto é removido.
            const docs = await Transaction.find({ gatewayId: g._id }).sort({ createdAt: 1, _id: 1 }).lean();
            const [keep, ...extras] = docs;
            console.log(
                `• gatewayId ${g._id}: ${docs.length} docs → mantém ${keep._id} ` +
                `(${keep.plan}/${keep.amount}), remove ${extras.length}`,
            );
            for (const e of extras) { idsToDelete.push(e._id); deletedBackup.push(e); }
        }

        console.log('\n──────────────────────────────────────────────');
        console.log(`gatewayIds duplicados:        ${dupGroups.length}`);
        console.log(`Registros ${isDryRun ? 'a remover' : 'removidos'}:          ${idsToDelete.length}`);
        console.log('──────────────────────────────────────────────\n');

        if (isDryRun) {
            console.log('DRY-RUN: nenhuma alteração feita. Rode sem --dry-run para aplicar.');
            process.exit(0);
        }

        if (idsToDelete.length > 0) {
            const backupPath = path.resolve(__dirname, `../../transactions-dedup-backup-${Date.now()}.json`);
            fs.writeFileSync(backupPath, JSON.stringify(deletedBackup, null, 2));
            console.log(`💾 Backup dos ${deletedBackup.length} removidos: ${backupPath}`);
            const res = await Transaction.deleteMany({ _id: { $in: idsToDelete } });
            console.log(`🗑️  ${res.deletedCount} duplicata(s) removida(s).`);
        }

        // Constrói/sincroniza o índice único {gatewayId} agora que não há colisão.
        try {
            await Transaction.syncIndexes();
            const indexes = await Transaction.collection.indexes();
            const gw = indexes.find((i) => i.key && i.key.gatewayId !== undefined);
            console.log(`🗂️  Índice sincronizado: ${gw ? `${gw.name} (unique=${!!gw.unique}, sparse=${!!gw.sparse})` : 'gatewayId NÃO encontrado ⚠️'}`);
        } catch (e) {
            console.error(`⚠️  Falha ao sincronizar índice (revise manualmente): ${e.message}`);
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Erro na limpeza de transações:', err.message);
        process.exit(1);
    }
};

run();
