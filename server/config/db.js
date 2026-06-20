
import mongoose from 'mongoose';
import logger from './logger.js';
import { attachMongoBreaker } from '../middleware/mongoCircuitBreaker.js';

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI;

  if (!MONGO_URI) {
    logger.warn("⚠️ AVISO: MONGO_URI não definida. O backend não persistirá dados corretamente.");
    return;
  }

  const connectOptions = {
    // Aumentado para 30s (padrão robusto para produção remota)
    serverSelectionTimeoutMS: 30000, 
    // Aumentado para 60s para permitir queries complexas de agregação
    socketTimeoutMS: 60000,
    // Garante reconexão automática
    autoIndex: true,
    // Limita conexões simultâneas para não afogar o banco (essencial para planos shared)
    maxPoolSize: 10,
    minPoolSize: 2,
    family: 4 // Força IPv4 para evitar problemas de resolução DNS IPv6 em alguns ambientes
  };

  // (6.9) Liga o circuit breaker aos eventos da conexão ANTES de conectar, para
  // não perder o primeiro 'connected'/'error'.
  attachMongoBreaker();

  try {
    const conn = await mongoose.connect(MONGO_URI, connectOptions);
    logger.info(`🗄️ [Database] MongoDB Conectado: ${conn.connection.host}`);

    mongoose.connection.on('error', err => {
      logger.error(`🔥 Erro de runtime no MongoDB: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn(`⚠️ MongoDB Desconectado. Tentando reconectar...`);
    });

    mongoose.connection.on('reconnected', () => {
      logger.info(`✅ MongoDB Reconectado.`);
    });

  } catch (err) {
    logger.error(`❌ Erro CRÍTICO na conexão MongoDB: ${err.message}`);
    // Não encerra o processo imediatamente em dev, tenta manter o servidor de pé
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
  }
};

export default connectDB;
