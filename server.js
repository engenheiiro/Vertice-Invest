import './instrument.js'; // ⚠️ DEVE SER A PRIMEIRA LINHA
import 'dotenv/config';
import app from './server/app.js';
import connectDB from './server/config/db.js';
import logger from './server/config/logger.js';

// Inicialização do Banco de Dados
connectDB();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error("❌ ERRO FATAL: JWT_SECRET não definido no .env");
  process.exit(1);
}

app.listen(PORT, () => {
  logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT} em ambiente ${process.env.NODE_ENV}`);
});