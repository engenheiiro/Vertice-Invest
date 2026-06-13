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

        await Promise.race([fn(session), timeout]);
        clearTimeout(timer);
        await session.commitTransaction();
    } catch (err) {
        clearTimeout(timer);
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
}
