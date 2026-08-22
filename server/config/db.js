
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

/**
 * Opções de conexão COMPARTILHADAS entre o servidor e os scripts longos
 * (`sync:prod`, `sync:TimeSeriesWorker`). Exportadas de propósito: até 22/08/2026
 * os scripts chamavam `mongoose.connect(URI)` sem opção nenhuma e rodavam com os
 * defaults do driver — pool sem mínimo, sem IPv4 forçado, sem socketTimeout. O
 * run de 18m40s daquele dia morreu em 570/1300 ativos quando o pool precisou
 * abrir um socket novo e o handshake TLS estourou o `connectTimeoutMS` padrão.
 */
export const MONGO_CONNECT_OPTIONS = {
  // Aumentado para 30s (padrão robusto para produção remota)
  serverSelectionTimeoutMS: 30000,
  // Aumentado para 60s para permitir queries complexas de agregação
  socketTimeoutMS: 60000,
  // Handshake (TCP + TLS) de conexão NOVA. O default de 30s é curto demais para
  // um link doméstico degradado: foi exatamente ele que estourou no run de 22/08
  // ("Socket 'secureConnect' timed out after 30214ms"). 60s dá folga ao TLS sem
  // travar o run — o retry de `utils/mongoResilience.js` cobre o resto.
  connectTimeoutMS: 60000,
  // Garante reconexão automática
  autoIndex: true,
  // Limita conexões simultâneas para não afogar o banco (essencial para planos shared)
  maxPoolSize: 10,
  // Mantém conexões quentes: nas rotinas longas há trechos de vários minutos só
  // raspando fonte externa, sem tocar o banco. Com o pool em zero, a volta ao
  // Mongo exigiria handshake novo — justamente o que falhou. (maxIdleTimeMS fica
  // no default 0 = o cliente nunca aposenta conexão ociosa por idade; aposentar
  // por tempo aqui só criaria mais handshakes, que é o passo frágil.)
  minPoolSize: 2,
  // Defaults do driver, explicitados: uma leitura/escrita que cai por rede é
  // re-tentada uma vez pelo próprio driver antes de chegar ao nosso retry.
  retryReads: true,
  retryWrites: true,
  family: 4 // Força IPv4 para evitar problemas de resolução DNS IPv6 em alguns ambientes
};

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI;

  if (!MONGO_URI) {
    logger.warn("⚠️ AVISO: MONGO_URI não definida. O backend não persistirá dados corretamente.");
    return;
  }

  const connectOptions = MONGO_CONNECT_OPTIONS;

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
