import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

// Configuração para __dirname em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

// --- CONEXÃO COM O BANCO DE DADOS ---
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.warn("⚠️ AVISO: MONGO_URI não definida. O backend não conectará ao banco.");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado ao MongoDB Atlas com sucesso!"))
    .catch(err => {
      console.error("❌ Erro fatal ao conectar no MongoDB:");
      console.error(err);
    });
}

// --- MODELO DE USUÁRIO (SCHEMA) ---
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// --- ROTAS DA API ---

app.get('/api/health', (req, res) => {
  res.send('API Vértice Invest está Online 🚀');
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Preencha todos os campos." });
    }

    // Verifica duplicidade
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(400).json({ message: "Este email já está em uso." });
    }

    // SEGURANÇA: Criptografar a senha antes de salvar
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ 
      name, 
      email: email.toLowerCase(), 
      password: hashedPassword 
    });
    
    await newUser.save();

    console.log(`👤 Novo usuário registrado: ${email}`);
    res.status(201).json({ message: "Conta criada com sucesso!" });

  } catch (error) {
    console.error("Erro no registro:", error);
    res.status(500).json({ message: "Erro interno ao criar conta." });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Busca usuário pelo email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(400).json({ message: "Credenciais inválidas." });
    }

    // SEGURANÇA: Comparar a senha enviada com o hash do banco
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Credenciais inválidas." });
    }

    console.log(`🔓 Login realizado: ${email}`);
    
    // Retorna dados seguros (sem a senha)
    res.status(200).json({ 
      message: "Login realizado com sucesso!",
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ message: "Erro interno ao realizar login." });
  }
});

// --- SERVIR FRONTEND (PRODUÇÃO) ---
const distPath = path.join(__dirname, 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.get(/.*/, (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #e11d48;">⚠️ Build não encontrado</h1>
        <p>A pasta <code>dist</code> não existe no servidor.</p>
        <p>Certifique-se de ter rodado <code>npm run build</code> ou configurado o Render corretamente.</p>
      </div>
    `);
  }
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});