/**
 * `syncBrEtfFundamentals`: um ETF com resposta quebrada (quoteSummary sem
 * corpo, histórico de proventos `undefined`) é pulado e contado como falha —
 * não derruba o lote nem impede a gravação dos outros.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ etfList: [], data: {}, hist: {}, writes: [] }));

vi.mock('yahoo-finance2', () => ({
    default: class {
        async quoteSummary(sym) { return h.data[sym]; }
    },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/MarketAsset.js', () => ({
    default: {
        find: () => ({ select: () => ({ lean: async () => [] }) }),
        bulkWrite: async (ops) => { h.writes.push(...ops); return {}; },
    },
}));
vi.mock('../config/brEtfList.js', () => ({
    get BR_ETF_LIST() { return h.etfList; },
}));
vi.mock('../services/externalMarketService.js', () => ({
    toYahooSymbol: (t) => t,
    externalMarketService: {
        fetchFromBrapi: async () => ({ price: 10, volume: 100 }),
        getDividendsHistory: async (ticker) => h.hist[ticker],
    },
}));

const { usStocksFundamentalsService } = await import('../services/usStocksFundamentalsService.js');

function setup(entries) {
    h.etfList = entries.map(([ticker]) => ({ ticker, name: ticker, sector: 'Ações' }));
    h.data = Object.fromEntries(entries.map(([ticker, data]) => [`${ticker}.SA`, data]));
    h.hist = Object.fromEntries(entries.map(([ticker, , hist]) => [ticker, hist]));
    h.writes = [];
}

const gravados = () => h.writes.map(op => op.updateOne.filter.ticker).sort();

describe('syncBrEtfFundamentals — ETF quebrado não derruba o lote', () => {
    it('quoteSummary resolvendo undefined pula só aquele ETF (derrubava o sync inteiro)', async () => {
        setup([['BOA11', { summaryDetail: { yield: 0.05 } }, []], ['VAZ11', undefined, []], ['OUT11', { summaryDetail: { yield: 0.02 } }, []]]);
        const result = await usStocksFundamentalsService.syncBrEtfFundamentals();
        expect(result).toEqual({ processed: 2, failed: 1, total: 3 });
        expect(gravados()).toEqual(['BOA11', 'OUT11']);
    });

    it('histórico de proventos undefined pula só aquele ETF (TypeError derrubava o lote)', async () => {
        setup([['BOA11', { summaryDetail: { yield: 0.05 } }, []], ['UND11', { summaryDetail: {} }, undefined]]);
        const result = await usStocksFundamentalsService.syncBrEtfFundamentals();
        expect(result).toEqual({ processed: 1, failed: 1, total: 2 });
        expect(gravados()).toEqual(['BOA11']);
    });
});
