import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
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
  email: { type: String, required: true, unique: true },
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

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "Este email já está em uso." });
    }

    const newUser = new User({ name, email, password });
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

    const user = await User.findOne({ email });
    
    if (!user || user.password !== password) {
      return res.status(400).json({ message: "Email ou senha incorretos." });
    }

    console.log(`🔓 Login realizado: ${email}`);
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

// Verifica se a pasta dist existe antes de tentar servir
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Qualquer rota que não seja da API, tenta mandar para o React (SPA)
app.get(/.*/, (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Se o index.html não existe, significa que o build não rodou
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #e11d48;">⚠️ Build não encontrado</h1>
        <p>A pasta <code>dist</code> não existe no servidor.</p>
        <p><strong>Como corrigir no Render:</strong></p>
        <ol style="display: inline-block; text-align: left;">
          <li>Vá em <em>Settings</em> no dashboard do Render.</li>
          <li>Encontre a opção <strong>Build Command</strong>.</li>
          <li>Mude para: <code>npm run render-build</code></li>
          <li>Salve e faça um novo deploy (Manual Deploy > Clear cache and deploy).</li>
        </ol>
      </div>
    `);
  }
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});