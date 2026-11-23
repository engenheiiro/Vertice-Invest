/**
 * Caracterização de `usStocksFundamentalsService` (quoteSummary do Yahoo →
 * bulkOps do MarketAsset), gravada ANTES de quebrar `extractFundamentals`,
 * `buildFundamentalsOp` e `syncBrEtfFundamentals` em partes.
 *
 * Varre respostas parciais do Yahoo (módulo ausente, campo null/undefined,
 * `{ raw }` em vez de número, NaN/±Infinity, 0/-0, string numérica) e, no
 * caminho dos ETFs nacionais, falha do Yahoo, blacklist, fallback da Brapi e
 * histórico de proventos (null = fonte fora, [] e TTM em volta do corte de 12m).
 * Regra 13: o snapshot congela onde campo ausente fica fora do $set em vez de
 * virar 0 ou número inventado.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';

const h = vi.hoisted(() => ({
    quoteSummary: null,
    find: null,
    bulkWrite: null,
    fetchFromBrapi: null,
    getDividendsHistory: null,
    etfList: [],
}));

vi.mock('yahoo-finance2', () => ({
    default: class {
        quoteSummary(...args) { return h.quoteSummary(...args); }
    },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/MarketAsset.js', () => ({
    default: {
        find: (...args) => h.find(...args),
        bulkWrite: (...args) => h.bulkWrite(...args),
    },
}));
vi.mock('../config/brEtfList.js', () => ({
    get BR_ETF_LIST() { return h.etfList; },
}));
vi.mock('../services/externalMarketService.js', () => ({
    toYahooSymbol: (t) => String(t).replace('.', '-'),
    externalMarketService: {
        fetchFromBrapi: (...args) => h.fetchFromBrapi(...args),
        getDividendsHistory: (...args) => h.getDividendsHistory(...args),
    },
}));

const { _internals, usStocksFundamentalsService } = await import('../services/usStocksFundamentalsService.js');
const { SP500_STOCKS } = await import('../config/sp500List.js');
const { US_ETF_LIST } = await import('../config/usEtfList.js');

const NOW = new Date('2026-11-20T15:00:00.000Z');

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function canon(v) {
    if (v === undefined) return '__undefined__';
    if (typeof v === 'number') {
        if (Number.isNaN(v)) return '__NaN__';
        if (v === Infinity) return '__Inf__';
        if (v === -Infinity) return '__-Inf__';
        if (Object.is(v, -0)) return '__-0__';
        return v;
    }
    if (v instanceof Date) return `__Date(${Number.isNaN(v.getTime()) ? 'invalid' : v.toISOString()})__`;
    if (v instanceof Map) return { __Map__: [...v.entries()].map(([k, x]) => [canon(k), canon(x)]) };
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
        return out;
    }
    return v;
}
const ser = (v) => JSON.stringify(canon(v));
const hash = (v) => createHash('sha256').update(ser(v)).digest('hex').slice(0, 16);

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// Valor "do Yahoo": número limpo é o mais comum, mas todo formato parcial aparece.
function yahooValue(rnd, scale) {
    const r = rnd();
    if (r < 0.40) return safeNum(rnd, scale);
    if (r < 0.48) return undefined;
    if (r < 0.54) return null;
    if (r < 0.60) return 0;
    if (r < 0.63) return -0;
    if (r < 0.68) return NaN;
    if (r < 0.71) return Infinity;
    if (r < 0.73) return -Infinity;
    if (r < 0.80) return -safeNum(rnd, scale);
    if (r < 0.88) return { raw: safeNum(rnd, scale), fmt: 'x' };
    if (r < 0.92) return { raw: NaN };
    if (r < 0.96) return String(safeNum(rnd, scale));
    return '';
}
function safeNum(rnd, scale) {
    return Math.round(rnd() * scale * 10000) / 10000;
}

const FIELDS = {
    summaryDetail: {
        trailingPE: 80, dividendYield: 0.12, yield: 0.12, trailingAnnualDividendYield: 0.12,
        beta: 3, marketCap: 3e12, regularMarketPrice: 900, averageVolume: 5e7, payoutRatio: 1.5,
    },
    defaultKeyStatistics: {
        priceToBook: 40, beta: 3, averageDailyVolume10Day: 5e7, bookValue: 300, trailingEps: 40,
        forwardPE: 60, enterpriseValue: 4e12,
    },
    financialData: {
        returnOnEquity: 1.2, profitMargins: 0.6, revenueGrowth: 0.9, earningsGrowth: 1.5,
        debtToEquity: 400, currentPrice: 900,
    },
};
const TEXTS = {
    assetProfile: { sector: ['Technology', 'Financial Services', '', null, undefined], industry: ['Banks', '', null, undefined] },
    price: { longName: ['Acme Corp', '', null, undefined], shortName: ['ACME', '', null, undefined] },
};

function genData(rnd) {
    const data = {};
    for (const [mod, fields] of Object.entries(FIELDS)) {
        const r = rnd();
        if (r < 0.12) continue; // módulo ausente
        if (r < 0.17) { data[mod] = null; continue; }
        const obj = {};
        for (const [field, scale] of Object.entries(fields)) {
            const v = yahooValue(rnd, scale);
            if (v !== undefined || rnd() < 0.3) obj[field] = v;
        }
        data[mod] = obj;
    }
    for (const [mod, fields] of Object.entries(TEXTS)) {
        if (rnd() < 0.2) continue;
        const obj = {};
        for (const [field, opts] of Object.entries(fields)) obj[field] = pick(rnd, opts);
        data[mod] = obj;
    }
    return data;
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

describe('caracterização: extractFundamentals (via _internals)', () => {
    it('500 respostas parciais do Yahoo', () => {
        const rnd = mulberry32(0xF00D);
        const hashes = [];
        const amostras = [];
        for (let i = 0; i < 500; i++) {
            const data = genData(rnd);
            const out = _internals.extractFundamentals(`T${i}`, data);
            hashes.push(`${i}:${hash({ data, out })}`);
            if (i < 6) amostras.push({ data, out });
        }
        expect(hashes).toMatchSnapshot();
        expect(JSON.parse(ser(amostras))).toMatchSnapshot();
    });

    it('casos-fronteira escritos à mão', () => {
        const casos = [
            {},
            { summaryDetail: {} },
            { summaryDetail: { trailingPE: 0, marketCap: 0, dividendYield: NaN, yield: 0.05 } },
            { summaryDetail: { trailingPE: -5, marketCap: -1, trailingAnnualDividendYield: 0 } },
            { summaryDetail: { trailingPE: Infinity, marketCap: Infinity, dividendYield: { raw: 0.03 } } },
            { summaryDetail: { trailingPE: 10 }, financialData: { earningsGrowth: 0.2 } },
            { summaryDetail: { trailingPE: 10 }, financialData: { earningsGrowth: -0.2 } },
            { summaryDetail: { averageVolume: 1000 }, financialData: { currentPrice: 0 } },
            { summaryDetail: { averageVolume: 1000, regularMarketPrice: 5 } },
            { defaultKeyStatistics: { averageDailyVolume10Day: 7, trailingEps: -0, beta: 0 }, summaryDetail: { beta: 1.1 } },
            { financialData: { debtToEquity: 0, returnOnEquity: 0, profitMargins: NaN } },
            { financialData: { debtToEquity: null } },
            { financialData: { debtToEquity: '47.49' } },
            { assetProfile: { sector: '' }, price: { longName: '', shortName: 'S' } },
        ];
        const out = casos.map((data) => ({ data, out: _internals.extractFundamentals('X', data) }));
        expect(JSON.parse(ser(out))).toMatchSnapshot();
    });

    it('data nulo lança (congelado)', () => {
        expect(() => _internals.extractFundamentals('X', null)).toThrow();
    });
});

describe('caracterização: buildFundamentalsOp (via _internals)', () => {
    it('400 tickers do universo e de fora × respostas parciais', () => {
        const rnd = mulberry32(0xBEEF);
        const universe = [...SP500_STOCKS, ...US_ETF_LIST].map(s => s.ticker);
        const extra = ['ZZZZ_FORA', 'O', 'PLD', 'AMT', 'SPG', 'EQIX', 'BRK.B', 'GLD'];
        const hashes = [];
        const amostras = [];
        for (let i = 0; i < 400; i++) {
            const ticker = rnd() < 0.3 ? pick(rnd, extra) : pick(rnd, universe);
            const data = genData(rnd);
            const op = _internals.buildFundamentalsOp(ticker, data);
            hashes.push(`${i}:${hash({ ticker, data, op })}`);
            if (i < 5) amostras.push({ ticker, data, op });
        }
        expect(hashes).toMatchSnapshot();
        expect(JSON.parse(ser(amostras))).toMatchSnapshot();
    });

    it('fora do universo e sem fonte: só a sigla no $setOnInsert', () => {
        const op = _internals.buildFundamentalsOp('ZZZZ_FORA', { assetProfile: { industry: 'Banks' } });
        expect(JSON.parse(ser(op))).toMatchSnapshot();
    });
});

// ---------------- syncBrEtfFundamentals ----------------

function genEtfList(rnd, n, base) {
    const list = [];
    for (let k = 0; k < n; k++) {
        const etf = { ticker: `E${base}X${k}11`, name: `ETF ${k}`, sector: pick(rnd, ['Ações', 'Renda Fixa', 'Internacional']) };
        const ac = rnd();
        if (ac < 0.5) etf.allocationClass = pick(rnd, ['EQUITY_BR', 'FIXED_INCOME', 'GLOBAL']);
        else if (ac < 0.6) etf.allocationClass = '';
        list.push(etf);
    }
    return list;
}

function genEtfData(rnd) {
    const data = genData(rnd);
    // Força casos de liquidez/preço zerados (Yahoo .SA) com mais frequência.
    if (rnd() < 0.4 && data.financialData) data.financialData.currentPrice = pick(rnd, [0, undefined, null, 12.5]);
    if (rnd() < 0.4 && data.summaryDetail) data.summaryDetail.averageVolume = pick(rnd, [0, undefined, 3000]);
    if (rnd() < 0.3 && data.summaryDetail) {
        data.summaryDetail.dividendYield = undefined;
        data.summaryDetail.yield = undefined;
        data.summaryDetail.trailingAnnualDividendYield = pick(rnd, [undefined, 0, NaN]);
    }
    return data;
}

function genBrapi(rnd) {
    const r = rnd();
    if (r < 0.2) return null;
    if (r < 0.25) return undefined;
    if (r < 0.3) return {};
    return {
        price: pick(rnd, [0, -1, 10.5, 98.12, undefined, NaN]),
        volume: pick(rnd, [0, 1500, 250000, undefined, -3]),
    };
}

function genHist(rnd) {
    const r = rnd();
    if (r < 0.25) return null;
    if (r < 0.4) return [];
    const n = 1 + Math.floor(rnd() * 6);
    const out = [];
    for (let k = 0; k < n; k++) {
        const daysAgo = Math.floor(rnd() * 500) - 5;
        out.push({
            date: new Date(NOW.getTime() - daysAgo * 86400000),
            amount: pick(rnd, [0, 0.12, 0.5, 1.37, -0.1]),
        });
    }
    // Corte exato de 12 meses (fronteira do >=).
    if (rnd() < 0.3) {
        const cutoff = new Date(NOW);
        cutoff.setFullYear(cutoff.getFullYear() - 1);
        out.push({ date: cutoff, amount: 0.25 });
    }
    return out;
}

async function runEtfScenario(rnd, idx, { n, blacklistMode }) {
    const list = genEtfList(rnd, n, idx);
    h.etfList = list;
    const plan = new Map();
    for (const etf of list) {
        const r = rnd();
        plan.set(`${etf.ticker}.SA`, {
            kind: r < 0.15 ? 'reject' : 'ok',
            data: genEtfData(rnd),
            brapi: genBrapi(rnd),
            hist: genHist(rnd),
        });
    }
    const blacklisted = list.filter(() => rnd() < 0.15).map(e => e.ticker);
    const calls = { quoteSummary: [], find: [], bulkWrite: [], brapi: [], hist: [] };

    h.find = (q) => {
        calls.find.push(q);
        if (blacklistMode === 'throw') throw new Error('db down');
        return { select: () => ({ lean: async () => blacklisted.map(ticker => ({ ticker })) }) };
    };
    h.quoteSummary = async (sym, opts, extra) => {
        calls.quoteSummary.push([sym, opts, extra]);
        const p = plan.get(sym);
        if (p.kind === 'reject') throw new Error(`Quote not found ${sym}`);
        return p.data;
    };
    h.bulkWrite = async (ops) => { calls.bulkWrite.push(JSON.parse(ser(ops))); return {}; };
    h.fetchFromBrapi = async (sym) => { calls.brapi.push(sym); return plan.get(sym).brapi; };
    h.getDividendsHistory = async (ticker, type, opts) => {
        calls.hist.push([ticker, type, opts]);
        return plan.get(`${ticker}.SA`).hist;
    };

    let result;
    try {
        result = await usStocksFundamentalsService.syncBrEtfFundamentals();
    } catch (err) {
        result = { threw: err.message };
    }
    return { list, plan: [...plan.entries()], blacklisted, calls, result };
}

describe('caracterização: syncBrEtfFundamentals', () => {
    it('120 cenários de lote único (blacklist, falhas, Brapi, proventos)', async () => {
        const rnd = mulberry32(0xE7F);
        const hashes = [];
        const amostras = [];
        for (let i = 0; i < 120; i++) {
            const n = Math.floor(rnd() * 8);
            const blacklistMode = rnd() < 0.1 ? 'throw' : 'ok';
            const run = await runEtfScenario(rnd, i, { n, blacklistMode });
            hashes.push(`${i}:${hash(run)}:${ser(run.result)}`);
            if (i < 3) amostras.push(run);
        }
        expect(hashes).toMatchSnapshot();
        expect(JSON.parse(ser(amostras))).toMatchSnapshot();
    });

    it('lista longa: vários lotes e flush intermediário de 50 ops', async () => {
        const rnd = mulberry32(0xB16);
        const run = await runEtfScenario(rnd, 999, { n: 64, blacklistMode: 'ok' });
        expect(run.calls.bulkWrite.map(ops => ops.length)).toMatchSnapshot();
        expect(hash(run)).toMatchSnapshot();
    }, 15000);

    it('casos à mão: DY do Yahoo, acumulador sem provento, fonte fora, Brapi preenche', async () => {
        const etf = { ticker: 'HAND11', name: 'Hand', sector: 'Ações' };
        const casos = [
            { data: { summaryDetail: { yield: 0.0845, averageVolume: 100 }, financialData: { currentPrice: 10 } }, brapi: null, hist: null },
            { data: { summaryDetail: { trailingAnnualDividendYield: 0 } }, brapi: { price: 50, volume: 10 }, hist: [] },
            { data: { summaryDetail: {} }, brapi: { price: 50, volume: 10 }, hist: null },
            { data: { summaryDetail: {} }, brapi: null, hist: null },
            { data: { summaryDetail: { averageVolume: 200 } }, brapi: { price: 20, volume: 0 }, hist: [{ date: new Date('2026-06-01'), amount: 0.4 }] },
            {
                data: { summaryDetail: { beta: 0, marketCap: 0, dividendYield: -0.01 } },
                brapi: { price: 8 },
                hist: [{ date: new Date('2025-01-01'), amount: 2 }],
            },
            { data: { defaultKeyStatistics: { beta: { raw: 1 } }, summaryDetail: { marketCap: { raw: 5 } } }, brapi: { price: 8, volume: 2 }, hist: [] },
            { data: { defaultKeyStatistics: { beta: 0 }, summaryDetail: { beta: -0 } }, brapi: { price: 0.5, volume: 4 }, hist: [] },
            { data: { summaryDetail: { averageVolume: 10 } }, brapi: { price: 0.5, volume: 4 }, hist: [{ date: new Date('2026-10-01'), amount: 0.01 }] },
        ];
        const out = [];
        for (const c of casos) {
            h.etfList = [etf];
            const writes = [];
            h.find = () => ({ select: () => ({ lean: async () => [] }) });
            h.quoteSummary = async () => c.data;
            h.bulkWrite = async (ops) => { writes.push(JSON.parse(ser(ops))); return {}; };
            h.fetchFromBrapi = async () => c.brapi;
            h.getDividendsHistory = async () => c.hist;
            const result = await usStocksFundamentalsService.syncBrEtfFundamentals();
            out.push({ writes, result });
        }
        expect(out).toMatchSnapshot();
    });

    it('histórico de proventos undefined (não null): ETF pulado e contado como falha', async () => {
        h.etfList = [{ ticker: 'UNH11', name: 'U', sector: 'Ações' }];
        h.find = () => ({ select: () => ({ lean: async () => [] }) });
        h.quoteSummary = async () => ({ summaryDetail: {} });
        h.bulkWrite = async () => ({});
        h.fetchFromBrapi = async () => ({ price: 10, volume: 1 });
        h.getDividendsHistory = async () => undefined;
        await expect(usStocksFundamentalsService.syncBrEtfFundamentals()).resolves.toEqual({ processed: 0, failed: 1, total: 1 });
    });

    it('quoteSummary devolvendo undefined: ETF pulado e contado como falha', async () => {
        h.etfList = [{ ticker: 'UND11', name: 'U', sector: 'Ações' }];
        h.find = () => ({ select: () => ({ lean: async () => [] }) });
        h.quoteSummary = async () => undefined;
        h.bulkWrite = async () => ({});
        await expect(usStocksFundamentalsService.syncBrEtfFundamentals()).resolves.toEqual({ processed: 0, failed: 1, total: 1 });
    });
});
