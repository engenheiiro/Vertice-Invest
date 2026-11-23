/**
 * Caracterização de quatro métodos de `marketDataService`, gravada no código
 * ANTERIOR à divisão deles em partes:
 *   - getMarketDataByTicker (self-heal de nome, cache HIT/STALE, fallback de
 *     histórico, MISS, erro);
 *   - getMarketDataMap (lote: chave original, fallback em uma query, falha total);
 *   - detectExDateDividends (provento provisório pelo gap do dia-ex: filtro de
 *     sessão de hoje, ETF de acumulação, evento oficial perto, trava de valores);
 *   - retireStaleInactiveAssets (aposentadoria: falhas, idade da prova de pregão,
 *     carteira, mercado regular, candle recente, escrita terminal).
 * Trava o valor devolvido (com a ORDEM das chaves), cada chamada a modelo/serviço
 * e cada linha de log. Cenários gerados por PRNG semeado; sem rede e sem banco.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import UserAsset from '../models/UserAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import logger from '../config/logger.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { getTunablesSync } from '../services/configService.js';
import { recordCacheAccess } from '../utils/performanceMetrics.js';
import { loadLatestCloseBefore } from '../utils/dayCloses.js';
import { deriveDividendFromGap } from '../utils/dividendGap.js';
import { marketDataService } from '../services/marketDataService.js';
import { mulberry32 } from './helpers/characterization.js';

vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: { distinct: vi.fn() } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/FundamentalSnapshot.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getQuotes: vi.fn(), getFullHistory: vi.fn() },
}));
vi.mock('../services/configService.js', () => ({ getTunablesSync: vi.fn() }));
vi.mock('../utils/performanceMetrics.js', () => ({ recordCacheAccess: vi.fn() }));
vi.mock('../utils/dayCloses.js', () => ({ loadLatestCloseBefore: vi.fn() }));
vi.mock('../utils/dividendGap.js', () => ({ deriveDividendFromGap: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Quarta, 18/11/2026, 15h BRT: pregão em curso.
const NOW = new Date('2026-11-18T15:00:00-03:00');
const DAY = 86400000;
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000);
const daysAgo = (d) => new Date(NOW.getTime() - d * DAY);

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const ABSENT = Symbol('absent');
// Campo opcional: ABSENT omite a chave (o documento real também pode não tê-la).
const put = (r, obj, key, values) => {
  const v = pick(r, values);
  if (v !== ABSENT) obj[key] = v;
};

// Serialização estável: a ORDEM das chaves é preservada (o JSON da API depende
// dela), e undefined/NaN/±Infinity/-0/Date/Map/Error ficam explícitos.
const normNumber = (v) => {
  if (Number.isNaN(v)) return '__NaN';
  if (!Number.isFinite(v)) return v > 0 ? '__Inf' : '__-Inf';
  if (Object.is(v, -0)) return '__-0';
  return v;
};
const norm = (v) => {
  if (v === undefined) return '__undef';
  if (typeof v === 'number') return normNumber(v);
  if (typeof v === 'symbol') return String(v);
  if (typeof v === 'function') return '__fn';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '__date(invalid)' : `__date(${v.toISOString()})`;
  if (v instanceof Error) return { __error: v.name, message: v.message };
  if (v instanceof Map) return { __map: [...v.entries()].map(norm) };
  if (v instanceof Set) return { __set: [...v].map(norm) };
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = norm(v[k]);
    return out;
  }
  return v;
};
const stable = (v) => JSON.stringify(norm(v));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
// Cópia no momento da chamada: o código pode mutar o argumento depois.
const snap = (v) => JSON.parse(stable(v));

const logs = () => ({
  info: logger.info.mock.calls, warn: logger.warn.mock.calls,
  debug: logger.debug.mock.calls, error: logger.error.mock.calls,
});

const runAll = async (n, seed, gen, exec) => {
  const hashes = {};
  const full = [];
  for (let i = 0; i < n; i++) {
    vi.clearAllMocks();
    const r = mulberry32(seed + i * 7919);
    const scenario = gen(r);
    const out = await exec(scenario);
    const s = stable({ scenario, out });
    hashes[i] = sha(s);
    if (i < 4) full.push(JSON.parse(s));
  }
  return { hashes, full };
};

let spies = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  spies = [];
  vi.useRealTimers();
});

// ---------------------------------------------------------------- comum ----
const TICKER_POOL = ['PETR4', ' petr4.sa ', 'btc', 'HGLG11', 'AAPL', '', null, undefined, 'IVVB11', 'XPML11'];
const genAsset = (r, ticker) => {
  const a = { ticker };
  put(r, a, 'type', ['STOCK', 'FII', 'STOCK_US', 'ETF', 'CRYPTO', 'INDEX', ABSENT]);
  put(r, a, 'name', [ABSENT, '', '  ', ticker, String(ticker || '').toLowerCase(), 'Nome Real SA', null]);
  put(r, a, 'lastPrice', [ABSENT, 0, -1, 10, 0.0000123, NaN, 37.5, null]);
  put(r, a, 'updatedAt', [
    ABSENT, null, minutesAgo(1), minutesAgo(14), minutesAgo(16), minutesAgo(600), 'lixo',
    minutesAgo(15.08), minutesAgo(1.008), minutesAgo(15),
  ]);
  put(r, a, 'change', [ABSENT, 0, 1.5, -2, null]);
  put(r, a, 'priceDate', [ABSENT, null, '', '2026-11-18', '2026-11-17']);
  put(r, a, 'previousClose', [ABSENT, 0, 9.8, null]);
  put(r, a, 'dy', [ABSENT, 0, 6.2, null]);
  put(r, a, 'sector', [ABSENT, 'Energia', null]);
  put(r, a, 'allocationClass', [ABSENT, '', 'FIXED_INCOME', 'STOCK', null]);
  return a;
};
const genCandles = (r) => {
  const n = Math.floor(r() * 5);
  return Array.from({ length: n }, () => {
    const c = { date: daysAgo(Math.floor(r() * 30)) };
    put(r, c, 'close', [ABSENT, 0, 12.3, 40, null, -1]);
    put(r, c, 'adjClose', [ABSENT, 0, 11.9, 38.1]);
    return c;
  });
};
const genHistoryDoc = (r) => pick(r, [
  () => null,
  () => ({}),
  () => ({ history: [] }),
  () => ({ history: genCandles(r) }),
  () => ({ history: genCandles(r) }),
  () => ({ history: genCandles(r) }),
])();

// --------------------------------------------------- getMarketDataByTicker --
describe('getMarketDataByTicker — caracterização', () => {
  const gen = (r) => {
    const ticker = pick(r, TICKER_POOL);
    const clean = ticker ? ticker.toUpperCase().trim().replace('.SA', '') : '';
    return {
      ticker,
      opts: pick(r, [ABSENT, {}, { interactive: true }, { interactive: false }]),
      cacheMinutes: pick(r, [1, 15, 60]),
      first: r() < 0.06 ? 'THROW' : (r() < 0.15 ? null : genAsset(r, clean)),
      second: r() < 0.08 ? 'THROW' : (r() < 0.15 ? null : genAsset(r, clean)),
      refreshFails: r() < 0.3,
      history: r() < 0.06 ? 'THROW' : genHistoryDoc(r),
    };
  };
  const exec = async (s) => {
    getTunablesSync.mockReturnValue({ marketCacheMinutes: s.cacheMinutes });
    const seq = [s.first, s.second];
    let k = 0;
    const findOneArgs = [];
    MarketAsset.findOne.mockImplementation(async (q) => {
      findOneArgs.push(snap(q));
      const v = seq[Math.min(k++, 1)];
      if (v === 'THROW') throw new Error('mongo fora');
      return v ? { ...v } : v;
    });
    const historyDoc = s.history === 'THROW' || !s.history ? s.history : JSON.parse(JSON.stringify(s.history));
    if (historyDoc && Array.isArray(historyDoc.history)) {
      historyDoc.history.forEach((c, i) => { c.date = new Date(s.history.history[i].date); });
    }
    AssetHistory.findOne.mockImplementation(async () => {
      if (historyDoc === 'THROW') throw new Error('hist fora');
      return historyDoc;
    });
    const refresh = vi.spyOn(marketDataService, 'refreshQuotesBatch')
      .mockImplementation(async () => { if (s.refreshFails) throw new Error('refresh falhou'); });
    const bg = vi.spyOn(marketDataService, 'refreshQuoteInBackground').mockReturnValue(Promise.resolve());
    spies.push(refresh, bg);
    const args = s.opts === ABSENT ? [s.ticker] : [s.ticker, s.opts];
    let result;
    try {
      result = await marketDataService.getMarketDataByTicker(...args);
    } catch (e) {
      result = { threw: e.message };
    }
    return {
      result,
      keys: result ? Object.keys(result) : null,
      findOneArgs,
      histArgs: AssetHistory.findOne.mock.calls,
      refreshArgs: refresh.mock.calls,
      bgArgs: bg.mock.calls,
      cache: recordCacheAccess.mock.calls,
      historyAfter: historyDoc && historyDoc !== 'THROW' ? historyDoc.history : null,
      logs: logs(),
    };
  };

  it('500 cenários semeados', async () => {
    const { hashes, full } = await runAll(500, 101, gen, exec);
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  });
});

// -------------------------------------------------------- getMarketDataMap --
describe('getMarketDataMap — caracterização', () => {
  const clean = (t) => (t ? t.toUpperCase().trim().replace('.SA', '') : '');
  const gen = (r) => {
    const mode = r();
    const tickers = mode < 0.04 ? null : (mode < 0.08 ? [] : Array.from(
      { length: 1 + Math.floor(r() * 6) }, () => pick(r, TICKER_POOL),
    ));
    const distinct = [...new Set((tickers || []).map(clean))];
    const assets = [];
    for (const c of distinct) if (c && r() < 0.75) assets.push(genAsset(r, c));
    if (r() < 0.2) assets.push(genAsset(r, 'EXTRA3'));
    const histories = [];
    for (const c of distinct) {
      if (r() < 0.6) {
        const a = assets.find((x) => x.ticker === c);
        const type = a?.type || 'INDEX';
        const key = r() < 0.85 ? (type === 'CRYPTO' ? `${c}-USD` : c) : `${c}-X`;
        const doc = genHistoryDoc(r) || {};
        histories.push({ ticker: key, ...doc });
      }
    }
    return {
      tickers,
      assets,
      histories,
      assetsThrow: r() < 0.05,
      histThrow: r() < 0.05,
    };
  };
  const exec = async (s) => {
    const selects = [];
    MarketAsset.find.mockImplementation((q) => ({
      select: (f) => {
        selects.push(['asset', snap(q), f]);
        return s.assetsThrow ? Promise.reject(new Error('asset fora')) : Promise.resolve(s.assets.map((a) => ({ ...a })));
      },
    }));
    AssetHistory.find.mockImplementation((q) => ({
      select: (f) => {
        selects.push(['hist', snap(q), f]);
        if (s.histThrow) return Promise.reject(new Error('hist fora'));
        return Promise.resolve(s.histories.map((h) => ({
          ...h, ...(Array.isArray(h.history) ? { history: h.history.map((c) => ({ ...c, date: new Date(c.date) })) } : {}),
        })));
      },
    }));
    const map = await marketDataService.getMarketDataMap(s.tickers);
    return {
      entries: [...map.entries()],
      keys: [...map.values()].map((v) => Object.keys(v)),
      selects,
      cache: recordCacheAccess.mock.calls,
      logs: logs(),
    };
  };

  it('400 cenários semeados', async () => {
    const { hashes, full } = await runAll(400, 202, gen, exec);
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  });
});

// --------------------------------------------------- detectExDateDividends --
describe('detectExDateDividends — caracterização', () => {
  const Q_TICKERS = ['PETR4', 'petr4.sa', 'BOVA11', 'XPML11', 'ETFX11', 'BTC', 'ZZZZ3', 'VALE3'];
  const MARKET_TIMES = [
    ABSENT, null, NOW, new Date('2026-11-18T13:30:00Z'), daysAgo(1), 'lixo',
    new Date('2026-11-18T01:00:00Z'), new Date('2026-11-18T23:00:00Z'),
  ];
  const gen = (r) => {
    const quotes = r() < 0.04 ? null : Array.from({ length: Math.floor(r() * 7) }, () => {
      const q = { ticker: pick(r, Q_TICKERS) };
      put(r, q, 'previousClose', [ABSENT, 0, -1, '10.5', 10, 25.3, NaN, 40]);
      put(r, q, 'marketTime', MARKET_TIMES.concat([NOW, NOW]));
      put(r, q, 'volume', [ABSENT, 0, 1000]);
      return q;
    });
    const assetEntries = [];
    for (const t of ['PETR4', 'BOVA11', 'XPML11', 'ETFX11', 'BTC', 'VALE3']) {
      if (r() < 0.8) assetEntries.push([t, { ticker: t, type: pick(r, ['STOCK', 'FII', 'ETF', 'CRYPTO']) }]);
    }
    const closes = [];
    for (const t of ['PETR4', 'BOVA11', 'XPML11', 'ETFX11', 'BTC-USD', 'BTC', 'VALE3']) {
      if (r() < 0.75) closes.push([t, { close: pick(r, [10.6, 10, 26, 40.9, 41, 0]), date: pick(r, ['2026-11-17', '2026-11-13']) }]);
    }
    // Datas em volta da borda de 4 dias do "evento oficial perto" e séries
    // longas no mesmo ticker (a trava usa só os 12 mais recentes).
    const nearBias = r() < 0.5;
    const offset = () => (nearBias && r() < 0.5
      ? pick(r, [-5, -4, -4, -3, 3, 4, 4, 5])
      : Math.floor(r() * 56) - 60);
    const events = Array.from({ length: Math.floor(r() * 40) }, () => {
      const ev = {
        ticker: pick(r, ['PETR4', 'PETR4', 'PETR4', 'XPML11', 'VALE3', 'BTC', 'OUTRO3']),
        date: new Date(Date.UTC(2026, 10, 18) + offset() * DAY + pick(r, [0, 0, 3600000, -1])),
        amount: pick(r, [0.1, 0.25, 0.9, '0.33', null]),
      };
      put(r, ev, 'source', [ABSENT, 'PROVIDER', 'DERIVED', 'MANUAL', null]);
      return ev;
    });
    // Histórico oficial longo de PETR4, longe do dia-ex: passa dos 12 da trava.
    if (r() < 0.4) {
      for (let k = 0; k < 10 + Math.floor(r() * 8); k++) {
        events.push({ ticker: 'PETR4', date: daysAgo(10 + k * 30), amount: pick(r, [0.2, 0.4, 1.1]), source: 'PROVIDER' });
      }
    }
    return {
      quotes, assetEntries, closes, events,
      closesThrow: r() < 0.04,
      eventsThrow: r() < 0.04,
      updateThrowAt: r() < 0.08 ? Math.floor(r() * 3) : -1,
      rejectMod: pick(r, [3, 4, 5]),
    };
  };
  const exec = async (s) => {
    const loadArgs = [];
    loadLatestCloseBefore.mockImplementation(async (cands, day) => {
      loadArgs.push(snap([cands, day]));
      if (s.closesThrow) throw new Error('closes fora');
      return new Map(s.closes.map(([k, v]) => [k, { ...v }]));
    });
    const deriveArgs = [];
    deriveDividendFromGap.mockImplementation((p) => {
      deriveArgs.push(snap(p));
      const gap = p.rawPrevClose - p.adjustedPrevClose;
      if (!(gap > 0.2)) return null;
      if (p.knownAmounts && p.knownAmounts.length % s.rejectMod === s.rejectMod - 1) return null;
      return { amount: Math.round(gap * 1e4) / 1e4 + (p.knownAmounts ? p.knownAmounts.length / 1000 : 0) };
    });
    const chain = [];
    DividendEvent.find.mockImplementation((q) => {
      chain.push(['find', snap(q)]);
      return {
        select: (f) => {
          chain.push(['select', f]);
          return {
            sort: (o) => {
              chain.push(['sort', o]);
              return {
                lean: async () => {
                  if (s.eventsThrow) throw new Error('eventos fora');
                  return s.events.map((e) => ({ ...e, date: new Date(e.date) }));
                },
              };
            },
          };
        },
      };
    });
    let updates = 0;
    DividendEvent.updateOne.mockImplementation(async () => {
      if (updates++ === s.updateThrowAt) throw new Error('escrita falhou');
      return { acknowledged: true };
    });
    const assetMap = new Map(s.assetEntries.map(([k, v]) => [k, { ...v }]));
    const quotes = s.quotes ? s.quotes.map((q) => ({ ...q })) : s.quotes;
    const result = await marketDataService.detectExDateDividends(quotes, assetMap);
    return {
      result, loadArgs, deriveArgs, chain,
      updateArgs: DividendEvent.updateOne.mock.calls,
      logs: logs(),
    };
  };

  it('800 cenários semeados', async () => {
    const { hashes, full } = await runAll(800, 303, gen, exec);
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  });
});

// ----------------------------------------------- retireStaleInactiveAssets --
describe('retireStaleInactiveAssets — caracterização', () => {
  const R_TICKERS = ['HGPO11', 'AERO11', 'PTNT3', 'BPAN4', 'MMC', 'BTC', 'FTCE11'];
  const gen = (r) => {
    const list = r() < 0.04 ? null : Array.from({ length: Math.floor(r() * 7) }, (_, i) => {
      const a = { ticker: R_TICKERS[i], type: pick(r, ['STOCK', 'FII', 'STOCK_US', 'CRYPTO']) };
      put(r, a, 'failCount', [ABSENT, 0, 9, 10, 25, null, 10, 25]);
      return a;
    });
    const ages = [];
    for (const t of R_TICKERS) {
      if (r() < 0.85) ages.push([t, { days: pick(r, [null, 5, 89, 90, 200, 200]), basis: pick(r, ['candle', 'priceDate', 'updatedAt']) }]);
    }
    const held = R_TICKERS.filter(() => r() < 0.15);
    const market = [];
    for (const t of R_TICKERS) {
      if (r() < 0.85) market.push([t, { regular: r() < 0.7, traded: Math.floor(r() * 120), sessions: pick(r, [2, 60, 120]) }]);
    }
    const history = {};
    for (const t of R_TICKERS) {
      history[t] = pick(r, [
        () => 'THROW', () => null, () => [], () => ({ nope: 1 }),
        () => Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
          const c = { date: daysAgo(pick(r, [2, 10, 11, 50, 400])) };
          put(r, c, 'close', [0, 5, 5, ABSENT]);
          put(r, c, 'volume', [0, ABSENT, 100]);
          return c;
        }),
      ])();
    }
    return {
      list, ages, held, market, history,
      agesThrow: r() < 0.03,
      heldThrow: r() < 0.03,
      marketThrow: r() < 0.08,
      bulkThrow: r() < 0.03,
    };
  };
  const exec = async (s) => {
    const ageArgs = [];
    const ages = vi.spyOn(marketDataService, 'lastTradeAgeByTicker').mockImplementation(async (a) => {
      ageArgs.push(snap(a));
      if (s.agesThrow) throw new Error('idade fora');
      return new Map(s.ages.map(([k, v]) => [k, { ...v }]));
    });
    const mktArgs = [];
    const mkt = vi.spyOn(marketDataService, 'hadRegularMarketByTicker').mockImplementation(async (a) => {
      mktArgs.push(snap(a));
      if (s.marketThrow) throw new Error('densidade fora');
      return new Map(s.market.map(([k, v]) => [k, { ...v }]));
    });
    spies.push(ages, mkt);
    UserAsset.distinct.mockImplementation(async () => {
      if (s.heldThrow) throw new Error('carteira fora');
      return [...s.held];
    });
    externalMarketService.getFullHistory.mockImplementation(async (t) => {
      const h = s.history[t];
      if (h === 'THROW') throw new Error('yahoo fora');
      return Array.isArray(h) ? h.map((c) => ({ ...c, date: new Date(c.date) })) : h;
    });
    MarketAsset.bulkWrite.mockImplementation(async () => {
      if (s.bulkThrow) throw new Error('bulk falhou');
      return {};
    });
    const list = s.list ? s.list.map((a) => ({ ...a })) : s.list;
    let result;
    try {
      result = await marketDataService.retireStaleInactiveAssets(list);
    } catch (e) {
      result = { threw: e.message };
    }
    return {
      result, ageArgs, mktArgs,
      distinctArgs: UserAsset.distinct.mock.calls,
      historyArgs: externalMarketService.getFullHistory.mock.calls,
      bulkArgs: MarketAsset.bulkWrite.mock.calls,
      logs: logs(),
    };
  };

  it('500 cenários semeados', async () => {
    const { hashes, full } = await runAll(500, 404, gen, exec);
    expect(hashes).toMatchSnapshot();
    expect(full).toMatchSnapshot();
  });
});
