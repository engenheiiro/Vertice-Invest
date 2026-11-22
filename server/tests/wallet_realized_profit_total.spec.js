/**
 * LUCRO REALIZADO DO CARD — todas as posições, câmbio de cada venda.
 *
 * O card somava só posições ENCERRADAS e convertia o realizado em moeda nativa
 * pelo câmbio de HOJE: venda parcial sumia do total (a linha do ativo mostrava,
 * o card não) e o realizado de um ativo em dólar já vendido oscilava com o dólar.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { sumRealizedProfitBRL } = await import('../controllers/walletController.js');

describe('sumRealizedProfitBRL', () => {
    it('usa o realizado em BRL congelado na venda, não o câmbio de hoje', () => {
        // 10 AAPL @ $100 (câmbio 5,0) vendidas @ $110 (câmbio 6,0): R$ 1.600.
        const aapl = { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', quantity: 0, realizedProfit: 100, realizedProfitBrl: 1600 };
        expect(sumRealizedProfitBRL([aapl], 5.5)).toBe(1600);
    });

    it('inclui o realizado de posição ainda aberta (venda parcial)', () => {
        const parcial = { ticker: 'PETR4', type: 'STOCK', quantity: 50, realizedProfit: 500, realizedProfitBrl: 500 };
        const encerrada = { ticker: 'VALE3', type: 'STOCK', quantity: 0, realizedProfit: 200, realizedProfitBrl: 200 };
        expect(sumRealizedProfitBRL([parcial, encerrada], 5.5)).toBe(700);
    });

    it('posição legada sem espelho BRL cai no câmbio de hoje (comportamento antigo)', () => {
        const legado = { ticker: 'MSFT', type: 'STOCK_US', currency: 'USD', quantity: 0, realizedProfit: 10, realizedProfitBrl: null };
        expect(sumRealizedProfitBRL([legado], 5)).toBe(50);
    });

    it('lista vazia ou ausente é zero', () => {
        expect(sumRealizedProfitBRL([], 5)).toBe(0);
        expect(sumRealizedProfitBRL(undefined, 5)).toBe(0);
    });
});
