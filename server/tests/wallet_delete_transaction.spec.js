/**
 * I11 — atomicidade de deleteTransaction.
 * Garante que o delete da transação e o recálculo da posição ocorrem na MESMA
 * sessão Mongo: commit no caminho feliz, abort se o recálculo falhar (ex.: saldo
 * insuficiente) e abort + 404 quando a transação não existe. Sem rede/DB —
 * mongoose, models e financialService são mockados.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = {
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  abortTransaction: vi.fn(),
  endSession: vi.fn(),
};

vi.mock('mongoose', () => ({
  default: { startSession: vi.fn(() => Promise.resolve(session)) },
}));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetTransaction.js', () => ({
  default: { findOneAndDelete: vi.fn() },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/TreasuryBond.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/financialService.js', () => ({
  financialService: { recalculatePosition: vi.fn(), rebuildUserHistory: vi.fn() },
}));
vi.mock('../services/schedulerService.js', () => ({ runDailySnapshot: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { deleteTransaction } = await import('../controllers/walletController.js');
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const { financialService } = await import('../services/financialService.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  financialService.rebuildUserHistory.mockResolvedValue();
});

describe('deleteTransaction — atomicidade', () => {
  it('commita quando delete + recálculo têm sucesso', async () => {
    AssetTransaction.findOneAndDelete.mockResolvedValue({ ticker: 'PETR4' });
    financialService.recalculatePosition.mockResolvedValue({});
    // walletId simula o que o middleware resolveWallet já teria anexado a req.
    const req = { params: { id: 't1' }, user: { id: 'u1' }, walletId: 'w1' };
    const res = mockRes();

    await deleteTransaction(req, res, vi.fn());

    expect(AssetTransaction.findOneAndDelete).toHaveBeenCalledWith(
      { _id: 't1', user: 'u1', wallet: 'w1' },
      { session },
    );
    expect(financialService.recalculatePosition).toHaveBeenCalledWith('u1', 'PETR4', null, session, null, 'w1');
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Transação removida.' });
  });

  it('aborta (reverte o delete) quando o recálculo lança', async () => {
    AssetTransaction.findOneAndDelete.mockResolvedValue({ ticker: 'PETR4' });
    financialService.recalculatePosition.mockRejectedValue(new Error('Saldo insuficiente para PETR4.'));
    const req = { params: { id: 't1' }, user: { id: 'u1' }, walletId: 'w1' };
    const res = mockRes();
    const next = vi.fn();

    await deleteTransaction(req, res, next);

    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Saldo insuficiente para PETR4.' }));
  });

  it('aborta e responde 404 quando a transação não existe', async () => {
    AssetTransaction.findOneAndDelete.mockResolvedValue(null);
    const req = { params: { id: 'nope' }, user: { id: 'u1' }, walletId: 'w1' };
    const res = mockRes();

    await deleteTransaction(req, res, vi.fn());

    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(financialService.recalculatePosition).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
