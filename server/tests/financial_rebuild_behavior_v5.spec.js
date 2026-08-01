import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  userAssetFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: { deleteMany: mocks.snapshotDeleteMany } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: mocks.systemConfigFindOne } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: mocks.auditCreate } }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/dateUtils.js', () => ({
  toDateKey: (date) => new Date(date).toISOString().slice(0, 10),
  startOfDay: (date) => new Date(`${new Date(date).toISOString().slice(0, 10)}T00:00:00.000Z`),
  isBusinessDay: (date) => ![0, 6].includes(new Date(date).getUTCDay()),
}));

const { financialService } = await import('../services/financialService.js');

const cashTransaction = {
  ticker: 'RESERVA',
  type: 'BUY',
  quantity: 1_000,
  price: 1,
  totalValue: 1_000,
  currency: 'BRL',
  date: new Date('2026-07-30T12:00:00Z'),
};
const cashAsset = {
  ticker: 'RESERVA',
  type: 'CASH',
  currency: 'BRL',
  fixedIncomeRate: 100,
  fixedIncomeIndex: 'CDI',
  fixedIncomeSpread: 0,
};

describe('rebuildUserHistory V5 — comportamento ponta a ponta sem banco', () => {
  let persistSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txFind.mockReturnValue({ sort: vi.fn().mockResolvedValue([cashTransaction]) });
    mocks.userAssetFind.mockResolvedValue([cashAsset]);
    mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, ipca: 4.5, dollar: 5 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(() => 5);
    vi.spyOn(financialService, '_loadPriceCacheMap').mockResolvedValue(new Map());
    vi.spyOn(financialService, '_loadDividendDateMap').mockResolvedValue(new Map());
    vi.spyOn(financialService, '_loadCdiFactors').mockResolvedValue({
      dailyFactorsMap: new Map(),
      cdiFactorsCacheFallback: { 2026: 1.0005 },
    });
    persistSpy = vi.spyOn(financialService, '_persistSnapshots').mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dry-run gera apenas dias úteis, em 23:59 BRT, sem qualquer escrita', async () => {
    const snapshots = await financialService.rebuildUserHistory('u1', 'w1', {
      dryRun: true,
      throughDayKey: '2026-08-02',
    });

    expect(snapshots.map((snapshot) => snapshot.dayKey)).toEqual(['2026-07-30', '2026-07-31']);
    expect(snapshots.map((snapshot) => snapshot.date.toISOString())).toEqual([
      '2026-07-31T02:59:00.000Z',
      '2026-08-01T02:59:00.000Z',
    ]);
    expect(snapshots.every((snapshot) => snapshot.calculationVersion === 5)).toBe(true);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('execuções repetidas são financeiramente idempotentes', async () => {
    const options = { dryRun: true, throughDayKey: '2026-07-31' };
    const first = await financialService.rebuildUserHistory('u1', 'w1', options);
    const second = await financialService.rebuildUserHistory('u1', 'w1', options);
    const financialProjection = (rows) => rows.map((row) => ({
      dayKey: row.dayKey,
      equity: row.totalEquity,
      invested: row.totalInvested,
      quota: row.quotaPrice,
      profit: row.profit,
    }));
    expect(financialProjection(second)).toEqual(financialProjection(first));
  });

  it('modo apply audita e entrega a coleção completa à persistência atômica', async () => {
    const snapshots = await financialService.rebuildUserHistory('u1', 'w1', {
      throughDayKey: '2026-07-31',
      source: 'BACKFILL',
    });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(persistSpy).toHaveBeenCalledWith('u1', 'w1', snapshots);
    expect(snapshots.every((snapshot) => snapshot.source === 'BACKFILL')).toBe(true);
  });

  it('por padrão termina ontem e nunca antecipa o fechamento do dia atual', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T15:00:00Z'));
    const snapshots = await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true });
    expect(snapshots.at(-1).dayKey).toBe('2026-07-31');
    expect(snapshots.some((snapshot) => snapshot.dayKey === '2026-08-01')).toBe(false);
  });

  it('sem transações remove histórico antigo apenas no modo apply', async () => {
    mocks.txFind.mockReturnValue({ sort: vi.fn().mockResolvedValue([]) });
    await expect(financialService.rebuildUserHistory('u1', 'w1', { dryRun: true })).resolves.toEqual([]);
    expect(mocks.snapshotDeleteMany).not.toHaveBeenCalled();

    await expect(financialService.rebuildUserHistory('u1', 'w1')).resolves.toEqual([]);
    expect(mocks.snapshotDeleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
  });
});
