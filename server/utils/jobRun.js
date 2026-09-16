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
import { getJobLabel, getJobMaxRuntimeMs } from '../config/jobCatalog.js';
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

/** Folga mínima sobre o teto do job antes de considerar uma execução órfã. */
const ORPHAN_GRACE_MS = 30 * 60 * 1000;

export const ORPHAN_ERROR = 'Execução órfã: o processo que a abriu não existe mais (reinício/deploy no meio do job).';

/**
 * Fecha execuções que ficaram ABERTAS num processo que já morreu.
 *
 * Quem abre um `JobRun` é quem o fecha. Quando o processo morre no meio — deploy,
 * reinício, OOM — não sobra ninguém para fechar, e a linha fica em RUNNING para
 * sempre. Eram 29 delas em 16/09/2026.
 *
 * Isso não é contabilidade: a sentinela lê a ÚLTIMA execução de cada job, então
 * uma órfã recente faz o painel dizer "execução travada segura memória do
 * processo" sobre um processo que já reiniciou — alarme certo pelo motivo errado,
 * que é o tipo de aviso que ensina a ignorar o painel. Fechada como FAILED, a
 * mesma linha diz a verdade: a rotina daquele dia não terminou.
 *
 * DUAS CONDIÇÕES, e as duas importam porque o banco é compartilhado (Render Cron
 * Jobs e `sync:prod` rodam em processos próprios):
 *
 *  - `instance` diferente da minha: nunca fecho o que EU abri e ainda estou
 *    rodando.
 *  - mais velha que o teto do job + folga: com o watchdog, nenhuma execução viva
 *    passa do próprio teto sem ser derrubada por quem a abriu. Passou disso e não
 *    é minha, o dono não existe mais.
 *
 * `durationMs` fica NULO de propósito: sabemos quando a execução começou e que
 * ela não terminou — a hora em que o processo morreu, não. Preencher com "agora
 * menos o começo" inventaria uma duração de dias e envenenaria a medição que
 * calibra os tetos.
 */
export const closeOrphanRuns = async (now = new Date()) => {
    if (!canPersist()) return { closed: 0 };

    try {
        const abertas = await JobRun.find({
            status: 'RUNNING',
            instance: { $ne: INSTANCE_ID },
        }).select('jobId startedAt instance').lean();

        const orfas = abertas.filter(({ jobId, startedAt }) => {
            const limite = Math.max(getJobMaxRuntimeMs(jobId), ORPHAN_GRACE_MS);
            return now.getTime() - new Date(startedAt).getTime() > limite;
        });

        if (!orfas.length) return { closed: 0 };

        await JobRun.updateMany(
            { _id: { $in: orfas.map((o) => o._id) } },
            { $set: { status: 'FAILED', finishedAt: now, durationMs: null, error: ORPHAN_ERROR } },
        );

        const porJob = [...new Set(orfas.map((o) => o.jobId))].join(', ');
        logger.warn(`🧹 [JobRun] ${orfas.length} execução(ões) órfã(s) fechada(s) no boot: ${porJob}.`);
        return { closed: orfas.length };
    } catch (err) {
        logger.warn(`[JobRun] Varredura de execuções órfãs falhou: ${err.message}`);
        return { closed: 0 };
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
        const reportedSkip = result && typeof result === 'object' && result.skipped === true;
        await safeClose(run?._id, {
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            status: reportedSkip ? 'SKIPPED' : reportedFailure ? 'FAILED' : 'SUCCESS',
            error: reportedFailure ? String(result.error || 'falha sem detalhe').slice(0, 500) : null,
            meta: result && typeof result === 'object'
                ? result.jobMeta ?? (reportedSkip ? { reason: result.reason || 'SKIPPED' } : null)
                : null,
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
