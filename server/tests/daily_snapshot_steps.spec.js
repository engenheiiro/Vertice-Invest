import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dividendFind: vi.fn(), exists: vi.fn(), captureMessage: vi.fn() }));

vi.mock('../models/DividendEvent.js', () => ({ default: { find: mocks.dividendFind } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: { exists: mocks.exists } }));
vi.mock('@sentry/node', () => ({ captureMessage: mocks.captureMessage }));
vi.mock('../config/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));

const {
  buildDailySnapshotPayload, dayDividendIncomeBRL, dietzQuotaForDay, isUndueQuotaReset,
} = await import('../services/snapshot/dailySnapshotSteps.js');

const DAY = '2026-07-08';

describe('dailySnapshotSteps', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('provento do dia-ex: compra do dia não recebe, dólar pelo câmbio do dia, fonte duplicada conta uma vez', async () => {
    mocks.dividendFind.mockReturnValue({ lean: async () => [
      { ticker: 'HGLG11', amount: 1 }, { ticker: 'HGLG11', amount: 1.01, type: 'DIVIDEND' },
      { ticker: 'AAPL', amount: 0.25 },
    ] });
    const positions = [
      { ticker: 'HGLG11', type: 'FII', quantity: 15 },
      { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', quantity: 4 },
    ];
    const transactions = [{ ticker: 'HGLG11', type: 'BUY', quantity: 5, date: new Date(`${DAY}T12:00:00Z`) }];
    const income = await dayDividendIncomeBRL(positions, transactions, DAY, { getUsdRateForDate: () => 5, usdRate: 9 });
    expect(income).toBe(10 * 1 + 4 * 0.25 * 5);
    expect(mocks.dividendFind.mock.calls[0][0].date).toEqual(new Date(Date.UTC(2026, 6, 8)));
  });

  it('sem posição com direito não consulta proventos', async () => {
    expect(await dayDividendIncomeBRL([{ ticker: 'X', quantity: 0 }], [], DAY, { usdRate: 5 })).toBe(0);
    expect(mocks.dividendFind).not.toHaveBeenCalled();
  });

  it('cota nasce em 100, segue o Dietz e acusa retorno anômalo', () => {
    expect(dietzQuotaForDay(null, 1000, 0, 0)).toEqual({ quotaPrice: 100 });
    expect(dietzQuotaForDay({ totalEquity: 1000, quotaPrice: 110 }, 1100, 0, 0).quotaPrice).toBeCloseTo(121, 10);
    expect(dietzQuotaForDay({ totalEquity: 1000, quotaPrice: 110 }, 5000, 0, 0).anomalous).toBe(true);
  });

  it('reset indevido: cota ~100 com histórico longe de 100, ou sem anterior mas com snapshot no banco', async () => {
    expect(await isUndueQuotaReset({ quotaPrice: 120 }, 100.05, 'w1', DAY)).toBe(true);
    expect(await isUndueQuotaReset({ quotaPrice: 120 }, 101, 'w1', DAY)).toBe(false);
    mocks.exists.mockResolvedValue({ _id: 's' });
    expect(await isUndueQuotaReset(null, 100, 'w1', DAY)).toBe(true);
    expect(mocks.exists).toHaveBeenCalledWith({ wallet: 'w1' });
  });

  it('documento: origem pelo force, lucro com proventos e percentual zero sem custo', () => {
    const p = buildDailySnapshotPayload({
      userId: 'u1', walletId: 'w1', dayStr: DAY, force: true, calculatedAt: new Date(0),
      totalEquity: 1100, totalInvested: 1000, totalDividends: 50, quotaPrice: 101,
    });
    expect(p).toMatchObject({ source: 'BACKFILL', profit: 150, profitPercent: 15, calculationVersion: 5, dayKey: DAY });
    expect(buildDailySnapshotPayload({ ...p, dayStr: DAY, force: false, totalInvested: 0 })).toMatchObject({ source: 'DAILY', profitPercent: 0 });
  });
});
