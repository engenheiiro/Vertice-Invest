import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cheerio from 'cheerio';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';

// Caracterização das fontes do macro-sync, gravada no código ANTERIOR à divisão
// em partes: `updateCurrencies` (cadeia de câmbio e trilha do painel),
// `syncDailyEconomicIndexes` (série diária da Selic; BCB fora não grava nada),
// `parseGenericRow` (linha do Investidor10) e `updateTreasuryRates` (catálogo do
// Tesouro e cadeia da NTN-B). Rede, modelos e logger mockados; relógio fixo.

const h = vi.hoisted(() => ({
    log: [], escalations: [], skips: [], sentry: [], lastEntry: null, lastEntryError: null, bulk: [],
}));

vi.mock('../config/logger.js', () => {
    const logAs = (level) => (...args) => { h.log.push([level, ...args]); };
    return { default: { info: logAs('info'), error: logAs('error'), warn: logAs('warn'), debug: logAs('debug') } };
});
vi.mock('@sentry/node', () => ({
    captureMessage: (...args) => { h.sentry.push(args); },
    captureException: () => {},
}));
vi.mock('../utils/sourceHealth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    recordEscalation: (ev) => { h.escalations.push(ev); },
    recordSourceSkip: (...args) => { h.skips.push(args); },
}));
vi.mock('../models/EconomicIndex.js', () => ({
    default: {
        findOne: () => ({
            sort: async () => {
                if (h.lastEntryError) throw new Error(h.lastEntryError);
                return h.lastEntry;
            },
        }),
    },
}));
vi.mock('../models/TreasuryBond.js', () => ({
    default: { bulkWrite: async (ops) => { h.bulk.push(structuredClone(ops)); } },
}));

import axios from 'axios';
import { macroDataService } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T14:00:00-03:00'));
    Object.assign(h, { log: [], escalations: [], skips: [], sentry: [], lastEntry: null, lastEntryError: null, bulk: [] });
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const maybe = (rand, p = 0.5) => rand() < p;
const reset = () => {
    vi.restoreAllMocks();
    Object.assign(h, { log: [], escalations: [], skips: [], sentry: [], bulk: [] });
};

// ---------------------------------------------------------------------------
// updateCurrencies
// ---------------------------------------------------------------------------

const CLOCKS = ['2026-11-18T14:00:00-03:00', '2026-11-18T10:00:00-03:00', '2026-11-21T14:00:00-03:00'];
const USDS = [undefined, null, 5.3, 0, NaN, 31, '5.2', 1];
const BTCS = [undefined, null, 95000, 999, 5000001, NaN];
const CHANGES = [undefined, 0.4, NaN, -1.1, Infinity];

const genPartial = (rand, keys) => {
    if (maybe(rand, 0.2)) return pick(rand, [null, undefined]);
    const out = {};
    if (keys.includes('usd')) { out.usd = pick(rand, USDS); out.usdChange = pick(rand, CHANGES); }
    if (keys.includes('btc')) { out.btc = pick(rand, BTCS); out.btcChange = pick(rand, CHANGES); }
    return out;
};

const genYahooQuotes = (rand) => {
    if (maybe(rand, 0.15)) return pick(rand, [null, undefined, {}]);
    const q = {};
    if (maybe(rand, 0.8)) q.usd = { value: pick(rand, USDS), change: pick(rand, CHANGES) };
    if (maybe(rand, 0.8)) q.btc = { value: pick(rand, BTCS), change: pick(rand, CHANGES) };
    return q;
};

const runCurrencies = async (sc) => {
    vi.setSystemTime(new Date(sc.clock));
    const calls = [];
    vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockImplementation(async () => { calls.push('yahoo'); return structuredClone(sc.yahoo); });
    vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockImplementation(async () => { calls.push('coinbase'); return structuredClone(sc.coinbase); });
    vi.spyOn(macroDataService, '_fetchPtaxUsd').mockImplementation(async () => { calls.push('ptax'); return structuredClone(sc.ptax); });
    vi.spyOn(macroDataService, '_fetchCurrenciesCoinbaseRates').mockImplementation(async () => { calls.push('rates'); return structuredClone(sc.rates); });
    const reading = await macroDataService.updateCurrencies();
    return { reading, calls, escalations: h.escalations, log: h.log };
};

describe('updateCurrencies — caracterização', () => {
    it('300 cenários semeados (hash por cenário)', async () => {
        const rand = mulberry32(0x6678);
        const hashes = [];
        for (let i = 0; i < 300; i++) {
            const sc = {
                clock: pick(rand, CLOCKS),
                yahoo: genYahooQuotes(rand),
                coinbase: genPartial(rand, ['btc']),
                ptax: genPartial(rand, ['usd']),
                rates: genPartial(rand, ['usd', 'btc']),
            };
            reset();
            hashes.push(`${i}:${hash16(await runCurrencies(sc))}`);
        }
        expect(hashes).toMatchSnapshot();
    });

    it('cenários legíveis', async () => {
        const named = {
            yahooCompleto: { clock: CLOCKS[0], yahoo: { usd: { value: 5.3, change: 0.2 }, btc: { value: 95000, change: 1 } },
                coinbase: null, ptax: null, rates: null },
            reservaManha: { clock: CLOCKS[1], yahoo: null, coinbase: { btc: 94000, btcChange: 0.5 },
                ptax: null, rates: { usd: 5.31, usdChange: 0.1, btc: 1, btcChange: 0 } },
            nadaVeio: { clock: CLOCKS[0], yahoo: null, coinbase: null, ptax: null, rates: null },
        };
        const out = {};
        for (const [name, sc] of Object.entries(named)) {
            reset();
            out[name] = canon(await runCurrencies(sc));
        }
        expect(out).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// syncDailyEconomicIndexes
// ---------------------------------------------------------------------------

const BCB_ROWS = [[{ data: '17/11/2026', valor: '0.055131' }], []];
const genOutcome = (rand) => pick(rand, [
    { throws: 'timeout' }, { data: null }, { data: 'html' }, { data: BCB_ROWS[0] }, { data: BCB_ROWS[1] },
]);

const runDaily = async (sc) => {
    h.lastEntry = sc.lastEntry;
    h.lastEntryError = sc.lastEntryError;
    const calls = [];
    vi.spyOn(macroDataService, '_oldestLegacySyntheticSelicDate').mockImplementation(async () => { calls.push(['legacy']); return sc.legacy; });
    vi.spyOn(macroDataService, 'processDailyData').mockImplementation(async (rows) => { calls.push(['process', rows.length]); });
    vi.spyOn(macroDataService, '_purgeLegacySyntheticRows').mockImplementation(async (since, rows) => { calls.push(['purge', since, rows.length]); });
    let n = 0;
    vi.spyOn(axios, 'get').mockImplementation(async (url) => {
        const out = sc.outcomes[n++];
        calls.push(['get', url]);
        if (out.throws) throw new Error(out.throws);
        return { data: out.data };
    });
    const ret = await macroDataService.syncDailyEconomicIndexes();
    return { ret, calls, log: h.log };
};

describe('syncDailyEconomicIndexes — caracterização', () => {
    it('200 cenários semeados (hash por cenário)', async () => {
        const rand = mulberry32(0x7364);
        const hashes = [];
        for (let i = 0; i < 200; i++) {
            const sc = {
                lastEntry: pick(rand, [null, { date: new Date('2026-11-10T12:00:00Z') }, { date: new Date('2026-11-18T12:00:00Z') },
                    { date: new Date('2026-12-01T12:00:00Z') }]),
                lastEntryError: maybe(rand, 0.1) ? 'mongo fora' : null,
                legacy: pick(rand, [null, new Date('2026-06-01T12:00:00Z'), new Date('2026-12-30T12:00:00Z')]),
                outcomes: [genOutcome(rand), genOutcome(rand)],
            };
            reset();
            hashes.push(`${i}:${hash16(await runDaily(sc))}`);
        }
        expect(hashes).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// parseGenericRow
// ---------------------------------------------------------------------------

const CELLS = ['Tesouro IPCA+ 2035', 'Tesouro Prefixado 2029', 'Tesouro Selic 2031', 'Tesouro Renda+ Aposentadoria Extra 2049',
    'IPCA+', 'Tesouro Reserva 2036', 'IPCA + 7,95%', 'SELIC + 0,07%', '13,98%', 'SELIC', '12,18%', '30,00%', 'R$ 3.002,69',
    'R$ 30,03', '01/01/2035', '1.234,56', '45', 'abc', '', '  Tesouro   IPCA+   2045  ', 'Educa+', 'Renda+ Aposentadoria 2049'];

const genRowHtml = (rand) => {
    const n = Math.floor(rand() * 7);
    return `<tr>${Array.from({ length: n }, () => `<td>${pick(rand, CELLS)}</td>`).join('')}</tr>`;
};

describe('parseGenericRow — caracterização', () => {
    it('400 linhas semeadas (hash por cenário)', () => {
        const rand = mulberry32(0x7072);
        const hashes = [];
        for (let i = 0; i < 400; i++) {
            const $ = cheerio.load(`<table>${genRowHtml(rand)}</table>`);
            const tr = $('tr').get(0);
            hashes.push(`${i}:${hash16(tr ? macroDataService.parseGenericRow($, tr) : 'sem-tr')}`);
        }
        expect(hashes).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// updateTreasuryRates
// ---------------------------------------------------------------------------

const TITLES = ['Tesouro IPCA+ 2035', 'Tesouro IPCA+ 2029', 'Tesouro IPCA+ 2045Juros Semestrais', 'Tesouro Prefixado 2027',
    'Tesouro LTN 2028', 'Tesouro Selic 2031', 'LFT 2030', 'Tesouro Renda+ Aposentadoria Extra 2065', 'Tesouro Educa+ 2040',
    'Tesouro Reserva 2036', 'Tesouro IPCA+ 2050', 'Tesouro Educa+ IPCA+ 2041', 'Tesouro IPCA+  2060'];

const genBond = (rand) => ({
    title: pick(rand, TITLES),
    rate: pick(rand, [6.5, 12.4, 0, 1.5, 9.5, 7.02]),
    index: pick(rand, [null, 'SELIC', 'PRE', 'IPCA']),
    minInvestment: 30,
    unitPrice: 3000,
    maturity: '15/05/2035',
});

const runTreasury = async (sc) => {
    const calls = [];
    vi.spyOn(macroDataService, 'fetchNtnbFromTesouroDireto').mockImplementation(async () => { calls.push('official'); return sc.official; });
    vi.spyOn(macroDataService, 'scrapeInvestidor10').mockImplementation(async () => { calls.push('scrape'); return structuredClone(sc.bonds); });
    vi.spyOn(macroDataService, 'getLastKnownNtnbRate').mockImplementation(async () => { calls.push('lastKnown'); return sc.lastKnown; });
    vi.spyOn(macroDataService, 'pruneStaleBonds').mockImplementation(async (titles) => { calls.push(['prune', titles]); return 0; });
    const ret = await macroDataService.updateTreasuryRates();
    return { ret, calls, bulk: h.bulk, sentry: h.sentry, log: h.log };
};

describe('updateTreasuryRates — caracterização', () => {
    it('250 cenários semeados (hash por cenário)', async () => {
        const rand = mulberry32(0x7472);
        const hashes = [];
        for (let i = 0; i < 250; i++) {
            const sc = {
                official: pick(rand, [null, 7.1, 12.4, NaN, 2.0]),
                bonds: Array.from({ length: Math.floor(rand() * 9) }, () => genBond(rand)),
                lastKnown: pick(rand, [null, 6.6, 0]),
            };
            reset();
            hashes.push(`${i}:${hash16(await runTreasury(sc))}`);
        }
        expect(hashes).toMatchSnapshot();
    });
});
