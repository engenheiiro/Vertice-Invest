/**
 * Rede de segurança do walletController — GET /wallet (KPIs e patrimônio).
 *
 * O controller vai ser dividido em módulos; estes testes travam o que o handler
 * DEVOLVE (status + JSON) para entradas realistas: carteira vazia, patrimônio
 * com e sem snapshot-âncora, câmbio congelado no custo (regra 8), auto-heal,
 * degradação graciosa e calculateLiveKPIS.
 *
 * Sem banco: todos os models e serviços com I/O são mockados — o `.env` local
 * aponta para produção, então nenhuma conexão real pode abrir aqui. As utils
 * puras (mathUtils, fixedIncome, walletRisk, dateUtils) rodam de verdade.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
    chain, call, NOW, oldLot, petr4, aapl, anchorSnapshot, quotesToday, freshReadState, wireReadPathMocks,
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
const { recordError } = await import('../services/errorLogService.js');
const logger = (await import('../config/logger.js')).default;
const { DAY_CHANGE_REASON } = await import('../utils/dayChangeReason.js');
const {
    getWalletData, calculateLiveKPIS,
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

describe('GET /wallet — carteira vazia', () => {
    it('sem posições nem lançamentos devolve KPIs zerados, risco nulo e metas padrão', async () => {
        state.config = { dollar: 5.2 };

        const { res, next } = await call(getWalletData);

        expect(next).not.toHaveBeenCalled();
        expect(res.body.assets).toEqual([]);
        expect(res.body.kpis).toMatchObject({
            totalEquity: 0, totalInvested: 0, totalResult: 0, totalDividends: 0,
            dayAnchorDate: null, dataQuality: 'AUDITED', sharpeRatio: null, beta: null, sharpeSample: 0,
        });
        expect(res.body.targetAllocation).toEqual({ STOCK: 40, FII: 30, STOCK_US: 20, ETF: 0, CRYPTO: 10, FIXED_INCOME: 0 });
        expect(res.body.targetReserve).toBe(10000);
        expect(res.body.targetMonthlyDividendIncome).toBe(0);
        expect(res.body.meta).toEqual({ usdRate: 5.2 });
    });

    // Regra 13: antes saía 5,75 fixo como se fosse cotação.
    it('sem macro gravado, o câmbio da carteira vazia é o último candle real da série, nunca 5,75', async () => {
        state.config = null;
        AssetHistory.findOne.mockReturnValueOnce({ lean: async () => ({ history: [{ date: '2026-11-19', close: 5.31 }] }) });
        expect((await call(getWalletData)).res.body.meta.usdRate).toBe(5.31);
        AssetHistory.findOne.mockReturnValueOnce({ lean: async () => null });
        expect((await call(getWalletData)).res.body.meta.usdRate).toBeNull();
    });

    it('devolve as metas salvas da carteira', async () => {
        state.walletPrefs = {
            targetAllocation: { STOCK: 50, FII: 50, STOCK_US: 0, ETF: 0, CRYPTO: 0, FIXED_INCOME: 0 },
            targetReserve: 0,
            targetMonthlyDividendIncome: 1500,
            targetSubAllocation: { STOCK: { STOCK: 100, ETF: 0 } },
        };
        const { res } = await call(getWalletData);
        expect(res.body.targetAllocation.STOCK).toBe(50);
        // 0 é meta legítima ("sem reserva"), não ausência.
        expect(res.body.targetReserve).toBe(0);
        expect(res.body.targetMonthlyDividendIncome).toBe(1500);
        expect(res.body.targetSubAllocation).toEqual({ STOCK: { STOCK: 100, ETF: 0 } });
    });
});

describe('GET /wallet — KPIs e patrimônio', () => {
    it('sem snapshot: soma patrimônio, custo com câmbio congelado e resultado com proventos (ESTIMATED)', async () => {
        state.assets = [petr4(), aapl()];
        state.quotes = quotesToday();
        state.accrued = { total: 120, byTicker: { PETR4: 120 }, sinceTotal: 0, sinceByTicker: {} };
        state.dividends = { totalAllTime: 100, projectedMonthly: 30, receivedByTicker: { PETR4: 100 } };

        const { res, next } = await call(getWalletData);

        expect(next).not.toHaveBeenCalled();
        const { kpis, assets, meta } = res.body;
        // 100 × 35 + 10 × US$ 200 × 5,50 = 3.500 + 11.000
        expect(kpis.totalEquity).toBe(14500);
        // Regra 8: AAPL custa R$ 7.500 (câmbio da compra), nunca US$ 1.500 × 5,50 = 8.250.
        expect(kpis.totalInvested).toBe(10500);
        // Proventos pelo ACCRUAL (120), não pelo caixa (100).
        expect(kpis.totalDividends).toBe(120);
        expect(kpis.totalResult).toBe(4120);
        expect(kpis.totalResultPercent).toBeCloseTo(39.238, 2);
        expect(kpis.projectedDividends).toBe(30);
        expect(kpis.dataQuality).toBe('ESTIMATED');
        expect(kpis.weightedRentability).toBeCloseTo(kpis.totalResultPercent, 3);
        expect(kpis.dayAnchorDate).toBeNull();
        expect(kpis.sharpeRatio).toBeNull();
        expect(kpis.beta).toBeNull();
        expect(meta.usdRate).toBe(5.5);
        expect(meta.lastUpdate).toBeInstanceOf(Date);

        const byTicker = Object.fromEntries(assets.map((a) => [a.ticker, a]));
        expect(byTicker.AAPL).toMatchObject({ totalValue: 11000, totalCost: 7500, profit: 3500, currentPrice: 200 });
        expect(byTicker.PETR4).toMatchObject({
            name: 'Petrobras PN', sector: 'Petróleo', totalValue: 3500, totalCost: 3000, profit: 500,
            averagePrice: 30, dividendsReceived: 120, dayDividends: 0,
            dayChangeReason: DAY_CHANGE_REASON.PROVIDER_SESSION,
        });
        expect(byTicker.PETR4.profitPercent).toBeCloseTo(16.6667, 3);
        // Variação da sessão do provedor: 3.500 − 100 × 35/1,02 e 11.000 − 10 × 200/1,01 × 5,50.
        expect(kpis.dayVariation).toBeCloseTo(177.54, 1);
        // As linhas do detalhamento fecham o card ao centavo.
        const sumLines = assets.reduce((acc, a) => acc + a.dayChangeValue, 0);
        expect(Number(sumLines.toFixed(2))).toBe(kpis.dayVariation);
        expect(marketDataService.refreshQuotesBatch).toHaveBeenCalledWith(['PETR4', 'AAPL']);
    });

    it('com snapshot-âncora: variação contra o candle e o câmbio do dia-âncora, cota TWRR live e AUDITED', async () => {
        state.assets = [petr4(), aapl()];
        state.quotes = quotesToday();
        state.snapshots = [anchorSnapshot()];
        state.closes = [{ ticker: 'PETR4', candle: { close: 34 } }, { ticker: 'AAPL', candle: { close: 198 } }];
        state.fxByDay = { '2026-11-23': 5.4 };
        state.accrued = { total: 120, byTicker: { PETR4: 120 }, sinceTotal: 10, sinceByTicker: { PETR4: 10 } };

        const { res } = await call(getWalletData);
        const { kpis, assets } = res.body;

        expect(kpis.dayAnchorDate).toBe('2026-11-23');
        // PETR4: 3.500 − 100 × 34 = 100. AAPL: 11.000 − 10 × 198 × 5,40 = 308.
        expect(kpis.dayVariation).toBe(408);
        const byTicker = Object.fromEntries(assets.map((a) => [a.ticker, a]));
        expect(byTicker.PETR4.dayChangeValue).toBe(100);
        expect(byTicker.AAPL.dayChangeValue).toBe(308);
        expect(byTicker.PETR4.dayChangeReason).toBe(DAY_CHANGE_REASON.ANCHOR_CLOSE);
        // Provento do dia-ex é explicado à parte, fora da variação.
        expect(kpis.dayDividends).toBe(10);
        expect(byTicker.PETR4.dayDividends).toBe(10);
        expect(kpis.dayVariationPercent).toBeCloseTo((408 / (14500 - 408)) * 100, 2);
        // Nenhum fechamento faltando entre segunda (âncora) e terça (hoje).
        expect(kpis.dataQuality).toBe('AUDITED');
        // Cota 110 × (14.500 − 14.000 + 10) / 14.000 → +14,007%.
        expect(kpis.weightedRentability).toBeCloseTo(14.007, 1);
        // Câmbio do dia-âncora e fluxo do período dividem UMA leitura da série.
        expect(financialService._loadUsdRateResolver).toHaveBeenCalledTimes(1);
    });

    it('aporte depois do âncora entra como fluxo e não infla a rentabilidade', async () => {
        state.assets = [petr4(), aapl()];
        state.quotes = quotesToday();
        state.snapshots = [anchorSnapshot()];
        state.closes = [{ ticker: 'PETR4', candle: { close: 34 } }, { ticker: 'AAPL', candle: { close: 198 } }];
        const semFluxo = (await call(getWalletData)).res.body.kpis.weightedRentability;

        state.transactions = [{ ticker: 'PETR4', type: 'BUY', totalValue: 400, date: new Date('2026-11-24T13:00:00.000Z'), currency: 'BRL' }];
        const comFluxo = (await call(getWalletData)).res.body.kpis.weightedRentability;

        expect(comFluxo).toBeLessThan(semFluxo);
        const txFilter = AssetTransaction.find.mock.calls.at(-1)[0];
        expect(txFilter).toMatchObject({ user: 'u1', wallet: 'w1' });
        expect(txFilter.$or).toBeDefined();
    });

    it('âncora com fechamento faltando (feriado no meio) rebaixa o selo para ESTIMATED', async () => {
        state.assets = [petr4()];
        state.quotes = quotesToday();
        // Quinta 19/11 → terça 24/11: a segunda 23/11 deveria ter snapshot.
        state.snapshots = [anchorSnapshot({ dayKey: '2026-11-19', date: new Date('2026-11-20T02:59:00.000Z') })];

        const { res } = await call(getWalletData);

        expect(res.body.kpis.dayAnchorDate).toBe('2026-11-19');
        expect(res.body.kpis.dataQuality).toBe('ESTIMATED');
    });

    it('posição em dólar não migrada (sem totalCostBrl) cai no câmbio de hoje', async () => {
        state.assets = [{ ...aapl(), totalCostBrl: null, realizedProfitBrl: null }];
        state.quotes = quotesToday();

        const { res } = await call(getWalletData);

        expect(res.body.kpis.totalInvested).toBe(8250);
        expect(res.body.assets[0].totalValue).toBe(11000);
    });

    it('variação cambial sem âncora entra na variação do dia da posição em dólar', async () => {
        state.assets = [aapl()];
        state.quotes = new Map([['AAPL', { price: 200, change: 0, priceDate: '2026-11-24' }]]);
        state.config = { dollar: 5.5, dollarChange: 1.0, cdi: 14.9 };

        const { res } = await call(getWalletData);

        // Preço parado, dólar +1%: 11.000 − 2.000 × 5,50/1,01 (câmbio de abertura a 4 casas).
        expect(res.body.kpis.dayVariation).toBeCloseTo(108.91, 0);
        expect(res.body.assets[0].dayChangePct).toBeCloseTo(1, 2);
    });

    it('cotação da véspera (priceDate antigo) não vira variação de hoje', async () => {
        state.assets = [petr4()];
        state.quotes = new Map([['PETR4', { price: 35, change: 3, priceDate: '2026-11-23' }]]);

        const { res } = await call(getWalletData);

        expect(res.body.kpis.dayVariation).toBe(0);
        expect(res.body.assets[0].dayChangeReason).toBe(DAY_CHANGE_REASON.STALE_QUOTE);
    });

    it('compra feita hoje mede a variação contra o preço médio', async () => {
        state.assets = [{ ...petr4(), taxLots: [{ date: new Date('2026-11-24T00:00:00.000Z'), quantity: 100 }] }];
        state.quotes = quotesToday();

        const { res } = await call(getWalletData);

        // 100 × (35 − 30): o pregão inteiro não conta para quem comprou à tarde.
        expect(res.body.kpis.dayVariation).toBe(500);
        expect(res.body.assets[0].dayChangeReason).toBe(DAY_CHANGE_REASON.BOUGHT_TODAY);
    });

    it('cripto sem candle mede contra o fechamento anterior do provedor', async () => {
        state.assets = [{
            _id: 'c1', ticker: 'BTC', type: 'CRYPTO', quantity: 0.1, totalCost: 5000, totalCostBrl: 27000,
            currency: 'USD', taxLots: oldLot(0.1),
        }];
        state.quotes = new Map([['BTC', { price: 60000, previousClose: 59000, change: 4 }]]);

        const { res } = await call(getWalletData);

        const btc = res.body.assets[0];
        expect(btc.dayChangeReason).toBe(DAY_CHANGE_REASON.PREVIOUS_CLOSE);
        expect(btc.totalValue).toBe(33000);
        expect(btc.dayChangePct).toBeCloseTo(((60000 / 59000) - 1) * 100, 2);
    });

    it('reserva em caixa rende pela curva e é marcada como reserva', async () => {
        state.assets = [{
            _id: 'r1', ticker: 'RESERVA', type: 'CASH', quantity: 1000, totalCost: 1000, currency: 'BRL',
            startDate: new Date('2026-10-01T00:00:00.000Z'), taxLots: oldLot(1000),
        }];

        const { res } = await call(getWalletData);

        const cash = res.body.assets[0];
        expect(cash).toMatchObject({ sector: 'Caixa', isReserve: true, currentPrice: 1, pricingSource: 'ACCRUAL' });
        expect(cash.totalValue).toBeGreaterThan(1000);
        expect(cash.dayChangeReason).toBe(DAY_CHANGE_REASON.FIXED_INCOME_CURVE);
        expect(marketDataService.refreshQuotesBatch).not.toHaveBeenCalled();
    });

    it('só posições encerradas: patrimônio zero e lucro realizado entra no resultado', async () => {
        state.assets = [{ ...petr4(), quantity: 0, totalCost: 0, realizedProfit: 800, taxLots: [] }];

        const { res } = await call(getWalletData);

        expect(res.body.assets).toEqual([]);
        expect(res.body.kpis).toMatchObject({ totalEquity: 0, totalInvested: 0, totalResult: 800, totalResultPercent: 0 });
    });
});

describe('GET /wallet — auto-heal e degradação', () => {
    it('sem posições mas com lançamentos: reconstrói as posições e responde com elas', async () => {
        state.distinct = ['PETR4'];
        state.quotes = quotesToday();
        let healed = false;
        financialService.recalculatePosition.mockImplementation(async () => {
            healed = true;
            state.assets = [petr4()];
        });

        const { res } = await call(getWalletData);

        expect(healed).toBe(true);
        expect(financialService.recalculatePosition).toHaveBeenCalledWith('u1', 'PETR4', null, null, null, 'w1');
        expect(res.body.kpis.totalEquity).toBe(3500);
        expect(res.body.assets.map((a) => a.ticker)).toEqual(['PETR4']);
    });

    it('auto-heal que não estabiliza para no limite de profundidade e renderiza o estado atual', async () => {
        state.distinct = ['PETR4'];
        state.assets = [{ ...petr4(), quantity: 0, totalCost: 0, realizedProfit: 50, taxLots: [] }];
        // A busca filtrada diz que curou; a leitura completa continua sem posição aberta.
        state.activeOverride = [petr4()];

        const { res, next } = await call(getWalletData);

        expect(next).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('limite de auto-heal'));
        expect(res.body.kpis.totalResult).toBe(50);
    });

    it('cotações fora do ar: marca no custo, avisa no log e registra no ErrorLog', async () => {
        state.assets = [petr4()];
        state.quotesError = new Error('Yahoo timeout');
        state.dividendsError = new Error('dividendos caíram');

        const { res, next } = await call(getWalletData);

        expect(next).not.toHaveBeenCalled();
        expect(res.body.assets[0]).toMatchObject({ totalValue: 3000, dayChangeReason: DAY_CHANGE_REASON.NO_QUOTE });
        expect(res.body.kpis.totalEquity).toBe(3000);
        expect(res.body.kpis.dayVariation).toBe(0);
        expect(logger.warn).toHaveBeenCalledWith('[Wallet] Payload montado com dados incompletos', expect.objectContaining({
            userId: 'u1', walletId: 'w1', failed: 'quotes,dividends',
        }));
        expect(recordError).toHaveBeenCalledWith(expect.objectContaining({ source: 'wallet.payload', code: 'quotes,dividends' }));
    });

    it('sem cotação mas com candle do dia-âncora: marca pelo candle gravado', async () => {
        state.assets = [petr4()];
        state.snapshots = [anchorSnapshot()];
        state.closes = [{ ticker: 'PETR4', candle: { close: 33 } }];

        const { res } = await call(getWalletData);

        expect(res.body.assets[0]).toMatchObject({ totalValue: 3300, currentPrice: 33, dayChangeValue: 0 });
    });

    it('accrual de proventos fora do ar cai na definição por caixa', async () => {
        state.assets = [petr4()];
        state.quotes = quotesToday();
        state.dividends = { totalAllTime: 90, projectedMonthly: 0, receivedByTicker: { PETR4: 90 } };
        financialService.accrueDividendsByTicker.mockRejectedValue(new Error('accrual caiu'));

        const { res } = await call(getWalletData);

        expect(res.body.kpis.totalDividends).toBe(90);
        expect(res.body.assets[0].dividendsReceived).toBe(90);
        expect(res.body.kpis.dayDividends).toBe(0);
    });

    it('erro ao ler as posições vai para o error handler', async () => {
        UserAsset.find.mockImplementation(() => chain(new Error('Mongo fora')));

        const { res, next } = await call(getWalletData);

        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mongo fora' }));
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('calculateLiveKPIS', () => {
    it('carteira sem posição aberta devolve null', async () => {
        expect(await calculateLiveKPIS('u1', 14.9, 'w1')).toBeNull();
    });

    it('marca a mercado, cai no custo sem cotação e devolve a renda desde o âncora', async () => {
        state.assets = [petr4(), aapl(), { ...petr4(), _id: 'a3', ticker: 'VALE3', totalCost: 6000 }];
        state.quotes = quotesToday();
        state.accrued = { total: 120, sinceTotal: 15 };

        const live = await calculateLiveKPIS('u1', 14.9, 'w1', { sinceDayKey: '2026-11-23' });

        expect(live.totalEquity).toBe(3500 + 11000 + 6000);
        expect(live.totalInvested).toBe(3000 + 7500 + 6000);
        expect(live.totalDividends).toBe(120);
        expect(live.dividendsSinceAnchor).toBe(15);
    });

    it('sem dia-âncora não credita renda do período', async () => {
        state.assets = [petr4()];
        state.quotes = quotesToday();
        state.accrued = { total: 120, sinceTotal: 15 };

        const live = await calculateLiveKPIS('u1', 14.9, 'w1');

        expect(live.dividendsSinceAnchor).toBe(0);
    });
});
