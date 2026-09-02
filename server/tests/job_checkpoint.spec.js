import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), updateOne: vi.fn() }));
vi.mock('../models/JobCheckpoint.js', () => ({
  default: { find: mocks.find, updateOne: mocks.updateOne },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { loadCompletedCheckpoints, saveCheckpoint } = await import('../utils/jobCheckpoint.js');

describe('Fase 3 — checkpoint recuperável', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carrega somente itens SUCCESS do mesmo job/run para retomada', async () => {
    const lean = vi.fn().mockResolvedValue([{ itemKey: 'w1' }, { itemKey: 'w3' }]);
    const select = vi.fn().mockReturnValue({ lean });
    mocks.find.mockReturnValue({ select });

    const completed = await loadCompletedCheckpoints('daily-snapshot', '2026-09-01');

    expect(mocks.find).toHaveBeenCalledWith({
      jobId: 'daily-snapshot', runKey: '2026-09-01', status: 'SUCCESS',
    });
    expect([...completed]).toEqual(['w1', 'w3']);
  });

  it('upsert torna o progresso idempotente por carteira', async () => {
    mocks.updateOne.mockResolvedValue({ acknowledged: true });
    await expect(saveCheckpoint('daily-snapshot', '2026-09-01', 'w1', {
      status: 'SUCCESS', result: 'created',
    })).resolves.toBe(true);

    expect(mocks.updateOne).toHaveBeenCalledWith(
      { jobId: 'daily-snapshot', runKey: '2026-09-01', itemKey: 'w1' },
      { $set: expect.objectContaining({ status: 'SUCCESS', result: 'created', error: null }) },
      { upsert: true },
    );
  });

  it('falha do checkpoint não derruba o trabalho financeiro idempotente', async () => {
    mocks.updateOne.mockRejectedValue(new Error('db down'));
    await expect(saveCheckpoint('daily-snapshot', '2026-09-01', 'w1', {
      status: 'FAILED', error: 'snapshot error',
    })).resolves.toBe(false);
  });
});
