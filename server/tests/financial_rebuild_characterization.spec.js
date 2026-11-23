import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Caracterização de rebuildUserHistory, gravada sobre o método monolítico ANTES
// da decomposição. Carteira mista (ação BR com compra e venda, FII com provento
// no dia-ex e compra no próprio dia-ex, ação em dólar com provento, reserva em
// CDI, CDB) com série sintética de preços, câmbio que varia por dia e um salto
// de preço absurdo no meio (circuit breaker do TWRR). A saída inteira — cada
// snapshot de cada dia — é congelada, junto com quem foi chamado para gravar.

const mocks = vi.hoisted(() => ({
    txFind: vi.fn(),
    snapshotDeleteMany: vi.fn(),
    userAssetFind: vi.fn(),
    systemConfigFindOne: vi.fn(),
    auditCreate: vi.fn(),
}));

vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: { deleteMany: mocks.snapshotDeleteMany } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: mocks.systemConfigFindOne } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: mocks.auditCreate } }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
// Série SELIC vazia: a curva do CDI cai na taxa corrente, sem banco.
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: () => ({ lean: async () => [] }) } }));
// Nenhum título público na carteira: o contexto de PU é o vazio, sem banco.
vi.mock('../services/treasuryPriceService.js', async (importOriginal) => {
    const original = await importOriginal();
    return { ...original, loadTreasuryPricing: async () => original.EMPTY_TREASURY_PRICING };
});
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/dateUtils.js', () => ({
    toDateKey: (date) => new Date(date).toISOString().slice(0, 10),
    startOfDay: (date) => new Date(`${new Date(date).toISOString().slice(0, 10)}T00:00:00.000Z`),
    isBusinessDay: (date) => ![0, 6].includes(new Date(date).getUTCDay()),
}));

const { financialService } = await import('../services/financialService.js');

const d = (s) => new Date(`${s}T12:00:00.000Z`);
const tx = (ticker, type, date, quantity, price, currency = 'BRL') => ({
    ticker, type, date: d(date), quantity, price, totalValue: quantity * price, currency,
});

const ASSETS = [
    { ticker: 'PETR4', type: 'STOCK', currency: 'BRL' },
    { ticker: 'HGLG11', type: 'FII', currency: 'BRL' },
    { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' },
    { ticker: 'RESERVA', type: 'CASH', currency: 'BRL', fixedIncomeRate: 100, fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0 },
    { ticker: 'CDB-XP', type: 'FIXED_INCOME', currency: 'BRL', fixedIncomeRate: 110, fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0 },
];

const TXS = [
    tx('RESERVA', 'BUY', '2026-06-01', 5000, 1),
    tx('PETR4', 'BUY', '2026-06-01', 100, 30),
    tx('CDB-XP', 'BUY', '2026-06-02', 1, 2000),
    tx('HGLG11', 'BUY', '2026-06-03', 10, 160),
    tx('AAPL', 'BUY', '2026-06-04', 5, 200, 'USD'),
    tx('HGLG11', 'BUY', '2026-06-15', 5, 158), // compra NO dia-ex: não recebe
    tx('PETR4', 'SELL', '2026-06-17', 40, 33),
    tx('PETR4', 'SELL', '2026-06-22', 60, 31), // zera a posição
    tx('RESERVA', 'SELL', '2026-06-24', 1000, 1),
];

// Série sintética determinística, dia a dia (inclui fim de semana: o lookup olha até 5 dias atrás).
const serie = (from, to, base, passo, salto = {}) => {
    const map = new Map();
    for (let cur = d(from), i = 0; cur <= d(to); cur.setUTCDate(cur.getUTCDate() + 1), i++) {
        const key = cur.toISOString().slice(0, 10);
        const close = salto[key] ?? Number((base + passo * Math.sin(i / 2) + i * 0.05).toFixed(2));
        map.set(key, { close, adjClose: Number((close * 0.99).toFixed(4)) });
    }
    return map;
};

const PRECOS = () => new Map([
    ['PETR4', serie('2026-05-25', '2026-06-30', 30, 1.2)],
    // Salto de 400% num dia: dado sujo, que o circuit breaker do TWRR tem de barrar.
    ['HGLG11', serie('2026-05-25', '2026-06-30', 160, 2, { '2026-06-10': 800 })],
    ['AAPL', serie('2026-05-25', '2026-06-30', 200, 4)],
]);

const PROVENTOS = () => new Map([
    ['2026-06-15', [{ ticker: 'HGLG11', amount: 1.1 }]],
    ['2026-06-17', [{ ticker: 'PETR4', amount: 0.8 }]], // venda no dia-ex: recebe
    ['2026-06-18', [{ ticker: 'AAPL', amount: 0.25 }]],
    ['2026-06-26', [{ ticker: 'PETR4', amount: 0.5 }]], // posição zerada: não recebe
]);

const usdDoDia = (key) => 5 + (Number(key.slice(8, 10)) % 7) * 0.03;

const prepararMocks = ({ sysConfig = { cdi: 14, ipca: 4.5, dollar: 5.2 }, precos = PRECOS(), txs = TXS } = {}) => {
    mocks.txFind.mockReturnValue({ sort: vi.fn().mockResolvedValue(txs) });
    mocks.userAssetFind.mockResolvedValue(ASSETS);
    mocks.systemConfigFindOne.mockResolvedValue(sysConfig);
    mocks.auditCreate.mockResolvedValue({});
    mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(usdDoDia);
    vi.spyOn(financialService, '_loadPriceCacheMap').mockResolvedValue(precos);
    vi.spyOn(financialService, '_loadDividendDateMap').mockResolvedValue(PROVENTOS());
    vi.spyOn(financialService, '_dividendFxResolver').mockResolvedValue((ticker, key) => (ticker === 'AAPL' ? usdDoDia(key) : 1));
    vi.spyOn(financialService, '_loadCdiFactors').mockResolvedValue({
        dailyFactorsMap: new Map([['2026-06-05', 1.00052], ['2026-06-12', 1.00049]]),
        cdiFactorsCacheFallback: { 2026: 1.0005 },
    });
    return vi.spyOn(financialService, '_persistSnapshots').mockResolvedValue();
};

describe('rebuildUserHistory — caracterização antes da decomposição', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-01T15:00:00.000Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('carteira mista: série completa de snapshots até a véspera', async () => {
        prepararMocks();
        const snaps = await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true });
        expect(snaps.length).toBeGreaterThan(15);
        expect(snaps).toMatchSnapshot();
    });

    it('throughDayKey e source explícitos', async () => {
        prepararMocks();
        const snaps = await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true, throughDayKey: '2026-06-19', source: 'BACKFILL' });
        expect(snaps.at(-1).dayKey).toBe('2026-06-19');
        expect(snaps).toMatchSnapshot();
    });

    it('macro ausente: cai nos defaults de IPCA, câmbio e CDI', async () => {
        prepararMocks({ sysConfig: null });
        expect(await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true, throughDayKey: '2026-06-12' })).toMatchSnapshot();
    });

    it('macro com Selic e IPCA zerado', async () => {
        prepararMocks({ sysConfig: { selic: 15, ipca: 0, dollar: 0 } });
        expect(await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true, throughDayKey: '2026-06-12' })).toMatchSnapshot();
    });

    it('fora do dry-run: audita, grava e devolve os mesmos snapshots', async () => {
        const persist = prepararMocks();
        const snaps = await financialService.rebuildUserHistory('u1', 'w1', { throughDayKey: '2026-06-10' });
        expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
        expect(mocks.auditCreate.mock.calls[0][0]).toMatchObject({ user: 'u1', action: 'RECALC_QUOTA' });
        expect(persist).toHaveBeenCalledWith('u1', 'w1', snaps);
    });

    it('sem transação: apaga os snapshots (fora do dry-run) e devolve vazio', async () => {
        prepararMocks({ txs: [] });
        expect(await financialService.rebuildUserHistory('u1', 'w1', {})).toEqual([]);
        expect(mocks.snapshotDeleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
        vi.clearAllMocks();
        prepararMocks({ txs: [] });
        expect(await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true })).toEqual([]);
        expect(mocks.snapshotDeleteMany).not.toHaveBeenCalled();
    });

    it('série que não cobre a posição: aborta sem gravar', async () => {
        const precos = PRECOS();
        precos.set('AAPL', serie('2026-06-20', '2026-06-30', 200, 4));
        const persist = prepararMocks({ precos });
        await expect(financialService.rebuildUserHistory('u1', 'w1', { throughDayKey: '2026-06-25' }))
            .rejects.toThrow('Histórico de preços insuficiente para reconstruir a carteira: AAPL (posição desde 2026-06-04, série desde 2026-06-20).');
        expect(persist).not.toHaveBeenCalled();
    });

    it('série que não cobre a posição com allowSparseHistory: segue e marca pelo custo', async () => {
        const precos = PRECOS();
        precos.delete('AAPL');
        prepararMocks({ precos });
        const snaps = await financialService.rebuildUserHistory('u1', 'w1', { dryRun: true, throughDayKey: '2026-06-25', allowSparseHistory: true });
        expect(snaps).toMatchSnapshot();
    });
});
