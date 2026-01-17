import './instrument.js'; 
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Configuração de Ambiente (Executa ANTES de importar o app)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env da raiz (../.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });
// Fallback para .env local se existir
dotenv.config();

// 2. Importações Dinâmicas (Garante que process.env já esteja populado)
// O uso de 'await import' assegura que o módulo só é carregado após o dotenv
const { default: app } = await import('./app.js');
const { default: connectDB } = await import('./config/db.js');
const { default: logger } = await import('./config/logger.js');

// 3. Inicialização
connectDB();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error("❌ ERRO FATAL: JWT_SECRET não definido no .env");
  // Não mata o processo em dev para facilitar debug, mas avisa
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

app.listen(PORT, () => {
  logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT}`);
});