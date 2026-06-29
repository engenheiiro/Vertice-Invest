/**
 * Meta de Renda Passiva — updateWalletTargets persiste targetMonthlyDividendIncome
 * e getWalletDividends expõe goal{target,current,progressPercent} a partir dela.
 * Sem rede/DB — mongoose, models e financialService são mockados.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('mongoose', () => ({ default: { startSession: vi.fn() } }));
vi.mock('../utils/dbTransaction.js', () => ({ runTransaction: vi.fn(), txError: vi.fn() }));
vi.mock('../models/User.js', () => ({
  default: { findByIdAndUpdate: vi.fn(), findById: vi.fn() },
}));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/TreasuryBond.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/financialService.js', () => ({
  financialService: { calculateUserDividends: vi.fn() },
}));
vi.mock('../services/schedulerService.js', () => ({ runDailySnapshot: vi.fn() }));
vi.mock('../utils/dateUtils.js', () => ({
  countBusinessDays: vi.fn(), isBusinessDay: vi.fn(), toDateKey: vi.fn(), startOfDay: vi.fn(),
}));
vi.mock('../utils/fixedIncome.js', () => ({
  accrueFixedIncomeValue: vi.fn(), fixedIncomeDailyFactor: vi.fn(), assetDailyFactor: vi.fn(),
  brazilToday: vi.fn(), brazilDateOnly: vi.fn(),
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { updateWalletTargets, getWalletDividends } = await import('../controllers/walletController.js');
const User = (await import('../models/User.js')).default;
const { financialService } = await import('../services/financialService.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const emptyDividendData = (overrides = {}) => ({
  dividendMap: new Map(),
  provisioned: [],
  totalAllTime: 0,
  projectedMonthly: 0,
  yieldOnCost: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateWalletTargets — targetMonthlyDividendIncome', () => {
  it('persiste a meta quando enviada no body', async () => {
    User.findByIdAndUpdate.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ targetMonthlyDividendIncome: 500 }) }),
    });
    const req = { user: { id: 'u1' }, body: { targetMonthlyDividendIncome: 500 } };
    const res = mockRes();

    await updateWalletTargets(req, res, vi.fn());

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { $set: { targetMonthlyDividendIncome: 500 } },
      { new: true },
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ targetMonthlyDividendIncome: 500 }));
  });

  it('não toca o campo quando ausente do body', async () => {
    User.findByIdAndUpdate.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({}) }),
    });
    const req = { user: { id: 'u1' }, body: {} };
    const res = mockRes();

    await updateWalletTargets(req, res, vi.fn());

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('u1', { $set: {} }, { new: true });
  });
});

describe('getWalletDividends — goal', () => {
  it('sem meta definida (0) → progressPercent null', async () => {
    financialService.calculateUserDividends.mockResolvedValue(emptyDividendData());
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ targetMonthlyDividendIncome: 0 }) }) });
    const req = { user: { id: 'u1' } };
    const res = mockRes();

    await getWalletDividends(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.goal).toEqual({ target: 0, current: 0, progressPercent: null });
  });

  it('meta R$500, projeção R$250 → progressPercent 50', async () => {
    financialService.calculateUserDividends.mockResolvedValue(emptyDividendData({ projectedMonthly: 250 }));
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ targetMonthlyDividendIncome: 500 }) }) });
    const req = { user: { id: 'u1' } };
    const res = mockRes();

    await getWalletDividends(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.goal).toEqual({ target: 500, current: 250, progressPercent: 50 });
  });

  it('meta R$100, projeção R$300 → progressPercent capado em 100', async () => {
    financialService.calculateUserDividends.mockResolvedValue(emptyDividendData({ projectedMonthly: 300 }));
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ targetMonthlyDividendIncome: 100 }) }) });
    const req = { user: { id: 'u1' } };
    const res = mockRes();

    await getWalletDividends(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.goal.progressPercent).toBe(100);
  });

  it('usa a soma das provisões do mês como current quando há provisões', async () => {
    financialService.calculateUserDividends.mockResolvedValue(emptyDividendData({
      provisioned: [{ ticker: 'TAEE11', amount: 30 }, { ticker: 'BBAS3', amount: 20 }],
      projectedMonthly: 80,
    }));
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ targetMonthlyDividendIncome: 100 }) }) });
    const req = { user: { id: 'u1' } };
    const res = mockRes();

    await getWalletDividends(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    // Provisões (30+20=50) têm prioridade sobre projectedMonthly → 50/100 = 50%.
    expect(payload.goal.current).toBe(50);
    expect(payload.goal.progressPercent).toBe(50);
  });

  it('NÃO usa totalAllTime (acumulado vitalício) contra a meta mensal', async () => {
    // Acumulado alto (1200) mas sem provisões e com fluxo mensal baixo (30):
    // a barra deve refletir 30/600 = 5%, não estourar em 100% por causa do acumulado.
    financialService.calculateUserDividends.mockResolvedValue(emptyDividendData({ totalAllTime: 1200, projectedMonthly: 30 }));
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ targetMonthlyDividendIncome: 600 }) }) });
    const req = { user: { id: 'u1' } };
    const res = mockRes();

    await getWalletDividends(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.goal.current).toBe(30);
    expect(payload.goal.progressPercent).toBe(5);
  });
});
