/**
 * Snapshot diário × rebuild × card — a mesma marcação.
 *
 *  - Ativo SEM fechamento e SEM cotação: o snapshot o tirava do patrimônio E do
 *    custo, enquanto o card seguia contando o custo e o rebuild o marcava pelo
 *    último preço conhecido / custo. Agora os três marcam no custo (o rebuild
 *    ainda prefere o último fechamento que viu, que o snapshot não tem).
 *  - O rebuild marcava ação com `qty × preço × câmbio` em float cru (regra 7);
 *    agora usa a mesma aritmética segura do snapshot, então os centavos batem.
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

const { computeEquityAt } = await import('../services/schedulerService.js');
const { historyStorageKey } = await import('../utils/assetHistory.js');

const markRebuild = (portfolio, metas, prices, usdRate = 5) => financialService._markPortfolioToMarket({
  cursorIso: '2026-07-07',
  portfolio,
  fixedIncomeState: {},
  assetMetadataMap: new Map(metas.map((m) => [m.ticker, m])),
  priceCacheMap: new Map(Object.entries(prices).map(([t, close]) => [t, financialService.indexHistoryByDate([{ date: '2026-07-07', close, adjClose: close }])])),
  lastKnownPrices: {},
  usdRateForDay: usdRate,
});

describe('computeEquityAt — ativo sem cotação', () => {
  it('marca no custo e conta o custo (antes: sumia dos dois lados)', () => {
    const asset = { ticker: 'XPTO3', type: 'STOCK', currency: 'BRL', quantity: 5, totalCost: 100, totalCostBrl: 100 };
    const r = computeEquityAt([asset], { priceMap: new Map(), closeMap: new Map(), macroRates: {}, usdRate: 5 });
    expect(r.totalEquity).toBe(100);
    expect(r.totalInvested).toBe(100);
  });

  it('em dólar: saldo pelo custo nativo × câmbio do dia, custo pelo câmbio das compras', () => {
    const asset = { ticker: 'ZZZ', type: 'STOCK_US', currency: 'USD', quantity: 2, totalCost: 20, totalCostBrl: 100 };
    const r = computeEquityAt([asset], { priceMap: new Map(), closeMap: new Map(), macroRates: {}, usdRate: 5.5 });
    expect(r.totalEquity).toBe(110);
    expect(r.totalInvested).toBe(100);
  });

  it('rebuild sem série nem último preço marca no mesmo custo', () => {
    const { totalEquityNominal, totalInvested } = markRebuild(
      { XPTO3: { qty: 5, cost: 100, costBrl: 100 } },
      [{ ticker: 'XPTO3', type: 'STOCK', currency: 'BRL' }],
      {},
    );
    expect(totalEquityNominal).toBe(100);
    expect(totalInvested).toBe(100);
  });
});

describe('rebuild × snapshot — centavos da marcação', () => {
  it('mesma aritmética segura, mesmo número ao centavo', () => {
    const positions = [
      { ticker: 'AAA3', type: 'STOCK', currency: 'BRL', quantity: 7, totalCost: 70, totalCostBrl: 70, close: 1.2345 },
      { ticker: 'BBB11', type: 'FII', currency: 'BRL', quantity: 333, totalCost: 3000, totalCostBrl: 3000, close: 9.87 },
      { ticker: 'CCC', type: 'STOCK_US', currency: 'USD', quantity: 3, totalCost: 30, totalCostBrl: 150, close: 10.335 },
    ];
    const usdRate = 5.4321;
    const snap = computeEquityAt(positions, {
      priceMap: new Map(),
      closeMap: new Map(positions.map((p) => [historyStorageKey(p.ticker, p.type), p.close])),
      macroRates: {},
      usdRate,
    });
    const rebuilt = markRebuild(
      Object.fromEntries(positions.map((p) => [p.ticker, { qty: p.quantity, cost: p.totalCost, costBrl: p.totalCostBrl }])),
      positions,
      Object.fromEntries(positions.map((p) => [p.ticker, p.close])),
      usdRate,
    );
    expect(rebuilt.totalEquityNominal).toBe(snap.totalEquity);
    expect(rebuilt.totalInvested).toBe(snap.totalInvested);
  });
});
