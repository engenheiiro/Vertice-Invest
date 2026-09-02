import JobCheckpoint from '../models/JobCheckpoint.js';
import logger from '../config/logger.js';

export const loadCompletedCheckpoints = async (jobId, runKey) => {
    try {
        const rows = await JobCheckpoint.find({ jobId, runKey, status: 'SUCCESS' })
            .select('itemKey')
            .lean();
        return new Set(rows.map((row) => String(row.itemKey)));
    } catch (error) {
        logger.warn(`[Checkpoint] Falha ao ler ${jobId}/${runKey}: ${error.message}`);
        return new Set();
    }
};

export const saveCheckpoint = async (
    jobId,
    runKey,
    itemKey,
    { status, result = null, error = null },
) => {
    try {
        await JobCheckpoint.updateOne(
            { jobId, runKey, itemKey: String(itemKey) },
            {
                $set: {
                    status,
                    result,
                    error: error ? String(error).slice(0, 500) : null,
                    updatedAt: new Date(),
                },
            },
            { upsert: true },
        );
        return true;
    } catch (checkpointError) {
        logger.warn(`[Checkpoint] Falha ao gravar ${jobId}/${runKey}/${itemKey}: ${checkpointError.message}`);
        return false;
    }
};
