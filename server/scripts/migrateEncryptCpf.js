
/**
 * Migração LGPD [12] — Criptografia field-level de CPF (Art. 6 VII / 46).
 *
 * Converte CPFs existentes (texto claro) para:
 *   - cpf:     ciphertext AES-256-GCM ("iv:tag:data")
 *   - cpfHash: blind index HMAC-SHA256 (unicidade/busca sem expor o dado)
 *
 * Também remove o índice único legado `cpf_1` (a unicidade passa a ser do cpfHash).
 *
 * Uso:
 *   node server/scripts/migrateEncryptCpf.js          (aplica a migração)
 *   node server/scripts/migrateEncryptCpf.js --dry     (apenas relata, não grava)
 *
 * Requer ENCRYPTION_KEY e MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { encrypt, blindIndex } from '../utils/encryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.includes('--dry');

// Já cifrado? formato "iv:tag:data" (3 partes hex separadas por ':').
const isEncrypted = (value) => typeof value === 'string' && value.split(':').length === 3;

const dropLegacyCpfIndex = async () => {
    try {
        const indexes = await User.collection.indexes();
        if (indexes.some((i) => i.name === 'cpf_1')) {
            if (dryRun) {
                console.log('  • [DRY] índice legado cpf_1 seria removido');
            } else {
                await User.collection.dropIndex('cpf_1');
                console.log('  • índice legado cpf_1 removido');
            }
        }
    } catch (err) {
        console.warn(`  ⚠️ não foi possível inspecionar/remover cpf_1: ${err.message}`);
    }
};

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`🔐 Conectado ao MongoDB. Migração de CPF ${dryRun ? '(DRY RUN)' : ''}...`);

        await dropLegacyCpfIndex();

        // Seleciona explicitamente cpfHash (select:false) para detectar já migrados.
        const users = await User.find({ cpf: { $exists: true, $ne: null } }).select('+cpfHash');

        let migrated = 0;
        let skipped = 0;

        for (const user of users) {
            const raw = (user.cpf || '').trim();
            if (!raw) { skipped++; continue; }

            // Já cifrado e com hash → nada a fazer.
            if (isEncrypted(raw) && user.cpfHash) { skipped++; continue; }

            // Deriva os dígitos: se cifrado mas sem hash, não dá p/ recuperar aqui →
            // apenas registra. O caminho normal é cpf em claro.
            const cleanCpf = isEncrypted(raw) ? null : raw.replace(/\D/g, '');

            if (!cleanCpf) {
                console.warn(`  ⚠️ ${user.email}: cpf cifrado sem cpfHash — regravar via perfil.`);
                skipped++;
                continue;
            }

            const cpfHash = blindIndex(cleanCpf);
            console.log(`  • ${user.email}: CPF ****${cleanCpf.slice(-2)} → cifrado + blind index`);

            if (!dryRun) {
                await User.updateOne(
                    { _id: user._id },
                    { $set: { cpf: encrypt(cleanCpf), cpfHash } }
                );
            }
            migrated++;
        }

        // Garante a criação dos índices definidos no schema (cpfHash único/sparse).
        if (!dryRun) await User.syncIndexes();

        console.log(`\n📊 Total: ${users.length} | Migrados: ${migrated} | Ignorados: ${skipped}`);
        console.log(dryRun ? '✅ DRY RUN concluído (nada foi gravado).' : '✅ Migração concluída.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
