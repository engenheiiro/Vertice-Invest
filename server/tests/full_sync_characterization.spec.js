import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';
import { CRYPTO_ASSETS } from '../config/cryptoList.js';

// Caracterização do sync completo (`syncService._runFullSync` / `performFullSync`)
// e da gravação de uma linha do Fundamentus (`buildFundamentusAssetUpdate`),
// gravada no código ANTERIOR à divisão em partes. Trava a SEQUÊNCIA de chamadas
// externas e de banco (com argumentos), os logs e o resultado devolvido —
// inclusive fonte bloqueada, ingestão degradada, falha em cada etapa e lease
// ocupado. Nada toca rede nem Mongo: serviços e modelos mockados, cenários de
// PRNG semeado, relógio fixo.

const mocks = vi.hoisted(() => ({ calls: [], scenario: null }));
const rec = (name, ...args) => mocks.calls.push([name, ...args]);
const maybeThrow = (stage) => {
  if (mocks.scenario?.failAt === stage) throw new Error(`falha simulada: ${stage}`);
};

vi.mock('yahoo-finance2', () => ({
  default: class {
    quoteSummary(symbol, query, opts) {
      rec('yahoo.quoteSummary', symbol, query, opts);
      const behavior = mocks.scenario.ltmBehavior[symbol];
      if (behavior.kind === 'throwSync') throw new Error('sync boom');
      if (behavior.kind === 'pending') return new Promise(() => {});
      if (behavior.kind === 'reject') return Promise.reject(behavior.error);
      return Promise.resolve(behavior.data);
    }
  },
}));

const chain = (value) => {
  const arr = value;
  arr.lean = () => { rec('lean'); return value; };
  return { select: (fields) => { rec('select', fields); return arr; } };
};

vi.mock('../models/MarketAsset.js', () => ({
  default: {
    find: (filter) => {
      rec('MarketAsset.find', filter);
      const s = mocks.scenario;
      if (filter.isBlacklisted === true) { maybeThrow('retiredFind'); return chain(s.retired.map((ticker) => ({ ticker }))); }
      if (filter.type?.$in) { maybeThrow('externalFind'); return chain(s.external.map((a) => ({ ...a }))); }
      if (filter.ticker?.$in) { maybeThrow('foreignFind'); return chain(s.foreign.map((a) => ({ ...a }))); }
      if (filter.type === 'STOCK_US') { maybeThrow('usFind'); return chain(s.usAssets.map((a) => ({ ...a }))); }
      if (filter.type === 'STOCK') { maybeThrow('ltmFind'); return chain(s.ltmCandidates.map((a) => ({ ...a }))); }
      throw new Error('filtro inesperado');
    },
    bulkWrite: async (ops) => {
      rec('MarketAsset.bulkWrite', ops);
      const s = mocks.scenario;
      s.bulkCount = (s.bulkCount || 0) + 1;
      // 1ª gravação = acervo; com usSubType = Exterior; as demais = LTM.
      const isUs = Boolean(ops[0]?.updateOne?.update?.$set?.usSubType);
      const kind = s.bulkCount === 1 ? 'mainBulk' : (isUs ? 'usBulk' : 'ltmBulk');
      maybeThrow(kind);
      return { ok: 1 };
    },
  },
}));

vi.mock('../models/SystemConfig.js', () => ({
  default: {
    findOneAndUpdate: async (...args) => {
      rec('SystemConfig.findOneAndUpdate', ...args);
      if (args[1]?.$set?.lastSyncStats?.fundamentalsHealthy === true) maybeThrow('statsWrite');
      return {};
    },
    findOne: async (filter) => {
      rec('SystemConfig.findOne', filter);
      const s = mocks.scenario;
      s.findOneCount = (s.findOneCount || 0) + 1;
      if (s.findOneCount === 1) maybeThrow('findOne4');
      if (s.findOneCount === 2) maybeThrow('findOne45');
      return s.macroConfig;
    },
  },
}));

vi.mock('../services/fundamentusService.js', () => ({
  fundamentusService: {
    getStocksMap: async () => { rec('fundamentus.getStocksMap'); maybeThrow('stocksMap'); return mocks.scenario.stocksMap; },
    getFIIsMap: async () => { rec('fundamentus.getFIIsMap'); return mocks.scenario.fiiMap; },
  },
}));
vi.mock('../services/macroDataService.js', () => ({
  macroDataService: { performMacroSync: async () => { rec('macro.performMacroSync'); maybeThrow('macro'); } },
}));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: {
    refreshQuotesBatch: async (batch, flag) => { rec('market.refreshQuotesBatch', batch, flag); maybeThrow('refreshQuotes'); },
  },
}));
vi.mock('../services/usStocksFundamentalsService.js', () => ({
  usStocksFundamentalsService: {
    seedSP500Assets: async () => { rec('us.seedSP500Assets'); maybeThrow('seedSP500'); },
    seedBrEtfAssets: async () => { rec('us.seedBrEtfAssets'); },
    syncUSStocksFundamentals: async () => { rec('us.syncUSStocksFundamentals'); maybeThrow('syncUS'); },
    syncBrEtfFundamentals: async () => { rec('us.syncBrEtfFundamentals'); maybeThrow('syncBrEtf'); },
  },
}));
vi.mock('../services/sectorBackfillService.js', () => ({
  backfillSectors: async () => { rec('backfillSectors'); maybeThrow('backfill'); return { updated: mocks.scenario.backfillUpdated }; },
}));
vi.mock('../services/fundamentalHistoryService.js', () => ({
  appendSnapshots: async (records, ts) => {
    rec('appendSnapshots', records, ts);
    maybeThrow('append');
    return { appended: mocks.scenario.appended };
  },
}));
vi.mock('../utils/mongoResilience.js', () => ({
  withMongoRetry: (fn, opts) => { rec('withMongoRetry', opts); return fn(); },
}));
vi.mock('../utils/jobRun.js', () => ({
  trackJob: async (jobId, fn) => {
    rec('trackJob', jobId);
    try { return await fn(); } catch (err) { rec('trackJob.threw', err.message); return { trackJobError: err.message }; }
  },
}));
vi.mock('../utils/jobLease.js', () => ({
  withJobLease: async (jobId, fn) => {
    rec('withJobLease', jobId);
    if (mocks.scenario.leaseHeld) return { skipped: true, reason: 'LEASE_HELD' };
    return fn();
  },
}));
vi.mock('../services/dataHealthService.js', () => ({
  runDataHealthCheck: async (opts) => {
    rec('runDataHealthCheck', opts);
    if (mocks.scenario.healthFails) throw new Error('sentinela caiu');
  },
}));
vi.mock('../config/logger.js', () => ({
  default: {
    info: (...a) => rec('log.info', ...a),
    warn: (...a) => rec('log.warn', ...a),
    error: (...a) => rec('log.error', ...a),
    debug: (...a) => rec('log.debug', ...a),
  },
}));

const { syncService, buildFundamentusAssetUpdate } = await import('../services/syncService.js');

const NOW = new Date('2026-11-23T14:00:00.000Z');
const HOUR = 3600000;
const realSetTimeout = globalThis.setTimeout;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // Pausas do sync (200 ms entre lotes, 400 ms no LTM) e o relógio de 8 s do
  // Yahoo disparam na hora: o teste não espera, e o "pending" cai no timeout.
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms === 200 || ms === 400 || ms === 8000) { fn(); return 0; }
    return realSetTimeout(fn, ms, ...rest);
  };
});
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
  vi.useRealTimers();
});
beforeEach(() => { mocks.calls.length = 0; });

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const VALUES = [0, 1.5, -3, '12.3', 'abc', null, undefined, Number.NaN, 1e12, '0', 0.07, 250];
const LIQ_LOW = [0, 4999, 5000, null, undefined, 'x', 1200];
const LIQ_HIGH = [5001, 99999, 100000, 100001, 2e6, '7000', '250000'];
const STOCK_SECTORS = [undefined, 'Bancos', 'Energia Elétrica', 'Petróleo, Gás e Biocombustíveis', 'Varejo', ''];
const FII_SECTORS = [undefined, 'Logística', 'Shoppings', 'Títulos e Val. Mob.', 'Híbrido', 'Lajes Corporativas'];
const DATA_FIELDS = [
  'price', 'dy', 'pvp', 'pl', 'roe', 'roic', 'netMargin', 'evEbitda', 'cresRec5a', 'debtToEquity', 'divBrutaPatrim',
  'vacancy', 'capRate', 'qtdImoveis', 'ffoYield', 'vpCota', 'ffoCota', 'marketCap', 'netDebt', 'netRevenue',
  'netIncome', 'totalAssets', 'patrimLiq', 'payout',
];

function buildRow(r, type, liquidP) {
  const data = {};
  for (const f of DATA_FIELDS) if (r() < 0.85) data[f] = pick(r, VALUES);
  data.sector = pick(r, type === 'FII' ? FII_SECTORS : STOCK_SECTORS);
  const liq = r() < liquidP ? pick(r, LIQ_HIGH) : pick(r, LIQ_LOW);
  if (r() < 0.5) data.liq2m = liq; else data.liquidity = liq;
  if (r() < 0.1) { data.liq2m = 0; data.liquidity = pick(r, LIQ_HIGH); }
  return data;
}

const STOCK_TYPOS = ['CPLEE5', 'AZULL4', 'JPSA3'];
const STOCK_TARGETS = ['CPLE6', 'AZUL4', 'IGTI3'];
const FII_TYPOS = ['CVBII11', 'MALLL11', 'QAGRR11'];
const FII_TARGETS = ['CVBI11', 'MALL11', 'QAGR11'];

function buildMap(r, type, size, liquidP) {
  const map = new Map();
  const typos = type === 'FII' ? FII_TYPOS : STOCK_TYPOS;
  const targets = type === 'FII' ? FII_TARGETS : STOCK_TARGETS;
  for (let i = 0; i < size; i++) {
    const roll = r();
    let ticker;
    if (roll < 0.03) ticker = pick(r, typos);
    else if (roll < 0.05) ticker = pick(r, targets);
    else if (roll < 0.07) ticker = `SHR${Math.floor(r() * 5)}3`; // repete entre classes
    else ticker = type === 'FII' ? `F${i}X11` : `S${i}A3`;
    map.set(ticker, buildRow(r, type, liquidP));
  }
  return map;
}

const CRYPTO_TICKERS = CRYPTO_ASSETS.map((c) => c.ticker);

function buildLtmScenario(r) {
  const candidates = [];
  const behavior = {};
  const n = Math.floor(r() * 24);
  for (let i = 0; i < n; i++) {
    const ticker = `L${i}T3`;
    const a = { ticker };
    for (const f of ['netRevenue', 'netIncome', 'netDebt', 'patrimLiq', 'marketCap']) {
      if (r() < 0.8) a[f] = pick(r, [0, null, 5e8, -2e7]);
    }
    candidates.push(a);
    const roll = r();
    let b;
    if (roll < 0.1) b = { kind: 'throwSync' };
    else if (roll < 0.18) b = { kind: 'pending' };
    else if (roll < 0.26) b = { kind: 'reject', error: new Error(pick(r, ['Not Found', 'No fundamentals data found', 'no data', 'notfound'])) };
    else if (roll < 0.34) {
      b = { kind: 'reject', error: pick(r, [new Error('HTTP 429'), new Error('ECONNRESET'), 'texto', undefined, { message: 'Not Found' }]) };
    }
    else {
      const num = () => pick(r, [undefined, null, 0, 1e9, 3.5e8, -4e7, 12.5]);
      const data = {};
      if (r() < 0.8) data.financialData = { totalRevenue: num(), netIncomeToCommon: num(), totalDebt: num(), totalCash: num() };
      if (r() < 0.8) data.defaultKeyStatistics = { sharesOutstanding: num(), bookValue: num() };
      if (r() < 0.8) data.summaryDetail = { marketCap: num() };
      b = { kind: 'resolve', data };
    }
    behavior[`${ticker}.SA`] = b;
  }
  return { candidates, behavior };
}

const FAIL_STAGES = [
  'macro', 'stocksMap', 'retiredFind', 'externalFind', 'foreignFind', 'seedSP500', 'mainBulk', 'append', 'backfill',
  'usFind', 'usBulk', 'refreshQuotes', 'findOne4', 'syncUS', 'syncBrEtf', 'findOne45', 'ltmFind', 'ltmBulk', 'statsWrite',
];
const SYNC_DATES = [undefined, null, 'lixo', NOW.getTime() - HOUR, NOW.getTime() - 23 * HOUR,
  NOW.getTime() - 23 * HOUR - 1, NOW.getTime() - 48 * HOUR];
const toDate = (v) => (typeof v === 'number' ? new Date(v) : v);

function buildScenario(seed, forced = null) {
  const r = mulberry32(seed);
  const drawnMode = pick(r, ['ok', 'ok', 'ok', 'ok', 'blocked', 'noFii', 'noStock', 'small', 'collapse']);
  const mode = forced ? 'ok' : drawnMode;
  const liquidP = mode === 'collapse' ? 0.05 : 0.55 + r() * 0.4 + (forced ? 0.3 : 0);
  const stockSize = { blocked: 0, noStock: 0, small: 60 }[mode] ?? 100 + Math.floor(r() * 50);
  const fiiSize = { blocked: 0, noFii: 0, small: 140 }[mode] ?? 100 + Math.floor(r() * 50);
  const stocksMap = buildMap(r, 'STOCK', stockSize, liquidP);
  const fiiMap = buildMap(r, 'FII', fiiSize, liquidP);
  const allTickers = [...stocksMap.keys(), ...fiiMap.keys(), ...STOCK_TARGETS, ...FII_TARGETS];
  const retired = allTickers.filter(() => r() < 0.04);
  const external = [];
  for (const t of CRYPTO_TICKERS) if (r() < 0.3) external.push({ ticker: t, type: 'CRYPTO', failCount: 0 });
  for (let i = 0; i < 8; i++) {
    if (r() < 0.6) external.push({ ticker: pick(r, [`US${i}`, '', '   ', null, 'BTC']), type: 'STOCK_US' });
  }
  const foreign = CRYPTO_TICKERS.filter(() => r() < 0.06)
    .map((t) => ({ ticker: t, type: pick(r, ['STOCK_US', 'STOCK']), name: `Dono de ${t}` }));
  const usAssets = [];
  for (let i = 0; i < 6; i++) {
    usAssets.push({
      ticker: pick(r, ['SPY', 'O', 'AAPL', 'IVVB11', 'GLD', `X${i}`]),
      sector: pick(r, [undefined, 'Technology', 'Real Estate', 'ETF']),
      name: pick(r, [undefined, 'iShares Core', 'Realty Income Corp', 'Apple Inc']),
      currency: pick(r, ['USD', 'BRL', undefined]),
      type: 'STOCK_US',
      usSubType: pick(r, [undefined, 'STOCK', 'ETF', 'REIT']),
    });
  }
  const ltm = buildLtmScenario(r);
  const macroConfig = r() < 0.15 ? null : {
    lastUSFundamentalsSync: toDate(pick(r, SYNC_DATES)),
    lastBRLTMEnrichSync: toDate(pick(r, SYNC_DATES)),
  };
  return {
    mode, stocksMap, fiiMap, retired, external, foreign, usAssets, macroConfig,
    ltmCandidates: ltm.candidates, ltmBehavior: ltm.behavior,
    appended: pick(r, [0, 3]), backfillUpdated: pick(r, [0, 2]),
    failAt: forced ?? (r() < 0.4 ? pick(r, FAIL_STAGES) : null),
    leaseHeld: r() < 0.2, healthFails: r() < 0.3,
  };
}

const describeScenario = (s) => ({
  mode: s.mode, failAt: s.failAt, stocks: s.stocksMap.size, fiis: s.fiiMap.size,
  ltm: s.ltmCandidates.length, leaseHeld: s.leaseHeld,
});

async function runScenario(seed, entry, forced = null) {
  const s = buildScenario(seed, forced);
  mocks.scenario = s;
  mocks.calls.length = 0;
  const result = entry === 'perform' ? await syncService.performFullSync() : await syncService._runFullSync();
  return { scenario: describeScenario(s), result, calls: mocks.calls.map((c) => canon(c)) };
}

describe('caracterização — syncService._runFullSync', () => {
  const SEEDS = Array.from({ length: 120 }, (_, i) => 1000 + i);

  it('cada cenário devolve o mesmo resultado com a mesma sequência de chamadas', async () => {
    const out = {};
    const modes = new Set();
    const fails = new Set();
    for (const seed of SEEDS) {
      const run = await runScenario(seed, 'run');
      modes.add(`${run.scenario.mode}:${run.result.success}:${run.result.errorCode ?? ''}`);
      if (run.scenario.failAt) fails.add(run.scenario.failAt);
      out[seed] = `${JSON.stringify(canon(run.scenario))} ${hash16(run)}`;
    }
    expect(fails.size).toBeGreaterThanOrEqual(15);
    expect([...modes].sort()).toMatchSnapshot('modos');
    expect(out).toMatchSnapshot();
  });

  it('cada etapa falhando num sync saudável', async () => {
    const out = {};
    for (const [i, stage] of FAIL_STAGES.entries()) {
      const run = await runScenario(9000 + i, 'run', stage);
      out[stage] = { result: canon(run.result), hash: hash16(run) };
    }
    expect(out).toMatchSnapshot();
  });

  it('cenários legíveis (resultado + nomes das chamadas)', async () => {
    const readable = {};
    for (const seed of [1000, 1001, 1002, 1003, 1004, 1005]) {
      const run = await runScenario(seed, 'run');
      readable[seed] = {
        scenario: run.scenario,
        result: canon(run.result),
        calls: run.calls.map((c) => (c[0].startsWith('log.') ? c : c[0])),
      };
    }
    expect(readable).toMatchSnapshot();
  });
});

describe('caracterização — syncService.performFullSync (trackJob + lease + sentinela)', () => {
  it('lease ocupado, sentinela falhando e sync normal', async () => {
    const out = {};
    for (let seed = 5000; seed < 5040; seed++) {
      const run = await runScenario(seed, 'perform');
      out[seed] = { scenario: run.scenario, result: canon(run.result), hash: hash16(run) };
    }
    expect(Object.values(out).some((o) => o.scenario.leaseHeld)).toBe(true);
    expect(out).toMatchSnapshot();
  });
});

describe('caracterização — buildFundamentusAssetUpdate', () => {
  it('linhas geradas por PRNG', () => {
    const r = mulberry32(77);
    const out = {};
    const ts = new Date('2026-11-23T10:00:00.000Z');
    for (let i = 0; i < 400; i++) {
      const type = r() < 0.5 ? 'FII' : 'STOCK';
      const data = buildRow(r, type, 0.5);
      if (r() < 0.2) delete data.debtToEquity;
      const ticker = pick(r, ['PETR4', 'ITUB4', 'HGLG11', 'KNRI11', `Z${i}3`, `Z${i}11`, 'TAEE11', 'BBSE3']);
      const liquidity = pick(r, [5001, 1e6, 0]);
      const upd = buildFundamentusAssetUpdate({ ticker, type, data, liquidity, timestamp: ts });
      out[i] = i < 5 ? canon(upd) : hash16(upd);
    }
    expect(out).toMatchSnapshot();
  });
});
