/**
 * DESLIGAMENTO GRACIOSO (SIGTERM/SIGINT).
 *
 * Sem isto, o SIGTERM do deploy matava o Node na hora:
 *  - todo `JobRun` em RUNNING ficava órfão (ninguém mais para fechá-lo) — era a
 *    origem do CRITICAL "Execução órfã" do painel de Saúde;
 *  - todo `JobLease` desta instância continuava válido por até 30 min, e o
 *    primeiro cron da instância nova era SKIPPED por "lease de outra instância";
 *  - requisições HTTP em andamento eram cortadas no meio.
 *
 * Aqui a instância fecha o que ELA abriu: para de aceitar conexão, marca as
 * próprias execuções como interrompidas (com o motivo verdadeiro), solta os
 * próprios leases, esvazia o Sentry e sai. Um teto duro garante a saída mesmo
 * que alguma etapa trave — o Render dá ~30s entre SIGTERM e SIGKILL.
 */
export const SHUTDOWN_ERROR = 'Interrompida pelo desligamento do processo (deploy/reinício) antes de terminar.';
export const SHUTDOWN_HARD_TIMEOUT_MS = 20_000;

/**
 * @param {object} deps — injetáveis para teste.
 * @returns {(signal: string) => Promise<void>} handler idempotente.
 */
export const createShutdownHandler = ({
    server,
    logger,
    instanceId,
    leaseOwner,
    JobRun,
    JobLease,
    mongoose,
    Sentry,
    exit = (code) => process.exit(code),
    hardTimeoutMs = SHUTDOWN_HARD_TIMEOUT_MS,
}) => {
    let started = false;
    const step = async (label, fn) => {
        try {
            await fn();
        } catch (err) {
            logger?.warn?.(`[Shutdown] ${label} falhou: ${err.message}`);
        }
    };

    return async (signal) => {
        if (started) return;
        started = true;
        logger?.info?.(`🛑 [Shutdown] ${signal} recebido — encerrando com elegância...`);
        const hard = setTimeout(() => {
            logger?.error?.('[Shutdown] Teto de desligamento estourado — saindo à força.');
            exit(1);
        }, hardTimeoutMs);
        hard.unref?.();

        await step('fechar HTTP', () => new Promise((resolve) => {
            if (!server?.close) return resolve();
            server.close(() => resolve());
            // Conexões keep-alive ociosas não podem segurar o desligamento.
            server.closeIdleConnections?.();
        }));

        if (mongoose?.connection?.readyState === 1) {
            await step('fechar JobRun', async () => {
                const r = await JobRun.updateMany(
                    { status: 'RUNNING', instance: instanceId },
                    { $set: { status: 'FAILED', finishedAt: new Date(), error: SHUTDOWN_ERROR } },
                );
                if (r?.modifiedCount) logger?.warn?.(`[Shutdown] ${r.modifiedCount} execução(ões) marcada(s) como interrompida(s).`);
            });
            await step('soltar leases', async () => {
                const r = await JobLease.deleteMany({ owner: leaseOwner });
                if (r?.deletedCount) logger?.info?.(`[Shutdown] ${r.deletedCount} lease(s) liberado(s).`);
            });
            await step('desconectar Mongo', () => mongoose.disconnect());
        }

        await step('esvaziar Sentry', () => Sentry?.close?.(2000));
        clearTimeout(hard);
        exit(0);
    };
};
