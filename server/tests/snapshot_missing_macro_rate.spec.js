// Regra 13 no snapshot diário: sem a taxa de que a carteira precisa, o dia NÃO
// é gravado com câmbio ou IPCA inventado (antes: dólar 5,75 fixo e IPCA 0).
// Sem cotação na macro, o câmbio vem da série USD/BRL real quando ela existe.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  userAssetFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  snapshotFindOne: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  snapshotExists: vi.fn(),
  dividendFind: vi.fn(),
  assetHistoryAggregate: vi.fn(),
  getMarketDataMap: vi.fn(),
  upsertSnapshot: vi.fn(),
  isHoliday: vi.fn(() => false),
  walletFind: vi.fn(),
  saveCheckpoint: vi.fn(async () => {}),
  systemConfigUpdate: vi.fn(async () => {}),
}));

// ---- modelos ----
vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/SystemConfig.js', () => ({
  default: { findOne: mocks.systemConfigFindOne, findOneAndUpdate: mocks.systemConfigUpdate },
}));
vi.mock('../models/WalletSnapshot.js', () => ({
  default: {
    findOne: mocks.snapshotFindOne,
    deleteMany: mocks.snapshotDeleteMany,
    exists: mocks.snapshotExists,
  },
}));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: mocks.dividendFind } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: mocks.assetHistoryAggregate } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: () => [] })) } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: { find: mocks.walletFind } }));
vi.mock('../utils/jobCheckpoint.js', () => ({ loadCompletedCheckpoints: async () => new Set(), saveCheckpoint: mocks.saveCheckpoint }));
vi.mock('../utils/dayCloses.js', () => ({ loadClosesForDay: async () => new Map() }));
vi.mock('../services/walletDayCandleService.js', () => ({ ensureWalletDayCandles: async () => new Map() }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));

// ---- serviços vizinhos (não exercitados aqui) ----
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getMarketDataMap: mocks.getMarketDataMap },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistory: vi.fn(), getFullHistoryDetailed: vi.fn() },
}));
vi.mock('../services/aiResearchService.js', () => ({ aiResearchService: {} }));
vi.mock('../services/macroDataService.js', () => ({ macroDataService: {} }));
vi.mock('../services/syncService.js', () => ({ syncService: {} }));
vi.mock('../services/holidayService.js', () => ({ holidayService: { isHoliday: mocks.isHoliday, sync: vi.fn() } }));
vi.mock('../services/engines/signalEngine.js', () => ({ signalEngine: {} }));
vi.mock('../services/notificationService.js', () => ({ createBroadcast: vi.fn() }));
vi.mock('../services/researchPublicationService.js', () => ({
  activateResearchSections: vi.fn(), hasSectionContent: vi.fn(),
}));
vi.mock('../services/workers/timeSeriesWorker.js', () => ({ timeSeriesWorker: {} }));
vi.mock('../services/usStocksFundamentalsService.js', () => ({ usStocksFundamentalsService: {} }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Upsert real substituído por captura do payload — o teste compara números.
vi.mock('../utils/walletSnapshot.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, upsertWalletSnapshotForDay: mocks.upsertSnapshot };
});

const { financialService } = await import('../services/financialService.js');
const { loadSnapshotContext, persistUserSnapshotForDay, runDailySnapshotCore } = await import('../services/schedulerService.js');

const WALLET = { _id: 'w1', user: 'u1', name: 'Taxas' };
const DAY = '2026-07-08';
const BRL = { ticker: 'TEST3', type: 'STOCK', currency: 'BRL', quantity: 10, totalCost: 100, totalCostBrl: 100 };
const USD = { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', quantity: 2, totalCost: 400, totalCostBrl: 2000 };
const IPCA = {
    ticker: 'NTNB-35', type: 'FIXED_INCOME', currency: 'BRL', quantity: 1, totalCost: 1000,
    fixedIncomeIndex: 'IPCA', fixedIncomeSpread: 6, startDate: new Date('2026-01-02T12:00:00Z'),
};

const ctxCom = (over = {}) => ({
    priceMap: new Map([['TEST3', { price: 10 }], ['AAPL', { price: 200 }]]),
    closeMap: new Map(),
    macroRates: { cdiRate: 14, selic: 14.25, ipca: 4.4, cdiCurve: null },
    usdRate: 5.2,
    getUsdRateForDate: () => 5.2,
    ...over,
});

describe('snapshot diário — taxa ausente não vira número inventado', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.snapshotFindOne.mockReturnValue({ sort: async () => null });
        // Consulta encadeável (find().sort().select().lean()) que resolve vazio.
        const vazio = () => { const q = Object.assign(Promise.resolve([]), { sort: () => q, select: () => q, lean: async () => [] }); return q; };
        mocks.txFind.mockImplementation(vazio);
        mocks.dividendFind.mockImplementation(vazio);
        mocks.upsertSnapshot.mockImplementation(async (_m, _w, _d, payload) => ({ ...payload, _id: 'snap' }));
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('sem câmbio e com posição em dólar: não grava e devolve missing-rate', async () => {
        const r = await persistUserSnapshotForDay(WALLET, DAY, ctxCom({ usdRate: null }), { assets: [BRL, USD] });
        expect(r).toBe('missing-rate');
        expect(mocks.upsertSnapshot).not.toHaveBeenCalled();
    });

    it('sem IPCA e com renda fixa IPCA: não grava e devolve missing-rate', async () => {
        const ctx = ctxCom({ macroRates: { cdiRate: 14, selic: 14.25, ipca: null, cdiCurve: null } });
        expect(await persistUserSnapshotForDay(WALLET, DAY, ctx, { assets: [BRL, IPCA] })).toBe('missing-rate');
        expect(mocks.upsertSnapshot).not.toHaveBeenCalled();
    });

    it('carteira que não usa a taxa ausente segue gravando', async () => {
        const ctx = ctxCom({ usdRate: null, macroRates: { cdiRate: 14, selic: 14.25, ipca: null, cdiCurve: null } });
        expect(await persistUserSnapshotForDay(WALLET, DAY, ctx, { assets: [BRL] })).not.toBe('missing-rate');
    });

    describe('loadSnapshotContext — de onde vem o câmbio do dia', () => {
        beforeEach(() => {
            mocks.userAssetFind.mockImplementation(() => ({ select: () => ({ lean: async () => [] }) }));
            mocks.getMarketDataMap.mockResolvedValue(new Map());
            mocks.assetHistoryAggregate.mockResolvedValue([]);
        });

        it('com cotação na macro, usa a cotação', async () => {
            mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, ipca: 4.4, dollar: 5.1 });
            const resolver = vi.spyOn(financialService, '_loadUsdRateResolver')
                .mockResolvedValue(Object.assign(() => 5.3, { hasSeries: true }));
            expect((await loadSnapshotContext(DAY)).usdRate).toBe(5.1);
            expect(resolver).toHaveBeenCalledWith(5.1);
        });

        it('sem cotação na macro, usa a série USD/BRL do dia — não 5,75', async () => {
            mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, ipca: 4.4 });
            vi.spyOn(financialService, '_loadUsdRateResolver')
                .mockResolvedValue(Object.assign((day) => (day === DAY ? 5.37 : 0), { hasSeries: true }));
            expect((await loadSnapshotContext(DAY)).usdRate).toBe(5.37);
        });

        it('sem cotação e sem série, o câmbio fica ausente', async () => {
            mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, ipca: 4.4 });
            vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(Object.assign(() => 5.75, { hasSeries: false }));
            expect((await loadSnapshotContext(DAY)).usdRate).toBeNull();
        });
    });
});

describe('runDailySnapshotCore — carteira sem taxa vira falha re-tentável', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const vazio = () => { const q = Object.assign(Promise.resolve([]), { sort: () => q, select: () => q, lean: async () => [] }); return q; };
        mocks.txFind.mockImplementation(vazio);
        mocks.dividendFind.mockImplementation(vazio);
        mocks.snapshotFindOne.mockReturnValue({ sort: async () => null });
        mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
        mocks.upsertSnapshot.mockImplementation(async (_m, _w, _d, payload) => ({ ...payload, _id: 'snap' }));
        mocks.getMarketDataMap.mockResolvedValue(new Map([['TEST3', { price: 10 }], ['AAPL', { price: 200 }]]));
        mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, ipca: 4.4 });
        vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(Object.assign(() => 5.75, { hasSeries: false }));
        const carteiras = [{ _id: 'w-brl', user: 'u1', name: 'Real' }, { _id: 'w-usd', user: 'u1', name: 'Dólar' }];
        mocks.walletFind.mockReturnValue({ populate: () => ({ select: async () => carteiras }) });
        // Lista global (contexto) responde vazio; por carteira, as posições dela.
        mocks.userAssetFind.mockImplementation((q) => {
            const lista = q?.wallet === 'w-usd' ? [BRL, USD] : q?.wallet === 'w-brl' ? [BRL] : [];
            return Object.assign(Promise.resolve(lista), { select: () => ({ lean: async () => [] }) });
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('grava a carteira em real e marca a com dólar como FAILED, contando como alarme', async () => {
        await runDailySnapshotCore(true);
        const porCarteira = Object.fromEntries(mocks.saveCheckpoint.mock.calls.map(([, , id, info]) => [id, info]));
        expect(porCarteira['w-brl']).toMatchObject({ status: 'SUCCESS', result: 'created' });
        expect(porCarteira['w-usd']).toMatchObject({ status: 'FAILED', result: 'missing-rate', error: 'missing-rate' });
        const stats = mocks.systemConfigUpdate.mock.calls[0][1].$set.lastSnapshotStats;
        expect(stats).toMatchObject({ created: 1, errors: 1 });
    });
});
