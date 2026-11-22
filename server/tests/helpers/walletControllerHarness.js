/**
 * Utilitários compartilhados pelos specs do walletController (wallet_controller_*).
 *
 * Só código de teste: query falsa do Mongoose, req/res falsos, fixtures de
 * posições realistas e a ligação dos mocks do caminho de leitura a um `state`
 * mutável. Nenhum I/O — os `vi.mock` continuam em cada spec (são içados).
 */
import { vi } from 'vitest';

/** Query falsa do Mongoose: encadeável e "thenable", como a real. Error → rejeita. */
export const chain = (value) => {
    const q = {};
    for (const m of ['sort', 'limit', 'select', 'skip', 'lean', 'session', 'populate']) q[m] = vi.fn(() => q);
    q.exec = () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
    q.then = (ok, fail) => q.exec().then(ok, fail);
    q.catch = (fail) => q.exec().catch(fail);
    return q;
};

export const mockRes = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = vi.fn((c) => { res.statusCode = c; return res; });
    res.json = vi.fn((b) => { res.body = b; return res; });
    return res;
};

/** Chama o handler com req autenticado na carteira w1 do usuário u1. */
export const call = async (handler, req = {}) => {
    const res = mockRes();
    const next = vi.fn();
    await handler({ user: { id: 'u1' }, walletId: 'w1', query: {}, params: {}, body: {}, ...req }, res, next);
    return { res, next };
};

// Terça, 24/11/2026, 15h em Brasília: dia útil (20/11 é feriado da Consciência Negra).
export const NOW = new Date('2026-11-24T18:00:00.000Z');
export const HOLIDAYS = ['2026-11-20', '2026-12-25'];

export const oldLot = (quantity) => [{ date: new Date('2026-10-01T00:00:00.000Z'), quantity }];

export const petr4 = () => ({
    _id: 'a1', ticker: 'PETR4', type: 'STOCK', quantity: 100, totalCost: 3000, currency: 'BRL',
    realizedProfit: 0, taxLots: oldLot(100),
});

// Custo em US$ 1.500 comprado a R$ 5,00 — totalCostBrl congela esse câmbio.
export const aapl = () => ({
    _id: 'a2', ticker: 'AAPL', type: 'STOCK_US', quantity: 10, totalCost: 1500, totalCostBrl: 7500,
    realizedProfit: 0, realizedProfitBrl: 0, currency: 'USD', taxLots: oldLot(10),
});

export const anchorSnapshot = (overrides = {}) => ({
    date: new Date('2026-11-24T02:59:00.000Z'), dayKey: '2026-11-23',
    quotaPrice: 110, totalEquity: 14000, totalInvested: 10500,
    calculatedAt: new Date('2026-11-24T02:59:30.000Z'),
    ...overrides,
});

export const quotesToday = () => new Map([
    ['PETR4', { price: 35, change: 2, priceDate: '2026-11-24', name: 'Petrobras PN', sector: 'Petróleo' }],
    ['AAPL', { price: 200, change: 1, priceDate: '2026-11-24', name: 'Apple Inc.', sector: 'Tecnologia' }],
]);

/** Documento de lançamento falso (com toObject, como o do Mongoose). */
export const txDoc = (fields) => ({ ...fields, toObject: () => ({ ...fields }) });

/** Documento de posição falso com save espionado. */
export const positionDoc = (overrides = {}) => ({ save: vi.fn(async () => {}), ...overrides });

/** Estado inicial do caminho de leitura: carteira vazia, macro com dólar a R$ 5,50. */
export const freshReadState = () => ({
    walletPrefs: null,
    assets: [],
    activeOverride: null,
    distinct: [],
    snapshots: [],
    riskSnapshots: [],
    transactions: [],
    config: { dollar: 5.5, dollarChange: 0, selic: 15, cdi: 14.9, ipca: 4.5, ibov: 103000 },
    quotes: new Map(),
    quotesError: null,
    accrued: { total: 0, byTicker: {}, sinceTotal: 0, sinceByTicker: {}, paid: 0, pending: 0 },
    dividends: { totalAllTime: 0, projectedMonthly: 0, receivedByTicker: {}, dividendMap: new Map(), provisioned: [] },
    dividendsError: null,
    closes: [],
    fxByDay: {},
    ibov: [],
});

/**
 * Liga os mocks de models/serviços do caminho de leitura ao `state`. `m` traz
 * os módulos mockados importados pelo spec.
 */
export const wireReadPathMocks = (m, state) => {
    const { Wallet, UserAsset, AssetTransaction, WalletSnapshot, AssetHistory, SystemConfig, marketDataService, financialService } = m;
    Wallet.findById.mockImplementation(() => chain(state.walletPrefs));
    UserAsset.find.mockImplementation((filter = {}) => {
        if (filter.ticker?.$in) return chain(state.assets.filter((a) => filter.ticker.$in.includes(a.ticker)));
        if (filter.quantity) return chain(state.activeOverride ?? state.assets.filter((a) => a.quantity > 1e-9));
        return chain([...state.assets]);
    });
    AssetTransaction.find.mockImplementation(() => chain(state.transactions));
    AssetTransaction.distinct.mockImplementation(async () => state.distinct);
    WalletSnapshot.find.mockImplementation((filter = {}) => chain(filter.totalEquity ? [...state.riskSnapshots] : [...state.snapshots]));
    AssetHistory.aggregate.mockImplementation(async () => state.closes);
    SystemConfig.findOne.mockImplementation(() => chain(state.config));

    marketDataService.refreshQuotesBatch.mockResolvedValue();
    marketDataService.getMarketDataMap.mockImplementation(async () => {
        if (state.quotesError) throw state.quotesError;
        return state.quotes;
    });
    marketDataService.getBenchmarkHistory.mockImplementation(async () => state.ibov);
    marketDataService.refreshFundamentals.mockResolvedValue();
    financialService.accrueDividendsByTicker.mockImplementation(async () => state.accrued);
    financialService.calculateUserDividends.mockImplementation(async () => {
        if (state.dividendsError) throw state.dividendsError;
        return state.dividends;
    });
    financialService._loadUsdRateResolver.mockImplementation(async (current) => (day) => state.fxByDay[day] ?? current);
    financialService.syncDividends.mockResolvedValue();
    financialService.recalculatePosition.mockResolvedValue({});
};
