import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import UserAsset from '../models/UserAsset.js';
import { financialService } from '../services/financialService.js';

// Caracterização de recalculatePosition: trava a saída e os efeitos (escritas no
// banco, ordem e argumentos) dos ramos que os specs de defeito não cobrem — FIFO,
// carimbo de câmbio, consolidação de lotes, RF/CASH, stub de MarketAsset e
// sub-tipo do Exterior. Serve de rede para refatorar sem mudar comportamento.

const USER = '64b000000000000000000001';
const WALLET = '64b000000000000000000002';

// findOne encadeável: aceita `await x`, `.select().lean().catch()`.
const chain = (value) => {
    const p = Promise.resolve(value);
    p.select = () => p;
    p.lean = () => p;
    return p;
};

const setup = ({ txs, existing = null, market = null, rate = () => 5, bulkWrite } = {}) => {
    vi.spyOn(AssetTransaction, 'find').mockReturnValue({ sort: () => Promise.resolve(txs) });
    const bw = vi.spyOn(AssetTransaction, 'bulkWrite').mockImplementation(bulkWrite || (async () => ({})));
    vi.spyOn(UserAsset, 'findOne').mockResolvedValue(existing);
    const findOne = vi.spyOn(MarketAsset, 'findOne').mockImplementation(() => chain(market));
    const upsert = vi.spyOn(MarketAsset, 'updateOne').mockResolvedValue({});
    vi.spyOn(SystemConfig, 'findOne').mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ dollar: 5 }) }) });
    const loader = vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(rate);
    const save = vi.spyOn(UserAsset.prototype, 'save').mockImplementation(async function save() { return this; });
    return { bw, findOne, upsert, loader, save };
};

const tx = (type, quantity, price, iso, extra = {}) => ({ type, quantity, price, date: new Date(iso), ...extra });
const plainLots = (asset) => asset.taxLots.map((l) => ({ quantity: l.quantity, price: l.price, fxRate: l.fxRate, date: l.date.toISOString() }));

afterEach(() => vi.restoreAllMocks());

describe('recalculatePosition — caracterização (FIFO e lucro realizado)', () => {
    it('venda parcial atravessa lotes: médio (RFB) e FIFO divergem, lotes restantes corretos', async () => {
        setup({
            txs: [
                tx('BUY', 10, 10, '2026-01-02T12:00:00Z'),
                tx('BUY', 10, 20, '2026-01-03T12:00:00Z'),
                tx('SELL', 15, 25, '2026-01-05T12:00:00Z'),
            ],
            market: { ticker: 'XPTO3', type: 'STOCK', currency: 'BRL', sector: 'Outros' },
        });
        const asset = await financialService.recalculatePosition(USER, 'XPTO3', null, null, null, WALLET);
        expect(asset.quantity).toBe(5);
        expect(asset.totalCost).toBe(75);
        expect(asset.realizedProfit).toBe(150);
        // FIFO: 10×10 + 5×20 = 200 de custo → 375 − 200
        expect(asset.fifoRealizedProfit).toBe(175);
        expect(asset.totalCostBrl).toBe(75);
        expect(asset.realizedProfitBrl).toBe(150);
        expect(plainLots(asset)).toEqual([{ quantity: 5, price: 20, fxRate: 1, date: '2026-01-03T12:00:00.000Z' }]);
        expect(asset.type).toBe('STOCK');
        expect(asset.currency).toBe('BRL');
        expect(asset.startDate).toBeUndefined();
    });

    it('venda total zera quantidade, custo e lotes, mantendo os lucros', async () => {
        const { bw, upsert } = setup({
            txs: [
                tx('BUY', 3, 10, '2026-01-02T12:00:00Z'),
                tx('BUY', 2, 12, '2026-01-02T13:00:00Z'),
                tx('SELL', 5, 15, '2026-01-07T12:00:00Z'),
            ],
            market: { ticker: 'XPTO3', type: 'STOCK', currency: 'BRL', sector: 'Outros' },
        });
        const asset = await financialService.recalculatePosition(USER, 'XPTO3', null, null, null, WALLET);
        expect(asset.quantity).toBe(0);
        expect(asset.totalCost).toBe(0);
        expect(asset.totalCostBrl).toBe(0);
        expect(asset.taxLots).toHaveLength(0);
        expect(asset.realizedProfit).toBe(21);
        expect(asset.fifoRealizedProfit).toBe(21);
        expect(asset.realizedProfitBrl).toBe(21);
        // Posição em real nunca carimba câmbio; MarketAsset existente não ganha stub.
        expect(bw).not.toHaveBeenCalled();
        expect(upsert).not.toHaveBeenCalled();
    });

    it('sem lançamentos e sem posição devolve null sem gravar nada', async () => {
        const { save, findOne } = setup({ txs: [] });
        const out = await financialService.recalculatePosition(USER, 'XPTO3', null, null, null, WALLET);
        expect(out).toBeNull();
        expect(save).not.toHaveBeenCalled();
        expect(findOne).not.toHaveBeenCalled();
    });

    it('venda que fica maior que o saldo no fim recusa com 400', async () => {
        setup({
            txs: [tx('BUY', 1, 10, '2026-01-02T12:00:00Z'), tx('SELL', 2, 10, '2026-01-02T13:00:00Z')],
            market: { ticker: 'XPTO3', type: 'STOCK', currency: 'BRL' },
        });
        await expect(financialService.recalculatePosition(USER, 'XPTO3', null, null, null, WALLET))
            .rejects.toMatchObject({ httpStatus: 400 });
    });
});

describe('recalculatePosition — caracterização (câmbio em dólar)', () => {
    it('câmbio por lançamento: carimba só os legados, com o câmbio do dia, em uma escrita', async () => {
        const rate = (key) => ({ '2026-01-02': 5, '2026-01-05': 5.5 }[key] || 6);
        const { bw, loader } = setup({
            txs: [
                tx('BUY', 10, 10, '2026-01-02T12:00:00Z', { _id: 'a' }),
                tx('BUY', 10, 10, '2026-01-03T12:00:00Z', { _id: 'b', fxRate: 5.2 }),
                tx('SELL', 5, 12, '2026-01-05T12:00:00Z', { _id: 'c' }),
            ],
            market: { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', sector: 'Technology', name: 'Apple' },
            rate,
        });
        const asset = await financialService.recalculatePosition(USER, 'AAPL', null, null, null, WALLET);
        expect(loader).toHaveBeenCalledWith(5);
        expect(bw).toHaveBeenCalledTimes(1);
        const ops = bw.mock.calls[0][0];
        expect(ops.map((o) => o.updateOne.filter._id)).toEqual(['a', 'c']);
        expect(ops.every((o) => Number(o.updateOne.update.$set.fxRate) > 0)).toBe(true);
        expect(bw.mock.calls[0][1]).toEqual({});
        expect(asset.currency).toBe('USD');
        expect(asset.quantity).toBe(15);
        expect(asset.totalCost).toBe(150);
        expect(asset.realizedProfit).toBe(10);
        expect(asset.fifoRealizedProfit).toBe(10);
        const brl = { totalCostBrl: asset.totalCostBrl, realizedProfitBrl: asset.realizedProfitBrl };
        // 1000×5 + 1000×5,2 = 1020; venda de 1/4 baixa 255 → 765. Lucro: 5×12×5,5 − 255.
        expect(brl).toEqual({ totalCostBrl: 765, realizedProfitBrl: 75 });
        expect(asset.usSubType).toBe('STOCK');
        expect(plainLots(asset)).toEqual([
            { quantity: 5, price: 10, fxRate: 5, date: '2026-01-02T12:00:00.000Z' },
            { quantity: 10, price: 10, fxRate: 5.2, date: '2026-01-03T12:00:00.000Z' },
        ]);
    });

    it('falha no carimbo de câmbio não derruba o recálculo', async () => {
        setup({
            txs: [tx('BUY', 1, 10, '2026-01-02T12:00:00Z', { _id: 'a' })],
            market: { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', sector: 'Technology' },
            bulkWrite: async () => { throw new Error('boom'); },
        });
        const asset = await financialService.recalculatePosition(USER, 'AAPL', null, null, null, WALLET);
        expect(asset.totalCostBrl).toBe(50);
    });
});

describe('recalculatePosition — caracterização (consolidação de lotes)', () => {
    it('mais de 500 lotes: os 100 mais antigos viram um só, com câmbio médio ponderado', async () => {
        const txs = Array.from({ length: 501 }, (_, i) => tx(
            'BUY', 1, 10 + (i % 3), new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(), { fxRate: i < 50 ? 5 : 6 },
        ));
        setup({ txs, market: { ticker: 'BTC', type: 'CRYPTO', currency: 'USD', sector: 'Crypto' } });
        const asset = await financialService.recalculatePosition(USER, 'BTC', null, null, null, WALLET);
        expect(asset.taxLots).toHaveLength(402);
        const [merged] = plainLots(asset);
        expect(merged).toEqual({ date: '2024-04-09T00:00:00.000Z', fxRate: 5.5005, price: 10.99, quantity: 100 });
        expect(asset.taxLots[1].date.toISOString()).toBe(txs[100].date.toISOString());
        expect(asset.quantity).toBe(501);
        expect({ totalCost: asset.totalCost, totalCostBrl: asset.totalCostBrl }).toEqual({ totalCost: 5511, totalCostBrl: 32517 });
    });
});

describe('recalculatePosition — caracterização (criação, RF e sub-tipo)', () => {
    it('renda fixa nova: startDate na primeira compra e sem stub de MarketAsset', async () => {
        const { upsert, findOne } = setup({
            txs: [tx('BUY', 1, 1000, '2026-02-02T12:00:00Z'), tx('BUY', 1, 500, '2026-03-02T12:00:00Z')],
            market: null,
        });
        const asset = await financialService.recalculatePosition(USER, 'CDB-XP', 'FIXED_INCOME', null, null, WALLET);
        expect(asset.type).toBe('FIXED_INCOME');
        expect(asset.startDate.toISOString()).toBe('2026-02-02T12:00:00.000Z');
        expect(asset.totalCost).toBe(1500);
        expect(upsert).not.toHaveBeenCalled();
        // Só a da moeda: a classe já sai resolvida (FIXED_INCOME), sem self-heal.
        expect(findOne).toHaveBeenCalledTimes(1);
        expect(asset.allocationClass).toBe('FIXED_INCOME');
    });

    it('CASH também ganha startDate', async () => {
        setup({ txs: [tx('BUY', 1, 200, '2026-04-01T12:00:00Z')] });
        const asset = await financialService.recalculatePosition(USER, 'RESERVA', 'CASH', null, null, WALLET);
        expect(asset.startDate.toISOString()).toBe('2026-04-01T12:00:00.000Z');
    });

    it('ticker sem MarketAsset ganha stub com $setOnInsert (upsert, mesma sessão)', async () => {
        const { upsert } = setup({ txs: [tx('BUY', 2, 30, '2026-01-02T12:00:00Z')], market: null });
        const asset = await financialService.recalculatePosition(USER, 'NOVO11', null, null, null, WALLET);
        expect(asset.type).toBe('STOCK');
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(upsert.mock.calls[0]).toEqual([
            { ticker: 'NOVO11' },
            { $setOnInsert: {
                ticker: 'NOVO11', name: 'NOVO11', type: 'STOCK', currency: 'BRL',
                allocationClass: asset.allocationClass || null, isActive: true,
            } },
            { upsert: true, session: null },
        ]);
    });

    it('ouro sem tipo forçado nasce ETF', async () => {
        setup({ txs: [tx('BUY', 1, 100, '2026-01-02T12:00:00Z')], market: null });
        const asset = await financialService.recalculatePosition(USER, 'GOLD11', null, null, null, WALLET);
        expect(asset.type).toBe('ETF');
    });

    it('posição existente: tipo forçado troca a classe e limpa o sub-tipo do Exterior', async () => {
        const existing = new UserAsset({
            user: USER, wallet: WALLET, ticker: 'VNQ', type: 'STOCK_US', currency: 'USD',
            usSubType: 'REIT', usSubTypeManual: true, allocationClass: 'STOCK_US',
        });
        const { findOne } = setup({ txs: [tx('BUY', 1, 90, '2026-01-02T12:00:00Z', { fxRate: 5 })], existing, market: null });
        const asset = await financialService.recalculatePosition(USER, 'VNQ', 'ETF', null, null, WALLET);
        expect(asset).toBe(existing);
        expect(asset.type).toBe('ETF');
        expect(asset.usSubType).toBeNull();
        expect(asset.usSubTypeManual).toBe(false);
        // Posição existente não consulta MarketAsset pela moeda; ETF faz o self-heal.
        expect(findOne).toHaveBeenCalledTimes(1);
        expect(asset.totalCostBrl).toBe(450);
    });

    it('STOCK_US com sub-tipo manual não é reclassificado', async () => {
        const existing = new UserAsset({
            user: USER, wallet: WALLET, ticker: 'O', type: 'STOCK_US', currency: 'USD',
            usSubType: 'STOCK', usSubTypeManual: true, allocationClass: 'STOCK_US',
        });
        const { findOne } = setup({ txs: [tx('BUY', 1, 50, '2026-01-02T12:00:00Z', { fxRate: 5 })], existing, market: null });
        const asset = await financialService.recalculatePosition(USER, 'O', null, null, null, WALLET);
        expect(asset.usSubType).toBe('STOCK');
        expect(findOne).not.toHaveBeenCalled();
    });

    it('STOCK_US automático busca o MarketAsset para classificar', async () => {
        const existing = new UserAsset({
            user: USER, wallet: WALLET, ticker: 'VNQ', type: 'STOCK_US', currency: 'USD', allocationClass: 'STOCK_US',
        });
        const { findOne } = setup({
            txs: [tx('BUY', 1, 90, '2026-01-02T12:00:00Z', { fxRate: 5 })],
            existing,
            market: { ticker: 'VNQ', sector: 'Real Estate', currency: 'USD', name: 'Vanguard Real Estate ETF' },
        });
        const asset = await financialService.recalculatePosition(USER, 'VNQ', null, null, null, WALLET);
        expect(findOne).toHaveBeenCalledTimes(1);
        expect(asset.usSubType).toBe('ETF');
    });
});
