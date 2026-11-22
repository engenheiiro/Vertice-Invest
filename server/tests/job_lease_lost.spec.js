/**
 * Lease perdido durante a execução precisa aparecer no log. `renewJobLease`
 * devolve false quando outra instância tomou o lease (partição longa do Mongo),
 * e o heartbeat ignorava isso — dois donos rodando o mesmo job em silêncio.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn(), error: vi.fn() }));

vi.mock('../models/JobLease.js', () => ({
    default: { findOneAndUpdate: mocks.findOneAndUpdate, updateOne: mocks.updateOne, deleteOne: mocks.deleteOne },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: mocks.error, debug: vi.fn() },
}));

const { withJobLease } = await import('../utils/jobLease.js');

afterEach(() => vi.useRealTimers());

describe('withJobLease — lease perdido', () => {
    it('loga UMA vez em ERROR quando a renovação diz que o lease não é mais nosso', async () => {
        vi.useFakeTimers();
        mocks.findOneAndUpdate.mockImplementation((_f, update) => ({ lean: async () => update.$set }));
        mocks.updateOne.mockResolvedValue({ modifiedCount: 0 }); // outra instância tomou
        mocks.deleteOne.mockResolvedValue({ deletedCount: 0 });

        let release;
        const job = withJobLease('x-job', () => new Promise((r) => { release = r; }), { leaseMs: 3000 });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1000); // 1º heartbeat
        await vi.advanceTimersByTimeAsync(1000); // 2º heartbeat
        release('ok');
        await expect(job).resolves.toBe('ok');

        const perdidos = mocks.error.mock.calls.filter(([m]) => String(m).includes('PERDIDO'));
        expect(perdidos).toHaveLength(1);
    });
});
