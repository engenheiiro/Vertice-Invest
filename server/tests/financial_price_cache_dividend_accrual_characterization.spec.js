import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';

// Caracterização de dois caminhos do patrimônio em financialService, gravada no
// código ANTERIOR à divisão em partes:
//  - `_loadPriceCacheMap`: o Map ticker → (dia → {close, adjClose}) que o rebuild
//    usa para marcar a carteira, com o fallback externo e a regravação da série;
//  - `accrueDividendsByTicker`: o acumulado de proventos por ex-date (total, pago,
//    pendente, por ticker e a janela `sinceDayKey`).
// Nenhum teste toca o banco: modelos e serviços externos mockados, cenários
// gerados por PRNG semeado, relógio fixo.

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  userAssetFind: vi.fn(),
  dividendFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  marketAssetFindOne: vi.fn(),
  historyUpdateOne: vi.fn(),
  getBenchmarkHistory: vi.fn(),
  getFullHistory: vi.fn(),
  log: [],
}));

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: mocks.dividendFind } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: mocks.systemConfigFindOne } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { findOne: mocks.marketAssetFindOne } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { updateOne: mocks.historyUpdateOne } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getBenchmarkHistory: mocks.getBenchmarkHistory },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistory: mocks.getFullHistory },
}));
vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((m) => mocks.log.push(['warn', m])),
    debug: vi.fn((m) => mocks.log.push(['debug', m])),
  },
}));

const { financialService } = await import('../services/financialService.js');

const NOW = new Date('2026-11-20T15:00:00.000Z');
const sortedByJson = (list) => list.map((x) => JSON.stringify(canon(x))).sort();

const isoPlus = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.log.length = 0;
});

// ---------------------------------------------------------------- _loadPriceCacheMap

const META_POOL = {
  PETR4: 'STOCK', HGLG11: 'FII', AAPL: 'STOCK_US', BTC: 'CRYPTO', IVVB11: 'ETF',
  'CDB-X': 'FIXED_INCOME', CAIXA: 'CASH', '^BVSP': undefined, RESERVA: undefined, NOMETA3: undefined,
};
const TICKER_POOL = Object.keys(META_POOL);
const MARKET_TYPES = [null, 'STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'THROW'];

function buildCandles(r, start, length) {
  return Array.from({ length }, (_, i) => {
    const close = r() < 0.1 ? 0 : Math.round(r() * 10000) / 100;
    const candle = { date: isoPlus(start, i), close };
    if (r() < 0.7) candle.adjClose = r() < 0.1 ? 0 : Math.round(close * 0.97 * 100) / 100;
    return candle;
  });
}

function buildSeries(r, kind) {
  const start = isoPlus('2024-01-01', Math.floor(r() * 800));
  if (kind === 'null') return null;
  if (kind === 'empty') return [];
  if (kind === 'short') return buildCandles(r, start, 1 + Math.floor(r() * 4));
  if (kind === 'nodate') return [{ close: 1 }, ...buildCandles(r, start, 5 + Math.floor(r() * 5))];
  return buildCandles(r, start, 5 + Math.floor(r() * 40));
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function buildPriceScenario(seed) {
  const r = mulberry32(seed);
  const tickers = [...new Set(Array.from({ length: 1 + Math.floor(r() * 5) }, () => pick(r, TICKER_POOL)))];
  const metadata = new Map();
  const required = new Map();
  const plan = {};
  for (const t of tickers) {
    if (r() < 0.8 && META_POOL[t] !== undefined) metadata.set(t, { ticker: t, type: META_POOL[t] });
    else if (r() < 0.3) metadata.set(t, { ticker: t });
    if (r() < 0.6) required.set(t, isoPlus('2024-01-01', Math.floor(r() * 900)));
    plan[t] = {
      bench: pick(r, ['null', 'empty', 'short', 'long', 'long', 'nodate', 'throw']),
      market: pick(r, MARKET_TYPES),
      ext: pick(r, ['null', 'empty', 'short', 'long', 'long', 'throw']),
      updateThrows: r() < 0.15,
    };
    plan[t].benchSeries = plan[t].bench === 'throw' ? null : buildSeries(r, plan[t].bench);
    plan[t].extSeries = plan[t].ext === 'throw' ? null : buildSeries(r, plan[t].ext);
    // Fronteira: a série começa exatamente no 1º dia exigido.
    const first = plan[t].benchSeries?.[0]?.date;
    if (first && r() < 0.25) required.set(t, first);
  }
  return { tickers, metadata, required, plan };
}

function wirePriceMocks(plan) {
  const byBench = (ticker) => plan[ticker];
  const bySearch = (search) => Object.entries(plan).find(([t]) => financialService.normalizeTickerForHistory(t) === search)?.[1];
  mocks.getBenchmarkHistory.mockImplementation(async (ticker) => {
    const p = byBench(ticker);
    if (p.bench === 'throw') throw new Error(`bench ${ticker}`);
    return p.benchSeries ? p.benchSeries.map((c) => ({ ...c })) : p.benchSeries;
  });
  mocks.marketAssetFindOne.mockImplementation(async ({ ticker }) => {
    const m = plan[ticker].market;
    if (m === 'THROW') throw new Error(`market ${ticker}`);
    return m ? { ticker, type: m } : null;
  });
  mocks.getFullHistory.mockImplementation(async (search) => {
    const p = bySearch(search);
    if (!p || p.ext === 'throw') throw new Error(`ext ${search}`);
    return p.extSeries ? p.extSeries.map((c) => ({ ...c })) : p.extSeries;
  });
  mocks.historyUpdateOne.mockImplementation(async (filter) => {
    const owner = Object.entries(plan).find(([t]) => filter.ticker.startsWith(t));
    if (owner?.[1].updateThrows) throw new Error(`update ${filter.ticker}`);
    return { acknowledged: true };
  });
}

async function runPriceScenario(seed) {
  const { tickers, metadata, required, plan } = buildPriceScenario(seed);
  wirePriceMocks(plan);
  const args = required.size > 0 || seed % 7 !== 0 ? [tickers, metadata, required] : [tickers, metadata];
  const result = await financialService._loadPriceCacheMap(...args);
  const map = {};
  for (const t of [...result.keys()].sort()) map[t] = [...result.get(t).entries()];
  return {
    input: { tickers, required: [...required.entries()] },
    map,
    insertionOrderSize: result.size,
    calls: {
      bench: sortedByJson(mocks.getBenchmarkHistory.mock.calls),
      market: sortedByJson(mocks.marketAssetFindOne.mock.calls),
      ext: sortedByJson(mocks.getFullHistory.mock.calls),
      update: sortedByJson(mocks.historyUpdateOne.mock.calls),
    },
    log: sortedByJson(mocks.log),
  };
}

describe('caracterização — financialService._loadPriceCacheMap', () => {
  it('300 cenários semeados: Map resultante, chamadas e logs', async () => {
    const hashes = [];
    const full = {};
    for (let seed = 1; seed <= 300; seed++) {
      const out = await runPriceScenario(seed);
      hashes.push(`${seed}:${hash16(out)}`);
      if (seed <= 3) full[seed] = canon(out);
    }
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  });

  it('renda fixa, caixa e RESERVA não buscam série', async () => {
    const meta = new Map([['CDB-X', { type: 'FIXED_INCOME' }], ['CAIXA', { type: 'CASH' }]]);
    const result = await financialService._loadPriceCacheMap(['CDB-X', 'CAIXA', 'RESERVA'], meta);
    expect(result.size).toBe(0);
    expect(mocks.getBenchmarkHistory).not.toHaveBeenCalled();
  });

  it('série local que não alcança o 1º dia da posição busca a externa e não regrava', async () => {
    const local = buildCandles(mulberry32(9), '2025-06-02', 10);
    const deep = buildCandles(mulberry32(10), '2024-01-02', 30);
    mocks.getBenchmarkHistory.mockResolvedValue(local);
    mocks.marketAssetFindOne.mockResolvedValue(null);
    mocks.getFullHistory.mockResolvedValue(deep);
    const result = await financialService._loadPriceCacheMap(
      ['PETR4'], new Map([['PETR4', { type: 'STOCK' }]]), new Map([['PETR4', '2024-01-05']]));
    expect(mocks.getFullHistory).toHaveBeenCalledWith('PETR4.SA', 'STOCK');
    expect(mocks.historyUpdateOne).not.toHaveBeenCalled();
    expect(result.get('PETR4').size).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------- accrueDividendsByTicker

const DIV_TICKERS = [
  { ticker: 'PETR4', type: 'STOCK' },
  { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' },
  { ticker: 'HGLG11', type: 'FII' },
  { ticker: 'VOO', type: 'ETF', currency: 'USD' },
  { ticker: 'BTC', type: 'CRYPTO' },
];
const QTYS = [1, 2.5, 0.3333, 10, 100, 1e-9, 7];

function buildTransactions(r) {
  const txs = Array.from({ length: Math.floor(r() * 9) }, () => {
    const asset = pick(r, DIV_TICKERS);
    const tx = {
      ticker: asset.ticker,
      type: r() < 0.7 ? 'BUY' : 'SELL',
      quantity: pick(r, QTYS),
      date: new Date(`${isoPlus('2026-01-01', Math.floor(r() * 90))}T12:00:00.000Z`),
    };
    if (asset.currency === 'USD' && r() < 0.6) tx.currency = 'USD';
    return tx;
  });
  return r() < 0.9 ? txs.sort((a, b) => a.date - b.date) : txs;
}

function buildEvents(r, txs) {
  const tickers = [...new Set([...txs.map((t) => t.ticker), pick(r, DIV_TICKERS).ticker])];
  const events = [];
  for (const ticker of tickers) {
    for (let i = Math.floor(r() * 5); i > 0; i--) {
      const day = isoPlus('2026-01-01', Math.floor(r() * 100));
      const ev = {
        ticker, amount: Math.round(r() * 300) / 100,
        date: new Date(`${day}T${r() < 0.5 ? '00' : '13'}:00:00.000Z`),
        type: pick(r, ['DIVIDEND', 'JCP', undefined]),
      };
      if (r() < 0.4) ev.paymentDate = new Date(`${isoPlus(day, Math.floor(r() * 40))}T00:00:00.000Z`);
      events.push(ev);
      if (r() < 0.2) events.push({ ...ev, amount: ev.amount + 0.01 });
    }
  }
  return events.sort((a, b) => a.date - b.date);
}

const chainable = (value) => {
  const q = Object.assign(Promise.resolve(value), {
    sort: vi.fn(() => q), select: vi.fn(() => q), lean: vi.fn(async () => value),
  });
  return q;
};

const fxForDay = (day) => 5 + (Number(day.slice(8, 10)) % 7) / 10;

function buildDividendScenario(seed) {
  const r = mulberry32(seed);
  const txs = buildTransactions(r);
  const events = buildEvents(r, txs);
  const through = isoPlus('2026-01-01', Math.floor(r() * 110));
  const options = {};
  if (r() < 0.5) options.sinceDayKey = isoPlus('2026-01-01', Math.floor(r() * 100));
  if (r() < 0.4) options.transactions = txs;
  if (r() < 0.3) {
    const map = new Map();
    for (const ev of events) {
      const k = financialService.toDateKey(ev.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(ev);
    }
    options.dividendDateMap = map;
  }
  if (r() < 0.3) options.assets = DIV_TICKERS.filter(() => r() < 0.5);
  if (r() < 0.2) options.dividendFx = (ticker, day) => (ticker === 'AAPL' ? fxForDay(day) : 1);
  if (r() < 0.3) options.getUsdRateForDate = (day) => fxForDay(day) + 0.05;
  const positions = DIV_TICKERS.filter(() => r() < 0.5);
  const sysConfig = pick(r, ['reject', null, { dollar: 5.4 }]);
  return { txs, events, through, options, positions, sysConfig };
}

async function runDividendScenario(seed) {
  const { txs, events, through, options, positions, sysConfig } = buildDividendScenario(seed);
  mocks.txFind.mockImplementation(() => chainable(txs));
  mocks.dividendFind.mockImplementation(() => chainable(events));
  mocks.userAssetFind.mockImplementation(() => chainable(positions));
  mocks.systemConfigFindOne.mockImplementation(() => {
    const q = chainable(sysConfig);
    if (sysConfig === 'reject') q.lean = vi.fn(() => Promise.reject(new Error('macro')));
    return q;
  });
  const resolver = vi.spyOn(financialService, '_loadUsdRateResolver').mockImplementation(async (rate) => (day) => fxForDay(day) + (rate ? 0.2 : 0));
  const result = await financialService.accrueDividendsByTicker('u1', 'w1', through, options);
  const out = {
    result,
    calls: {
      txFind: mocks.txFind.mock.calls,
      txSort: mocks.txFind.mock.results.map((x) => x.value.sort.mock.calls),
      dividendFind: mocks.dividendFind.mock.calls,
      userAssetFind: mocks.userAssetFind.mock.calls,
      userAssetSelect: mocks.userAssetFind.mock.results.map((x) => x.value.select.mock.calls),
      systemConfig: mocks.systemConfigFindOne.mock.calls,
      resolver: resolver.mock.calls,
    },
  };
  resolver.mockRestore();
  return out;
}

describe('caracterização — financialService.accrueDividendsByTicker', () => {
  it('400 cenários semeados: total, pago, pendente, por ticker e janela since', async () => {
    const hashes = [];
    const full = {};
    for (let seed = 1; seed <= 400; seed++) {
      const out = await runDividendScenario(seed);
      hashes.push(`${seed}:${hash16(out)}`);
      if (seed <= 3) full[seed] = canon(out);
    }
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  });

  it('sem lançamentos devolve zeros sem consultar proventos', async () => {
    mocks.txFind.mockImplementation(() => chainable([]));
    const result = await financialService.accrueDividendsByTicker('u1', 'w1', '2026-03-01');
    expect(result).toEqual({ total: 0, paid: 0, pending: 0, byTicker: {}, sinceTotal: 0, sinceByTicker: {} });
    expect(mocks.dividendFind).not.toHaveBeenCalled();
  });

  it('compra no dia-ex não recebe; venda no dia-ex recebe', async () => {
    const at = (d) => new Date(`${d}T12:00:00.000Z`);
    const transactions = [
      { ticker: 'PETR4', type: 'BUY', quantity: 10, date: at('2026-02-01') },
      { ticker: 'PETR4', type: 'SELL', quantity: 10, date: at('2026-02-10') },
      { ticker: 'HGLG11', type: 'BUY', quantity: 5, date: at('2026-02-10') },
    ];
    const dividendDateMap = new Map([['2026-02-10', [
      { ticker: 'PETR4', amount: 1 }, { ticker: 'HGLG11', amount: 1 },
    ]]]);
    const result = await financialService.accrueDividendsByTicker('u1', 'w1', '2026-03-31', {
      transactions, dividendDateMap, dividendFx: () => 1,
    });
    expect(result.byTicker).toEqual({ PETR4: 10 });
  });
});
