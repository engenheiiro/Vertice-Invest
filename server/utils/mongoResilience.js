/**
 * Resiliência de CONEXÃO com o MongoDB para rotinas longas (sync, workers).
 *
 * Motivação (run de 22/08/2026): o `sync:prod` levou 18m40s e, no meio da etapa
 * de séries temporais, o pool precisou abrir um socket novo. O handshake TLS não
 * fechou dentro do `connectTimeoutMS` e o erro
 *   `Socket 'secureConnect' timed out after 30214ms (connectTimeoutMS: 30000)`
 * derrubou a etapa inteira em 570/1300 ativos — 730 ativos ficaram com beta,
 * volatilidade, SMA e EMA velhos naquele ciclo.
 *
 * Uma queda transitória de conexão no meio de um laço de 20 minutos é NORMAL num
 * banco remoto: o certo é re-tentar o punhado de operações afetadas, não abortar
 * o run. Este módulo separa o "transitório" (vale re-tentar) do "erro real"
 * (schema, validação, duplicidade — re-tentar só perde tempo).
 *
 * IMPORTANTE: `withMongoRetry` só serve para operações IDEMPOTENTES — leituras e
 * escritas que reaplicam o mesmo `$set`. Nunca envolva `$inc`, `push` de array
 * ou qualquer escrita acumulativa: um timeout pode acontecer DEPOIS de o servidor
 * ter aplicado a operação, e a re-tentativa aplicaria de novo.
 */
import logger from '../config/logger.js';
import { withRetry } from './resilience.js';

// Nomes de erro do driver/mongoose que sempre indicam problema de transporte,
// nunca de dado. `PoolClearedError` entra porque o driver esvazia o pool quando
// perde o servidor: as operações em voo falham, mas a próxima já reconecta.
const TRANSIENT_ERROR_NAMES = new Set([
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
    'MongoTopologyClosedError',
    'MongoNotConnectedError',
    'MongoExpiredSessionError',
    'PoolClearedError',
    'MongoPoolClearedError',
]);

// Nem todo erro de transporte chega com nome útil: mongoose reembrulha vários
// como `MongoError`/`Error` genérico e só a mensagem denuncia a causa. Os dois
// casos vistos no run de 22/08 estão cobertos aqui: o handshake que estourou
// (`Socket 'secureConnect' timed out`) e o monitor que caiu (`connection
// <monitor> to 89.192.9.78:27017 closed`).
const TRANSIENT_MESSAGE_RE = new RegExp([
    'timed out', 'timeout',
    'connection .*closed', 'connection closed', 'socket',
    'server selection', 'topology', 'no primary', 'not connected',
    'pool .*cleared', 'client .*closed',
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EAI_AGAIN',
    'getaddrinfo',
].join('|'), 'i');

/** Erro de conexão/transporte (vale re-tentar) vs. erro de dado (não vale). */
export const isTransientMongoError = (err) => {
    if (!err) return false;
    if (TRANSIENT_ERROR_NAMES.has(err.name)) return true;
    // Rótulos oficiais do driver: o servidor está dizendo "pode re-tentar".
    if (typeof err.hasErrorLabel === 'function'
        && (err.hasErrorLabel('RetryableWriteError') || err.hasErrorLabel('TransientTransactionError'))) {
        return true;
    }
    return TRANSIENT_MESSAGE_RE.test(String(err.message ?? ''));
};

// Backoff pensado para queda de link, não para contenção: a primeira re-tentativa
// espera ~1s e a última ~8s, dando à malha tempo de refazer o handshake. 3 tentativas
// extras cobrem folgadamente um flap; além disso o problema não é mais transitório.
export const MONGO_RETRY_DEFAULTS = { retries: 3, baseDelayMs: 1000, factor: 2, maxDelayMs: 8000 };

/**
 * Executa uma operação Mongo IDEMPOTENTE re-tentando quedas transitórias.
 * Erro não transitório (ou re-tentativas esgotadas) é propagado intacto — quem
 * chama decide se aquilo aborta o run.
 */
export const withMongoRetry = (fn, { label = 'mongo', ...opts } = {}) => withRetry(fn, {
    ...MONGO_RETRY_DEFAULTS,
    ...opts,
    shouldRetry: isTransientMongoError,
    onRetry: (err, attempt, delay) => {
        logger.warn(`🔁 [Mongo] ${label}: queda transitória (${err.message}). `
            + `Tentativa ${attempt} em ${delay}ms.`);
    },
});
