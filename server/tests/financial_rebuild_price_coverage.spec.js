/**
 * Regressão do incidente de 01/08/2026: um rebuild rodou com a série de preços
 * TRUNCADA pelo timeSeriesWorker (`history.slice(-ASSET_HISTORY_MAX_POINTS)`, ~400
 * candles ≈ 1,6 ano) e gravou 1.244 dias de patrimônio marcado no CUSTO — cota
 * parada em 100 durante 4,8 anos — seguidos de um degrau de +16,01% no primeiro
 * dia com candle. O teste antigo de profundidade (`history.length < 5`) não pegava:
 * 400 candles passam folgado. O circuit breaker de TWRR também não: 16% < 50%.
 *
 * Invariante travado aqui: sem série que cubra o período da posição, o rebuild
 * ABORTA e não persiste nada — o histórico existente sobrevive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  userAssetFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  auditCreate: vi.fn(),
  marketAssetFindOne: vi.fn(),
  assetHistoryUpdateOne: vi.fn(),
  getBenchmarkHistory: vi.fn(),
  getFullHistory: vi.fn(),
}));

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: { deleteMany: mocks.snapshotDeleteMany } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: mocks.systemConfigFindOne } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: mocks.auditCreate } }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: { findOne: mocks.marketAssetFindOne } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { updateOne: mocks.assetHistoryUpdateOne } }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getBenchmarkHistory: mocks.getBenchmarkHistory },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistory: mocks.getFullHistory },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/dateUtils.js', () => ({
  toDateKey: (date) => new Date(date).toISOString().slice(0, 10),
  startOfDay: (date) => new Date(`${new Date(date).toISOString().slice(0, 10)}T00:00:00.000Z`),
  isBusinessDay: (date) => ![0, 6].includes(new Date(date).getUTCDay()),
}));

const { financialService } = await import('../services/financialService.js');

/** Série diária sintética (dias corridos) — só a data importa para a cobertura. */
const series = (fromDay, days, price = 50) => {
  const out = [];
  const cursor = new Date(`${fromDay}T12:00:00.000Z`);
  for (let i = 0; i < days; i++) {
    out.push({ date: cursor.toISOString().slice(0, 10), close: price, adjClose: price });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};

describe('findPriceCoverageGaps — profundidade da série vs. período da posição', () => {
  it('acusa série truncada que começa anos depois da primeira compra', () => {
    // Exatamente o caso de produção: posição desde 2020, cache com ~1,6 ano.
    const priceCacheMap = new Map([['VALE3', financialService.indexHistoryByDate(series('2024-12-19', 400))]]);
    expect(financialService.findPriceCoverageGaps(priceCacheMap, new Map([['VALE3', '2020-03-03']])))
      .toEqual([{ ticker: 'VALE3', requiredFrom: '2020-03-03', availableFrom: '2024-12-19' }]);
  });

  it('acusa ticker sem série nenhuma', () => {
    expect(financialService.findPriceCoverageGaps(new Map(), new Map([['VALE3', '2020-03-03']])))
      .toEqual([{ ticker: 'VALE3', requiredFrom: '2020-03-03', availableFrom: null }]);
  });

  it('tolera até 5 dias de folga — compra na sexta, feriado, listagem recente', () => {
    const priceCacheMap = new Map([['XPML11', financialService.indexHistoryByDate(series('2026-07-06', 30))]]);
    expect(financialService.findPriceCoverageGaps(priceCacheMap, new Map([['XPML11', '2026-07-03']]))).toEqual([]);
  });

  it('não acusa nada quando a série cobre desde antes da posição', () => {
    const priceCacheMap = new Map([['VALE3', financialService.indexHistoryByDate(series('2020-01-02', 1600))]]);
    expect(financialService.findPriceCoverageGaps(priceCacheMap, new Map([['VALE3', '2020-03-03']]))).toEqual([]);
  });
});

describe('_loadPriceCacheMap — refetch por profundidade, não só por série vazia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marketAssetFindOne.mockResolvedValue({ ticker: 'VALE3', type: 'STOCK' });
    mocks.assetHistoryUpdateOne.mockResolvedValue({});
  });

  it('série de 400 candles que não alcança a posição dispara refetch e usa a série profunda', async () => {
    mocks.getBenchmarkHistory.mockResolvedValue(series('2024-12-19', 400));
    mocks.getFullHistory.mockResolvedValue(series('2020-01-02', 1600));

    const cache = await financialService._loadPriceCacheMap(
      ['VALE3'],
      new Map([['VALE3', { ticker: 'VALE3', type: 'STOCK' }]]),
      new Map([['VALE3', '2020-03-03']]),
    );

    expect(mocks.getFullHistory).toHaveBeenCalledWith('VALE3.SA', 'STOCK');
    expect(cache.get('VALE3').has('2020-03-03')).toBe(true);
    // A série profunda NÃO é regravada por cima do cache: o worker a truncaria
    // de novo às 18:30, então isso seria escrita pura para ser desfeita.
    expect(mocks.assetHistoryUpdateOne).not.toHaveBeenCalled();
  });

  it('série já profunda não gera chamada externa', async () => {
    mocks.getBenchmarkHistory.mockResolvedValue(series('2020-01-02', 1600));

    await financialService._loadPriceCacheMap(
      ['VALE3'],
      new Map([['VALE3', { ticker: 'VALE3', type: 'STOCK' }]]),
      new Map([['VALE3', '2020-03-03']]),
    );

    expect(mocks.getFullHistory).not.toHaveBeenCalled();
  });
});

describe('rebuildUserHistory — fail-closed quando não dá para marcar a mercado', () => {
  let persistSpy;

  const buy = {
    ticker: 'VALE3', type: 'BUY', quantity: 10, price: 46.35,
    totalValue: 463.5, currency: 'BRL', date: new Date('2026-07-01T12:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txFind.mockReturnValue({ sort: vi.fn().mockResolvedValue([buy]) });
    mocks.userAssetFind.mockResolvedValue([{ ticker: 'VALE3', type: 'STOCK', currency: 'BRL' }]);
    mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, ipca: 4.5, dollar: 5 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(() => 5);
    vi.spyOn(financialService, '_loadDividendDateMap').mockResolvedValue(new Map());
    vi.spyOn(financialService, '_loadCdiFactors').mockResolvedValue({
      dailyFactorsMap: new Map(), cdiFactorsCacheFallback: { 2026: 1.0005 },
    });
    persistSpy = vi.spyOn(financialService, '_persistSnapshots').mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  it('aborta e não persiste quando a série não cobre a posição', async () => {
    vi.spyOn(financialService, '_loadPriceCacheMap')
      .mockResolvedValue(new Map([['VALE3', financialService.indexHistoryByDate(series('2026-07-20', 20))]]));

    await expect(financialService.rebuildUserHistory('u1', 'w1', { throughDayKey: '2026-07-31' }))
      .rejects.toThrow(/Histórico de preços insuficiente.*VALE3.*2026-07-01.*2026-07-20/s);
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('aborta também quando o ticker não tem série nenhuma — nunca marca no custo', async () => {
    vi.spyOn(financialService, '_loadPriceCacheMap').mockResolvedValue(new Map());

    await expect(financialService.rebuildUserHistory('u1', 'w1', { throughDayKey: '2026-07-31' }))
      .rejects.toThrow(/Histórico de preços insuficiente/);
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('allowSparseHistory segue em frente — escotilha explícita só para scripts', async () => {
    vi.spyOn(financialService, '_loadPriceCacheMap').mockResolvedValue(new Map());

    const snapshots = await financialService.rebuildUserHistory('u1', 'w1', {
      dryRun: true, throughDayKey: '2026-07-31', allowSparseHistory: true,
    });
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it('com série completa, reconstrói normalmente', async () => {
    vi.spyOn(financialService, '_loadPriceCacheMap')
      .mockResolvedValue(new Map([['VALE3', financialService.indexHistoryByDate(series('2026-06-01', 90, 50))]]));

    const snapshots = await financialService.rebuildUserHistory('u1', 'w1', {
      dryRun: true, throughDayKey: '2026-07-31',
    });

    expect(snapshots.length).toBeGreaterThan(0);
    // Marcado a 50 (candle), não a 46,35 (custo) — é a diferença entre histórico
    // reconstruído e histórico inventado.
    expect(snapshots.at(-1).totalEquity).toBeCloseTo(500, 2);
    expect(snapshots.at(-1).totalInvested).toBeCloseTo(463.5, 2);
  });

  it('renda fixa/caixa não exige série de preços', async () => {
    mocks.txFind.mockReturnValue({ sort: vi.fn().mockResolvedValue([{
      ticker: 'RESERVA', type: 'BUY', quantity: 1000, price: 1,
      totalValue: 1000, currency: 'BRL', date: new Date('2026-07-01T12:00:00Z'),
    }]) });
    mocks.userAssetFind.mockResolvedValue([{
      ticker: 'RESERVA', type: 'CASH', currency: 'BRL',
      fixedIncomeRate: 100, fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0,
    }]);
    vi.spyOn(financialService, '_loadPriceCacheMap').mockResolvedValue(new Map());

    const snapshots = await financialService.rebuildUserHistory('u1', 'w1', {
      dryRun: true, throughDayKey: '2026-07-31',
    });
    expect(snapshots.length).toBeGreaterThan(0);
  });
});
