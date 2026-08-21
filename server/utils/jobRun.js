/**
 * Instrumentação de execução de job.
 *
 * `trackJob` embrulha a função de um cron (ou de um sync manual) e grava início,
 * fim, duração e erro num `JobRun`. É o que alimenta o check de ROTINAS da
 * sentinela — sem isso não há como distinguir "cron rodou e não achou nada" de
 * "cron não rodou".
 *
 * Duas garantias:
 *  1. A instrumentação nunca altera o comportamento do job: erro de gravação é
 *     engolido, e o erro original é re-lançado tal como veio.
 *  2. Nunca engole o erro do job em silêncio — registra no ErrorLog e relança,
 *     preservando o try/catch que o chamador já tinha.
 */
import os from 'os';
import mongoose from 'mongoose';
import JobRun from '../models/JobRun.js';
import logger from '../config/logger.js';
import { getJobLabel } from '../config/jobCatalog.js';
import { recordJobError } from '../services/errorLogService.js';

const canPersist = () => mongoose.connection?.readyState === 1;

// Identidade da instância que grava a execução. Resolvida uma vez: hostname não
// muda em runtime e a chamada é síncrona.
const INSTANCE_ID = `${os.hostname()}#${process.pid}`;

const safeCreate = async (doc) => {
    if (!canPersist()) return null;
    try {
        return await JobRun.create(doc);
    } catch (err) {
        logger.debug(`[JobRun] Falha ao abrir execução de ${doc.jobId}: ${err.message}`);
        return null;
    }
};

const safeClose = async (runId, patch) => {
    if (!runId || !canPersist()) return;
    try {
        await JobRun.updateOne({ _id: runId }, { $set: patch });
    } catch (err) {
        logger.debug(`[JobRun] Falha ao fechar execução: ${err.message}`);
    }
};

/**
 * Executa `fn` registrando a execução como JobRun.
 * `fn` pode devolver `{ jobMeta }` — qualquer objeto vira `meta` no registro.
 *
 * Convenção de falha silenciosa: vários serviços daqui (syncService à frente)
 * capturam o próprio erro e RESOLVEM com `{ success: false, error }` em vez de
 * lançar. Sem tratar esse caso, a execução seria gravada como SUCCESS e o painel
 * mostraria verde num sync que não trouxe dado nenhum — exatamente o tipo de
 * falha silenciosa que este registro existe para acabar.
 */
export const trackJob = async (jobId, fn) => {
    const startedAt = new Date();
    const run = await safeCreate({
        jobId,
        label: getJobLabel(jobId),
        startedAt,
        status: 'RUNNING',
        instance: INSTANCE_ID,
    });

    try {
        const result = await fn();
        const finishedAt = new Date();
        const reportedFailure = result && typeof result === 'object' && result.success === false;
        await safeClose(run?._id, {
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            status: reportedFailure ? 'FAILED' : 'SUCCESS',
            error: reportedFailure ? String(result.error || 'falha sem detalhe').slice(0, 500) : null,
            meta: result && typeof result === 'object' ? result.jobMeta ?? null : null,
        });
        // O resultado segue intacto para o chamador — só o registro muda.
        if (reportedFailure) {
            await recordJobError(jobId, { message: result.error || 'falha sem detalhe', code: 'JOB_REPORTED_FAILURE' });
        }
        return result;
    } catch (error) {
        const finishedAt = new Date();
        await safeClose(run?._id, {
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            status: 'FAILED',
            error: String(error?.message || error).slice(0, 500),
        });
        await recordJobError(jobId, error);
        throw error;
    }
};

/**
 * Variante que não propaga a exceção — para crons cujo corpo já tinha try/catch
 * próprio e cuja falha não deve derrubar o tick do scheduler.
 */
export const trackJobSafe = async (jobId, fn) => {
    try {
        return await trackJob(jobId, fn);
    } catch (error) {
        logger.error(`❌ [Job ${jobId}] ${error.message}`);
        return null;
    }
};
