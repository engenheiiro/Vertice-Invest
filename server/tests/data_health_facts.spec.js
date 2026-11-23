import { describe, it, expect } from 'vitest';
import { resolveCollectionWindows, assembleHealthFacts } from '../utils/dataHealthFacts.js';
import { DEFAULT_THRESHOLDS } from '../utils/dataHealthRules.js';

const NOW = new Date('2026-11-23T14:30:00.000Z');

const collected = (over = {}) => ({
    totalAll: 10,
    totalInactive: 1,
    retiredButActive: 0,
    assetFacts: { activeTotal: 9, assets: {}, implausible: {} },
    macroConfig: null,
    treasuryRows: [],
    treasuryCatalogRows: [],
    candleFacts: {},
    jobs: [],
    email: { ok: true },
    errors24h: [],
    walletPayload: { degraded24h: 0, sources: [] },
    oldestRun: null,
    frozenAssets: [],
    dividendPayment: null,
    priceDelivery: null,
    ...over,
});

describe('resolveCollectionWindows', () => {
    it('override zero, texto ou ausente cai no padrão; número vale', () => {
        const w = resolveCollectionWindows({ priceStaleAfterHours: '0', frozenPriceAfterDays: 2 }, NOW);
        expect(w.staleCutoff.getTime()).toBe(NOW.getTime() - DEFAULT_THRESHOLDS.priceStaleAfterHours * 3600000);
        expect(w.frozenCutoff.getTime()).toBe(NOW.getTime() - 2 * 86400000);
        expect(w.since24h.getTime()).toBe(NOW.getTime() - 24 * 3600000);
        expect(resolveCollectionWindows(null, NOW).candleTolerances.timeSeriesUniverseDaysStale)
            .toBe(DEFAULT_THRESHOLDS.timeSeriesUniverseDaysStale);
    });
});

describe('assembleHealthFacts', () => {
    it('sem macro, sem Tesouro e sem marco de instrumentação: vazios honestos', () => {
        const f = assembleHealthFacts(NOW, collected());
        expect(f.macro).toEqual({});
        expect(f.treasury).toEqual({ titles: 0, latestDate: null, businessDaysStale: null });
        expect(f.fundamentals).toEqual({ healthy: false, timestamp: null, errorCode: null });
        expect(f.instrumentationSince).toBe(NOW);
        expect(f.priceDelivery).toEqual({});
        expect(f.errors.last24h).toBe(0);
    });

    it('macro: falso vira null nos carimbos e booleano nos flags; frozen corta em 10', () => {
        const f = assembleHealthFacts(NOW, collected({
            macroConfig: { selic: 0, lastUpdated: '', ratesStale: 'sim', lastSyncStats: { fundamentalsHealthy: true } },
            frozenAssets: Array.from({ length: 12 }, (_, i) => ({ ticker: `T${i}` })),
            priceDelivery: [{ _id: 'yahoo' }],
        }));
        expect(f.macro.selic).toBe(0);
        expect(f.macro.updatedAt).toBeNull();
        expect(f.macro.ratesStale).toBe(true);
        expect(f.macro.indicesStale).toBe(false);
        expect(f.fundamentals.healthy).toBe(true);
        expect(f.frozen).toEqual({ count: 12, tickers: Array.from({ length: 10 }, (_, i) => `T${i}`) });
        expect(f.priceDelivery).toEqual({ yahoo: { at: null, assets: 0 } });
    });
});
