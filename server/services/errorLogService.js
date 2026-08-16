/**
 * Persistência de erros do backend para o painel do Admin.
 *
 * Princípio inegociável: registrar erro NUNCA pode causar erro. Toda função aqui
 * engole a própria falha — um problema de escrita no ErrorLog não pode derrubar a
 * requisição ou o cron que estava só tentando reportar.
 */
import mongoose from 'mongoose';
import crypto from 'crypto';
import ErrorLog from '../models/ErrorLog.js';
import logger from '../config/logger.js';

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/**
 * Normaliza a mensagem para agrupar ocorrências do mesmo defeito.
 * Números, ObjectIds, UUIDs e aspas variam a cada ocorrência e não distinguem
 * o erro — sem isso, cada request cria uma linha nova e o painel vira ruído.
 */
export const normalizeMessage = (message = '') => String(message)
    .slice(0, MAX_MESSAGE)
    .replace(/[0-9a-f]{24}/gi, '<id>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();

export const buildFingerprint = ({ origin = 'HTTP', source = '', code = '', message = '' }) => {
    const basis = `${origin}|${source}|${code}|${normalizeMessage(message)}`;
    return crypto.createHash('sha1').update(basis).digest('hex');
};

/**
 * Grava (ou incrementa) uma ocorrência de erro.
 * Retorna true se persistiu, false se foi ignorado/falhou — o chamador não precisa
 * checar, mas o teste usa.
 */
export const recordError = async ({
    origin = 'HTTP',
    source = '',
    code = '',
    message = '',
    stack = null,
    statusCode = null,
} = {}) => {
    // Sem conexão o upsert ficaria pendurado no buffer do Mongoose até estourar
    // timeout — e o chamador já está num caminho de erro. Melhor desistir em silêncio.
    if (mongoose.connection?.readyState !== 1) return false;

    try {
        const fingerprint = buildFingerprint({ origin, source, code, message });
        const now = new Date();
        await ErrorLog.updateOne(
            { fingerprint },
            {
                $set: {
                    origin,
                    source: String(source).slice(0, 200),
                    code: String(code).slice(0, 100),
                    message: String(message).slice(0, MAX_MESSAGE),
                    stack: stack ? String(stack).slice(0, MAX_STACK) : null,
                    statusCode,
                    lastSeenAt: now,
                    // Reincidência reabre: erro que voltou não está resolvido.
                    resolvedAt: null,
                },
                $inc: { count: 1 },
                $setOnInsert: { fingerprint, firstSeenAt: now },
            },
            { upsert: true },
        );
        return true;
    } catch (err) {
        // Só um debug: subir para error criaria laço (erro ao registrar erro).
        logger.debug(`[ErrorLog] Falha ao registrar erro: ${err.message}`);
        return false;
    }
};

/** Atalho para falhas de job/cron. */
export const recordJobError = (jobId, error) => recordError({
    origin: 'JOB',
    source: jobId,
    code: error?.code ? String(error.code) : 'JOB_FAILED',
    message: error?.message || String(error),
    stack: error?.stack || null,
});

/**
 * Atalho para falhas de fonte externa (scraping/API de mercado).
 *
 * `code` explícito TEM precedência sobre `error.code`: o chamador está
 * classificando o defeito (layout mudou vs. fonte fora do ar), e o código nativo
 * do axios ('ERR_BAD_REQUEST') não distingue os dois — deixá-lo ganhar apagaria
 * justamente a informação que decide o conserto.
 */
export const recordIngestionError = (sourceName, error, code = null) => recordError({
    origin: 'INGESTION',
    source: sourceName,
    code: code || (error?.code ? String(error.code) : 'INGESTION_FAILED'),
    message: error?.message || String(error),
    stack: error?.stack || null,
});
