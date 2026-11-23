import { describe, it, expect } from 'vitest';
import { pickDisplayUsdRate, usdMultiplierFor } from '../utils/fxRate.js';
import { processWalletAsset } from '../controllers/walletController.js';

// Regra 13: as telas (KPI, carteira, metas, rebalanceamento) exibiam
// `config?.dollar || 5.75` — sem macro, um câmbio inventado aparecia como cotação.
describe('câmbio de exibição — nunca 5,75 inventado', () => {
    it('macro primeiro; sem ela, o último candle real (com a data); sem nada, nulo', () => {
        expect(pickDisplayUsdRate(5.2, { date: '2026-11-19', close: 5.31 })).toEqual({ rate: 5.2, source: 'macro', asOf: null });
        expect(pickDisplayUsdRate(null, { date: '2026-11-19', close: 5.31 })).toEqual({ rate: 5.31, source: 'series', asOf: '2026-11-19' });
        expect(pickDisplayUsdRate(0, { date: '2026-11-19', adjClose: 5.4, close: 5.31 }).rate).toBe(5.4);
        expect(pickDisplayUsdRate(null, null)).toEqual({ rate: null, source: null, asOf: null });
        expect(pickDisplayUsdRate(undefined, { date: 'lixo', close: 5.31 }).rate).toBeNull();
        expect(pickDisplayUsdRate(undefined, { date: '2026-11-19', close: 0 }).rate).toBeNull();
    });

    it('multiplicador: real/BRL vale 1; dólar usa a cotação; sem cotação, o câmbio médio das próprias compras', () => {
        const brl = { type: 'STOCK', currency: 'BRL' };
        const usd = { type: 'STOCK_US', currency: 'USD', totalCost: 1000, totalCostBrl: 5100 };
        expect(usdMultiplierFor(brl, null)).toBe(1);
        expect(usdMultiplierFor(usd, 5.4)).toBe(5.4);
        expect(usdMultiplierFor(usd, null)).toBeCloseTo(5.1);
        // Posição ainda não migrada (sem custo em BRL): não há câmbio honesto nenhum.
        expect(usdMultiplierFor({ ...usd, totalCostBrl: null }, null)).toBe(0);
    });

    it('carteira sem câmbio valoriza o dólar pelo câmbio médio da compra, sem ganho cambial inventado', () => {
        const aapl = {
            ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', quantity: 10, totalCost: 1000, totalCostBrl: 5100,
            taxLots: [{ date: new Date('2026-05-10T00:00:00.000Z'), quantity: 10, price: 100 }],
        };
        const { processed } = processWalletAsset(aapl, {
            assetMap: new Map([['AAPL', { price: 110, previousClose: 110, change: 0, priceDate: '2026-09-01' }]]),
            usdRate: null, usdChange: 0, macroRates: { cdiRate: 13.9 }, isTodayBusinessDay: true,
            todayKey: '2026-09-01', anchorDayKey: null, anchorCloses: new Map(), anchorUsdRate: 0,
        });
        // 10 × US$ 110 × 5,10 = R$ 5.610 (o ganho é só o do papel: +10%).
        expect(processed.totalValue).toBeCloseTo(5610, 2);
        expect(processed.totalCost).toBeCloseTo(5100, 2);
    });
});
