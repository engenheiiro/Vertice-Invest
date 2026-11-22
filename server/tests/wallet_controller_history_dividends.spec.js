/**
 * Rede de segurança do walletController — rentabilidade, histórico e proventos.
 *
 * Trava o JSON de GET /wallet/performance (ponto live, CDI, IPCA+6%, Ibov),
 * GET /wallet/history (paginação) e GET /wallet/dividends (meta mensal e
 * self-heal) antes da divisão do controller em módulos.
 *
 * Sem banco: models e serviços com I/O mockados (o `.env` local aponta para
 * produção). As utils puras rodam de verdade.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
    call, NOW, petr4, freshReadState, wireReadPathMocks,
} from './helpers/walletControllerHarness.js';

vi.mock('mongoose', () => ({
    default: {
        startSession: vi.fn(),
        connect: vi.fn(() => { throw new Error('conexão real proibida em teste'); }),
    },
}));
vi.mock('../services/holidayService.js', () => ({
    holidayService: { sync: vi.fn(async () => true), isHoliday: (d) => ['2026-11-20', '2026-12-25'].includes(d) },
}));
vi.mock('../services/errorLogService.js', () => ({ recordError: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/AssetTransaction.js', () => ({ default: { find: vi.fn(), distinct: vi.fn() } }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/TreasuryBond.js', () => ({ default: {} }));
vi.mock('../services/treasuryPriceService.js', () => {
    const empty = { catalog: [], series: new Map(), historyFor: () => null, resolve: () => ({ key: null, reason: 'NOT_TREASURY' }) };
    return { loadTreasuryPricing: vi.fn(async () => empty), EMPTY_TREASURY_PRICING: empty };
});
vi.mock('../models/WalletSnapshot.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: async () => [] })) } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../services/marketDataService.js', () => ({
    marketDataService: {
        refreshQuotesBatch: vi.fn(),
        getMarketDataMap: vi.fn(),
        getBenchmarkHistory: vi.fn(),
        refreshFundamentals: vi.fn(),
    },
}));
vi.mock('../services/financialService.js', () => ({
    financialService: {
        recalculatePosition: vi.fn(),
        rebuildUserHistory: vi.fn(),
        accrueDividendsByTicker: vi.fn(),
        calculateUserDividends: vi.fn(),
        syncDividends: vi.fn(),
        _loadUsdRateResolver: vi.fn(),
    },
}));
vi.mock('../services/schedulerService.js', () => ({ runDailySnapshot: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Wallet = (await import('../models/Wallet.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const WalletSnapshot = (await import('../models/WalletSnapshot.js')).default;
const AssetHistory = (await import('../models/AssetHistory.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { marketDataService } = await import('../services/marketDataService.js');
const { financialService } = await import('../services/financialService.js');
const logger = (await import('../config/logger.js')).default;
const {
    getWalletPerformance, getWalletHistory, getWalletDividends,
} = await import('../controllers/walletController.js');

const state = freshReadState();

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, freshReadState());
    wireReadPathMocks({
        Wallet, UserAsset, AssetTransaction, WalletSnapshot, AssetHistory, SystemConfig, marketDataService, financialService,
    }, state);
});

describe('GET /wallet/performance', () => {
    const history = () => [
        { date: new Date('2026-11-20T02:59:00.000Z'), dayKey: '2026-11-19', totalEquity: 10000, totalInvested: 10000, totalDividends: 0, quotaPrice: 100 },
        { date: new Date('2026-11-24T02:59:00.000Z'), dayKey: '2026-11-23', totalEquity: 10200, totalInvested: 10000, totalDividends: 0, quotaPrice: 102 },
    ];

    it('sem snapshot devolve lista vazia', async () => {
        const { res } = await call(getWalletPerformance);
        expect(res.body).toEqual([]);
    });

    it('anexa o ponto live de hoje e compara com CDI, IPCA+6% e Ibovespa', async () => {
        state.riskSnapshots = history();
        state.assets = [{ ...petr4(), quantity: 300, totalCost: 10000 }];
        state.quotes = new Map([['PETR4', { price: 34.68, change: 0, priceDate: '2026-11-24' }]]);
        state.ibov = [{ date: '2026-11-19', close: 100000 }, { date: '2026-11-23', close: 102000 }];

        const { res, next } = await call(getWalletPerformance);

        expect(next).not.toHaveBeenCalled();
        const { history: series, stats } = res.body;
        expect(series).toHaveLength(3);
        expect(series.map((p) => p.date)).toEqual(['2026-11-19', '2026-11-23', '2026-11-24']);
        expect(series[0]).toMatchObject({ wallet: 0, cdi: 0, ipca: 0, ibov: 0, equity: 10000, invested: 10000 });
        expect(series[1].wallet).toBeCloseTo(2, 6);
        expect(series[1].ibov).toBeCloseTo(2, 6);
        // Live: cota 102 × 10.404/10.200 = 104,04; Ibov live pelo macro (103.000).
        expect(series[2].wallet).toBeCloseTo(4.04, 2);
        expect(series[2].equity).toBe(10404);
        expect(series[2].ibov).toBeCloseTo(3, 6);
        expect(series[2].walletRoi).toBeCloseTo(4.04, 2);
        // Benchmarks acumulam por dia útil e só sobem.
        expect(series[1].cdi).toBeGreaterThan(0);
        expect(series[2].cdi).toBeGreaterThan(series[1].cdi);
        expect(series[2].ipca).toBeGreaterThan(series[1].ipca);
        expect(series[2].cdiValue).toBeGreaterThan(10000);
        expect(stats).toHaveProperty('sharpe');
        expect(stats).toHaveProperty('beta');
        expect(stats.sharpe).toBeNull();
    });

    it('sem posição aberta não inventa ponto live', async () => {
        state.riskSnapshots = history();

        const { res } = await call(getWalletPerformance);

        expect(res.body.history).toHaveLength(2);
    });

    it('Ibovespa sem cotação no início usa o primeiro fechamento posterior', async () => {
        state.riskSnapshots = history();
        state.ibov = [{ date: '2026-11-23', close: 102000 }];

        const { res } = await call(getWalletPerformance);

        expect(res.body.history[0].ibov).toBe(0);
        expect(res.body.history[1].ibov).toBe(0);
    });

    it('erro na leitura vai para o error handler', async () => {
        SystemConfig.findOne.mockRejectedValue(new Error('macro fora'));
        const { next } = await call(getWalletPerformance);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'macro fora' }));
    });
});

describe('GET /wallet/history', () => {
    const snaps = [
        { date: new Date('2026-11-18T02:59:00.000Z'), totalEquity: 1 },
        { date: new Date('2026-11-19T02:59:00.000Z'), totalEquity: 2 },
        { date: new Date('2026-11-20T02:59:00.000Z'), totalEquity: 3 },
    ];

    it('sem paginação devolve a série inteira em ordem cronológica', async () => {
        state.snapshots = snaps;

        const { res } = await call(getWalletHistory);

        expect(res.body.map((s) => s.totalEquity)).toEqual([1, 2, 3]);
        expect(WalletSnapshot.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    });

    it('com limit busca a página mais recente e devolve em ordem cronológica', async () => {
        state.snapshots = [snaps[2], snaps[1]];

        const { res } = await call(getWalletHistory, { query: { limit: '2', before: '2026-11-21' } });

        expect(res.body.map((s) => s.totalEquity)).toEqual([2, 3]);
        expect(WalletSnapshot.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', date: { $lt: new Date('2026-11-21') } });
    });

    it('before inválido é ignorado', async () => {
        state.snapshots = snaps;
        await call(getWalletHistory, { query: { before: 'ontem' } });
        expect(WalletSnapshot.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    });

    it('erro vai para o error handler', async () => {
        WalletSnapshot.find.mockImplementation(() => { throw new Error('falhou'); });
        const { next } = await call(getWalletHistory);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('GET /wallet/dividends', () => {
    const paying = () => ({
        dividendMap: new Map([
            ['2026-10', { total: 50, breakdown: [{ ticker: 'PETR4', amount: 50 }] }],
            ['2026-09', { total: 40, breakdown: [] }],
        ]),
        provisioned: [{ ticker: 'PETR4', amount: 20 }, { ticker: 'MXRF11', amount: 5 }],
        totalAllTime: 90,
        projectedMonthly: 30,
        yieldOnCost: 4.2,
    });

    it('histórico mensal ordenado, accrual quebrado em pago/a pagar e meta MENSAL pelas provisões', async () => {
        state.dividends = paying();
        state.walletPrefs = { targetMonthlyDividendIncome: 100 };
        state.accrued = { total: 95, paid: 90, pending: 5 };

        const { res } = await call(getWalletDividends, { user: { id: 'u-div-1' } });

        expect(res.body.history).toEqual([
            { month: '2026-09', value: 40, breakdown: [] },
            { month: '2026-10', value: 50, breakdown: [{ ticker: 'PETR4', amount: 50 }] },
        ]);
        expect(res.body.accrued).toEqual({ total: 95, paid: 90, pending: 5 });
        expect(res.body).toMatchObject({ totalAllTime: 90, projectedMonthly: 30, yieldOnCost: 4.2 });
        expect(res.body.goal).toEqual({ target: 100, current: 25, progressPercent: 25 });
        expect(marketDataService.refreshFundamentals).not.toHaveBeenCalled();
    });

    it('sem provisão a meta usa o fluxo projetado; a barra não passa de 100%', async () => {
        state.dividends = { ...paying(), provisioned: [], projectedMonthly: 250 };
        state.walletPrefs = { targetMonthlyDividendIncome: 100 };

        const { res } = await call(getWalletDividends, { user: { id: 'u-div-2' } });

        expect(res.body.goal).toEqual({ target: 100, current: 250, progressPercent: 100 });
    });

    it('sem meta definida o progresso é nulo, não zero', async () => {
        state.dividends = paying();

        const { res } = await call(getWalletDividends, { user: { id: 'u-div-3' } });

        expect(res.body.goal.target).toBe(0);
        expect(res.body.goal.progressPercent).toBeNull();
    });

    it('tudo zerado dispara o self-heal só para os pagadores, uma vez por hora', async () => {
        state.assets = [
            { ticker: 'PETR4', type: 'STOCK', quantity: 10 },
            { ticker: 'BTC', type: 'CRYPTO', quantity: 1 },
            { ticker: 'RESERVA', type: 'CASH', quantity: 100 },
        ];

        const { res } = await call(getWalletDividends, { user: { id: 'u-div-heal' } });

        expect(res.body.goal.current).toBe(0);
        await vi.waitFor(() => expect(financialService.syncDividends).toHaveBeenCalled());
        expect(marketDataService.refreshFundamentals).toHaveBeenCalledWith(['PETR4']);
        expect(financialService.syncDividends).toHaveBeenCalledWith([{ ticker: 'PETR4', type: 'STOCK' }]);

        financialService.syncDividends.mockClear();
        await call(getWalletDividends, { user: { id: 'u-div-heal' } });
        await Promise.resolve();
        expect(financialService.syncDividends).not.toHaveBeenCalled();
    });

    it('self-heal que falha é logado sem afetar a resposta', async () => {
        state.assets = [{ ticker: 'PETR4', type: 'STOCK', quantity: 10 }];
        marketDataService.refreshFundamentals.mockRejectedValue(new Error('fundamentus fora'));

        const { res } = await call(getWalletDividends, { user: { id: 'u-div-fail' } });

        expect(res.json).toHaveBeenCalled();
        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Self-heal falhou')));
    });

    it('carteira só com renda fixa não dispara sincronização', async () => {
        state.assets = [{ ticker: 'RESERVA', type: 'CASH', quantity: 100 }];

        await call(getWalletDividends, { user: { id: 'u-div-cash' } });
        await vi.waitFor(() => expect(UserAsset.find).toHaveBeenCalled());
        await Promise.resolve();

        expect(marketDataService.refreshFundamentals).not.toHaveBeenCalled();
    });

    it('erro no cálculo vai para o error handler', async () => {
        state.dividendsError = new Error('cálculo falhou');
        const { res, next } = await call(getWalletDividends, { user: { id: 'u-div-err' } });
        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'cálculo falhou' }));
    });
});
