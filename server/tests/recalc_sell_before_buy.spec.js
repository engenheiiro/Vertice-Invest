import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { financialService } from '../services/financialService.js';

// Venda datada antes das compras: o check de saldo só rodava no FIM da sequência,
// então VENDA 10 (01/01) + COMPRA 20 (01/02) passava com lucro realizado fictício
// (a venda saía com preço médio 0) e médio de 80 em vez de 40 na compra.

const USER = '64b000000000000000000001';
const WALLET = '64b000000000000000000002';

const recalc = async (txs) => {
    vi.spyOn(AssetTransaction, 'find').mockReturnValue({ sort: () => Promise.resolve(txs) });
    vi.spyOn(UserAsset, 'findOne').mockResolvedValue(null);
    vi.spyOn(MarketAsset, 'findOne').mockResolvedValue({ ticker: 'PETR4', type: 'STOCK', currency: 'BRL', sector: 'Petróleo' });
    vi.spyOn(UserAsset.prototype, 'save').mockImplementation(async function save() { return this; });
    return financialService.recalculatePosition(USER, 'PETR4', null, null, null, WALLET);
};

const tx = (type, quantity, price, iso) => ({ type, quantity, price, date: new Date(iso) });

afterEach(() => vi.restoreAllMocks());

describe('recalculatePosition — venda maior que o saldo até a data dela', () => {
    it('recusa venda num dia anterior às compras, mesmo que o saldo final fique positivo', async () => {
        await expect(recalc([
            tx('SELL', 10, 50, '2026-01-01T12:00:00Z'),
            tx('BUY', 20, 40, '2026-02-01T12:00:00Z'),
        ])).rejects.toMatchObject({ httpStatus: 400 });
    });

    it('recusa a sequência que zera no fim mas vendeu antes de comprar', async () => {
        await expect(recalc([
            tx('SELL', 10, 50, '2026-01-01T12:00:00Z'),
            tx('BUY', 10, 40, '2026-02-01T12:00:00Z'),
        ])).rejects.toMatchObject({ httpStatus: 400 });
    });

    it('aceita day trade lançado com a venda antes da compra no MESMO dia', async () => {
        const asset = await recalc([
            tx('SELL', 10, 50, '2026-01-01T12:00:00Z'),
            tx('BUY', 10, 40, '2026-01-01T12:00:00Z'),
            tx('BUY', 5, 30, '2026-01-02T12:00:00Z'),
        ]);
        expect(asset.quantity).toBe(5);
    });

    it('sequência normal segue com o médio certo', async () => {
        const asset = await recalc([
            tx('BUY', 20, 40, '2026-01-01T12:00:00Z'),
            tx('SELL', 10, 50, '2026-02-01T12:00:00Z'),
        ]);
        expect(asset.quantity).toBe(10);
        expect(asset.totalCost).toBe(400);
        expect(asset.realizedProfit).toBe(100);
    });
});
