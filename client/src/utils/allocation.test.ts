import { describe, it, expect } from 'vitest';
import { computeSubAllocationReal, fixedIncomeSubKey, usSubKeyOf, etfSubKeyOf, resolveAllocClass, hasSubTargets, splitContributionBySubMeta } from './allocation';
import type { Asset } from '../contexts/WalletContext';

const mkAsset = (partial: Partial<Asset>): Asset => ({
    id: Math.random().toString(),
    ticker: 'X',
    type: 'STOCK',
    quantity: 1,
    averagePrice: 0,
    currentPrice: 0,
    totalValue: 0,
    totalCost: 0,
    profit: 0,
    profitPercent: 0,
    currency: 'BRL',
    ...partial,
});

describe('fixedIncomeSubKey', () => {
    it('mapeia IPCA, Selic/CDI (POS), PRE e legado', () => {
        expect(fixedIncomeSubKey({ fixedIncomeIndex: 'IPCA' })).toBe('IPCA');
        expect(fixedIncomeSubKey({ fixedIncomeIndex: 'SELIC' })).toBe('POS');
        expect(fixedIncomeSubKey({ fixedIncomeIndex: 'CDI' })).toBe('POS');
        expect(fixedIncomeSubKey({ fixedIncomeIndex: 'PRE' })).toBe('PRE');
        expect(fixedIncomeSubKey({ fixedIncomeIndex: null })).toBe('PRE'); // legado
    });
});

describe('usSubKeyOf', () => {
    it('usa o sub-tipo quando válido; cai em STOCK caso contrário', () => {
        expect(usSubKeyOf({ usSubType: 'REIT' })).toBe('REIT');
        expect(usSubKeyOf({ usSubType: null })).toBe('STOCK');
        expect(usSubKeyOf({ usSubType: undefined })).toBe('STOCK');
    });
});

describe('etfSubKeyOf / resolveAllocClass', () => {
    it('ETF nacional (type ETF) → BR; internacional (STOCK_US + ETF/GOLD) → US', () => {
        expect(etfSubKeyOf({ type: 'ETF', usSubType: null })).toBe('BR');
        expect(etfSubKeyOf({ type: 'STOCK_US', usSubType: 'ETF' })).toBe('US');
        expect(etfSubKeyOf({ type: 'STOCK_US', usSubType: 'GOLD' })).toBe('US'); // ouro lastreado
        expect(etfSubKeyOf({ type: 'STOCK_US', usSubType: 'STOCK' })).toBe(null);
        expect(etfSubKeyOf({ type: 'STOCK', usSubType: null })).toBe(null);
    });

    it('reclassifica ETF internacional de Exterior para a classe ETF', () => {
        expect(resolveAllocClass({ type: 'ETF', usSubType: null })).toBe('ETF');
        expect(resolveAllocClass({ type: 'STOCK_US', usSubType: 'ETF' })).toBe('ETF');
        expect(resolveAllocClass({ type: 'STOCK_US', usSubType: 'GOLD' })).toBe('ETF');
        expect(resolveAllocClass({ type: 'STOCK_US', usSubType: 'STOCK' })).toBe('STOCK_US');
        expect(resolveAllocClass({ type: 'FII', usSubType: null })).toBe('FII');
    });
});

describe('hasSubTargets', () => {
    it('true quando há alguma sub-meta > 0', () => {
        expect(hasSubTargets({ IPCA: 0, POS: 0, PRE: 0 })).toBe(false);
        expect(hasSubTargets({ IPCA: 68, POS: 32, PRE: 0 })).toBe(true);
        expect(hasSubTargets(undefined)).toBe(false);
    });
});

describe('computeSubAllocationReal', () => {
    it('carteira vazia → tudo zero', () => {
        const r = computeSubAllocationReal([]);
        expect(r.FIXED_INCOME.total).toBe(0);
        expect(r.STOCK_US.total).toBe(0);
        expect(r.ETF.total).toBe(0);
        expect(r.FIXED_INCOME.pct.IPCA).toBe(0);
    });

    it('agrupa ETFs em Nacional/Internacional e tira os internacionais do Exterior', () => {
        const assets = [
            mkAsset({ type: 'ETF', ticker: 'BOVA11', totalValue: 600 }),              // nacional → BR
            mkAsset({ type: 'STOCK_US', usSubType: 'ETF', ticker: 'VOO', totalValue: 300 }),  // internacional → US
            mkAsset({ type: 'STOCK_US', usSubType: 'GOLD', ticker: 'GLD', totalValue: 100 }), // ouro lastreado → US
            mkAsset({ type: 'STOCK_US', usSubType: 'STOCK', ticker: 'AAPL', totalValue: 500 }), // fica no Exterior
        ];
        const r = computeSubAllocationReal(assets);
        // ETF: BR 600, US 400 (VOO 300 + GLD 100)
        expect(r.ETF.total).toBe(1000);
        expect(r.ETF.value.BR).toBe(600);
        expect(r.ETF.value.US).toBe(400);
        expect(r.ETF.pct.BR).toBeCloseTo(60, 5);
        expect(r.ETF.pct.US).toBeCloseTo(40, 5);
        // Exterior NÃO conta os ETFs internacionais: só AAPL (Stocks).
        expect(r.STOCK_US.total).toBe(500);
        expect(r.STOCK_US.value.STOCK).toBe(500);
    });

    it('agrupa Renda Fixa por índice e calcula % dentro da classe', () => {
        const assets = [
            mkAsset({ type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA', totalValue: 6800 }),
            mkAsset({ type: 'FIXED_INCOME', fixedIncomeIndex: 'SELIC', totalValue: 2000 }),
            mkAsset({ type: 'FIXED_INCOME', fixedIncomeIndex: 'CDI', totalValue: 1200 }),
        ];
        const r = computeSubAllocationReal(assets);
        expect(r.FIXED_INCOME.total).toBe(10000);
        expect(r.FIXED_INCOME.value.IPCA).toBe(6800);
        expect(r.FIXED_INCOME.value.POS).toBe(3200); // Selic + CDI
        expect(r.FIXED_INCOME.pct.IPCA).toBeCloseTo(68, 5);
        expect(r.FIXED_INCOME.pct.POS).toBeCloseTo(32, 5);
    });

    it('agrupa Exterior por usSubType (null → STOCK)', () => {
        const assets = [
            mkAsset({ type: 'STOCK_US', usSubType: 'REIT', totalValue: 200 }),
            mkAsset({ type: 'STOCK_US', usSubType: 'DOLLAR', totalValue: 300 }),
            mkAsset({ type: 'STOCK_US', usSubType: null, totalValue: 500 }), // vira STOCK
        ];
        const r = computeSubAllocationReal(assets);
        expect(r.STOCK_US.total).toBe(1000);
        expect(r.STOCK_US.value.STOCK).toBe(500);
        expect(r.STOCK_US.pct.REIT).toBeCloseTo(20, 5);
        expect(r.STOCK_US.pct.DOLLAR).toBeCloseTo(30, 5);
        expect(r.STOCK_US.pct.STOCK).toBeCloseTo(50, 5);
    });

    it('ignora outras classes (incl. Ouro) e valores não-positivos', () => {
        const assets = [
            mkAsset({ type: 'STOCK', totalValue: 9999 }),
            mkAsset({ type: 'OURO', ticker: 'GOLD11', totalValue: 5000 }), // classe própria, sem sub-metas
            mkAsset({ type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA', totalValue: 0 }),
        ];
        const r = computeSubAllocationReal(assets);
        expect(r.FIXED_INCOME.total).toBe(0);
        expect(r.STOCK_US.total).toBe(0);
        expect(r.STOCK_US.total).toBe(0);
    });
});

describe('splitContributionBySubMeta', () => {
    const FI = ['IPCA', 'POS', 'PRE'] as const;

    it('prioriza o sub-tipo defasado (gap) e conserva o total', () => {
        // Atual: IPCA 8000, POS 0. Aporte 2000 → projeção 10000.
        // Meta IPCA 50% = 5000 (já tem 8000 → gap 0); POS 50% = 5000 (gap 5000).
        // Todo o aporte vai p/ POS.
        const out = splitContributionBySubMeta(2000, { IPCA: 8000, POS: 0, PRE: 0 }, { IPCA: 50, POS: 50, PRE: 0 }, [...FI]);
        expect(out.POS).toBeCloseTo(2000, 2);
        expect(out.IPCA).toBeCloseTo(0, 2);
        expect(out.IPCA + out.POS + out.PRE).toBeCloseTo(2000, 2);
    });

    it('sem defasagem → rateia pelas próprias sub-metas', () => {
        const out = splitContributionBySubMeta(1000, { IPCA: 0, POS: 0, PRE: 0 }, { IPCA: 70, POS: 30, PRE: 0 }, [...FI]);
        expect(out.IPCA).toBeCloseTo(700, 2);
        expect(out.POS).toBeCloseTo(300, 2);
    });

    it('aporte ≤ 0 → tudo zero', () => {
        const out = splitContributionBySubMeta(0, { IPCA: 0, POS: 0, PRE: 0 }, { IPCA: 70, POS: 30, PRE: 0 }, [...FI]);
        expect(out.IPCA).toBe(0);
        expect(out.POS).toBe(0);
    });
});
