/**
 * Desligamento gracioso — a instância fecha o que ELA abriu antes de sair.
 * Sem isto, todo deploy deixava JobRun órfão (CRITICAL no painel) e lease preso.
 */
import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler, SHUTDOWN_ERROR } from '../utils/gracefulShutdown.js';

const deps = (overrides = {}) => {
    const d = {
        server: { close: vi.fn((cb) => cb()), closeIdleConnections: vi.fn() },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        instanceId: 'host#42',
        leaseOwner: 'host#42',
        JobRun: { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }) },
        JobLease: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }) },
        mongoose: { connection: { readyState: 1 }, disconnect: vi.fn().mockResolvedValue() },
        Sentry: { close: vi.fn().mockResolvedValue(true) },
        exit: vi.fn(),
        ...overrides,
    };
    return d;
};

describe('createShutdownHandler', () => {
    it('fecha HTTP, marca só as execuções DESTA instância, solta os leases dela e sai 0', async () => {
        const d = deps();
        await createShutdownHandler(d)('SIGTERM');
        expect(d.server.close).toHaveBeenCalled();
        expect(d.JobRun.updateMany).toHaveBeenCalledWith(
            { status: 'RUNNING', instance: 'host#42' },
            { $set: expect.objectContaining({ status: 'FAILED', error: SHUTDOWN_ERROR }) },
        );
        expect(d.JobLease.deleteMany).toHaveBeenCalledWith({ owner: 'host#42' });
        expect(d.mongoose.disconnect).toHaveBeenCalled();
        expect(d.Sentry.close).toHaveBeenCalled();
        expect(d.exit).toHaveBeenCalledWith(0);
    });

    it('é idempotente: SIGTERM + SIGINT não rodam duas vezes', async () => {
        const d = deps();
        const h = createShutdownHandler(d);
        await Promise.all([h('SIGTERM'), h('SIGINT')]);
        expect(d.JobRun.updateMany).toHaveBeenCalledTimes(1);
        expect(d.exit).toHaveBeenCalledTimes(1);
    });

    it('uma etapa que falha não impede as outras nem a saída', async () => {
        const d = deps({ JobRun: { updateMany: vi.fn().mockRejectedValue(new Error('rede')) } });
        await createShutdownHandler(d)('SIGTERM');
        expect(d.JobLease.deleteMany).toHaveBeenCalled();
        expect(d.exit).toHaveBeenCalledWith(0);
    });

    it('sem banco conectado, não tenta gravar', async () => {
        const d = deps({ mongoose: { connection: { readyState: 0 }, disconnect: vi.fn() } });
        await createShutdownHandler(d)('SIGTERM');
        expect(d.JobRun.updateMany).not.toHaveBeenCalled();
        expect(d.exit).toHaveBeenCalledWith(0);
    });
});
