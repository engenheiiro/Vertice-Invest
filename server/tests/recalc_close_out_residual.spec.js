import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import UserAsset from '../models/UserAsset.js';
import { financialService } from '../services/financialService.js';

// Venda que ZERA a posição tem que baixar o custo inteiro. Com qtd × médio
// arredondado (safeUnitPrice, 4 casas), COMPRA 1000@10 + COMPRA 2000@10,01 dá médio
// 10,0067 e a venda de 3000 baixava 30.020,10 de um custo de 30.020,00: o lucro
// saía 0,10 menor e o −0,10 de custo era herdado pela compra seguinte.

const USER = '64b000000000000000000001';
const WALLET = '64b000000000000000000002';

const recalc = async (txs, { currency = 'BRL' } = {}) => {
    vi.spyOn(AssetTransaction, 'find').mockReturnValue({ sort: () => Promise.resolve(txs) });
    vi.spyOn(UserAsset, 'findOne').mockResolvedValue(null);
    vi.spyOn(MarketAsset, 'findOne').mockResolvedValue({ ticker: 'XPTO3', type: currency === 'USD' ? 'STOCK_US' : 'STOCK', currency, sector: 'Outros' });
    vi.spyOn(SystemConfig, 'findOne').mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ dollar: 5 }) }) });
    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(() => 5);
    vi.spyOn(UserAsset.prototype, 'save').mockImplementation(async function save() { return this; });
    return financialService.recalculatePosition(USER, 'XPTO3', null, null, currency, WALLET);
};

const tx = (type, quantity, price, iso, extra = {}) => ({ type, quantity, price, date: new Date(iso), ...extra });

afterEach(() => vi.restoreAllMocks());

describe('recalculatePosition — venda que zera a posição baixa o custo inteiro', () => {
    it('lucro exato e a compra seguinte nasce sem resíduo de custo', async () => {
        const asset = await recalc([
            tx('BUY', 1000, 10, '2026-01-02T12:00:00Z'),
            tx('BUY', 2000, 10.01, '2026-01-03T12:00:00Z'),
            tx('SELL', 3000, 11, '2026-01-05T12:00:00Z'),
            tx('BUY', 100, 10, '2026-01-06T12:00:00Z'),
        ]);
        expect(asset.realizedProfit).toBe(2980);
        expect(asset.totalCost).toBe(1000);
        expect(asset.quantity).toBe(100);
    });

    it('o espelho em BRL também zera inteiro (câmbio de cada lançamento)', async () => {
        const asset = await recalc([
            tx('BUY', 1000, 10, '2026-01-02T12:00:00Z', { fxRate: 5 }),
            tx('BUY', 2000, 10.01, '2026-01-03T12:00:00Z', { fxRate: 5.1 }),
            tx('SELL', 3000, 11, '2026-01-05T12:00:00Z', { fxRate: 5.2 }),
            tx('BUY', 100, 10, '2026-01-06T12:00:00Z', { fxRate: 5.3 }),
        ], { currency: 'USD' });
        expect(asset.realizedProfit).toBe(2980);
        expect(asset.totalCost).toBe(1000);
        // 1000 × 5,3: nada do custo das compras encerradas sobra no espelho.
        expect(asset.totalCostBrl).toBe(5300);
        // 3000 × 11 × 5,2 − (10.000 × 5 + 20.020 × 5,1)
        expect(asset.realizedProfitBrl).toBe(19498);
    });

    it('venda parcial segue baixando pelo médio', async () => {
        const asset = await recalc([
            tx('BUY', 1000, 10, '2026-01-02T12:00:00Z'),
            tx('BUY', 2000, 10.01, '2026-01-03T12:00:00Z'),
            tx('SELL', 1500, 11, '2026-01-05T12:00:00Z'),
        ]);
        // médio 10,0067 × 1500 = 15.010,05
        expect(asset.totalCost).toBe(15009.95);
        expect(asset.realizedProfit).toBe(1489.95);
    });
});
