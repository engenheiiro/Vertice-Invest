import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';

// Caracterização de `loadSnapshotContext` (macro + cotações em lote de um run de
// snapshot), gravada no código ANTERIOR à extração. Trava o contexto devolvido e
// a sequência de consultas, com macro ausente/zerada/negativa, câmbio por série
// ou ausente e o reforço de candles do dia. Nada toca o banco.

const mocks = vi.hoisted(() => ({ calls: [], scenario: null, resolver: null }));
const rec = (name, ...args) => mocks.calls.push([name, ...args]);

const chain = (value) => ({
  select: (fields) => {
    rec('select', fields);
    return { lean: () => value };
  },
});

vi.mock('../models/SystemConfig.js', () => ({
  default: {
    findOne: async (filter) => { rec('SystemConfig.findOne', filter); return mocks.scenario.sysConfig; },
    findOneAndUpdate: vi.fn(),
  },
}));
vi.mock('../models/UserAsset.js', () => ({
  default: {
    find: (filter) => {
      rec('UserAsset.find', filter);
      const s = mocks.scenario;
      if (filter.type?.$in) return chain(s.fixedIncome);
      if (filter.type?.$nin) return chain(s.live);
      return chain(s.treasury);
    },
  },
}));
vi.mock('../utils/cdiCurve.js', () => ({
  loadCdiCurveForAssets: async (assets, opts) => { rec('loadCdiCurveForAssets', assets, opts); return { curva: assets.length }; },
}));
vi.mock('../utils/dayCloses.js', () => ({
  loadClosesForDay: async (assets, day) => {
    rec('loadClosesForDay', assets, day);
    return new Map(mocks.scenario.closes);
  },
}));
vi.mock('../services/walletDayCandleService.js', () => ({
  ensureWalletDayCandles: async (assets, day, closeMap) => {
    rec('ensureWalletDayCandles', assets, day, closeMap);
    return new Map(mocks.scenario.resolved);
  },
}));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: {
    getMarketDataMap: async (tickers) => { rec('getMarketDataMap', tickers); return new Map(tickers.map((t) => [t, { price: t.length }])); },
  },
}));
vi.mock('../services/financialService.js', () => ({
  financialService: {
    _loadUsdRateResolver: async (rate) => {
      rec('_loadUsdRateResolver', rate);
      const fn = (day) => { rec('usdForDate', day); return mocks.scenario.seriesRate; };
      if (mocks.scenario.hasSeries !== 'absent') fn.hasSeries = mocks.scenario.hasSeries;
      mocks.resolver = fn;
      return fn;
    },
  },
}));
vi.mock('../services/treasuryPriceService.js', () => ({
  loadTreasuryPricing: async (assets) => { rec('loadTreasuryPricing', assets); return { titulos: assets.length }; },
}));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));
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
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { loadSnapshotContext } = await import('../services/schedulerService.js');

const NOW = new Date('2026-11-24T02:30:00.000Z'); // 23:30 BRT de 23/11

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { mocks.calls.length = 0; });

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const RATES = [undefined, null, 0, -1, 5.42, 10.65, 14.9, '5.1'];
const TICKERS = ['PETR4', 'HGLG11', 'AAPL', 'BTC', 'PETR4', 'IVVB11'];

function buildScenario(r) {
  const sysConfig = r() < 0.15 ? null : {
    dollar: pick(r, RATES), cdi: pick(r, RATES), selic: pick(r, RATES), ipca: pick(r, RATES),
  };
  const live = TICKERS.filter(() => r() < 0.5).map((ticker, i) => ({ ticker, type: 'STOCK', quantity: i + 1 }));
  return {
    sysConfig,
    live,
    fixedIncome: Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ type: 'FIXED_INCOME', startDate: `2026-0${i + 1}-02` })),
    treasury: Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ ticker: `TD${i}`, type: 'FIXED_INCOME' })),
    closes: live.filter(() => r() < 0.5).map((a) => [a.ticker, 10]),
    resolved: live.filter(() => r() < 0.5).map((a) => [a.ticker, 11]),
    hasSeries: pick(r, [true, false, 'absent', 1]),
    seriesRate: pick(r, [5.33, null, undefined]),
  };
}

async function runScenario(seed) {
  const r = mulberry32(seed);
  const s = buildScenario(r);
  mocks.scenario = s;
  mocks.calls.length = 0;
  const argMode = pick(r, ['none', 'day', 'dayNoOpts', 'ensure', 'noEnsure', 'emptyOpts']);
  let ctx;
  if (argMode === 'none') ctx = await loadSnapshotContext();
  else if (argMode === 'dayNoOpts') ctx = await loadSnapshotContext('2026-11-20');
  else if (argMode === 'day') ctx = await loadSnapshotContext('2026-11-21', {});
  else if (argMode === 'emptyOpts') ctx = await loadSnapshotContext(undefined, {});
  else ctx = await loadSnapshotContext('2026-11-22', { ensureDayCandles: argMode === 'ensure' });
  const sameResolver = ctx.getUsdRateForDate === mocks.resolver;
  return { argMode, ctx: canon(ctx), sameResolver, calls: mocks.calls.map((c) => canon(c)) };
}

describe('caracterização — loadSnapshotContext', () => {
  it('cenários de PRNG', async () => {
    const out = {};
    for (let seed = 1; seed <= 300; seed++) {
      const run = await runScenario(seed);
      expect(run.sameResolver).toBe(true);
      out[seed] = `${run.argMode} ${hash16(run)}`;
    }
    expect(out).toMatchSnapshot();
  });

  it('cenários legíveis', async () => {
    const out = {};
    for (let seed = 1; seed <= 8; seed++) out[seed] = await runScenario(seed);
    expect(out).toMatchSnapshot();
  });
});
