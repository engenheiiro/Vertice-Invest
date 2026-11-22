/**
 * DIREITO AO PROVENTO NO DIA-EX — todos os caminhos com a MESMA régua.
 *
 * `DividendEvent.date` é a ex-date. Quem COMPRA no dia-ex já compra "ex" (não
 * recebe); quem VENDE no dia-ex vendeu "com" (recebe). O direito é a posição de
 * ANTES das movimentações do próprio dia.
 *
 * Os quatro caminhos aplicavam as transações do dia antes de creditar o provento
 * (compra no dia-ex recebia, venda no dia-ex perdia). Corrigir só um deles reabre
 * a divergência KPI × snapshot × rebuild, então este teste exige os quatro juntos:
 *   - accrual (`accrueDividendsByTicker`, card/KPI e `totalDividends` do snapshot)
 *   - rebuild (`rebuildUserHistory`)
 *   - snapshot diário (`persistUserSnapshotForDay`, renda do Dietz)
 *   - tela de Proventos (`calculateUserDividends`, corte da primeira compra)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  txAggregate: vi.fn(),
  userAssetFind: vi.fn(),
  marketAssetFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  snapshotFindOne: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  snapshotExists: vi.fn(),
  dividendFind: vi.fn(),
  assetHistoryAggregate: vi.fn(),
  getMarketDataMap: vi.fn(),
  upsertSnapshot: vi.fn(),
}));

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind, aggregate: mocks.txAggregate } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/SystemConfig.js', () => ({
  default: { findOne: mocks.systemConfigFindOne, findOneAndUpdate: vi.fn() },
}));
vi.mock('../models/WalletSnapshot.js', () => ({
  default: { findOne: mocks.snapshotFindOne, deleteMany: mocks.snapshotDeleteMany, exists: mocks.snapshotExists },
}));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: mocks.dividendFind } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: mocks.assetHistoryAggregate } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: mocks.marketAssetFind, findOne: vi.fn() } }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: () => [] })) } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getMarketDataMap: mocks.getMarketDataMap },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistory: vi.fn(), getFullHistoryDetailed: vi.fn() },
}));
vi.mock('../services/aiResearchService.js', () => ({ aiResearchService: {} }));
vi.mock('../services/macroDataService.js', () => ({ macroDataService: {} }));
vi.mock('../services/syncService.js', () => ({ syncService: {} }));
vi.mock('../services/holidayService.js', () => ({ holidayService: { isHoliday: vi.fn(() => false), sync: vi.fn() } }));
vi.mock('../services/engines/signalEngine.js', () => ({ signalEngine: {} }));
vi.mock('../services/notificationService.js', () => ({ createBroadcast: vi.fn() }));
vi.mock('../services/researchPublicationService.js', () => ({
  activateResearchSections: vi.fn(), hasSectionContent: vi.fn(),
}));
vi.mock('../services/workers/timeSeriesWorker.js', () => ({ timeSeriesWorker: {} }));
vi.mock('../services/usStocksFundamentalsService.js', () => ({ usStocksFundamentalsService: {} }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/walletSnapshot.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, upsertWalletSnapshotForDay: mocks.upsertSnapshot };
});

const { financialService } = await import('../services/financialService.js');
const { loadSnapshotContext, persistUserSnapshotForDay } = await import('../services/schedulerService.js');

const USER = '64b000000000000000000001';
const WALLET_ID = '64b000000000000000000002';
const WALLET = { _id: WALLET_ID, user: USER };
const TICKER = 'TEST3';
const EX_DAY = '2026-07-07';
const AMOUNT = 0.4;
const DIVIDEND = { ticker: TICKER, type: 'DIVIDEND', amount: AMOUNT, date: new Date(`${EX_DAY}T00:00:00Z`) };
const CLOSES = {
  '2026-07-01': 10.0, '2026-07-02': 10.4, '2026-07-03': 10.2,
  '2026-07-06': 10.9, '2026-07-07': 10.5, '2026-07-08': 11.3,
};
const BUSINESS_DAYS = Object.keys(CLOSES);
const candles = Object.entries(CLOSES).map(([date, close]) => ({ date, close, adjClose: close }));

const tx = (type, quantity, day, price = 10) => ({
  ticker: TICKER, type, quantity, price, totalValue: quantity * price, currency: 'BRL',
  date: new Date(`${day}T12:00:00Z`),
});

/** Posição (quantidade + custo pelo médio) ao FIM de cada dia. */
const positionAt = (txs, day) => {
  let quantity = 0;
  let totalCost = 0;
  for (const t of txs) {
    if (t.date.toISOString().slice(0, 10) > day) continue;
    if (t.type === 'BUY') { quantity += t.quantity; totalCost += t.totalValue; } else {
      totalCost -= (totalCost / quantity) * t.quantity; quantity -= t.quantity;
    }
  }
  return { ticker: TICKER, type: 'STOCK', currency: 'BRL', quantity, totalCost, totalCostBrl: totalCost };
};

const SCENARIOS = [
  {
    name: 'COMPRA no dia-ex não recebe',
    txs: [tx('BUY', 10, '2026-07-01'), tx('BUY', 10, EX_DAY)],
    expected: 10 * AMOUNT, // e não 20 × 0,4
  },
  {
    name: 'VENDA no dia-ex recebe',
    txs: [tx('BUY', 20, '2026-07-01'), tx('SELL', 10, EX_DAY, 10.5)],
    expected: 20 * AMOUNT, // e não 10 × 0,4
  },
];

describe.each(SCENARIOS)('Direito ao provento no dia-ex — $name', ({ txs, expected }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, selic: 14.25, ipca: 4.5, dollar: 5 });
    mocks.userAssetFind.mockImplementation(() => {
      const result = [positionAt(txs, '2026-12-31')];
      result.select = () => ({ lean: async () => [{ ticker: TICKER, type: 'STOCK' }] });
      return Object.assign(Promise.resolve(result), result);
    });
    mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.snapshotExists.mockResolvedValue(false);
    mocks.upsertSnapshot.mockImplementation(async (_m, _w, _d, payload) => ({ ...payload, _id: 'snap' }));

    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(() => 5);
    vi.spyOn(financialService, '_loadPriceCacheMap')
      .mockResolvedValue(new Map([[TICKER, financialService.indexHistoryByDate(candles)]]));
    vi.spyOn(financialService, '_loadDividendDateMap').mockResolvedValue(new Map([[EX_DAY, [DIVIDEND]]]));
    vi.spyOn(financialService, '_loadCdiFactors')
      .mockResolvedValue({ dailyFactorsMap: new Map(), cdiFactorsCacheFallback: { 2026: 1.0005 } });
    vi.spyOn(financialService, '_persistSnapshots').mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  it('accrual (card / totalDividends do snapshot)', async () => {
    const { total } = await financialService.accrueDividendsByTicker(USER, WALLET_ID, '2026-07-31', { transactions: txs });
    expect(total).toBeCloseTo(expected, 2);
  });

  it('rebuild do histórico', async () => {
    mocks.txFind.mockReturnValue({ sort: () => Promise.resolve(txs) });
    const rebuilt = await financialService.rebuildUserHistory(USER, WALLET_ID, { dryRun: true, throughDayKey: '2026-07-08' });
    const exSnap = rebuilt.find((s) => s.dayKey === EX_DAY);
    expect(exSnap.totalDividends).toBeCloseTo(expected, 2);
  });

  it('snapshot diário: renda do Dietz e cota idênticas ao rebuild', async () => {
    mocks.txFind.mockReturnValue({ sort: () => Promise.resolve(txs) });
    const rebuilt = await financialService.rebuildUserHistory(USER, WALLET_ID, { dryRun: true, throughDayKey: '2026-07-08' });

    // O total acumulado do snapshot vem do accrual (testado acima); aqui o que
    // interessa é a RENDA do dia, que o job diário calcula por conta própria.
    const realAccrual = financialService.accrueDividendsByTicker.bind(financialService);
    vi.spyOn(financialService, 'accruedDividendsThroughDay').mockImplementation(async (u, w, day) =>
      (await realAccrual(u, w, day, { transactions: txs })).total);

    const produced = [];
    for (const day of BUSINESS_DAYS) {
      const previous = produced.at(-1) || null;
      mocks.snapshotFindOne.mockReturnValue({ sort: () => Promise.resolve(previous) });
      // Fluxo pendente: no 1º dia tudo até ele; depois, só os lançamentos do dia.
      mocks.txFind.mockResolvedValue(txs.filter((t) => {
        const key = t.date.toISOString().slice(0, 10);
        return previous ? key === day : key <= day;
      }));
      mocks.dividendFind.mockReturnValue({ lean: async () => (day === EX_DAY ? [DIVIDEND] : []) });
      mocks.assetHistoryAggregate.mockResolvedValue([{ ticker: TICKER, candle: { close: CLOSES[day] } }]);
      mocks.getMarketDataMap.mockResolvedValue(new Map([[TICKER, { price: CLOSES[day] }]]));

      const ctx = await loadSnapshotContext(day);
      // Posição gravada = a do FIM do dia (como o UserAsset real).
      const result = await persistUserSnapshotForDay(WALLET, day, ctx, { assets: [positionAt(txs, day)] });
      expect(result).toBe('created');
      produced.push(mocks.upsertSnapshot.mock.calls.at(-1)[3]);
    }

    for (let i = 0; i < BUSINESS_DAYS.length; i++) {
      const day = BUSINESS_DAYS[i];
      expect.soft(produced[i].totalEquity, `${day} totalEquity`).toBeCloseTo(rebuilt[i].totalEquity, 2);
      expect.soft(produced[i].totalDividends, `${day} totalDividends`).toBeCloseTo(rebuilt[i].totalDividends, 2);
      expect.soft(produced[i].quotaPrice, `${day} quotaPrice`).toBeCloseTo(rebuilt[i].quotaPrice, 4);
    }
    expect(produced.find((s) => s.dayKey === EX_DAY).totalDividends).toBeCloseTo(expected, 2);
  });
});

describe('calculateUserDividends — compra no dia-ex não entra na tela de Proventos', () => {
  const setup = (firstBuyIso) => {
    vi.clearAllMocks();
    mocks.userAssetFind.mockResolvedValue([{ ticker: TICKER, type: 'STOCK', currency: 'BRL', quantity: 10, totalCost: 100 }]);
    mocks.marketAssetFind.mockReturnValue({ select: () => Promise.resolve([]) });
    mocks.dividendFind.mockReturnValue({ sort: () => Promise.resolve([{ ...DIVIDEND, paymentDate: new Date('2026-07-20T00:00:00Z') }]) });
    mocks.txAggregate.mockResolvedValue([{ _id: TICKER, firstBuyDate: new Date(firstBuyIso) }]);
    vi.spyOn(financialService, '_projectMonthlyIncome').mockReturnValue(0);
  };

  afterEach(() => vi.restoreAllMocks());

  it('primeira compra NO dia-ex: sem provento', async () => {
    setup(`${EX_DAY}T12:00:00Z`);
    const { totalAllTime } = await financialService.calculateUserDividends(USER, WALLET_ID);
    expect(totalAllTime).toBe(0);
  });

  it('primeira compra na véspera: recebe', async () => {
    setup('2026-07-06T12:00:00Z');
    const { totalAllTime } = await financialService.calculateUserDividends(USER, WALLET_ID);
    expect(totalAllTime).toBeCloseTo(10 * AMOUNT, 2);
  });
});
