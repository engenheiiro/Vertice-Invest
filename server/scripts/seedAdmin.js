
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

// Configuração de ambiente
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const promoteToAdmin = async () => {
  const email = process.argv[2]; // Pega o email do argumento do comando

  if (!email) {
    console.error("❌ Por favor, forneça o email do usuário. Ex: npm run seed:admin usuario@email.com");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("📡 Conectado ao MongoDB...");

    const user = await User.findOne({ email });

    if (!user) {
      console.error(`❌ Usuário não encontrado: ${email}`);
      process.exit(1);
    }

    // --- APLICANDO SUPER PODERES ---
    user.role = 'ADMIN';
    user.plan = 'BLACK'; // Acesso total a todas as features
    user.subscriptionStatus = 'ACTIVE'; // Status ativo para passar em middlewares
    
    // Define validade vitalícia (ano 2099) para evitar bloqueios de UI que checam data
    user.validUntil = new Date('2099-12-31T23:59:59.999Z'); 
    
    // Garante que flags de tutorial não bloqueiem
    user.hasSeenTutorial = true;

    await user.save();

    console.log(`\n✅ SUCESSO! O usuário ${user.name} (${email}) foi atualizado:`);
    console.log(`   - Role: ADMIN`);
    console.log(`   - Plano: BLACK (Elite)`);
    console.log(`   - Status: ACTIVE`);
    console.log(`   - Validade: Vitalícia (2099)`);
    console.log("\n👉 O usuário tem agora acesso irrestrito a todo o sistema.");
    
    process.exit(0);

  } catch (error) {
    console.error("❌ Erro:", error.message);
    process.exit(1);
  }
};

promoteToAdmin();
