// Caracterização de `collectFacts` (não exportada) pelo export público que a chama,
// `runDataHealthCheck`. Os modelos Mongoose são falsos e respondem a partir de um
// cenário semeado; o `buildHealthReport` real é embrulhado para capturar os FATOS
// e os overrides que a coleta montou. Congela fatos, consultas emitidas e logs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mulberry32, canon, hash16 } from './helpers/characterization.js';

const h = vi.hoisted(() => ({ scenario: null, calls: [], captured: [], logs: [] }));

const record = (model, method, args) => {
    h.calls.push(`${model}.${method} ${JSON.stringify(args)}`);
};

// Query encadeável: select/sort/limit devolvem a própria query; lean() resolve.
const query = (value) => {
    const q = {
        select: () => q, sort: () => q, limit: () => q,
        lean: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)),
    };
    return q;
};
const settle = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));

vi.mock('mongoose', () => ({ default: { connection: { get readyState() { return h.scenario?.readyState ?? 1; } } } }));
vi.mock('../config/logger.js', () => {
    const log = (level) => (msg, meta) => h.logs.push({ level, msg, meta });
    return { default: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') } };
});
vi.mock('../services/emailService.js', () => ({
    verifyEmailTransport: async () => h.scenario.email,
}));
vi.mock('../models/MarketAsset.js', () => ({
    default: {
        find: (filter) => {
            record('MarketAsset', 'find', filter);
            if (filter.type) return query(h.scenario.brTickers);
            if (filter.$or) return query(h.scenario.implausibleRows);
            if (filter.updatedAt) return query(h.scenario.frozenAssets);
            return query(h.scenario.universe);
        },
        countDocuments: (filter) => {
            record('MarketAsset', 'countDocuments', filter);
            if (filter.isBlacklisted) return settle(h.scenario.retiredButActive);
            if (filter.failCount) return settle(h.scenario.totalInactive);
            return settle(h.scenario.totalAll);
        },
        aggregate: (pipeline) => {
            record('MarketAsset', 'aggregate', pipeline);
            return settle(pipeline[1].$group._id === '$type' ? h.scenario.assetRows : h.scenario.priceDelivery);
        },
    },
}));
vi.mock('../models/SystemConfig.js', () => ({
    default: {
        findOne: (filter) => {
            record('SystemConfig', 'findOne', filter);
            return query(filter.key === 'MACRO_INDICATORS' ? h.scenario.macro : h.scenario.thresholdDoc);
        },
    },
}));
vi.mock('../models/AssetHistory.js', () => ({
    default: { aggregate: (p) => { record('AssetHistory', 'aggregate', p); return settle(h.scenario.seriesRows); } },
}));
vi.mock('../models/TreasuryPriceHistory.js', () => ({
    default: { aggregate: (p) => { record('TreasuryPriceHistory', 'aggregate', p); return settle(h.scenario.treasuryRows); } },
}));
vi.mock('../models/TreasuryBond.js', () => ({
    default: { find: (f) => { record('TreasuryBond', 'find', f); return query(h.scenario.catalog); } },
}));
vi.mock('../models/UserAsset.js', () => ({
    default: { find: (f) => { record('UserAsset', 'find', f); return query(h.scenario.holdings); } },
}));
vi.mock('../models/DividendEvent.js', () => ({
    default: {
        countDocuments: (f) => {
            record('DividendEvent', 'countDocuments', f);
            return settle(h.scenario.divBase + (JSON.stringify(f).length % 97));
        },
    },
}));
vi.mock('../models/DataHealthReport.js', () => ({
    default: { create: async (doc) => { h.calls.push(`DataHealthReport.create ${doc.trigger} ${doc.status}`); } },
}));
vi.mock('../models/ErrorLog.js', () => ({
    default: {
        aggregate: (p) => {
            record('ErrorLog', 'aggregate', p);
            return settle(p[0].$match.source ? h.scenario.walletPayloadRows : h.scenario.errors24h);
        },
    },
}));
vi.mock('../models/JobRun.js', () => ({
    default: {
        aggregate: (p) => { record('JobRun', 'aggregate', p); return settle(h.scenario.jobRows); },
        findOne: () => { record('JobRun', 'findOne', {}); return query(h.scenario.oldestRun); },
    },
}));
vi.mock('../utils/dataHealthRules.js', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        buildHealthReport: (facts, overrides) => {
            h.captured.push({ facts, overrides });
            return real.buildHealthReport(facts, overrides);
        },
    };
});

const { runDataHealthCheck } = await import('../services/dataHealthService.js');
const { COVERAGE_SPEC, PLAUSIBILITY_RANGES } = await import('../utils/dataHealthRules.js');
const { JOB_CATALOG } = await import('../config/jobCatalog.js');

const NOW = new Date('2026-11-23T14:30:00.000Z');

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const maybe = (rnd, p, fn) => (rnd() < p ? fn() : undefined);
const times = (rnd, max, fn) => Array.from({ length: Math.floor(rnd() * (max + 1)) }, (_, i) => fn(i));

const NUMS = [0, 1, 2, 3, 5, 7, 12, 48, '3', '0', 'abc', null, undefined, -2, 0.5];
const TICKERS = ['PETR4', 'VALE3', 'HGLG11', 'BTC', 'AAPL', 'MXRF11', 'WEST3', 'ITUB4'];
const DAYS = ['2026-11-20', '2026-11-21', '2026-11-13', '2026-10-01', '2026-11-23', null, undefined, '2026-11-14'];
const CLASSES = [...Object.keys(COVERAGE_SPEC), 'CASH', 'FIXED_INCOME', null];
const OVERRIDE_KEYS = [
    'priceStaleAfterHours', 'fundamentalsDateStaleAfterDays', 'timeSeriesWalletDaysStale',
    'timeSeriesWalletDaysStaleCrypto', 'timeSeriesUniverseDaysStale', 'frozenPriceAfterDays',
];
const MACRO_KEYS = [
    'selic', 'ipca', 'cdi', 'ibov', 'dollar', 'btc', 'lastUpdated', 'ratesSources', 'ratesUpdatedAt', 'ratesStale',
    'currenciesUpdatedAt', 'currenciesStale', 'currenciesSources', 'indicesUpdatedAt', 'indicesStale', 'indicesSources',
];
const MACRO_VALUES = [0, 14.25, '', null, 'BCB', 1, true, false, new Date('2026-11-23T10:00:00Z'), { selic: 'BCB' }];

const genThresholdDoc = (rnd) => {
    const r = rnd();
    if (r < 0.15) return null;
    if (r < 0.25) return { value: null };
    const value = {};
    for (const k of OVERRIDE_KEYS) if (rnd() < 0.5) value[k] = pick(rnd, NUMS);
    if (rnd() < 0.3) value.extra = 'x';
    return { value };
};

const genMacro = (rnd) => {
    if (rnd() < 0.2) return null;
    const m = {};
    for (const k of MACRO_KEYS) if (rnd() < 0.6) m[k] = pick(rnd, MACRO_VALUES);
    if (rnd() < 0.7) {
        m.lastSyncStats = maybe(rnd, 0.85, () => ({
            fundamentalsHealthy: pick(rnd, [true, false, 'true', 1, undefined]),
            timestamp: pick(rnd, [new Date('2026-11-22T00:00:00Z'), null, undefined, 0]),
            errorCode: pick(rnd, ['E_LAYOUT', '', null, undefined]),
        }));
    }
    return m;
};

const genAssetRow = (rnd) => {
    const row = { _id: pick(rnd, CLASSES), active: Math.floor(rnd() * 50) };
    for (const k of ['stalePrice', 'nonPositivePrice', 'staleFundamentals']) {
        if (rnd() < 0.7) row[k] = Math.floor(rnd() * 5);
    }
    for (const spec of Object.values(COVERAGE_SPEC)) {
        for (const { field } of spec) if (rnd() < 0.5) row[`missing__${field}`] = Math.floor(rnd() * 4);
    }
    for (const field of Object.keys(PLAUSIBILITY_RANGES)) if (rnd() < 0.5) row[`imp__${field}`] = Math.floor(rnd() * 3);
    return row;
};

const genImplausibleRow = (rnd) => {
    const row = { ticker: pick(rnd, TICKERS), lastPrice: pick(rnd, [0, -1, 10, null, undefined, '5', 'x']) };
    for (const [field, { min, max }] of Object.entries(PLAUSIBILITY_RANGES)) {
        row[field] = pick(rnd, [min - 1.2345, max + 3.14159, (min + max) / 2, null, undefined, min, max]);
    }
    return row;
};

const genJobRows = (rnd) => Object.keys(JOB_CATALOG)
    .filter(() => rnd() < 0.6)
    .map((id) => ({
        _id: id,
        lastRunAt: maybe(rnd, 0.9, () => new Date(NOW.getTime() - Math.floor(rnd() * 72) * 3600000)),
        lastStatus: pick(rnd, ['SUCCESS', 'FAILED', 'RUNNING', 'SKIPPED', null]),
        lastError: pick(rnd, [null, 'boom', undefined]),
    }));

const genScenario = (seed) => {
    const rnd = mulberry32(seed);
    return {
        readyState: 1,
        email: pick(rnd, [{ ok: true, host: 'smtp' }, { ok: false, error: 'x', host: 'smtp' }]),
        thresholdDoc: genThresholdDoc(rnd),
        macro: genMacro(rnd),
        brTickers: times(rnd, 4, () => ({ ticker: pick(rnd, TICKERS) })),
        implausibleRows: times(rnd, 5, () => genImplausibleRow(rnd)),
        frozenAssets: times(rnd, 14, (i) => ({ ticker: `${pick(rnd, TICKERS)}${i}`, updatedAt: new Date('2026-10-01T00:00:00Z') })),
        universe: times(rnd, 5, () => ({ ticker: pick(rnd, TICKERS), type: pick(rnd, ['STOCK', 'FII', 'CRYPTO', 'STOCK_US']) })),
        holdings: times(rnd, 5, () => ({ ticker: pick(rnd, TICKERS), type: pick(rnd, ['STOCK', 'FII', 'CRYPTO', 'STOCK_US']) })),
        seriesRows: times(rnd, 8, () => ({ ticker: pick(rnd, TICKERS), lastCandle: pick(rnd, DAYS) })),
        totalAll: Math.floor(rnd() * 1000),
        totalInactive: Math.floor(rnd() * 50),
        retiredButActive: Math.floor(rnd() * 3),
        assetRows: times(rnd, 6, () => genAssetRow(rnd)),
        priceDelivery: pick(rnd, [null, [], [
            { _id: 'yahoo', at: new Date('2026-11-23T14:00:00Z'), assets: 900 },
            { _id: 'brapi' },
        ]]),
        treasuryRows: pick(rnd, [[], [{}], [{ latest: pick(rnd, DAYS), titles: pick(rnd, [0, 12, undefined]) }]]),
        catalog: times(rnd, 4, () => ({
            title: pick(rnd, ['Tesouro IPCA+ 2035', 'Tesouro IPCA+ 2035Juros Semestrais', 'Tesouro Selic 2029']),
            type: pick(rnd, ['IPCA', 'SELIC', 'PREFIXADO']),
            rate: pick(rnd, [6, 14, 0.1]),
            index: pick(rnd, ['IPCA', 'SELIC', undefined]),
            unitPrice: pick(rnd, [10.93, 0, 3000]),
            minInvestment: pick(rnd, [30, 1]),
            updatedAt: pick(rnd, [new Date('2026-11-22T00:00:00Z'), new Date('2026-05-01T00:00:00Z'), undefined]),
        })),
        errors24h: pick(rnd, [[], [{ total: 7 }], [{}]]),
        walletPayloadRows: times(rnd, 5, () => ({ _id: pick(rnd, ['snapshots', 'treasuryPricing', null]), total: pick(rnd, [1, 4, 0, undefined]) })),
        jobRows: genJobRows(rnd),
        oldestRun: pick(rnd, [null, { startedAt: new Date('2026-09-01T00:00:00Z') }, {}]),
        divBase: Math.floor(rnd() * 100),
    };
};

const runScenario = async (scenario, opts) => {
    h.scenario = scenario;
    h.calls = [];
    h.captured = [];
    h.logs = [];
    const result = await runDataHealthCheck(opts);
    return {
        result,
        captured: h.captured,
        calls: [...h.calls].sort(),
        logs: h.logs,
    };
};

describe('dataHealthService.collectFacts — caracterização via runDataHealthCheck', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('hash por cenário (120 cenários semeados)', async () => {
        const hashes = {};
        for (let seed = 1; seed <= 120; seed += 1) {
            hashes[seed] = hash16(await runScenario(genScenario(seed), { trigger: 'MANUAL', persist: seed % 3 !== 0 }));
        }
        expect(hashes).toMatchSnapshot();
    });

    it('fatos completos legíveis', async () => {
        const out = [];
        for (const seed of [2, 5, 9]) {
            const { captured } = await runScenario(genScenario(seed), { persist: false });
            out.push(canon(captured));
        }
        expect(out).toMatchSnapshot();
    });

    it('sem conexão, falha transitória e falha comum', async () => {
        const base = genScenario(77);
        const out = [
            await runScenario({ ...base, readyState: 0 }),
            await runScenario({ ...base, thresholdDoc: Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' }) }),
            await runScenario({ ...base, holdings: new Error('schema quebrado') }),
        ];
        expect(canon(out)).toMatchSnapshot();
    });
});
