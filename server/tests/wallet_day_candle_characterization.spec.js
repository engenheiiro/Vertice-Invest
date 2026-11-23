import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Caracterização de `ensureWalletDayCandles` e `healWalletCandleGaps`
// (walletDayCandleService), gravada no código ANTERIOR à divisão das duas funções
// em partes. Trava a sequência de chamadas às fontes (Yahoo, arquivo da B3) e ao
// AssetHistory, o que é gravado (updateOne com upsert ou sem), o ledger de
// escalonamento, os logs e o que cada função devolve. Sem banco e sem rede:
// modelo, fontes, logger e ledger mockados; mescla, chave de série, calendário e
// cobertura da B3 são os reais. Relógio fixo: a mescla recusa data além de D+1.

const mocks = vi.hoisted(() => ({ calls: [], state: null }));
const rec = (...entry) => mocks.calls.push(JSON.parse(JSON.stringify(entry, (_k, v) => (v instanceof Map
  ? { __map: [...v.entries()] } : v instanceof Set ? { __set: [...v] } : v))));

vi.mock('../models/AssetHistory.js', () => ({
  default: {
    find: (query) => {
      rec('find', query);
      return {
        lean: async () => {
          const s = mocks.state;
          s.findCount += 1;
          if (s.findThrows?.includes(s.findCount)) throw new Error(`find falhou #${s.findCount}`);
          return s.docs.filter((d) => query.ticker.$in.includes(d.ticker));
        },
      };
    },
    updateOne: async (filter, update, opts) => {
      rec('updateOne', filter, update, opts === undefined ? '__semOpcoes' : opts);
      if (mocks.state.updateThrows?.includes(filter.ticker)) throw new Error(`gravação recusada ${filter.ticker}`);
      return { acknowledged: true };
    },
    aggregate: async (pipeline) => {
      rec('aggregate', pipeline);
      if (mocks.state.aggregateThrows) throw new Error('aggregate falhou');
      const keys = pipeline[0].$match.ticker.$in;
      return mocks.state.rows.filter((r) => keys.includes(r.ticker));
    },
  },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: {
    getFullHistoryDetailed: async (ticker, type, day) => {
      rec('yahoo', ticker, type, day);
      const p = mocks.state.yahoo[ticker];
      if (p === 'throw') throw new Error(`yahoo caiu ${ticker}`);
      return p === undefined ? null : JSON.parse(JSON.stringify(p));
    },
  },
}));
vi.mock('../services/b3DailyFileService.js', () => ({
  fetchB3DailyCloses: async (day) => {
    rec('b3', day);
    const f = mocks.state.b3[day];
    if (f === 'throw') throw new Error(`b3 caiu ${day}`);
    if (!f) return null;
    return new Map(Object.entries(f));
  },
}));
vi.mock('../config/logger.js', () => ({
  default: {
    info: (...a) => rec('log.info', ...a),
    warn: (...a) => rec('log.warn', ...a),
    error: (...a) => rec('log.error', ...a),
    debug: () => {},
  },
}));
vi.mock('../utils/sourceHealth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordEscalation: (e) => rec('escalation', e),
}));

const { ensureWalletDayCandles, healWalletCandleGaps } = await import('../services/walletDayCandleService.js');

const NOW = new Date('2026-09-09T02:59:00.000Z'); // 23:59 BRT de 08/09/2026

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

const normNumber = (v) => {
  if (Number.isNaN(v)) return '__NaN';
  if (!Number.isFinite(v)) return v > 0 ? '__Inf' : '__-Inf';
  return Object.is(v, -0) ? '__-0' : v;
};
const norm = (v) => {
  if (v === undefined) return '__undef';
  if (typeof v === 'number') return normNumber(v);
  if (typeof v === 'function') return '__fn';
  if (v instanceof Date) return `__date(${v.toISOString()})`;
  if (v instanceof Map) return { __map: [...v.entries()].map(norm) };
  if (v instanceof Set) return { __set: [...v].map(norm) };
  if (v instanceof Error) return { __error: v.name, message: v.message };
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  }
  return v;
};
const stable = (v) => JSON.stringify(norm(v));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// Dias corridos de 26/08 a 10/09/2026 (inclui fins de semana, 07/09 feriado e D+2).
const CAL = [];
for (let d = new Date('2026-08-26T12:00:00Z'); d <= new Date('2026-09-10T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  CAL.push(d.toISOString().slice(0, 10));
}
const FUTURO = '2026-09-25';

const POOL = [
  { ticker: 'BOVA11', type: 'ETF' }, { ticker: 'PETR4', type: 'STOCK' }, { ticker: 'KNRI11', type: 'FII' },
  { ticker: 'BTC', type: 'CRYPTO' }, { ticker: 'AAPL', type: 'STOCK_US' }, { ticker: 'VOO', type: 'ETF' },
  { ticker: 'ITSA4', type: 'STOCK' }, { ticker: 'ETH-USD', type: 'CRYPTO' }, { ticker: ' ivvb11 ', type: 'etf' },
  { ticker: 'B3SA3', type: 'STOCK' }, { ticker: 'HGLG11', type: 'FII' }, { ticker: 'MXRF11', type: undefined },
  { ticker: 'PETR4.SA', type: 'STOCK' }, { ticker: 'O', type: 'REIT' },
];
const QTYS = [undefined, undefined, 3, 7, 0, -1, '5', Number.NaN, 0.5];
const DIAS_ENSURE = ['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-08', '2026-09-05', '2026-09-07', '2026-09-02', '', undefined];
const DIAS_HEAL = ['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-08', '2026-09-02', '2026-09-05', '2026-09-07', null];
const MAXDAYS = [undefined, undefined, 1, 3, 5, 8, 0];

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const keyOf = (a) => {
  const clean = String(a.ticker || '').trim().toUpperCase().replace(/\.SA$/, '');
  return String(a.type || 'INDEX').trim().toUpperCase() === 'CRYPTO' && !clean.endsWith('-USD') ? `${clean}-USD` : clean;
};
const b3Ticker = (a) => String(a.ticker).trim().toUpperCase();

const genAssets = (r, max) => {
  const n = Math.floor(r() * (max + 1));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const x = r();
    if (x < 0.04) out.push(null);
    else if (x < 0.07) out.push({ ticker: '', type: 'STOCK' });
    else out.push({ ...pick(r, POOL), ...(r() < 0.7 ? { quantity: pick(r, QTYS) } : {}) });
  }
  return out;
};

const genCandles = (r, dias, p = 0.6) => dias.filter(() => r() < p).map((date) => {
  const z = r();
  const close = z < 0.08 ? 0 : z < 0.12 ? null : Math.round(r() * 20000) / 100;
  const c = { date, close, volume: Math.floor(r() * 1000) };
  if (r() < 0.5) c.adjClose = close === null ? null : Math.round(close * 95) / 100;
  return c;
});

const genYahoo = (r, day) => {
  const z = r();
  if (z < 0.1) return undefined;
  if (z < 0.17) return 'throw';
  if (z < 0.23) return { candles: [], emptyDates: r() < 0.5 ? [day] : [] };
  if (z < 0.27) return { candles: 'x' };
  const ate = CAL.filter((d) => d <= (day || '2026-09-08'));
  const candles = genCandles(r, ate.slice(-8)).filter((c) => c.date !== day);
  const w = r();
  const emptyDates = [];
  if (w < 0.45) candles.push({ date: day, close: Math.round(r() * 10000) / 100 + 1, volume: 10 });
  else if (w < 0.55) candles.push({ date: day, close: 0, volume: 0 });
  else if (w < 0.7) emptyDates.push(day);
  else if (w < 0.75) candles.push({ date: FUTURO, close: 9, volume: 1 });
  candles.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return r() < 0.15 ? { candles } : { candles, emptyDates };
};

const genB3 = (r, tickers) => {
  const z = r();
  if (z < 0.25) return undefined;
  if (z < 0.28) return 'throw';
  const out = {};
  for (const t of tickers) if (r() < 0.6) out[t] = { close: Math.round(r() * 10000) / 100 + 1, volume: Math.floor(r() * 500) };
  if (r() < 0.3) out.ZZZZ3 = { close: 1, volume: 1 };
  return out;
};

const runScenario = async (fn, args) => {
  mocks.calls.length = 0;
  let result; let error = null;
  try { result = await fn(...args); } catch (e) { error = { message: e.message }; }
  return { args, result, error, calls: mocks.calls.slice() };
};

const ensureScenario = (seed) => {
  const r = mulberry32(seed);
  const day = pick(r, DIAS_ENSURE);
  const assets = seed % 40 === 0
    ? POOL.slice(seed % 7, (seed % 7) + 5 + (seed % 3)).map((a) => ({ ...a, quantity: 1 })) : genAssets(r, 5);
  const valid = assets.filter((a) => a?.ticker && keyOf(a));
  const closeMap = new Map();
  for (const a of valid) if (r() < 0.15) closeMap.set(keyOf(a), 50);
  const yahoo = {};
  for (const a of valid) yahoo[a.ticker] = genYahoo(r, day);
  const docs = valid.filter(() => r() < 0.6).map((a) => (r() < 0.1
    ? { ticker: keyOf(a) } : { ticker: keyOf(a), history: genCandles(r, CAL.slice(0, 12), 0.5) }));
  const b3 = {};
  const tickersB3 = valid.map(b3Ticker);
  for (const d of CAL) if (r() < 0.8) b3[d] = genB3(r, tickersB3);
  const updateThrows = valid.filter(() => r() < 0.1).map(keyOf);
  mocks.state = { yahoo, docs, b3, updateThrows, findCount: 0, findThrows: r() < 0.1 ? [1] : [], rows: [] };
  const args = r() < 0.08 ? [assets, day] : [assets, day, closeMap];
  return { state: JSON.parse(JSON.stringify({ ...mocks.state, closeMap: [...closeMap] })), args };
};

const healScenario = (seed) => {
  const r = mulberry32(seed);
  const day = pick(r, DIAS_HEAL);
  const assets = genAssets(r, 6);
  const valid = assets.filter((a) => a?.ticker && keyOf(a));
  const md = pick(r, MAXDAYS);
  const janela = CAL.filter((d) => !day || d <= day).slice(-12);
  const rows = valid.filter(() => r() < 0.8).map((a) => {
    const z = r();
    if (z < 0.1) return { ticker: keyOf(a), dates: [] };
    return { ticker: keyOf(a), dates: janela.filter(() => r() < 0.65) };
  });
  const docs = valid.filter(() => r() < 0.7).map((a) => (r() < 0.1
    ? { ticker: keyOf(a) } : { ticker: keyOf(a), history: genCandles(r, CAL.slice(0, 12), 0.5) }));
  const b3 = {};
  const tickersB3 = valid.map(b3Ticker);
  for (const d of CAL) if (r() < 0.85) b3[d] = genB3(r, tickersB3);
  const updateThrows = valid.filter(() => r() < 0.1).map(keyOf);
  mocks.state = {
    yahoo: {}, docs, b3, rows, updateThrows, findCount: 0,
    findThrows: r() < 0.05 ? [1] : [], aggregateThrows: r() < 0.07,
  };
  const opt = r();
  const args = opt < 0.1 ? [assets, day] : opt < 0.15 ? [assets, day, {}] : [assets, day, { maxDays: md }];
  return { state: JSON.parse(JSON.stringify(mocks.state)), args };
};

const N_ENSURE = 260;
const N_HEAL = 320;

describe('caracterização — walletDayCandleService', () => {
  const realSetTimeout = globalThis.setTimeout;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // A pausa entre lotes entra na sequência; o tempo real continua passando.
    globalThis.setTimeout = (cb, ms, ...rest) => {
      rec('pausa', ms);
      return realSetTimeout(cb, ms, ...rest);
    };
  });
  afterAll(() => {
    globalThis.setTimeout = realSetTimeout;
    vi.useRealTimers();
  });

  it('ensureWalletDayCandles: matriz semeada', async () => {
    const hashes = {};
    const cobertura = { comRetorno: 0, comGravacao: 0, comB3: 0, comEscalonamento: 0, comErro: 0, comPausa: 0 };
    for (let seed = 1; seed <= N_ENSURE; seed += 1) {
      const { state, args } = ensureScenario(seed);
      const out = await runScenario(ensureWalletDayCandles, args);
      if (out.result?.size) cobertura.comRetorno += 1;
      if (out.calls.some((c) => c[0] === 'updateOne')) cobertura.comGravacao += 1;
      if (out.calls.some((c) => c[0] === 'b3')) cobertura.comB3 += 1;
      if (out.calls.some((c) => c[0] === 'escalation')) cobertura.comEscalonamento += 1;
      if (out.error) cobertura.comErro += 1;
      if (out.calls.some((c) => c[0] === 'pausa')) cobertura.comPausa += 1;
      hashes[seed] = sha(stable({ state, ...out }));
      if (seed <= 4 || seed === 25) expect(norm({ state, ...out })).toMatchSnapshot(`ensure completo #${seed}`);
    }
    expect(cobertura).toMatchSnapshot('ensure cobertura');
    for (const v of ['comRetorno', 'comGravacao', 'comB3', 'comEscalonamento', 'comErro', 'comPausa']) {
      expect(cobertura[v]).toBeGreaterThan(0);
    }
    expect(hashes).toMatchSnapshot('ensure hashes');
  }, 60000);

  it('healWalletCandleGaps: matriz semeada', async () => {
    const hashes = {};
    const cobertura = { comRetorno: 0, comGravacao: 0, comB3: 0, comErro: 0, semCobertura: 0, aggregateFalhou: 0 };
    for (let seed = 1001; seed <= 1000 + N_HEAL; seed += 1) {
      const { state, args } = healScenario(seed);
      const out = await runScenario(healWalletCandleGaps, args);
      if (out.result?.size) cobertura.comRetorno += 1;
      if (out.calls.some((c) => c[0] === 'updateOne')) cobertura.comGravacao += 1;
      if (out.calls.some((c) => c[0] === 'b3')) cobertura.comB3 += 1;
      if (out.error) cobertura.comErro += 1;
      if (out.calls.some((c) => c[0] === 'log.info' && String(c[1]).includes('sem cobertura'))) cobertura.semCobertura += 1;
      if (out.calls.some((c) => c[0] === 'log.warn' && String(c[1]).includes('não pôde ler'))) cobertura.aggregateFalhou += 1;
      hashes[seed] = sha(stable({ state, ...out }));
      if (seed <= 1004) expect(norm({ state, ...out })).toMatchSnapshot(`heal completo #${seed}`);
    }
    expect(cobertura).toMatchSnapshot('heal cobertura');
    for (const v of Object.keys(cobertura)) expect(cobertura[v]).toBeGreaterThan(0);
    expect(hashes).toMatchSnapshot('heal hashes');
  }, 60000);

  it('cenários fixos nomeados', async () => {
    const fixos = {};
    const run = async (nome, state, fn, args) => {
      mocks.state = { yahoo: {}, docs: [], b3: {}, rows: [], updateThrows: [], findCount: 0, ...state };
      fixos[nome] = norm(await runScenario(fn, args));
    };
    // Yahoo entrega o dia: grava com upsert e devolve o fechamento.
    await run('ensure yahoo ok', {
      yahoo: { PETR4: { candles: [{ date: '2026-09-07', close: 30 }, { date: '2026-09-08', close: 31, volume: 9 }], emptyDates: [] } },
      docs: [{ ticker: 'PETR4', history: [{ date: '2026-09-04', close: 29 }] }],
    }, ensureWalletDayCandles, [[{ ticker: 'PETR4', type: 'STOCK', quantity: 1 }], '2026-09-08']);
    // Volume 0 / close 0 no dia: cai na B3, que tem o fechamento oficial.
    await run('ensure close zero -> b3', {
      yahoo: { BOVA11: { candles: [{ date: '2026-09-08', close: 0, volume: 0 }], emptyDates: [] } },
      docs: [{ ticker: 'BOVA11', history: [{ date: '2026-09-04', close: 100 }] }],
      b3: { '2026-09-08': { BOVA11: { close: 101, volume: 0 } } },
    }, ensureWalletDayCandles, [[{ ticker: 'BOVA11', type: 'ETF' }], '2026-09-08']);
    // Arquivo da B3 publicado sem o papel: sem negócio, nada gravado.
    await run('ensure sem negocio', {
      yahoo: { KNRI11: { candles: [], emptyDates: ['2026-09-08'] } },
      docs: [{ ticker: 'KNRI11', history: [{ date: '2026-09-04', close: 100 }] }],
      b3: { '2026-09-08': { OUTRO11: { close: 1, volume: 1 } } },
    }, ensureWalletDayCandles, [[{ ticker: 'KNRI11', type: 'FII', quantity: 2 }], '2026-09-08']);
    // Cripto em fim de semana (dias corridos) e STOCK_US no feriado brasileiro.
    await run('ensure cripto sabado', {
      yahoo: { BTC: { candles: [{ date: '2026-09-05', close: 60000 }], emptyDates: [] } },
    }, ensureWalletDayCandles, [[{ ticker: 'BTC', type: 'CRYPTO', quantity: 1 }], '2026-09-05']);
    await run('ensure stock_us feriado BR', {
      yahoo: { AAPL: { candles: [{ date: '2026-09-07', close: 200 }], emptyDates: [] } },
    }, ensureWalletDayCandles, [[{ ticker: 'AAPL', type: 'STOCK_US', quantity: 1 }], '2026-09-07']);
    await run('ensure stock_us sabado', {
      yahoo: { AAPL: { candles: [{ date: '2026-09-05', close: 200 }], emptyDates: [] } },
    }, ensureWalletDayCandles, [[{ ticker: 'AAPL', type: 'STOCK_US', quantity: 1 }], '2026-09-05']);
    await run('ensure closeMap cheio', {}, ensureWalletDayCandles,
      [[{ ticker: 'BTC', type: 'CRYPTO' }], '2026-09-08', new Map([['BTC-USD', 1]])]);
    // Varredura: teto maxDays e B3 fora.
    await run('heal maxDays 2', {
      rows: [{ ticker: 'BOVA11', dates: ['2026-09-01', '2026-09-08'] }],
      docs: [{ ticker: 'BOVA11', history: [{ date: '2026-09-01', close: 1 }] }],
      b3: { '2026-09-04': { BOVA11: { close: 2, volume: 3 } } },
    }, healWalletCandleGaps, [[{ ticker: 'BOVA11', type: 'ETF' }], '2026-09-08', { maxDays: 2 }]);
    await run('heal b3 fora', {
      rows: [{ ticker: 'BOVA11', dates: ['2026-09-01', '2026-09-08'] }],
    }, healWalletCandleGaps, [[{ ticker: 'BOVA11', type: 'ETF' }], '2026-09-08']);
    expect(fixos).toMatchSnapshot('fixos');
  });
});
