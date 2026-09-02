import mongoose from 'mongoose';

const TX_TIMEOUT_MS = 30_000;

/**
 * Throw inside a runTransaction callback to produce an HTTP error response
 * without going through the generic error handler.
 */
export function txError(httpStatus, message) {
    return Object.assign(new Error(message), { httpStatus });
}

/**
 * Runs `fn(session)` inside a MongoDB transaction with a hard timeout.
 * Commits on success, aborts on failure or timeout, always ends the session.
 *
 * Usage:
 *   await runTransaction(async (session) => {
 *       await Model.create([doc], { session });
 *   });
 *
 * For HTTP-mapped early exits, throw txError(statusCode, message) inside fn.
 * Check error.httpStatus in the caller's catch block.
 */
export async function runTransaction(fn, timeoutMs = TX_TIMEOUT_MS) {
    const session = await mongoose.startSession();
    session.startTransaction({ maxCommitTimeMS: timeoutMs });

    let timer;
    let workPromise;
    try {
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(Object.assign(
                    new Error(`MongoDB transaction timed out after ${timeoutMs}ms`),
                    { code: 'TX_TIMEOUT' }
                )),
                timeoutMs
            );
        });

        // Encapsula também throws síncronos e mantém uma referência à operação.
        // Promise.race não cancela a promessa perdedora: sem esta referência, o
        // finally encerrava a sessão enquanto fn(session) ainda podia escrever.
        workPromise = Promise.resolve().then(() => fn(session));
        await Promise.race([workPromise, timeout]);
        clearTimeout(timer);
        await session.commitTransaction();
    } catch (err) {
        clearTimeout(timer);
        try {
            await session.abortTransaction();
        } catch (abortError) {
            // A falha de rollback é contexto operacional importante, mas nunca
            // deve esconder a causa original que levou a transação a abortar.
            err.abortError = abortError;
        }

        // O timeout inicia o rollback, mas não torna `fn` magicamente cancelada.
        // Aguarda a operação observar o abort/terminar antes de liberar a sessão.
        // Se ela falhar depois do timeout, preserva TX_TIMEOUT como causa pública
        // e anexa a falha tardia apenas como contexto de diagnóstico.
        if (err.code === 'TX_TIMEOUT' && workPromise) {
            try {
                await workPromise;
            } catch (callbackError) {
                if (callbackError !== err) err.callbackError = callbackError;
            }
        }
        throw err;
    } finally {
        await session.endSession();
    }
}
