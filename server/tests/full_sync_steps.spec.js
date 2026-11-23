import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Etapas do sync completo (services/sync/fullSyncSteps.js): guarda diária de 23h,
// cotações em lote sem duplicata e o seed de cripto que pula sigla de outra classe.

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  find: vi.fn(),
  refreshQuotesBatch: vi.fn(),
}));

vi.mock('../models/SystemConfig.js', () => ({
  default: { findOne: mocks.findOne, findOneAndUpdate: mocks.findOneAndUpdate },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: mocks.find } }));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { refreshQuotesBatch: mocks.refreshQuotesBatch },
}));
vi.mock('../services/fundamentalHistoryService.js', () => ({ appendSnapshots: vi.fn() }));
vi.mock('../services/sectorBackfillService.js', () => ({ backfillSectors: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { runDailyStep, refreshQuotesInBatches, prepareExternalAssets } = await import('../services/sync/fullSyncSteps.js');
const { CRYPTO_ASSETS } = await import('../config/cryptoList.js');

const NOW = new Date('2026-11-23T12:00:00.000Z');
const HOUR = 3600000;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { vi.clearAllMocks(); });

describe('runDailyStep — guarda de 23h', () => {
  const step = (run) => runDailyStep({ stampField: 'lastX', run, skipMessage: 'pula', stepLabel: 'Etapa X' });

  it('roda e regrava o carimbo quando passou de 23h', async () => {
    mocks.findOne.mockResolvedValue({ lastX: new Date(NOW.getTime() - 23 * HOUR - 1) });
    const run = vi.fn();
    await step(run);
    expect(run).toHaveBeenCalledOnce();
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'MACRO_INDICATORS' }, { $set: { lastX: NOW } }, { upsert: true },
    );
  });

  it('pula quando o carimbo tem exatamente 23h', async () => {
    mocks.findOne.mockResolvedValue({ lastX: new Date(NOW.getTime() - 23 * HOUR) });
    const run = vi.fn();
    await step(run);
    expect(run).not.toHaveBeenCalled();
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('falha da rotina não propaga nem regrava o carimbo', async () => {
    mocks.findOne.mockResolvedValue(null);
    await expect(step(async () => { throw new Error('caiu'); })).resolves.toBeUndefined();
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('refreshQuotesInBatches', () => {
  it('remove duplicatas e cota em lotes de 50', async () => {
    const tickers = Array.from({ length: 60 }, (_, i) => `T${i}`);
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { fn(); return 0; };
    try {
      await refreshQuotesInBatches([...tickers, 'T0', 'T59']);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(mocks.refreshQuotesBatch.mock.calls.map(([batch, flag]) => [batch.length, flag])).toEqual([[50, true], [10, true]]);
  });
});

describe('prepareExternalAssets', () => {
  it('não semeia nem cota moeda cuja sigla pertence a outra classe', async () => {
    const [taken, ...rest] = CRYPTO_ASSETS.map((c) => c.ticker);
    mocks.find.mockImplementation((filter) => {
      const rows = filter.ticker
        ? [{ ticker: taken, type: 'STOCK_US', name: 'Outro' }]
        : [{ ticker: 'AAPL', type: 'STOCK_US' }, { ticker: ' ', type: 'STOCK_US' }];
      return { select: () => Object.assign(rows, { lean: () => rows }) };
    });
    const operations = [];
    const tickers = await prepareExternalAssets(operations);
    expect(tickers).toEqual(['AAPL', ...rest]);
    expect(operations.map((op) => op.updateOne.filter.ticker)).toEqual(rest);
  });
});
