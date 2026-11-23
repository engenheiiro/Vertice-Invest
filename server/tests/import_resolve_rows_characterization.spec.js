import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// Caracterização de `resolveRows` (prévia da importação de carteira, não
// escreve): o snapshot foi gravado no código ANTERIOR à divisão da função em
// partes. Trava status/motivo/classe/moeda de cada linha, o resumo por ticker e
// as consultas feitas ao catálogo e à carteira. Modelos mockados; cenários
// gerados em memória por um PRNG semeado.

const db = vi.hoisted(() => ({ catalog: [], positions: [], transactions: [], queries: [] }));

const chain = (model, key) => (filter) => {
  const q = { model, filter };
  db.queries.push(q);
  return { select: (fields) => { q.fields = fields; return { lean: () => Promise.resolve(db[key].map((d) => ({ ...d }))) }; } };
};

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: chain('AssetTransaction', 'transactions') } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: chain('UserAsset', 'positions') } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: chain('MarketAsset', 'catalog') } }));
vi.mock('../models/ImportBatch.js', () => ({ default: {} }));
vi.mock('../services/financialService.js', () => ({ financialService: {} }));
vi.mock('../utils/dbTransaction.js', () => ({ runTransaction: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { resolveRows } = await import('../services/portfolioImportService.js');

const SCENARIOS = 400;

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

// Rótulos crus e o ticker que `extractTicker` tira deles.
const LABELS = [
  ['PETR4', 'PETR4'], ['PETR4 - PETROLEO BRASILEIRO', 'PETR4'], ['petr4f', 'PETR4'],
  ['MXRF11F - MAXI RENDA', 'MXRF11'], ['AAPL', 'AAPL'], ['BTC', 'BTC'], ['XPTO11', 'XPTO11'],
  ['Tesouro Selic 2029', 'TESOURO SELIC 2029'], ['', ''], [null, ''],
];
const KNOWN = ['PETR4', 'MXRF11', 'AAPL', 'BTC', 'XPTO11', 'TESOURO SELIC 2029'];
const TYPES = ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'ETF', 'FIXED_INCOME'];
const DAYS = ['2024-01-10', '2024-01-10', '2024-02-05', '2024-03-15', '2024-03-15', '2024-06-30'];

function buildScenario(seed) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const chance = (p) => r() < p;
  const qty = () => pick([100, 50, 10, 1, 0.5, 0.123456789, 0, -20, 250, '30', Number.NaN]);
  const price = () => pick([30, 12.5, 0, 0.00001234, 0.00001567, -5, 101.987654, 1e-9]);
  const dateOf = (day) => (chance(0.5) ? new Date(`${day}T00:00:00.000Z`) : chance(0.5) ? day : `${day}T22:30:00-03:00`);

  db.catalog = KNOWN.filter(() => chance(0.5)).map((ticker) => ({
    ticker,
    name: chance(0.8) ? `Nome ${ticker}` : null,
    type: chance(0.9) ? pick(TYPES) : null,
    currency: chance(0.6) ? pick(['BRL', 'USD']) : undefined,
  }));
  db.positions = KNOWN.filter(() => chance(0.3)).map((ticker) => ({
    ticker, quantity: pick([0, 10, 100, 0.5]),
    type: chance(0.7) ? pick(TYPES) : null, currency: chance(0.5) ? 'USD' : undefined,
  }));
  db.transactions = Array.from({ length: Math.floor(r() * 6) }, () => ({
    ticker: pick(KNOWN), date: new Date(`${pick(DAYS)}T12:00:00.000Z`),
    type: chance(0.75) ? 'BUY' : 'SELL', quantity: pick([100, 50, 10]), price: pick([30, 12.5, 0.00001234]),
  }));
  db.queries = [];

  const rows = [];
  const n = Math.floor(r() * 9);
  for (let i = 0; i < n; i++) {
    if (rows.length && chance(0.12)) { rows.push({ ...pick(rows) }); continue; }
    const existing = db.transactions.length && chance(0.15) ? pick(db.transactions) : null;
    if (existing) {
      rows.push({ ticker: existing.ticker, side: existing.type, quantity: existing.quantity, price: existing.price, date: existing.date });
      continue;
    }
    const row = {
      ticker: pick(LABELS)[0],
      side: chance(0.6) ? 'BUY' : chance(0.9) ? 'SELL' : 'OUTRO',
      quantity: qty(),
      price: price(),
      date: chance(0.08) ? pick([null, 'não é data', undefined]) : dateOf(pick(DAYS)),
    };
    if (chance(0.25)) row.type = pick(TYPES);
    if (chance(0.25)) row.currency = pick(['BRL', 'USD']);
    if (chance(0.3)) row.name = `Linha ${i}`;
    if (chance(0.1)) row.extra = { origem: 'B3', linha: i };
    rows.push(row);
  }
  return { userId: 'u1', walletId: 'w1', rows };
}

// Serialização estável: chaves ordenadas, número não-finito e -0 explícitos.
function stable(value) {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '"-0"';
    if (!Number.isFinite(value)) return `"${String(value)}"`;
    return JSON.stringify(value);
  }
  if (value === undefined) return '"undefined"';
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function runScenario(seed) {
  const input = buildScenario(seed);
  let result;
  try {
    result = await resolveRows(input);
  } catch (err) {
    result = { error: `${err.constructor.name}: ${err.message}` };
  }
  return { result, queries: db.queries };
}

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

describe('resolveRows — caracterização (snapshot gravado no código anterior à divisão)', () => {
  it('resolve exatamente igual em todos os cenários', async () => {
    const out = [];
    for (let seed = 1; seed <= SCENARIOS; seed++) out.push(`${seed}:${digest(stable(await runScenario(seed)))}`);
    expect(out).toMatchSnapshot();
  });

  it('a matriz exercita os ramos que importam', async () => {
    const reasons = new Map();
    let errors = 0;
    let withSummary = 0;
    for (let seed = 1; seed <= SCENARIOS; seed++) {
      const { result } = await runScenario(seed);
      if (result.error) { errors++; continue; }
      if (result.summary.some((s) => s.hadPosition && s.rows > 0)) withSummary++;
      for (const row of result.rows) reasons.set(row.reason, (reasons.get(row.reason) || 0) + 1);
    }
    expect(errors).toBe(0);
    expect(withSummary).toBeGreaterThan(20);
    expect([...reasons.keys()].sort()).toEqual([
      'Ativo fora do nosso catálogo. Escolha a classe para importar.',
      'Compra com preço zerado — confira antes de importar.',
      'Lançamento idêntico já existe nesta carteira.',
      'Linha repetida dentro do próprio arquivo.',
      'Linha sem ticker ou data válida.',
      'Venda maior que a posição acumulada até esta data — falta a compra correspondente.',
      null,
    ].sort());
    for (const count of reasons.values()) expect(count).toBeGreaterThan(5);
  });

  it('cenários legíveis de referência (diff por campo quando algo muda)', async () => {
    const readable = [];
    for (const seed of [5, 42, 123]) readable.push(JSON.parse(stable(await runScenario(seed))));
    expect(readable).toMatchSnapshot();
  });
});
