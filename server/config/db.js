import mongoose from 'mongoose';
import logger from './logger.js';

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI;

  if (!MONGO_URI) {
    logger.warn("⚠️ AVISO: MONGO_URI não definida. O backend não persistirá dados corretamente.");
    return;
  }

  const connectOptions = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };

  try {
    const conn = await mongoose.connect(MONGO_URI, connectOptions);
    logger.info(`✅ MongoDB Conectado: ${conn.connection.host}`);
    
    mongoose.connection.on('error', err => {
      logger.error(`🔥 Erro de runtime no MongoDB: ${err.message}`);
    });

  } catch (err) {
    logger.error(`❌ Erro CRÍTICO na conexão MongoDB: ${err.message}`);
  }
};

export default connectDB;