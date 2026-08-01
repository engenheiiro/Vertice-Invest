import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  deleteMany: vi.fn(),
  insertMany: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../utils/dbTransaction.js', () => ({ runTransaction: mocks.runTransaction }));
vi.mock('../models/WalletSnapshot.js', () => ({
  default: { deleteMany: mocks.deleteMany, insertMany: mocks.insertMany },
}));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: mocks.loggerError, warn: vi.fn(), debug: vi.fn() },
}));

const { financialService } = await import('../services/financialService.js');

describe('financialService._persistSnapshots V5 — atomicidade e escala', () => {
  const session = { id: 'session-v5' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback(session));
    mocks.deleteMany.mockReturnValue({ session: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    mocks.insertMany.mockResolvedValue([]);
  });

  it('limpa histórico dentro da transação mesmo quando a reconstrução fica vazia', async () => {
    await financialService._persistSnapshots('u1', 'w1', []);

    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    expect(mocks.deleteMany.mock.results[0].value.session).toHaveBeenCalledWith(session);
    expect(mocks.insertMany).not.toHaveBeenCalled();
  });

  it('insere em lotes de no máximo 5.000 preservando a sessão', async () => {
    const snapshots = Array.from({ length: 10_001 }, (_, index) => ({ dayKey: `d${index}` }));
    await financialService._persistSnapshots('u1', 'w1', snapshots);

    expect(mocks.insertMany).toHaveBeenCalledTimes(3);
    expect(mocks.insertMany.mock.calls.map(([batch]) => batch.length)).toEqual([5_000, 5_000, 1]);
    expect(mocks.insertMany.mock.calls.every(([, options]) => options.session === session)).toBe(true);
  });

  it('não engole falha do delete, insert ou wrapper transacional', async () => {
    const deleteFailure = new Error('delete failed');
    mocks.deleteMany.mockReturnValueOnce({ session: vi.fn().mockRejectedValue(deleteFailure) });
    await expect(financialService._persistSnapshots('u1', 'w1', [{}])).rejects.toBe(deleteFailure);

    mocks.deleteMany.mockReturnValue({ session: vi.fn().mockResolvedValue({}) });
    const insertFailure = new Error('insert failed');
    mocks.insertMany.mockRejectedValueOnce(insertFailure);
    await expect(financialService._persistSnapshots('u1', 'w1', [{}])).rejects.toBe(insertFailure);

    const transactionFailure = new Error('transaction unavailable');
    mocks.runTransaction.mockRejectedValueOnce(transactionFailure);
    await expect(financialService._persistSnapshots('u1', 'w1', [{}])).rejects.toBe(transactionFailure);
  });
});
