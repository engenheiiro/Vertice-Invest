import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';

// Contexto de um run de snapshot (services/snapshot/snapshotContext.js): taxas da
// macro com fallback e câmbio do dia sem número inventado (regra 13).

const mocks = vi.hoisted(() => ({ sysConfig: null, hasSeries: false, ensure: vi.fn() }));
const empty = () => ({ select: () => ({ lean: () => [] }) });

vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: async () => mocks.sysConfig } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: empty } }));
vi.mock('../utils/cdiCurve.js', () => ({ loadCdiCurveForAssets: async () => 'curva' }));
vi.mock('../utils/dayCloses.js', () => ({ loadClosesForDay: async () => new Map() }));
vi.mock('../services/walletDayCandleService.js', () => ({ ensureWalletDayCandles: mocks.ensure }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: { getMarketDataMap: async () => new Map() } }));
vi.mock('../services/treasuryPriceService.js', () => ({ loadTreasuryPricing: async () => 'pu' }));
vi.mock('../services/financialService.js', () => ({
  financialService: {
    _loadUsdRateResolver: async () => Object.assign(() => 5.2, { hasSeries: mocks.hasSeries }),
  },
}));

const { loadSnapshotContext } = await import('../services/snapshot/snapshotContext.js');

beforeEach(() => { vi.clearAllMocks(); });

describe('loadSnapshotContext', () => {
  it('sem macro: CDI cai no fallback e o câmbio fica ausente sem série', async () => {
    mocks.sysConfig = null;
    mocks.hasSeries = false;
    const ctx = await loadSnapshotContext('2026-11-20');
    expect(ctx.macroRates).toEqual({ cdiRate: DEFAULT_SELIC_FALLBACK, selic: undefined, ipca: undefined, cdiCurve: 'curva' });
    expect(ctx.usdRate).toBeNull();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('CDI zerado cai na SELIC; câmbio vem da série; reforça candles quando pedido', async () => {
    mocks.sysConfig = { cdi: 0, selic: 14.9, ipca: 4.4, dollar: 0 };
    mocks.hasSeries = true;
    mocks.ensure.mockResolvedValue(new Map([['PETR4', 30]]));
    const ctx = await loadSnapshotContext('2026-11-20', { ensureDayCandles: true });
    expect(ctx.macroRates.cdiRate).toBe(14.9);
    expect(ctx.usdRate).toBe(5.2);
    expect(ctx.closeMap.get('PETR4')).toBe(30);
  });
});
