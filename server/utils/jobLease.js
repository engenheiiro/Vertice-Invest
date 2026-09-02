import os from 'os';
import { randomUUID } from 'crypto';
import JobLease from '../models/JobLease.js';
import logger from '../config/logger.js';

export const JOB_LEASE_MS = 30 * 60 * 1000;
export const JOB_LEASE_OWNER = `${os.hostname()}#${process.pid}`;

const duplicateKey = (error) => error?.code === 11000;

export const acquireJobLease = async (
    jobId,
    { now = new Date(), leaseMs = JOB_LEASE_MS, owner = JOB_LEASE_OWNER, token = randomUUID() } = {},
) => {
    const expiresAt = new Date(now.getTime() + leaseMs);
    try {
        // Garante o índice único antes da primeira disputa, inclusive em scripts
        // standalone que não passam pelo connectDB do servidor web.
        await JobLease.init?.();
        const lease = await JobLease.findOneAndUpdate(
            { jobId, expiresAt: { $lte: now } },
            {
                $set: { owner, token, acquiredAt: now, heartbeatAt: now, expiresAt },
                $setOnInsert: { jobId },
            },
            { upsert: true, new: true },
        ).lean();
        return lease?.token === token ? { acquired: true, jobId, owner, token, expiresAt } : { acquired: false, jobId };
    } catch (error) {
        // O lease ainda está válido: o upsert disputa o índice único de jobId e
        // perde com E11000. Isso é contenção normal, não falha operacional.
        if (duplicateKey(error)) return { acquired: false, jobId };
        throw error;
    }
};

export const renewJobLease = async (lease, leaseMs = JOB_LEASE_MS) => {
    const now = new Date();
    const result = await JobLease.updateOne(
        { jobId: lease.jobId, owner: lease.owner, token: lease.token },
        { $set: { heartbeatAt: now, expiresAt: new Date(now.getTime() + leaseMs) } },
    );
    return result.modifiedCount === 1;
};

export const releaseJobLease = async (lease) => {
    const result = await JobLease.deleteOne({ jobId: lease.jobId, owner: lease.owner, token: lease.token });
    return result.deletedCount === 1;
};

/** Executa fn somente na instância que adquiriu o lease atômico no Mongo. */
export const withJobLease = async (jobId, fn, { leaseMs = JOB_LEASE_MS } = {}) => {
    let lease;
    try {
        lease = await acquireJobLease(jobId, { leaseMs });
    } catch (error) {
        // Falha fechada: sem coordenação não é seguro executar um job destrutivo
        // em duas instâncias. O próximo tick tenta novamente.
        logger.error(`[JobLease] Falha ao adquirir '${jobId}': ${error.message}`);
        return { skipped: true, reason: 'LEASE_ERROR', error: error.message };
    }

    if (!lease.acquired) {
        logger.info(`⏭️ Job '${jobId}' ignorado: lease mantido por outra instância.`);
        return { skipped: true, reason: 'LEASE_HELD' };
    }

    const heartbeatMs = Math.max(1000, Math.floor(leaseMs / 3));
    const heartbeat = setInterval(() => {
        renewJobLease(lease, leaseMs).catch((error) => {
            logger.error(`[JobLease] Falha ao renovar '${jobId}': ${error.message}`);
        });
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
        return await fn();
    } finally {
        clearInterval(heartbeat);
        try {
            await releaseJobLease(lease);
        } catch (error) {
            logger.error(`[JobLease] Falha ao liberar '${jobId}': ${error.message}`);
        }
    }
};
