/**
 * selectBasket — seleção da cesta da Carteira Recomendada (backtest contínuo).
 * Regras (jul/2026): só COMPRAR (nunca AGUARDAR/SELL); curva de perfil é PURA (sem
 * emprestar picks de outro perfil nem cair para top-score); ETF separa Nacional/US
 * por typeFilter; dedupe por ticker, máx 10.
 */
import { describe, it, expect } from 'vitest';
import { selectBasket, CLASS_CONFIG } from '../scripts/recommendedPortfolioEngine.js';

const item = (ticker, action, riskProfile, type = 'STOCK') => ({ ticker, action, riskProfile, type });
const report = (assetClass, ranking) => ({ assetClass, content: { ranking } });

describe('selectBasket — anti-WAIT e pureza por perfil', () => {
    it('BRASIL_10: só COMPRAR (exclui AGUARDAR/SELL)', () => {
        const r = report('BRASIL_10', [
            item('PETR4', 'BUY', 'DEFENSIVE'),
            item('VALE3', 'WAIT', 'DEFENSIVE'),
            item('ITSA4', 'BUY', 'MODERATE'),
            item('XPTO3', 'SELL', 'BOLD'),
        ]);
        const basket = selectBasket(r, 'MODERATE');
        expect(basket.map(b => b.ticker)).toEqual(['PETR4', 'ITSA4']);
    });

    it('profile-aware: só BUY do perfil pedido', () => {
        const r = report('STOCK', [
            item('AAA3', 'BUY', 'DEFENSIVE'),
            item('BBB3', 'BUY', 'MODERATE'),
            item('CCC3', 'WAIT', 'MODERATE'),
            item('DDD3', 'BUY', 'BOLD'),
        ]);
        expect(selectBasket(r, 'MODERATE').map(b => b.ticker)).toEqual(['BBB3']);
        expect(selectBasket(r, 'DEFENSIVE').map(b => b.ticker)).toEqual(['AAA3']);
        expect(selectBasket(r, 'BOLD').map(b => b.ticker)).toEqual(['DDD3']);
    });

    it('perfil sem nenhum BUY → cesta vazia (sem fallback que injete WAIT/outro perfil)', () => {
        const r = report('STOCK', [
            item('AAA3', 'BUY', 'DEFENSIVE'),
            item('BBB3', 'WAIT', 'MODERATE'),
        ]);
        expect(selectBasket(r, 'MODERATE')).toEqual([]);
        expect(selectBasket(r, 'BOLD')).toEqual([]);
    });

    it('nunca inclui AGUARDAR mesmo quando é o de maior score (sem fallback top-score)', () => {
        const r = report('STOCK', Array.from({ length: 12 }, (_, i) => item(`T${i}3`, 'WAIT', 'MODERATE')));
        expect(selectBasket(r, 'MODERATE')).toEqual([]);
    });
});

describe('selectBasket — typeFilter ETF (Nacional/Internacional)', () => {
    const etf = report('ETF', [
        item('BOVA11', 'BUY', 'DEFENSIVE', 'ETF'),      // nacional (B3)
        item('IVVB11', 'BUY', 'MODERATE', 'ETF'),       // nacional (B3)
        item('SCHD', 'BUY', 'DEFENSIVE', 'STOCK_US'),   // internacional
        item('VNQ', 'BUY', 'MODERATE', 'STOCK_US'),     // internacional
    ]);

    it("BR: só type 'ETF' (B3)", () => {
        const basket = selectBasket(etf, 'DEFENSIVE', CLASS_CONFIG.ETF_BR.typeFilter);
        expect(basket.map(b => b.ticker)).toEqual(['BOVA11']);
    });

    it("US: só type != 'ETF'", () => {
        const basket = selectBasket(etf, 'MODERATE', CLASS_CONFIG.ETF_US.typeFilter);
        expect(basket.map(b => b.ticker)).toEqual(['VNQ']);
    });
});

describe('selectBasket — dedupe e limite', () => {
    it('dedupe por ticker e máx 10', () => {
        const many = [];
        for (let i = 0; i < 14; i++) many.push(item(`T${i}3`, 'BUY', 'MODERATE'));
        many.push(item('T0', 'BUY', 'MODERATE')); // duplicata lógica após normalização? nomes distintos
        const r = report('STOCK', [item('DUP3', 'BUY', 'MODERATE'), item('dup3', 'BUY', 'MODERATE'), ...many]);
        const basket = selectBasket(r, 'MODERATE');
        expect(basket.length).toBeLessThanOrEqual(10);
        const tickers = basket.map(b => b.ticker);
        expect(new Set(tickers).size).toBe(tickers.length); // sem duplicatas
    });
});

describe('CLASS_CONFIG — cobertura de classes', () => {
    it('inclui as classes que faltavam (CRYPTO, REIT, ETF_BR, ETF_US)', () => {
        for (const k of ['BRASIL_10', 'STOCK', 'FII', 'STOCK_US', 'REIT', 'CRYPTO', 'ETF_BR', 'ETF_US']) {
            expect(CLASS_CONFIG[k]).toBeTruthy();
        }
        expect(CLASS_CONFIG.CRYPTO.benchmarks).toContain('btc');
        expect(CLASS_CONFIG.ETF_BR.realClass).toBe('ETF');
        expect(CLASS_CONFIG.ETF_US.typeFilter).toBe('US');
        expect(CLASS_CONFIG.BRASIL_10.profileAware).toBe(false);
    });
});
