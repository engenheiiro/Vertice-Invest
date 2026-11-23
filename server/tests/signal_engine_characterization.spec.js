import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Caracterização do motor de sinais (Radar Alpha): `runScanner`,
// `detectBullishDivergence` e `runBacktest`. O snapshot foi gravado no código
// ANTERIOR à divisão dessas funções em partes e trava tudo o que elas produzem:
// cada chamada aos modelos (filtro, projeção, operações gravadas, na ordem),
// cada linha de log e o retorno. Nenhum teste toca o banco ou a rede: modelos,
// cotações e logger mockados; cenários gerados por PRNG semeado; relógio fixo.

const rec = vi.hoisted(() => ({ events: [], plan: null }));

vi.mock('../config/logger.js', () => {
  const at = (level) => (...args) => { rec.events.push(['log.' + level, args]); };
  return { default: { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } };
});
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: {
    getQuotes: async (symbols) => {
      rec.events.push(['getQuotes', [symbols]]);
      return rec.plan.quotes();
    },
  },
}));

// Consulta encadeável do Mongoose (`find().select().lean()` ou `await find()`):
// registra cada passo e resolve/rejeita com o que o cenário mandou.
const chain = (name, args, resolve) => {
  rec.events.push([name, args]);
  const q = {
    select: (...a) => { rec.events.push([name + '.select', a]); return q; },
    lean: (...a) => { rec.events.push([name + '.lean', a]); return q; },
    then: (ok, ko) => {
      let p;
      try { p = Promise.resolve(resolve()); } catch (e) { p = Promise.reject(e); }
      return p.then(ok, ko);
    },
  };
  return q;
};
const call = (name) => (...args) => chain(name, args, () => rec.plan[name](...args));

vi.mock('../models/MarketAsset.js', () => ({ default: { find: (...a) => call('MarketAsset.find')(...a) } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: (...a) => call('AssetHistory.find')(...a) } }));
vi.mock('../models/QuantSignal.js', () => ({
  default: {
    find: (...a) => call('QuantSignal.find')(...a),
    bulkWrite: (...a) => call('QuantSignal.bulkWrite')(...a),
    updateMany: (...a) => call('QuantSignal.updateMany')(...a),
    countDocuments: (...a) => call('QuantSignal.countDocuments')(...a),
  },
}));
vi.mock('../models/SystemConfig.js', () => ({
  default: {
    findOne: (...a) => call('SystemConfig.findOne')(...a),
    findOneAndUpdate: (...a) => call('SystemConfig.findOneAndUpdate')(...a),
  },
}));

const { signalEngine } = await import('../services/engines/signalEngine.js');

const NOW = new Date('2026-11-18T15:00:00Z');
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  rec.events = [];
});
afterEach(() => { vi.useRealTimers(); });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Serialização estável: chaves ordenadas; -0, NaN, ±Infinity, undefined, Date,
// Map, Set, Error e função viram marcadores explícitos.
function canonNumber(v) {
  if (Object.is(v, -0)) return '~-0';
  if (!Number.isFinite(v)) return `~${v}`;
  return v;
}
function canon(v) {
  if (v === undefined) return '~undef';
  if (typeof v === 'number') return canonNumber(v);
  if (typeof v === 'function') return '~fn';
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '~D:invalid' : `~D:${v.toISOString()}`;
  if (v instanceof Error) return `~E:${v.message}`;
  if (v instanceof Map) return { '~map': [...v.entries()].map(([k, x]) => [canon(k), canon(x)]) };
  if (v instanceof Set) return { '~set': [...v].map(canon) };
  if (Array.isArray(v)) return v.map(canon);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (k === 'then') continue;
    out[k] = canon(v[k]);
  }
  return out;
}
const hash = (o) => createHash('sha256').update(JSON.stringify(canon(o))).digest('hex').slice(0, 16);

// ─── Séries de preço (mais recente → mais antiga) ─────────────────────────────
const toDesc = (chrono) => [...chrono].reverse();

function divergentChrono(r, n) {
  const c = [];
  let p = 60 + r() * 20;
  const warm = Math.max(4, n - 27);
  for (let i = 0; i < warm; i++) { p += 0.3 + r() * 0.4; c.push(p); }
  const d1 = 2.5 + r() * 1.5;
  for (let i = 0; i < 8; i++) { p -= d1; c.push(p); }
  for (let i = 0; i < 6; i++) { p += 2 + r(); c.push(p); }
  const d2 = 1.2 + r() * 0.8;
  for (let i = 0; i < 10; i++) { p -= d2; c.push(p); }
  const reaction = 1 + Math.floor(r() * 4);
  for (let i = 0; i < reaction; i++) { p += 0.8 + r(); c.push(p); }
  return c;
}

function seriesFamily(r, family, n) {
  if (n <= 0) return [];
  let chrono;
  if (family === 'flat') chrono = Array(n).fill(20);
  else if (family === 'up') chrono = Array.from({ length: n }, (_, i) => 30 + i * (0.5 + r()));
  else if (family === 'down') {
    chrono = [];
    let p = 100;
    const bounce = Math.floor(r() * 3);
    for (let i = 0; i < n - bounce; i++) { p *= 1 - (0.01 + r() * 0.03); chrono.push(p); }
    for (let i = 0; i < bounce; i++) { p *= 1 + r() * 0.02; chrono.push(p); }
    if (r() < 0.25) chrono[n - 1] = chrono[n - 2]; // empate hoje × ontem
  } else if (family === 'div') {
    chrono = divergentChrono(r, n).slice(-n);
  } else if (family === 'saw') {
    chrono = Array.from({ length: n }, (_, i) => 50 + (i % 5) * (i % 2 ? -1 : 1.3) - i * 0.4);
  } else {
    chrono = [];
    let p = 50;
    for (let i = 0; i < n; i++) { p *= 1 + (r() - 0.55) * 0.07; chrono.push(p); }
  }
  return toDesc(chrono);
}
const FAMILIES = ['walk', 'down', 'down', 'div', 'div', 'flat', 'up', 'saw'];

function corrupt(r, v) {
  const x = r();
  if (x < 0.02) return NaN;
  if (x < 0.035) return 0;
  if (x < 0.045) return -5;
  if (x < 0.055) return null;
  if (x < 0.06) return undefined;
  if (x < 0.063) return String(Math.round(v * 100) / 100);
  return v;
}

// ─── runScanner ──────────────────────────────────────────────────────────────
const TICKERS = ['PETR4', 'VALE3', 'WEGE3', 'ITUB4', 'PRIO3', 'HGLG11', 'AAPL', 'MSFT', 'XPTO3', 'SAPR11'];
const TYPES = { HGLG11: 'FII', AAPL: 'STOCK_US', MSFT: 'STOCK_US' };
const SECTORS = [undefined, 'Bancos', 'Elétricas', 'Tecnologia', 'Petróleo', 'Utilities', 'Consumer Staples', 'Logística'];
const SIGNAL_TYPES = ['RSI_OVERSOLD', 'BULLISH_DIVERGENCE', 'DEEP_VALUE', 'VOLUME_SPIKE'];

function buildHistoryDoc(r, ticker) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const n = pick([0, 10, 15, 16, 18, 20, 25, 30, 40, 45, 50, 60]);
  const closes = seriesFamily(r, pick(FAMILIES), n);
  const volMode = pick(['none', 'flat', 'spike', 'spike', 'random', 'short']);
  const entries = closes.map((c, i) => {
    const e = { date: new Date(NOW.getTime() - (i + 1) * DAY - 3 * 3600_000) };
    const close = corrupt(r, c);
    const adj = r();
    if (adj < 0.4) { e.close = close; e.adjClose = close; } else if (adj < 0.6) e.close = close;
    else if (adj < 0.75) { e.close = close; e.adjClose = 0; } else { e.close = close; e.adjClose = typeof close === 'number' ? close * 0.98 : close; }
    if (volMode === 'flat') e.volume = 1000;
    else if (volMode === 'spike') e.volume = i === 0 ? 1000 * (1 + r() * 2) : 800 + r() * 400;
    else if (volMode === 'random') e.volume = r() < 0.1 ? NaN : Math.floor(r() * 2000);
    else if (volMode === 'short' && i < 10) e.volume = 500;
    return e;
  });
  if (entries.length && r() < 0.05) entries[Math.floor(r() * entries.length)].date = 'nada';
  const chrono = entries.reverse();
  if (r() < 0.15) chrono.sort(() => r() - 0.5);
  const doc = { ticker, history: chrono };
  if (r() < 0.04) delete doc.history;
  return doc;
}

function buildAsset(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const ticker = pick(TICKERS);
  const lastPrice = pick([undefined, 0, 5, 10.5, 41, 100, 250]);
  // Metade das vezes a SMA200 fica relativa ao preço, para cair nas bordas dos
  // filtros de tendência (85% e 100% da média).
  const sma200 = lastPrice > 0 && r() < 0.5
    ? lastPrice / pick([0.8, 0.82, 0.84, 0.85, 0.86, 0.95, 1, 1.1])
    : pick([undefined, 0, 0, 30, 45, 48, 60, 200]);
  const asset = {
    ticker,
    type: TYPES[ticker] || (r() < 0.85 ? 'STOCK' : pick(['FII', 'STOCK_US'])),
    lastPrice,
    netMargin: pick([undefined, -10, -5, -4.9, 0, 12, 12, 12]),
    sma200,
    pl: pick([undefined, -3, 0, 4, 8, 15]),
    p_vp: pick([undefined, 0, 0.5, 1, 2]),
    roe: pick([undefined, -2, 0, 5, 12.345, 20, '7']),
    sector: pick(SECTORS),
    marketCap: pick([undefined, 1e9, 3e9, 6e10]),
    debtToEquity: pick([undefined, 1, 4]),
  };
  // Desconto de Graham EXATAMENTE 0,70 (borda do Deep Value).
  if (r() < 0.1) Object.assign(asset, { lastPrice: 10, pl: 4.9, p_vp: 2.25 });
  return asset;
}

function buildQuotes(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const x = r();
  if (x < 0.08) return () => { throw new Error('yahoo fora'); };
  if (x < 0.2) return () => [];
  const changes = [-3.1, -2.6, -2.2, -1.6, -1, 0, 0.4, 2];
  const list = [];
  if (r() < 0.8) list.push({ ticker: 'BZ=F', change: pick(changes) });
  if (r() < 0.8) list.push({ ticker: pick(['^BVSP', 'BVSP']), change: pick(changes) });
  if (r() < 0.8) list.push({ ticker: pick(['^GSPC', 'GSPC']), change: pick(changes) });
  if (r() < 0.1) list.push({ change: 1 });
  return () => list;
}

function buildScannerPlan(seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const fail = (p, msg) => (r() < p ? msg : null);
  const assets = r() < 0.05 ? [] : Array.from({ length: 1 + Math.floor(r() * 6) }, () => buildAsset(r));
  const histTickers = [...new Set(assets.map((a) => a.ticker))].filter(() => r() < 0.85);
  if (r() < 0.2) histTickers.push(pick(TICKERS));
  const histories = histTickers.map((t) => buildHistoryDoc(r, t));
  const active = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({
    _id: `sig#${seed}-${i}`, ticker: pick(TICKERS), type: pick(SIGNAL_TYPES),
  }));
  const errs = {
    assets: fail(0.03, 'falha MarketAsset'), hist: fail(0.03, 'falha AssetHistory'),
    active: fail(0.03, 'falha QuantSignal.find'), bulk: fail(0.04, 'falha bulkWrite'),
    many: fail(0.04, 'falha updateMany'), count: fail(0.03, 'falha count'), meta: fail(0.03, 'falha meta'),
  };
  const boom = (msg, v) => () => { if (msg) throw new Error(msg); return v; };
  return {
    quotes: buildQuotes(r),
    'MarketAsset.find': boom(errs.assets, assets),
    'AssetHistory.find': boom(errs.hist, histories),
    'QuantSignal.find': boom(errs.active, active),
    'QuantSignal.bulkWrite': boom(errs.bulk, { ok: 1 }),
    'QuantSignal.updateMany': boom(errs.many, { modifiedCount: 1 }),
    'QuantSignal.countDocuments': boom(errs.count, Math.floor(r() * 30)),
    'SystemConfig.findOneAndUpdate': boom(errs.meta, {}),
  };
}

// ─── runBacktest ─────────────────────────────────────────────────────────────
function buildBacktestPlan(seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const cfg = pick([null, null, {}, { backtestHorizon: 7 }, { backtestHorizon: 0 }, { backtestHorizon: 30 }, 'erro']);
  const signals = r() < 0.08 ? [] : Array.from({ length: 1 + Math.floor(r() * 8) }, (_, i) => {
    const s = {
      _id: `bt#${seed}-${i}`,
      ticker: pick(TICKERS),
      priceAtSignal: pick([undefined, 0, 10, 40, 100, 100]),
      timestamp: pick([new Date(NOW.getTime() - r() * 40 * DAY), new Date(NOW.getTime() - 14 * DAY), 'xx', undefined]),
    };
    return s;
  });
  const assets = [...new Set(signals.map((s) => s.ticker))].filter(() => r() < 0.85).map((ticker) => ({
    ticker, lastPrice: pick([undefined, 0, -1, 9.6, 10, 10.3, 10.36, 10.4, 38.5, 39, 41.4, 96.5, 96.4, 100, 103.5, 104]),
  }));
  if (assets.length && r() < 0.1) assets.push({ ...assets[0], lastPrice: 100 });
  const boom = (bad, v) => () => { if (bad) throw new Error(bad); return v; };
  return {
    'SystemConfig.findOne': boom(cfg === 'erro' ? 'falha config' : null, cfg),
    'QuantSignal.find': boom(r() < 0.03 ? 'falha sinais' : null, signals),
    'MarketAsset.find': boom(r() < 0.03 ? 'falha ativos' : null, assets),
    'QuantSignal.bulkWrite': boom(r() < 0.04 ? 'falha bulk' : null, { ok: 1 }),
  };
}

// ─── detectBullishDivergence ─────────────────────────────────────────────────
function buildDivergenceCase(seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  if (r() < 0.03) return { closes: pick([null, undefined, 'abc', { length: 50 }]), period: 14, opts: undefined };
  const n = pick([5, 18, 20, 21, 25, 30, 35, 40, 45, 50, 60]);
  let closes = seriesFamily(r, pick(['div', 'div', 'div', 'walk', 'down', 'flat', 'saw', 'up']), n);
  if (r() < 0.15) closes = closes.map((c) => corrupt(r, c));
  const period = pick([14, 14, 14, 5, 7, 10, undefined]);
  let opts;
  const o = r();
  if (o < 0.4) opts = undefined;
  else if (o < 0.5) opts = {};
  else {
    opts = {};
    if (r() < 0.6) opts.wing = pick([1, 2, 3, null]);
    if (r() < 0.6) opts.minSeparation = pick([1, 2, 3, 5]);
    if (r() < 0.6) opts.maxLookback = pick([10, 20, 40, 60]);
    if (r() < 0.6) opts.rsiZone = pick([30, 45, 60, 101]);
    if (r() < 0.6) opts.maxRecentAge = pick([1, 3, 6, 12]);
  }
  // Zona de RSI EXATAMENTE no fundo recente (borda do `< rsiZone`): a série é a
  // mesma, a zona é lida de uma busca sem teto de zona.
  if (r() < 0.15) {
    const free = signalEngine.detectBullishDivergence(closes, period, { ...opts, rsiZone: 1000 });
    if (free) opts = { ...opts, rsiZone: free.rsiAtLow };
  }
  return { closes, period, opts };
}

const SCANNER_SCENARIOS = 600;
const BACKTEST_SCENARIOS = 300;
const DIVERGENCE_SCENARIOS = 1500;

async function runScannerCase(seed) {
  rec.events = [];
  rec.plan = buildScannerPlan(seed);
  const result = await signalEngine.runScanner();
  return { result, events: rec.events };
}
async function runBacktestCase(seed) {
  rec.events = [];
  rec.plan = buildBacktestPlan(seed);
  const result = await signalEngine.runBacktest();
  return { result, events: rec.events };
}

describe('caracterização — runScanner', () => {
  it('cada cenário grava as mesmas chamadas, logs e retorno', async () => {
    const hashes = {};
    const tally = {};
    const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
    for (let s = 1; s <= SCANNER_SCENARIOS; s++) {
      const out = await runScannerCase(s);
      hashes[s] = hash(out);
      bump(out.result.success ? 'ok' : 'erro');
      if (out.result.blocked > 0) bump('bloqueado');
      if (out.result.staleInactivated > 0) bump('inativados');
      for (const [name, args] of out.events) {
        if (name !== 'QuantSignal.bulkWrite') continue;
        for (const op of args[0]) bump(`${op.updateOne.filter.type}:${op.updateOne.update.$set.urgencyLevel}`);
      }
    }
    // Todos os ramos que importam aparecem na matriz.
    for (const k of ['ok', 'erro', 'bloqueado', 'inativados', 'RSI_OVERSOLD:HIGH', 'RSI_OVERSOLD:CRITICAL',
      'BULLISH_DIVERGENCE:HIGH', 'DEEP_VALUE:CRITICAL', 'DEEP_VALUE:HIGH']) {
      expect(tally[k], k).toBeGreaterThan(0);
    }
    expect(hashes).toMatchSnapshot();
  });

  it('cenários de amostra em JSON completo', async () => {
    const samples = {};
    for (const s of [3, 17, 42, 101]) samples[s] = canon(await runScannerCase(s));
    expect(samples).toMatchSnapshot();
  });
});

describe('caracterização — runBacktest', () => {
  it('cada cenário grava as mesmas chamadas, logs e retorno', async () => {
    const hashes = {};
    const tally = {};
    for (let s = 1; s <= BACKTEST_SCENARIOS; s++) {
      const out = await runBacktestCase(s);
      hashes[s] = hash(out);
      for (const [name, args] of out.events) {
        if (name !== 'QuantSignal.bulkWrite') continue;
        for (const op of args[0]) tally[op.updateOne.update.$set.status] = (tally[op.updateOne.update.$set.status] || 0) + 1;
      }
      if (out.result.success === false) tally.erro = (tally.erro || 0) + 1;
    }
    for (const k of ['HIT', 'MISS', 'NEUTRAL', 'erro']) expect(tally[k], k).toBeGreaterThan(0);
    expect(hashes).toMatchSnapshot();
  });

  it('cenários de amostra em JSON completo', async () => {
    const samples = {};
    for (const s of [2, 9, 33]) samples[s] = canon(await runBacktestCase(s));
    expect(samples).toMatchSnapshot();
  });
});

describe('caracterização — detectBullishDivergence', () => {
  it('cada série devolve o mesmo resultado', () => {
    const hashes = {};
    let found = 0;
    for (let s = 1; s <= DIVERGENCE_SCENARIOS; s++) {
      const { closes, period, opts } = buildDivergenceCase(s);
      const out = signalEngine.detectBullishDivergence(closes, period, opts);
      if (out) found++;
      hashes[s] = hash({ out });
    }
    expect(found).toBeGreaterThan(40);
    expect(hashes).toMatchSnapshot();
  });

  it('séries de amostra em JSON completo', () => {
    const samples = {};
    for (const s of [1, 4, 8, 15, 16, 23]) {
      const c = buildDivergenceCase(s);
      samples[s] = canon({ ...c, out: signalEngine.detectBullishDivergence(c.closes, c.period, c.opts) });
    }
    expect(samples).toMatchSnapshot();
  });
});
