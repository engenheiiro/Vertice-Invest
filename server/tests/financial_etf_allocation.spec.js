import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { financialService } from '../services/financialService.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('financialService.recalculatePosition — classe econômica de ETF', () => {
    it('persiste uma nova posição de IVVB11 como ETF/BRL alocada em Exterior', async () => {
        vi.spyOn(AssetTransaction, 'find').mockReturnValue({
            sort: () => Promise.resolve([{
                type: 'BUY', quantity: 2, price: 400,
                date: new Date('2026-07-31T12:00:00Z'),
            }]),
        });
        vi.spyOn(UserAsset, 'findOne').mockResolvedValue(null);
        vi.spyOn(MarketAsset, 'findOne').mockResolvedValue({
            ticker: 'IVVB11', name: 'iShares S&P 500', type: 'ETF',
            currency: 'BRL', sector: 'Exterior (S&P 500)', allocationClass: 'STOCK_US',
        });
        vi.spyOn(UserAsset.prototype, 'save').mockImplementation(async function save() {
            return this;
        });

        const asset = await financialService.recalculatePosition(
            '64b000000000000000000001',
            'IVVB11',
            null,
            null,
            null,
            '64b000000000000000000002',
        );

        expect(asset.type).toBe('ETF');
        expect(asset.currency).toBe('BRL');
        expect(asset.allocationClass).toBe('STOCK_US');
        expect(asset.quantity).toBe(2);
        expect(asset.totalCost).toBe(800);
        expect(UserAsset.prototype.save).toHaveBeenCalledOnce();
    });
});
