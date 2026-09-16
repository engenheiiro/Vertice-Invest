/**
 * Teto de duração de uma execução de job.
 *
 * O `JobRun` responde "rodou?" e o `JobLease` responde "rodou uma vez só?".
 * Faltava a terceira pergunta, que é a que ficou sem dono: "terminou?".
 *
 * Em 13, 14 e 15/09/2026 a rotina 'daily-morning' abriu execução às 09:00 e
 * nunca fechou — três `JobRun` em RUNNING para sempre, no mesmo processo. Nada
 * alarmou: a sentinela lê a ÚLTIMA execução e viu uma recente, o lease foi
 * renovado pelo heartbeat enquanto a execução estivesse viva, e o cron seguinte
 * encontrou o lease ocupado. Enquanto isso cada execução presa continuava
 * segurando na memória tudo o que tinha carregado, num processo de 512 MB.
 *
 * O watchdog não conserta a causa (isso é teto de tempo em cada chamada externa,
 * onde o defeito nasce) — ele impede que a causa vire permanente. Uma execução
 * que estoura o teto é DERRUBADA: o `JobRun` fecha como FAILED com o motivo, o
 * lease é liberado pelo `finally` de quem chamou, e a rotina do dia seguinte
 * encontra o caminho livre.
 *
 * POR QUE POR DENTRO DO LEASE. `withJobLease(jobId, () => withJobWatchdog(...))`,
 * nunca o contrário. O `finally` que libera o lease só roda quando a função
 * interna assenta; com o watchdog por FORA, a execução presa continuaria viva
 * por baixo, com o heartbeat renovando o lease indefinidamente — e o job nunca
 * mais rodaria, que é pior do que o defeito original.
 *
 * O QUE ELE NÃO FAZ: cancelar o trabalho pendurado. JavaScript não interrompe uma
 * promessa de fora, então a chamada travada continua lá até o socket dela cair.
 * O ganho é o resto: o alarme sai, o lease volta, e o próximo tick roda.
 */
import logger from '../config/logger.js';
import { getJobMaxRuntimeMs } from '../config/jobCatalog.js';

export class JobTimeoutError extends Error {
    constructor(jobId, timeoutMs) {
        super(`Execução de '${jobId}' passou do teto de ${Math.round(timeoutMs / 60000)} min e foi derrubada pelo watchdog`);
        this.name = 'JobTimeoutError';
        this.jobId = jobId;
        this.timeoutMs = timeoutMs;
    }
}

/**
 * Executa `fn` com teto de tempo. Sem `timeoutMs`, usa o do `jobCatalog`.
 *
 * @param {string} jobId chave do JOB_CATALOG
 * @param {Function} fn corpo do job
 * @param {{timeoutMs?: number}} [opts]
 */
export const withJobWatchdog = async (jobId, fn, { timeoutMs } = {}) => {
    const teto = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : getJobMaxRuntimeMs(jobId);

    let timer = null;
    const alarme = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError(jobId, teto)), teto);
        // Um timer pendurado não pode ser o que segura o processo vivo no fim.
        timer.unref?.();
    });

    try {
        // Promise.race trata as duas promessas, então a execução presa não vira
        // unhandledRejection quando (e se) ela finalmente falhar sozinha.
        return await Promise.race([fn(), alarme]);
    } catch (error) {
        if (error instanceof JobTimeoutError) {
            logger.error(`⏱️ [Watchdog] ${error.message}. A chamada presa segue pendurada até o socket dela cair; o lease foi liberado.`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
};
