import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';

// Caracterização de `persistUserSnapshotForDay` (snapshot diário do patrimônio,
// cota TWRR por Modified Dietz), gravada no código ANTERIOR à divisão em partes.
// Trava o retorno E o que seria escrito: filtro, update e opções de cada chamada
// de escrita no WalletSnapshot, além das consultas e dos alertas. Nenhum teste
// toca o banco: modelos mockados, cenários de PRNG semeado, relógio fixo.

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  userAssetFind: vi.fn(),
  dividendFind: vi.fn(),
  snapshotFindOne: vi.fn(),
  snapshotExists: vi.fn(),
  snapshotFindOneAndUpdate: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  captureMessage: vi.fn(),
  log: [],
}));

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: mocks.dividendFind } }));
vi.mock('../models/WalletSnapshot.js', () => ({
  default: {
    findOne: mocks.snapshotFindOne,
    exists: mocks.snapshotExists,
    findOneAndUpdate: mocks.snapshotFindOneAndUpdate,
    deleteMany: mocks.snapshotDeleteMany,
  },
}));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));
vi.mock('../utils/dayCloses.js', () => ({ loadClosesForDay: async () => new Map() }));
vi.mock('../services/walletDayCandleService.js', () => ({ ensureWalletDayCandles: async () => new Map() }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
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
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: mocks.captureMessage }));
vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn((m) => mocks.log.push(['error', m])),
    warn: vi.fn((m) => mocks.log.push(['warn', m])),
    debug: vi.fn(),
  },
}));

const { financialService } = await import('../services/financialService.js');
const { persistUserSnapshotForDay } = await import('../services/schedulerService.js');

const NOW = new Date('2026-09-01T03:00:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.log.length = 0;
});

const isoPlus = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const POSITION_POOL = [
  { ticker: 'PETR4', type: 'STOCK', currency: 'BRL', totalCost: 300 },
  { ticker: 'HGLG11', type: 'FII', currency: 'BRL', totalCost: 1500 },
  { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', totalCost: 400, totalCostBrl: 2100 },
  { ticker: 'BTC', type: 'CRYPTO', currency: 'USD', totalCost: 50, totalCostBrl: 260 },
  { ticker: 'SEMCOT3', type: 'STOCK', currency: 'BRL', totalCost: 80 },
  { ticker: 'GRATIS3', type: 'STOCK', currency: 'BRL', totalCost: 0 },
  {
    ticker: 'CDB-110', type: 'FIXED_INCOME', currency: 'BRL', quantity: 1, totalCost: 1000,
    fixedIncomeIndex: 'CDI', fixedIncomeRate: 110, startDate: new Date('2026-01-05T12:00:00Z'),
  },
  {
    ticker: 'NTNB-35', type: 'FIXED_INCOME', currency: 'BRL', quantity: 1, totalCost: 2000,
    fixedIncomeIndex: 'IPCA', fixedIncomeSpread: 6, startDate: new Date('2026-02-02T12:00:00Z'),
  },
  { ticker: 'CAIXA', type: 'CASH', currency: 'BRL', quantity: 1, totalCost: 500, startDate: new Date('2026-03-02T12:00:00Z') },
];
const QTYS = [0, 1, 2.5, 10, 100, 0.0005, -1, 5e-10];

function buildPositions(r) {
  return POSITION_POOL.filter(() => r() < 0.45).map((p) => (
    p.quantity !== undefined ? { ...p } : { ...p, quantity: pick(r, QTYS) }
  ));
}

// [ticker, chave do fechamento, preço-base]
const PRICE_BASES = [
  ['GRATIS3', 'GRATIS3', 9], ['PETR4', 'PETR4', 35], ['HGLG11', 'HGLG11', 160], ['AAPL', 'AAPL', 210], ['BTC', 'BTC-USD', 60000],
];

function buildCtx(r, dayStr) {
  const priceMap = new Map();
  const closeMap = new Map();
  for (const [t, key, base] of PRICE_BASES) {
    if (r() < 0.6) priceMap.set(t, { price: Math.round(base * (0.5 + r()) * 100) / 100 });
    if (r() < 0.4) closeMap.set(key, Math.round(base * (0.5 + r()) * 100) / 100);
  }
  const ipca = pick(r, [4.4, 4.4, 4.4, null, 0]);
  const ctx = {
    priceMap, closeMap,
    macroRates: { cdiRate: 14, selic: 14.25, ipca, cdiCurve: null },
    usdRate: pick(r, [5.2, 5.2, null, 5.45, 5.45]),
    getUsdRateForDate: pick(r, [null, 'fn', 'fn', 'zero']),
  };
  if (ctx.getUsdRateForDate === 'fn') ctx.getUsdRateForDate = (day) => 5 + (Number(day.slice(8, 10)) % 5) / 10;
  else if (ctx.getUsdRateForDate === 'zero') ctx.getUsdRateForDate = (day) => (day === dayStr ? 5.3 : 0);
  if (r() < 0.3) ctx.treasuryPricing = { historyFor: () => null };
  return ctx;
}

function buildLastSnapshot(r, dayStr) {
  const kind = pick(r, ['none', 'none', 'normal', 'normal', 'quota100', 'zeroEquity', 'badCalc']);
  if (kind === 'none') return null;
  const prevDay = isoPlus(dayStr, -1 - Math.floor(r() * 3));
  const snap = {
    _id: 'prev', dayKey: r() < 0.8 ? prevDay : undefined,
    date: new Date(`${prevDay}T23:59:00.000-03:00`),
    calculatedAt: r() < 0.7 ? new Date(`${prevDay}T23:59:30.000-03:00`) : undefined,
    totalEquity: kind === 'zeroEquity' ? 0 : Math.round(r() * 8000 * 100) / 100,
    quotaPrice: kind === 'quota100' ? 100.02 : pick(r, [100, 104.5, 87.2, undefined, 120]),
  };
  if (kind === 'badCalc') snap.calculatedAt = 'nao-e-data';
  return snap;
}

function buildTransactions(r, dayStr, positions) {
  const tickers = [...positions.map((p) => p.ticker), 'VENDIDA3', 'MSFT'];
  return Array.from({ length: Math.floor(r() * 6) }, () => {
    const ticker = pick(r, tickers);
    const sameDay = r() < 0.5;
    const tx = {
      ticker: r() < 0.1 ? ticker.toLowerCase() : ticker,
      type: r() < 0.03 ? 'BONUS' : pick(r, ['BUY', 'BUY', 'SELL']),
      quantity: pick(r, [1, 2, 5, 0.5]),
      totalValue: Math.round(r() * 2000 * 100) / 100,
      date: new Date(`${sameDay ? dayStr : isoPlus(dayStr, -2)}T${pick(r, ['12', '02'])}:00:00.000Z`),
    };
    if (ticker === 'MSFT' || (ticker === 'AAPL' && r() < 0.5)) tx.currency = 'USD';
    if (r() < 0.2) tx.fxRate = 5.11;
    return tx;
  });
}

function buildDividends(r, positions) {
  const events = [];
  for (const t of [...positions.map((p) => p.ticker), 'VENDIDA3', 'MSFT']) {
    if (r() < 0.45) continue;
    const ev = { ticker: r() < 0.1 ? t.toLowerCase() : t, amount: Math.round(r() * 300) / 100, type: pick(r, ['DIVIDEND', 'JCP', undefined]) };
    events.push(ev);
    if (r() < 0.3) events.push({ ...ev, amount: ev.amount + 0.5 });
    // Mesma fonte sem `type` × com 'DIVIDEND': a deduplicação as trata como um só.
    if (r() < 0.3) events.push({ ...ev, amount: ev.amount + 0.25, type: ev.type ? undefined : 'DIVIDEND' });
  }
  return events;
}

function buildScenario(seed) {
  const r = mulberry32(seed);
  const dayStr = isoPlus('2026-07-01', Math.floor(r() * 60));
  const positions = buildPositions(r);
  return {
    dayStr,
    wallet: r() < 0.5 ? { _id: 'w1', user: 'u1' } : { _id: 'w1', user: { _id: 'u1', email: 'x' } },
    positions,
    passAssets: r() < 0.5,
    passOptions: r() < 0.9,
    force: r() < 0.4,
    ctx: buildCtx(r, dayStr),
    last: buildLastSnapshot(r, dayStr),
    exists: pick(r, [null, { _id: 'any' }]),
    txs: buildTransactions(r, dayStr, positions),
    dividends: buildDividends(r, positions),
    accrued: pick(r, [0, 12.34, 250]),
    sentry: r() < 0.5,
  };
}

function wire(s) {
  mocks.userAssetFind.mockResolvedValue(s.positions);
  mocks.snapshotFindOne.mockReturnValue({ sort: vi.fn(async () => s.last) });
  mocks.snapshotExists.mockResolvedValue(s.exists);
  mocks.txFind.mockResolvedValue(s.txs);
  mocks.dividendFind.mockReturnValue({ lean: vi.fn(async () => s.dividends) });
  mocks.snapshotFindOneAndUpdate.mockImplementation(async (_f, update) => ({ ...update.$set, _id: 'saved' }));
  mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 1 });
}

const errorShape = (e) => ({ name: e?.name, message: e?.message, code: e?.code });

async function runScenario(seed) {
  const s = buildScenario(seed);
  wire(s);
  const accrued = vi.spyOn(financialService, 'accruedDividendsThroughDay').mockResolvedValue(s.accrued);
  if (s.sentry) process.env.SENTRY_DSN = 'https://teste.invalid/1';
  else delete process.env.SENTRY_DSN;
  let result;
  try {
    const opts = s.passOptions ? { assets: s.passAssets ? s.positions : null, force: s.force } : undefined;
    result = await persistUserSnapshotForDay(s.wallet, s.dayStr, s.ctx, opts);
  } catch (e) {
    result = { thrown: errorShape(e) };
  } finally {
    delete process.env.SENTRY_DSN;
  }
  const out = {
    result,
    writes: {
      findOneAndUpdate: mocks.snapshotFindOneAndUpdate.mock.calls,
      deleteMany: mocks.snapshotDeleteMany.mock.calls,
    },
    reads: {
      userAsset: mocks.userAssetFind.mock.calls,
      lastSnapshot: mocks.snapshotFindOne.mock.calls,
      lastSnapshotSort: mocks.snapshotFindOne.mock.results.map((x) => x.value.sort.mock.calls),
      exists: mocks.snapshotExists.mock.calls,
      tx: mocks.txFind.mock.calls,
      dividends: mocks.dividendFind.mock.calls,
      accrued: accrued.mock.calls,
    },
    log: mocks.log.slice(),
    sentry: mocks.captureMessage.mock.calls,
  };
  accrued.mockRestore();
  return out;
}

describe('caracterização — persistUserSnapshotForDay', () => {
  it('1000 cenários semeados: retorno, escritas, consultas e alertas', async () => {
    const hashes = [];
    const full = {};
    const tally = {};
    for (let seed = 1; seed <= 1000; seed++) {
      const out = await runScenario(seed);
      hashes.push(`${seed}:${hash16(out)}`);
      const key = typeof out.result === 'string' ? out.result : out.result.thrown.code || out.result.thrown.name;
      tally[key] = (tally[key] || 0) + 1;
      if (!full[key]) full[key] = { seed, out: canon(out) };
    }
    expect(tally).toMatchSnapshot();
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  }, 60_000); // 1000 cenários: ~3,5 s sozinho, mais de 15 s com cobertura e máquina carregada

  it('carteira vazia devolve empty sem escrever', async () => {
    wire({ positions: [], last: null, exists: null, txs: [], dividends: [] });
    const r = await persistUserSnapshotForDay({ _id: 'w1', user: 'u1' }, '2026-07-08', {
      priceMap: new Map(), closeMap: new Map(), macroRates: { ipca: 4.4 }, usdRate: 5.2, getUsdRateForDate: null,
    });
    expect(r).toBe('empty');
    expect(mocks.snapshotFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('cota que volta a ~100 com histórico longe de 100 aborta (reset-guard)', async () => {
    const positions = [{ ticker: 'PETR4', type: 'STOCK', currency: 'BRL', quantity: 10, totalCost: 300 }];
    const last = { _id: 'prev', dayKey: '2026-07-07', date: new Date('2026-07-08T02:59:00Z'), totalEquity: 1199.4003, quotaPrice: 120 };
    wire({ positions, last, exists: null, txs: [], dividends: [] });
    const ctx = { priceMap: new Map([['PETR4', { price: 100 }]]), closeMap: new Map(), macroRates: { ipca: 4.4 }, usdRate: 5.2 };
    expect(await persistUserSnapshotForDay({ _id: 'w1', user: 'u1' }, '2026-07-08', ctx, { assets: positions })).toBe('reset-guard');
    expect(mocks.snapshotFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('câmbio ausente num lançamento em dólar lança FX_UNAVAILABLE sem escrever', async () => {
    const positions = [{ ticker: 'PETR4', type: 'STOCK', currency: 'BRL', quantity: 10, totalCost: 300 }];
    wire({
      positions, last: null, exists: null, dividends: [],
      txs: [{ ticker: 'MSFT', type: 'BUY', currency: 'USD', quantity: 1, totalValue: 100, date: new Date('2026-07-07T12:00:00Z') }],
    });
    const ctx = {
      priceMap: new Map([['PETR4', { price: 30 }]]), closeMap: new Map(), macroRates: { ipca: 4.4 },
      usdRate: null, getUsdRateForDate: () => 0,
    };
    await expect(persistUserSnapshotForDay({ _id: 'w1', user: 'u1' }, '2026-07-08', ctx, { assets: positions }))
      .rejects.toMatchObject({ code: 'FX_UNAVAILABLE' });
    expect(mocks.snapshotFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
