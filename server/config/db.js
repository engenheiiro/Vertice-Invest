
import mongoose from 'mongoose';
import logger from './logger.js';
import { attachMongoBreaker } from '../middleware/mongoCircuitBreaker.js';

/**
 * Self-heal de índices legados que `autoIndex` NÃO remove sozinho (autoIndex só
 * CRIA os que faltam; nunca dropa os obsoletos). A migração Fase 2 (múltiplas
 * carteiras) reescopou os índices de user- para wallet-, mas os legados user-scoped
 * ficaram no banco. O mais grave é `userassets.user_1_ticker_1` (ÚNICO), que bloqueia
 * o MESMO ticker em carteiras diferentes (E11000 ao cadastrar, ex.: BOVA11). Os demais
 * são compostos user-scoped já substituídos pelos equivalentes wallet-scoped.
 *
 * Remoção idempotente e NÃO destrutiva: apaga só a definição de índice obsoleta (nunca
 * dados), e o índice correto já é garantido pelo autoIndex do schema. Para a limpeza
 * completa (inclui índices `wallet_1` redundantes), use scripts/fixWalletScopedIndexes.js.
 */
const healLegacyIndexes = async () => {
  const STALE = [
    { collection: 'userassets', index: 'user_1_ticker_1' },        // ÚNICO — causa E11000
    { collection: 'assettransactions', index: 'user_1_ticker_1_date_1' },
    { collection: 'investmentgoals', index: 'user_1_status_1' },
    { collection: 'goalcontributions', index: 'user_1_goal_1_date_-1' },
  ];
  for (const { collection, index } of STALE) {
    try {
      const coll = mongoose.connection.db.collection(collection);
      const exists = await coll.indexExists(index);
      if (exists) {
        await coll.dropIndex(index);
        logger.warn(`🩹 [Database] Índice legado ${collection}.${index} removido (Fase 2 — múltiplas carteiras).`);
      }
    } catch (err) {
      // Não crítico: se falhar (permissão, índice já removido em corrida), seguimos.
      logger.warn(`[Database] Não foi possível remover o índice legado ${collection}.${index}: ${err.message}`);
    }
  }
};

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

    await healLegacyIndexes();

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
