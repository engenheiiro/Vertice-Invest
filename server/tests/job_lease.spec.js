import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  deleteOne: vi.fn(),
}));

vi.mock('../models/JobLease.js', () => ({
  default: {
    findOneAndUpdate: mocks.findOneAndUpdate,
    updateOne: mocks.updateOne,
    deleteOne: mocks.deleteOne,
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { withJobLease } = await import('../utils/jobLease.js');

describe('Fase 3 — lease distribuído', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });

  it('executa somente um corpo quando duas instâncias disputam o mesmo job', async () => {
    let locked = false;
    mocks.findOneAndUpdate.mockImplementation((_filter, update) => ({
      lean: async () => {
        if (locked) throw Object.assign(new Error('duplicate'), { code: 11000 });
        locked = true;
        return update.$set;
      },
    }));
    mocks.deleteOne.mockImplementation(async () => {
      locked = false;
      return { deletedCount: 1 };
    });

    let releaseFirst;
    const firstBody = vi.fn(() => new Promise((resolve) => { releaseFirst = resolve; }));
    const secondBody = vi.fn(async () => 'duplicado');

    const first = withJobLease('daily-snapshot', firstBody);
    await vi.waitFor(() => expect(firstBody).toHaveBeenCalledOnce());
    const second = await withJobLease('daily-snapshot', secondBody);

    expect(second).toEqual({ skipped: true, reason: 'LEASE_HELD' });
    expect(secondBody).not.toHaveBeenCalled();

    releaseFirst('ok');
    await expect(first).resolves.toBe('ok');
    expect(mocks.deleteOne).toHaveBeenCalledOnce();
  });

  it('falha fechada: erro do banco não autoriza execução duplicada', async () => {
    mocks.findOneAndUpdate.mockReturnValue({ lean: async () => { throw new Error('db down'); } });
    const body = vi.fn();

    await expect(withJobLease('quotes-sync', body)).resolves.toMatchObject({
      skipped: true,
      reason: 'LEASE_ERROR',
    });
    expect(body).not.toHaveBeenCalled();
  });
});
