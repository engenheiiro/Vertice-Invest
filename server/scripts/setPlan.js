
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VALID_PLANS = ['GUEST', 'ESSENTIAL', 'PRO', 'BLACK'];

const setPlan = async () => {
  const [email, plan, daysArg] = process.argv.slice(2);

  if (!email || !plan) {
    console.error('❌ Uso: npm run set:plan <email> <plano> [dias]');
    console.error(`   Planos disponíveis: ${VALID_PLANS.join(' | ')}`);
    console.error('   Ex: npm run set:plan pai@email.com PRO');
    console.error('   Ex: npm run set:plan pai@email.com PRO 30   (validade de 30 dias)');
    process.exit(1);
  }

  const planUpper = plan.toUpperCase();
  if (!VALID_PLANS.includes(planUpper)) {
    console.error(`❌ Plano inválido: "${plan}"`);
    console.error(`   Opções: ${VALID_PLANS.join(' | ')}`);
    process.exit(1);
  }

  const days = daysArg ? parseInt(daysArg, 10) : 365;
  if (isNaN(days) || days <= 0) {
    console.error('❌ Quantidade de dias inválida. Use um número inteiro positivo.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado ao MongoDB...\n');

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.error(`❌ Usuário não encontrado: ${email}`);
      process.exit(1);
    }

    const planAnterior = user.plan;

    user.plan = planUpper;
    user.subscriptionStatus = 'ACTIVE';

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + days);
    user.validUntil = validUntil;

    await user.save();

    console.log(`✅ Plano atualizado com sucesso!`);
    console.log(`   Usuário:    ${user.name} (${user.email})`);
    console.log(`   Plano:      ${planAnterior} → ${planUpper}`);
    console.log(`   Status:     ACTIVE`);
    console.log(`   Duração:    ${days} dia(s)`);
    console.log(`   Válido até: ${validUntil.toLocaleDateString('pt-BR')}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
};

setPlan();
