import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// Caracterização de `_applyDayTransactions` (rebuild do histórico da carteira):
// o snapshot foi gravado no código ANTERIOR à divisão da função em partes, e
// trava todo número que ela produz — retorno, portfolio, estado de renda fixa e
// último preço conhecido. Nenhum teste aqui toca o banco: modelos mockados e
// cenários gerados em memória por um PRNG semeado.

vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { financialService } = await import('../services/financialService.js');

const SCENARIOS = 400;
const CURSOR = '2026-03-16';

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

const isoPlus = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const METADATA = [
  ['PETR4', { ticker: 'PETR4', type: 'STOCK' }],
  ['AAPL', { ticker: 'AAPL', type: 'STOCK_US' }],
  ['BTC', { ticker: 'BTC', type: 'CRYPTO' }],
  ['IVVB11', { ticker: 'IVVB11', type: 'ETF' }],
  ['CDB-A', { ticker: 'CDB-A', type: 'FIXED_INCOME', fixedIncomeRate: 110, fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0 }],
  ['CDB-Z', { ticker: 'CDB-Z', type: 'FIXED_INCOME', fixedIncomeRate: 0 }],
  ['LCI-S', { ticker: 'LCI-S', type: 'FIXED_INCOME', fixedIncomeRate: -1, fixedIncomeIndex: 'IPCA', fixedIncomeSpread: 5.5 }],
  ['CASH-1', { ticker: 'CASH-1', type: 'CASH' }],
  ['CASH-2', { ticker: 'CASH-2', type: 'CASH', fixedIncomeRate: 102 }],
  ['TD-PRE', { ticker: 'TD-PRE', type: 'FIXED_INCOME', fixedIncomeRate: 12, maturityDate: new Date('2029-01-01T00:00:00Z') }],
  ['TD-IPCA', { ticker: 'TD-IPCA', type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA', fixedIncomeSpread: 6, maturityDate: '2035-05-15' }],
];
const TICKERS = [...METADATA.map(([t]) => t), 'NOMETA', 'NOMETA-US'];

// Série de PU com buraco: compras antes de 2026-02-20 ficam sem PU.
const TREASURY_HISTORY = Array.from({ length: 30 }, (_, i) => ({
  date: isoPlus('2026-02-20', i), pu: 1000 + i * 1.5, puBuy: i % 3 === 0 ? 0 : 1001 + i * 1.5,
}));
const treasuryPricing = {
  historyFor: (meta) => (meta.ticker.startsWith('TD') ? TREASURY_HISTORY.map((p) => ({ ...p })) : null),
};

function buildScenario(seed) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const chance = (p) => r() < p;
  const tickers = Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(TICKERS));

  const priceCacheMap = new Map();
  for (const t of tickers) {
    if (chance(0.3)) continue;
    const m = new Map();
    const offsets = chance(0.5) ? [0] : [pick([1, 3, 5, 6, 8])];
    for (const off of offsets) {
      m.set(isoPlus(CURSOR, -off), {
        close: pick([0, 10, 25.5, 101.37]),
        adjClose: pick([0, 9.7, 24.1, 99.99, -1]),
      });
    }
    if (chance(0.1)) m.clear();
    priceCacheMap.set(t, m);
  }

  const portfolio = {};
  const fixedIncomeState = {};
  const lastKnownPrices = {};
  for (const t of tickers) {
    if (chance(0.25)) portfolio[t] = { qty: pick([0, 1, 2.5, 10]), cost: pick([0, 100, 333.33]), costBrl: pick([0, 150, 1200.5]) };
    if (portfolio[t] && chance(0.5)) {
      const lotQty = chance(0.2) ? undefined : pick([1, 2.5]);
      fixedIncomeState[t] = {
        currentValue: pick([0, 500, 1234.56]), rate: 100, index: null, spread: 0, history: null, maturityIso: null,
        lots: [{ dateIso: '2025-12-01', cost: 400, qty: lotQty }, { dateIso: '2026-01-05', cost: 600, qty: 3 }],
      };
    }
    if (chance(0.2)) lastKnownPrices[t] = { close: 7, adjClose: 6.5 };
  }

  const nTx = Math.floor(r() * 7);
  const txs = [];
  let dayOffset = -40 + Math.floor(r() * 10);
  for (let i = 0; i < nTx; i += 1) {
    dayOffset += Math.floor(r() * 12);
    const ticker = pick(tickers);
    const quantity = pick([1, 0.5, 2, 2.5, 10, 0.001, 1e-10]);
    const price = pick([10, 25.5, 1000, 0.37]);
    const tx = {
      ticker,
      type: pick(['BUY', 'BUY', 'SELL', 'SELL', 'DIVIDEND']),
      quantity,
      price,
      totalValue: pick([quantity * price, quantity * price * 1.01, 0]),
      date: new Date(`${isoPlus(CURSOR, Math.min(dayOffset, 3))}T${pick(['00:30', '12:00', '23:59'])}:00Z`),
    };
    const currency = pick(['BRL', 'USD', undefined, 'EUR']);
    if (currency !== undefined) tx.currency = currency;
    if (chance(0.25)) tx.fxRate = pick([4.2, 0, 'abc', -1]);
    txs.push(tx);
  }

  const rateMode = pick(['by-day', 'by-day', 'by-day', 'null', 'zero', 'constant']);
  const getUsdRateForDate = (dayKey) => {
    if (rateMode === 'null') return null;
    if (rateMode === 'zero') return 0;
    if (rateMode === 'constant') return 5.75;
    return 4 + (Number(dayKey.slice(8, 10)) % 7) * 0.125;
  };

  const ctx = {
    txs,
    txIndex: chance(0.15) && txs.length ? 1 : 0,
    cursorIso: CURSOR,
    portfolio,
    fixedIncomeState,
    assetMetadataMap: new Map(METADATA.map(([t, m]) => [t, { ...m }])),
    priceCacheMap,
    lastKnownPrices,
    getUsdRateForDate,
  };
  if (chance(0.6)) ctx.treasuryPricing = treasuryPricing;
  return ctx;
}

// Serialização estável: chaves ordenadas, número não-finito e -0 explícitos.
function stable(value) {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '"-0"';
    if (!Number.isFinite(value)) return `"${String(value)}"`;
    return JSON.stringify(value);
  }
  if (value === undefined) return '"undefined"';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runScenario(seed) {
  const ctx = buildScenario(seed);
  let result;
  try {
    result = financialService._applyDayTransactions(ctx);
  } catch (err) {
    result = { error: `${err.constructor.name}: ${err.message}` };
  }
  return {
    result,
    portfolio: ctx.portfolio,
    fixedIncomeState: ctx.fixedIncomeState,
    lastKnownPrices: ctx.lastKnownPrices,
  };
}

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

describe('_applyDayTransactions — caracterização (snapshot gravado no código anterior à divisão)', () => {
  const outputs = Array.from({ length: SCENARIOS }, (_, seed) => runScenario(seed + 1));

  it('produz exatamente os mesmos números em todos os cenários', () => {
    expect(outputs.map((o, i) => `${i + 1}:${digest(stable(o))}`)).toMatchSnapshot();
  });

  it('a matriz exercita os ramos que importam', () => {
    const texts = outputs.map((o) => stable(o));
    const errors = outputs.filter((o) => o.result.error).length;
    const fixedWithLots = texts.filter((t) => t.includes('"lots":[{')).length;
    const zeroed = outputs.filter((o) => Object.values(o.portfolio).some((p) => p.qty === 0)).length;
    expect(errors).toBeGreaterThan(10);
    expect(errors).toBeLessThan(SCENARIOS / 2);
    expect(fixedWithLots).toBeGreaterThan(20);
    expect(zeroed).toBeGreaterThan(20);
  });

  it('cenários legíveis de referência (diff por campo quando algo muda)', () => {
    expect([7, 42, 123].map((seed) => JSON.parse(stable(runScenario(seed))))).toMatchSnapshot();
  });
});
