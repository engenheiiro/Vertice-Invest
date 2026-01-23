import './instrument.js'; 
import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';
import logger from './src/config/logger.js';

// Inicialização do Banco de Dados
connectDB();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error("❌ ERRO FATAL: JWT_SECRET não definido no .env");
  process.exit(1);
}

const server = app.listen(PORT, () => {
  logger.info(`🚀 Servidor Vértice Invest rodando na porta ${PORT} em ambiente ${process.env.NODE_ENV}`);
});

// Aumenta o timeout para 5 minutos (300000 ms) para evitar ECONNRESET em operações pesadas
server.setTimeout(300000);