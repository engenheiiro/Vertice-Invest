
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const listUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado ao MongoDB...\n');

    const users = await User.find({})
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 });

    if (users.length === 0) {
      console.log('Nenhum usuário cadastrado.');
      process.exit(0);
    }

    console.log(`Total: ${users.length} usuário(s)\n`);
    console.log('─'.repeat(80));

    users.forEach((user, i) => {
      const validUntil = user.validUntil
        ? new Date(user.validUntil).toLocaleDateString('pt-BR')
        : '—';
      const createdAt = new Date(user.createdAt).toLocaleDateString('pt-BR');

      console.log(`#${i + 1} ${user.name}`);
      console.log(`   Email:  ${user.email}`);
      console.log(`   Plano:  ${user.plan}  |  Status: ${user.subscriptionStatus}  |  Role: ${user.role}`);
      console.log(`   Válido: ${validUntil}  |  Criado em: ${createdAt}`);
      console.log('─'.repeat(80));
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
};

listUsers();
