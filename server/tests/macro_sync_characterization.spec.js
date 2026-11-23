import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';

// Caracterização do macro-sync, gravada no código ANTERIOR à divisão em partes.
// Quatro pontos de entrada de hoje: `performMacroSync` (o que é gravado no
// SystemConfig e o que fica como estava quando uma fonte falha — regra 13),
// `updateOfficialRates` (cadeia BCB → BrasilAPI → IBGE, guard da Selic, trilha
// do painel), `_parseNtnbFromCsv` (CSV do Tesouro) e `_persistUsdHistory`
// (união da série USD/BRL). Nenhum teste toca o banco nem a rede: modelos,
// fontes e logger mockados, cenários de PRNG semeado, relógio fixo.

const h = vi.hoisted(() => ({
    log: [],
    escalations: [],
    configDoc: null,
    prior: null,
    saved: null,
    usdExisting: null,
    usdFindError: null,
    usdWrites: [],
}));

vi.mock('../config/logger.js', () => {
    const logAs = (level) => (...args) => { h.log.push([level, ...args]); };
    return { default: { info: logAs('info'), error: logAs('error'), warn: logAs('warn'), debug: logAs('debug') } };
});
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../utils/sourceHealth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    recordEscalation: (ev) => { h.escalations.push(ev); },
}));
vi.mock('../models/SystemConfig.js', () => {
    function SystemConfig(init) { Object.assign(this, init); }
    SystemConfig.prototype.save = async function save() { h.saved = { ...this }; };
    SystemConfig.findOne = () => {
        const chain = {
            select: () => chain,
            lean: async () => (h.prior ? { ...h.prior } : null),
            then: (res, rej) => Promise.resolve(h.configDoc
                ? Object.assign(Object.create(SystemConfig.prototype), structuredClone(h.configDoc))
                : null).then(res, rej),
        };
        return chain;
    };
    return { default: SystemConfig };
});
vi.mock('../models/AssetHistory.js', () => ({
    default: {
        findOne: () => ({
            select: () => ({
                lean: async () => {
                    if (h.usdFindError) throw new Error(h.usdFindError);
                    return h.usdExisting ? structuredClone(h.usdExisting) : null;
                },
            }),
        }),
        findOneAndUpdate: async (...args) => { h.usdWrites.push(structuredClone(args)); return null; },
    },
}));

import { macroDataService } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

const AGORA = new Date('2026-11-18T14:00:00-03:00');

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    h.log = [];
    h.escalations = [];
    h.configDoc = null;
    h.prior = null;
    h.saved = null;
    h.usdExisting = null;
    h.usdFindError = null;
    h.usdWrites = [];
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const maybe = (rand, p = 0.5) => rand() < p;

// ---------------------------------------------------------------------------
// performMacroSync
// ---------------------------------------------------------------------------

const genOfficial = (rand) => {
    if (maybe(rand, 0.1)) return null;
    const selic = pick(rand, [null, 0, -1, 13.75, 15, 10.5]);
    return {
        selic,
        cdi: selic != null ? pick(rand, [selic - 0.1, 0, null]) : null,
        ipca: pick(rand, [null, NaN, 4.5, Infinity, 5.12]),
        isFallback: pick(rand, [true, false, undefined]),
        selicIsFallback: pick(rand, [true, false, undefined]),
        ipcaIsFallback: pick(rand, [true, false, undefined]),
        selicFrozen: pick(rand, [true, false, undefined]),
        sources: pick(rand, [undefined, null, { selic: 'BCB', ipca: 'IBGE' }, { selic: 'frozen', ipca: 'fallback' }]),
    };
};

const genCurrencies = (rand) => ({
    usd: pick(rand, [null, 5.1, undefined, 5.43]),
    usdChange: pick(rand, [0, 0.3, -1.2, undefined]),
    usdSource: pick(rand, [null, 'Yahoo', 'PTAX/BCB']),
    btc: pick(rand, [null, 91000, undefined]),
    btcChange: pick(rand, [0, 2.5, undefined]),
    btcSource: pick(rand, [null, 'Yahoo', 'Coinbase']),
});

const genIndex = (rand, value) => (maybe(rand, 0.4)
    ? undefined
    : { value, change: pick(rand, [0.4, -0.8, undefined]), source: pick(rand, [undefined, 'Yahoo', 'B3', '']) });

const genGlobalIndices = (rand) => {
    if (maybe(rand, 0.15)) return pick(rand, [null, undefined]);
    return { ibov: genIndex(rand, 128000), spx: genIndex(rand, 5900) };
};

const genTreasury = (rand) => pick(rand, [
    null,
    { ntnbLong: null, ntnbSource: null },
    { ntnbLong: 0, ntnbSource: 'x' },
    { ntnbLong: 6.21, ntnbSource: 'TesouroTransparente' },
    { ntnbLong: 7.05, ntnbSource: 'último-conhecido' },
]);

const genConfigDoc = (rand) => {
    if (maybe(rand, 0.2)) return null;
    const doc = { key: 'MACRO_INDICATORS' };
    const fields = {
        selic: 11.25, cdi: 11.15, riskFree: 11.25, ipca: 4.1, ratesStale: true, dollar: 4.9, dollarChange: 0.1,
        btc: 80000, btcChange: 1, ibov: 120000, ibovChange: 0.2, spx: 5000, spxChange: 0.1, cdiReturn12m: 10.9,
        spxReturn12m: 20, ibovReturn12m: 8, ntnbLong: 6.6, currenciesStale: false, indicesStale: false,
        ratesUpdatedAt: new Date('2026-11-01T00:00:00Z'), currenciesUpdatedAt: new Date('2026-11-02T00:00:00Z'),
        indicesUpdatedAt: new Date('2026-11-03T00:00:00Z'), lastUpdated: new Date('2026-11-04T00:00:00Z'),
    };
    for (const [k, v] of Object.entries(fields)) if (maybe(rand, 0.6)) doc[k] = v;
    const rs = pick(rand, ['absent', null, { ntnb: 'Investidor10' }, { selic: 'BCB', ipca: 'BCB' }, { selic: 'BCB', ntnb: 'TesouroTransparente' }]);
    if (rs !== 'absent') doc.ratesSources = rs;
    return doc;
};

const genSyncScenario = (rand) => ({
    prior: pick(rand, [null, { selic: 13.75 }, { selic: null }, {}]),
    configDoc: genConfigDoc(rand),
    official: genOfficial(rand),
    currencies: genCurrencies(rand),
    globalIndices: genGlobalIndices(rand),
    cdi12m: pick(rand, [null, NaN, Infinity, 12.3, -5, undefined]),
    spx12m: pick(rand, [null, NaN, 18.4, undefined]),
    ibov12m: pick(rand, [null, -Infinity, 9.9, 0]),
    treasury: genTreasury(rand),
});

const runSync = async (sc) => {
    h.prior = sc.prior;
    h.configDoc = sc.configDoc;
    const calls = [];
    const track = (name, value) => (...args) => { calls.push([name, ...args]); return Promise.resolve(structuredClone(value)); };
    vi.spyOn(macroDataService, 'updateOfficialRates').mockImplementation(track('updateOfficialRates', sc.official));
    vi.spyOn(macroDataService, 'syncDailyEconomicIndexes').mockImplementation(track('syncDailyEconomicIndexes', undefined));
    vi.spyOn(macroDataService, 'computeCdiReturn12m').mockImplementation(track('computeCdiReturn12m', sc.cdi12m));
    vi.spyOn(macroDataService, 'updateCurrencies').mockImplementation(track('updateCurrencies', sc.currencies));
    vi.spyOn(macroDataService, 'updateTreasuryRates').mockImplementation(track('updateTreasuryRates', sc.treasury));
    vi.spyOn(externalMarketService, 'getGlobalIndices').mockImplementation(track('getGlobalIndices', sc.globalIndices));
    vi.spyOn(externalMarketService, 'getSpx12mReturn').mockImplementation(track('getSpx12mReturn', sc.spx12m));
    vi.spyOn(externalMarketService, 'getIbov12mReturn').mockImplementation(track('getIbov12mReturn', sc.ibov12m));
    const returned = await macroDataService.performMacroSync();
    return { calls, saved: h.saved, returnedIsSaved: returned && JSON.stringify(canon({ ...returned })) === JSON.stringify(canon(h.saved)), log: h.log };
};

describe('performMacroSync — caracterização', () => {
    const SEED = 0x6d61; // 'ma'
    const N = 400;

    it(`${N} cenários semeados (hash por cenário)`, async () => {
        const rand = mulberry32(SEED);
        const hashes = [];
        for (let i = 0; i < N; i++) {
            const sc = genSyncScenario(rand);
            h.saved = null;
            h.log = [];
            vi.restoreAllMocks();
            hashes.push(`${i}:${hash16(await runSync(sc))}`);
        }
        expect(hashes).toMatchSnapshot();
    });

    it('cenários legíveis: tudo falhou, tudo veio, parcial', async () => {
        const allFailed = {
            prior: { selic: 13.75 },
            configDoc: { key: 'MACRO_INDICATORS', selic: 13.75, ipca: 4.4, dollar: 5.2, btc: 90000, ibov: 125000, spx: 5800,
                ntnbLong: 6.9, cdiReturn12m: 11, ratesSources: { ntnb: 'Investidor10' } },
            official: { selic: 13.75, cdi: 13.65, ipca: null, isFallback: true, selicIsFallback: true, ipcaIsFallback: true, selicFrozen: false,
                sources: { selic: 'fallback', ipca: 'fallback' } },
            currencies: { usd: null, usdChange: 0, usdSource: null, btc: null, btcChange: 0, btcSource: null },
            globalIndices: null,
            cdi12m: null, spx12m: null, ibov12m: null,
            treasury: { ntnbLong: null, ntnbSource: null },
        };
        const allFresh = {
            prior: null,
            configDoc: null,
            official: { selic: 15, cdi: 14.9, ipca: 4.68, isFallback: false, selicIsFallback: false, ipcaIsFallback: false, selicFrozen: false,
                sources: { selic: 'BCB', ipca: 'BCB' } },
            currencies: { usd: 5.33, usdChange: 0.2, usdSource: 'Yahoo', btc: 95000, btcChange: -1, btcSource: 'Yahoo' },
            globalIndices: { ibov: { value: 130000, change: 0.5, source: 'Yahoo' }, spx: { value: 6000, change: 0.1, source: 'Yahoo' } },
            cdi12m: 14.1, spx12m: 18, ibov12m: 9,
            treasury: { ntnbLong: 7.1, ntnbSource: 'TesouroTransparente' },
        };
        const partial = {
            ...allFailed,
            official: { selic: 14.25, cdi: 14.15, ipca: 4.9, isFallback: false, selicIsFallback: false, ipcaIsFallback: false, selicFrozen: true,
                sources: { selic: 'frozen', ipca: 'IBGE' } },
            currencies: { usd: 5.4, usdChange: 0, usdSource: 'PTAX/BCB', btc: null, btcChange: 0, btcSource: null },
            globalIndices: { ibov: { value: 126000, change: 0.3 } },
            spx12m: NaN,
        };
        const out = {};
        for (const [name, sc] of Object.entries({ allFailed, allFresh, partial })) {
            vi.restoreAllMocks();
            h.saved = null;
            h.log = [];
            const r = await runSync(sc);
            out[name] = canon({ calls: r.calls, saved: r.saved, returnedIsSaved: r.returnedIsSaved });
        }
        expect(out).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// updateOfficialRates — grade exaustiva
// ---------------------------------------------------------------------------

const runOfficial = async ({ bcbSelic, bcbIpca, brSelic, brIpca, ibge, lastGood, brThrows }) => {
    const calls = [];
    vi.spyOn(macroDataService, '_fetchBcbSeries').mockImplementation(async (serie, label) => {
        calls.push(['bcb', serie, label]);
        return label === 'SELIC' ? bcbSelic : bcbIpca;
    });
    vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockImplementation(async () => {
        calls.push(['brasilapi']);
        if (brThrows) throw new Error('brasilapi caiu');
        return { selic: brSelic, ipca: brIpca };
    });
    vi.spyOn(macroDataService, 'fetchIpcaFromIbge').mockImplementation(async () => { calls.push(['ibge']); return ibge; });
    let result;
    try {
        result = await macroDataService.updateOfficialRates(lastGood);
    } catch (e) {
        result = { threw: e.message };
    }
    return { result, calls, escalations: h.escalations, log: h.log };
};

const officialGrid = () => {
    const out = [];
    for (const bcbSelic of [null, 13.75])
        for (const bcbIpca of [null, 4.5])
            for (const brSelic of [null, 13.75, 12.25])
                for (const brIpca of [null, 4.8])
                    for (const ibge of [null, 4.9])
                        for (const lastGood of [null, 0, 13.75, 11, undefined])
                            out.push({ bcbSelic, bcbIpca, brSelic, brIpca, ibge, lastGood });
    out.push({ bcbSelic: null, bcbIpca: null, brSelic: null, brIpca: null, ibge: null, lastGood: 13.75, brThrows: true });
    return out;
};

describe('updateOfficialRates — caracterização', () => {
    it('grade exaustiva (hash por cenário)', async () => {
        const hashes = [];
        for (const [i, sc] of officialGrid().entries()) {
            vi.restoreAllMocks();
            h.log = [];
            h.escalations = [];
            hashes.push(`${i}:${hash16(await runOfficial(sc))}`);
        }
        expect(hashes).toMatchSnapshot();
    });

    it('cenários legíveis', async () => {
        const named = {
            bcbOk: { bcbSelic: 13.75, bcbIpca: 4.5, brSelic: null, brIpca: null, ibge: null, lastGood: 13.75 },
            frozen: { bcbSelic: null, bcbIpca: 4.5, brSelic: 12.25, brIpca: null, ibge: null, lastGood: 13.75 },
            nothing: { bcbSelic: null, bcbIpca: null, brSelic: null, brIpca: null, ibge: null, lastGood: 11 },
            ibgeOnly: { bcbSelic: 13.75, bcbIpca: null, brSelic: null, brIpca: null, ibge: 4.9, lastGood: null },
        };
        const out = {};
        for (const [name, sc] of Object.entries(named)) {
            vi.restoreAllMocks();
            h.log = [];
            h.escalations = [];
            out[name] = canon(await runOfficial(sc));
        }
        expect(out).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// _parseNtnbFromCsv
// ---------------------------------------------------------------------------

const CSV_COLS = ['Tipo Titulo', 'Data Vencimento', 'Data Base', 'Taxa Compra Manha', 'Taxa Venda Manha', 'PU Compra Manha'];
const TIPOS = ['Tesouro IPCA+', 'Tesouro IPCA+ com Juros Semestrais', 'Tesouro Educa+', 'Tesouro Renda+ Aposentadoria Extra',
    'Tesouro Prefixado', 'Tesouro Selic', 'tesouro ipca+', '', ' Tesouro IPCA+ ', 'Tesouro Renda+ IPCA+', 'Tesouro Educa+ IPCA+'];
const VENCS = ['15/05/2029', '15/05/2035', '15/08/2040', '15/05/2045', '15/08/2050', '15/05/2055', '15/08/2060',
    '15/05/2037', '15/08/2065', '2035-05-15', '', '1/5/2045'];
const BASES = ['17/11/2026', '18/11/2026', '16/11/2026', 'x', '', '31/12/1969', '18/11/2026 '];
const RATES = ['6,12', '7,5', '12,40', '1,5', '9,5', '2,0', 'abc', '', '1.006,5', '9,51', '6.12', '8,05'];

const shuffle = (rand, arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const genCsv = (rand) => {
    if (maybe(rand, 0.04)) return pick(rand, [null, undefined, 42, '', 'Tipo Titulo;Data Base', { csv: true }]);
    let cols = shuffle(rand, CSV_COLS);
    if (maybe(rand, 0.25)) cols = cols.filter((c) => c !== pick(rand, CSV_COLS));
    if (maybe(rand, 0.1)) cols = cols.filter((c) => !c.startsWith('Taxa'));
    const header = cols.map((c) => (maybe(rand, 0.2) ? ` ${c.toUpperCase()} ` : c)).join(';');
    const value = { 'Tipo Titulo': () => pick(rand, TIPOS), 'Data Vencimento': () => pick(rand, VENCS),
        'Data Base': () => pick(rand, BASES), 'Taxa Compra Manha': () => pick(rand, RATES),
        'Taxa Venda Manha': () => pick(rand, RATES), 'PU Compra Manha': () => '3.012,45' };
    const lines = [header];
    const n = Math.floor(rand() * 14);
    for (let r = 0; r < n; r++) {
        if (maybe(rand, 0.08)) { lines.push(''); continue; }
        let cells = cols.map((c) => value[c]());
        if (maybe(rand, 0.06)) cells = cells.slice(0, 2);
        lines.push(cells.join(';'));
    }
    return lines.join(maybe(rand, 0.3) ? '\r\n' : '\n');
};

describe('_parseNtnbFromCsv — caracterização', () => {
    const SEED = 0x6e74; // 'nt'
    const N = 500;

    it(`${N} CSVs semeados (hash por cenário)`, () => {
        const rand = mulberry32(SEED);
        const hashes = [];
        for (let i = 0; i < N; i++) {
            const csv = genCsv(rand);
            h.log = [];
            const rate = macroDataService._parseNtnbFromCsv(csv);
            hashes.push(`${i}:${hash16({ rate, log: h.log })}`);
        }
        expect(hashes).toMatchSnapshot();
    });

    it('cenários legíveis', () => {
        const head = 'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha';
        const csvs = {
            escada2035: [head, 'Tesouro IPCA+;15/05/2035;18/11/2026;6,90;7,02', 'Tesouro IPCA+;15/05/2045;18/11/2026;6,80;6,95'].join('\n'),
            baseMaisRecente: [head, 'Tesouro IPCA+;15/05/2035;17/11/2026;6,90;7,02', 'Tesouro IPCA+;15/05/2045;18/11/2026;6,80;6,95'].join('\n'),
            foraDaEscada: [head, 'Tesouro IPCA+;15/05/2037;18/11/2026;6,90;7,12', 'Tesouro IPCA+;15/05/2065;18/11/2026;6,80;6,91'].join('\n'),
            implausivel: [head, 'Tesouro IPCA+;15/05/2035;18/11/2026;12,0;12,40'].join('\n'),
            soCompra: ['Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha', 'Tesouro IPCA+;15/05/2040;18/11/2026;6,44'].join('\n'),
            educaRenda: [head, 'Tesouro Educa+;15/05/2040;18/11/2026;6,90;7,02', 'Tesouro Renda+;15/05/2045;18/11/2026;6,80;6,95'].join('\n'),
        };
        const out = {};
        for (const [name, csv] of Object.entries(csvs)) {
            h.log = [];
            out[name] = canon({ rate: macroDataService._parseNtnbFromCsv(csv), log: h.log });
        }
        expect(out).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// _persistUsdHistory
// ---------------------------------------------------------------------------

const USD_DATES = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-1-1', undefined, 20261110, '2026-11-10T00:00'];
const USD_CLOSES = [5.1, '5.2', 0, -1, NaN, undefined, null, 'abc', Infinity, 5.33];
const USD_ADJ = [undefined, null, 5.0, 0, 'x', -2, '5.05'];

const genUsdEntry = (rand) => (maybe(rand, 0.05) ? pick(rand, [null, undefined]) : {
    date: pick(rand, USD_DATES), close: pick(rand, USD_CLOSES), adjClose: pick(rand, USD_ADJ),
});

const genUsdScenario = (rand) => {
    const entries = maybe(rand, 0.05) ? pick(rand, [null, undefined, []]) : Array.from({ length: Math.floor(rand() * 9) }, () => genUsdEntry(rand));
    const existing = pick(rand, [
        null, { history: [] }, { history: null },
        { history: Array.from({ length: Math.floor(rand() * 6) }, () => ({
            date: pick(rand, ['2025-01-02', '2026-11-10', '2026-11-12', '2026-11-20', undefined, '']),
            close: pick(rand, [4.9, 5.0, 5.6]),
            adjClose: 4.9,
        })) },
    ]);
    return { entries, existing, source: pick(rand, ['Yahoo', 'PTAX/BCB']), findError: maybe(rand, 0.04) ? 'mongo fora' : null };
};

const runUsd = async ({ entries, existing, source, findError }) => {
    h.usdExisting = existing;
    h.usdFindError = findError;
    h.usdWrites = [];
    h.log = [];
    let result;
    try {
        result = await macroDataService._persistUsdHistory(structuredClone(entries), source);
    } catch (e) {
        result = { threw: e.message };
    }
    return { result, writes: h.usdWrites, log: h.log };
};

describe('_persistUsdHistory — caracterização', () => {
    const SEED = 0x7573; // 'us'
    const N = 400;

    it(`${N} cenários semeados (hash por cenário)`, async () => {
        const rand = mulberry32(SEED);
        const hashes = [];
        for (let i = 0; i < N; i++) hashes.push(`${i}:${hash16(await runUsd(genUsdScenario(rand)))}`);
        expect(hashes).toMatchSnapshot();
    });

    it('cenários legíveis', async () => {
        const out = {
            uniao: canon(await runUsd({
                entries: [{ date: '2026-11-12', close: 5.4 }, { date: '2026-11-13', close: '5.5', adjClose: 0 }, { date: 'x', close: 5 }],
                existing: { history: [{ date: '2026-11-11', close: 5.3, adjClose: 5.3 }, { date: '2026-11-12', close: 9, adjClose: 9 }] },
                source: 'Yahoo',
                findError: null,
            })),
            nadaValido: canon(await runUsd({ entries: [{ date: '2026-11-12', close: 0 }], existing: null, source: 'PTAX/BCB', findError: null })),
        };
        expect(out).toMatchSnapshot();
    });
});
