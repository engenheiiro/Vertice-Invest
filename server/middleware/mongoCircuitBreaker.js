/**
 * (6.9) Circuit breaker ("disjuntor") para o MongoDB.
 *
 * Problema: quando o banco cai ou fica lento, cada request fica preso até o
 * `serverSelectionTimeout` (30s) e os pedidos ACUMULAM — esgotando event loop,
 * pool de conexões e memória até derrubar o processo. Este disjuntor faz
 * FAIL-FAST: enquanto a conexão não está saudável, as rotas dependentes de DB
 * respondem 503 na hora, em vez de enfileirar e esperar o timeout.
 *
 * O estado vem de duas fontes:
 *   1. mongoose.connection.readyState — a verdade da conexão (0=disconnected,
 *      1=connected, 2=connecting, 3=disconnecting).
 *   2. Um CircuitBreaker (utils/resilience) que conta falhas de conexão: abre o
 *      circuito após N quedas e dá um cooldown de HALF_OPEN antes de reabrir —
 *      útil quando a conexão "flapa" (cai e volta repetidamente).
 */
import mongoose from 'mongoose';
import { CircuitBreaker } from '../utils/resilience.js';
import logger from '../config/logger.js';

const breaker = new CircuitBreaker({ name: 'mongodb', failureThreshold: 3, cooldownMs: 15_000 });

/**
 * Liga o disjuntor aos eventos da conexão mongoose. Desconexão/erro contam como
 * falha; (re)conexão fecha o circuito. Idempotente o suficiente para 1 chamada
 * no boot (connectDB).
 */
export const attachMongoBreaker = (connection = mongoose.connection) => {
    connection.on('disconnected', () => breaker.recordFailure());
    connection.on('error', () => breaker.recordFailure());
    connection.on('connected', () => breaker.recordSuccess());
    connection.on('reconnected', () => breaker.recordSuccess());
};

/**
 * Decisão PURA (testável): rejeita a request se a conexão não está em
 * `connected` OU se o circuito está aberto.
 */
export const shouldRejectRequest = (readyState, breakerOpen) =>
    readyState !== 1 || breakerOpen;

export const isDbAvailable = () =>
    !shouldRejectRequest(mongoose.connection.readyState, breaker.isOpen);

export const getMongoBreakerState = () => ({
    circuit: breaker.state,
    failures: breaker.failures,
    readyState: mongoose.connection.readyState,
});

/**
 * Middleware Express: fail-fast 503 quando o banco está indisponível. Deve ser
 * montado ANTES das rotas que dependem de DB (e depois do /api/health, que
 * precisa responder mesmo com o banco fora).
 */
export const mongoCircuitBreaker = (req, res, next) => {
    if (isDbAvailable()) return next();

    logger.warn('🔌 [MongoCB] Request rejeitada (fail-fast): banco indisponível', {
        source: 'mongoCircuitBreaker',
        path: req.originalUrl,
        circuit: breaker.state,
        readyState: mongoose.connection.readyState,
    });

    res.set('Retry-After', '15');
    return res.status(503).json({
        message: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
        error: { code: 'DB_UNAVAILABLE' },
    });
};

// Exposto para testes (resetar estado entre casos).
export const _breaker = breaker;
