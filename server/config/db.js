
import mongoose from 'mongoose';
import logger from './logger.js';
import { attachMongoBreaker } from '../middleware/mongoCircuitBreaker.js';
import { attachMongoCommandMetrics, performanceMetrics } from '../utils/performanceMetrics.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import JobLease from '../models/JobLease.js';
import JobCheckpoint from '../models/JobCheckpoint.js';

/**
 * Self-heal de índices legados que `autoIndex` NÃO remove sozinho (autoIndex só
 * CRIA os que faltam; nunca dropa os obsoletos). A migração Fase 2 (múltiplas
 * carteiras) reescopou os índices de user- para wallet-, mas os legados user-scoped
 * ficaram no banco. O mais grave é `userassets.user_1_ticker_1` (ÚNICO), que bloqueia
 * o MESMO ticker em carteiras diferentes (E11000 ao cadastrar, ex.: BOVA11). Os demais
 * são compostos user-scoped já substituídos pelos equivalentes wallet-scoped. A lista
 * também recolhe índices que nasceram com a definição errada (ver `wallets.publicToken_1`).
 *
 * Remoção idempotente e NÃO destrutiva: apaga só a definição de índice obsoleta (nunca
 * dados), e o índice correto já é garantido pelo autoIndex do schema. Para a limpeza
 * completa (inclui índices `wallet_1` redundantes), use scripts/fixWalletScopedIndexes.js.
 */
const healLegacyIndexes = async () => {
  const STALE = [
    // ÚNICO — causa E11000 ao cadastrar o mesmo ticker em carteiras diferentes.
    { collection: 'userassets', index: 'user_1_ticker_1', reason: 'Fase 2 — múltiplas carteiras' },
    { collection: 'assettransactions', index: 'user_1_ticker_1_date_1', reason: 'Fase 2 — múltiplas carteiras' },
    { collection: 'assettransactions', index: 'wallet_1_ticker_1_date_1', reason: 'Fase 3 — sort agora inclui createdAt' },
    { collection: 'investmentgoals', index: 'user_1_status_1', reason: 'Fase 2 — múltiplas carteiras' },
    { collection: 'goalcontributions', index: 'user_1_goal_1_date_-1', reason: 'Fase 2 — múltiplas carteiras' },
    // ÚNICO — causa E11000 ao criar a 2ª carteira. Nasceu `{ unique, sparse }`
    // acreditando que sparse tiraria do índice as carteiras sem link público. Não
    // tira: sparse só ignora o documento em que o campo está AUSENTE, e
    // `publicToken` tem `default: null`, então toda carteira grava o campo valendo
    // null e a segunda colide com a primeira. O substituto é o índice PARCIAL
    // `publicToken_partial_unique` do schema (nome distinto de propósito: assim o
    // autoIndex o cria sem conflitar com este, que morre aqui).
    { collection: 'wallets', index: 'publicToken_1', reason: 'sparse+unique colidia em publicToken:null' },
  ];
  for (const { collection, index, reason } of STALE) {
    try {
      const coll = mongoose.connection.db.collection(collection);
      const exists = await coll.indexExists(index);
      if (exists) {
        await coll.dropIndex(index);
        logger.warn(`🩹 [Database] Índice legado ${collection}.${index} removido (${reason}).`);
      }
    } catch (err) {
      // Não crítico: se falhar (permissão, índice já removido em corrida), seguimos.
      logger.warn(`[Database] Não foi possível remover o índice legado ${collection}.${index}: ${err.message}`);
    }
  }
};

/**
 * Índices operacionais cuja ausência muda corretude (lease único) ou recoloca
 * SORT em memória nas rotas quentes. `createIndex` é idempotente e o connectDB
 * espera sua confirmação antes de liberar o scheduler.
 */
const ensureOperationalIndexes = async () => {
  // Model.init() reutiliza a promessa interna do Mongoose e, portanto, não
  // disputa a mesma criação com o autoIndex iniciado na conexão.
  await Promise.all([
    AssetTransaction.init(),
    WalletSnapshot.init(),
    JobLease.init(),
    JobCheckpoint.init(),
  ]);
  logger.info('🧭 [Database] Índices operacionais da Fase 3 confirmados.');
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
  // Handshake (TCP + TLS) de conexão NOVA — o passo caro deste cluster (ver
  // minPoolSize). Foi ele que estourou nos dois runs de 22/08 ("Socket
  // 'secureConnect' timed out after 30214ms" e depois after 60397ms). Subir o
  // teto sozinho NÃO resolve: 60s já não bastou. Ele só dá folga; quem resolve é
  // não precisar de conexão nova no meio do run (minPoolSize) e re-tentar quando
  // precisar (utils/mongoResilience.js).
  connectTimeoutMS: 60000,
  // Garante reconexão automática
  autoIndex: true,
  // Limita conexões simultâneas para não afogar o banco (essencial para planos shared)
  maxPoolSize: 10,
  // Pool PRÉ-AQUECIDO. Medição de 22/08/2026 contra o cluster Atlas: abrir uma
  // conexão nova custa 9,5s no melhor caso (e estourou 30s e 60s nos dois runs
  // que falharam naquela manhã), enquanto um socket JÁ ESTABELECIDO responde em
  // 131ms, estável. Ou seja: o gargalo é exclusivamente o handshake TLS, não o
  // banco. Como o driver preenche o pool até o mínimo logo após conectar, subir
  // esse número move o custo para o começo do run — onde ninguém está esperando
  // — em vez de deixá-lo estourar no meio do laço. 5 cobre a concorrência real
  // do sync (lotes de 5 em Promise.all) sem chegar perto do teto de 10.
  // (maxIdleTimeMS fica no default 0 = o cliente nunca aposenta conexão ociosa
  // por idade; aposentar por tempo aqui só criaria mais handshakes.)
  minPoolSize: 5,
  // Defaults do driver, explicitados: uma leitura/escrita que cai por rede é
  // re-tentada uma vez pelo próprio driver antes de chegar ao nosso retry.
  retryReads: true,
  retryWrites: true,
  // Command monitoring é opt-in porque adiciona eventos por operação. Quando
  // ativo, o coletor guarda somente comando + coleção + duração — nunca filtros,
  // documentos ou valores.
  monitorCommands: performanceMetrics.enabled && process.env.PERF_MONGO_COMMANDS_ENABLED === 'true',
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
    attachMongoCommandMetrics(conn.connection.getClient());
    logger.info(`🗄️ [Database] MongoDB Conectado: ${conn.connection.host}`);

    await ensureOperationalIndexes();
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
