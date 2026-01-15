import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

const app = express();

// --- CONFIGURAÇÃO ---
// Em produção, restringimos o CORS para aceitar apenas nosso frontend.
// Por enquanto, usamos '*' para garantir que funcione na primeira implantação.
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- CONEXÃO COM O BANCO DE DADOS ---
// O Render injetará a variável MONGO_URI. Localmente, usamos uma string vazia ou fallback.
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

// --- ROTAS (API) ---

app.get('/', (req, res) => {
  res.send('API Vértice Invest está Online 🚀');
});

// 1. Rota de Cadastro
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

// 2. Rota de Login
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

// --- INICIALIZAÇÃO ---
// O Render injeta a variável PORT automaticamente.
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});