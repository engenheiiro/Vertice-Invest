/**
 * Testes unitários do Rebalanceamento IA — núcleo PURO (buildRebalancePlan) e o
 * estimador de IR (FIFO). Sem DB/rede: insumos são fixtures determinísticas.
 *
 * Cobre: gap negativo → venda; gap positivo → compra do perfil; FIFO de IR;
 * holding sem score cortado só por alocação; carteira equilibrada → sem ordens.
 */
import { describe, it, expect } from 'vitest';
import { buildRebalancePlan, estimateCapitalGainsTax } from '../services/rebalanceService.js';

// Helper: monta um holding já avaliado (formato de computeWalletValuation).
const holding = (over = {}) => ({
    ticker: 'AAAA3',
    type: 'STOCK',
    sector: null,
    quantity: 100,
    currency: 'BRL',
    valueBr: 1000,
    priceBr: 10,
    priceNative: 10,
    totalCostNative: 800,
    taxLots: [{ date: new Date('2023-01-01'), quantity: 100, price: 8 }],
    multiplier: 1,
    ...over,
});

const baseTargets = { STOCK: 50, FII: 50, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0 };

describe('estimateCapitalGainsTax (FIFO)', () => {
    it('aplica a alíquota da classe sobre o ganho FIFO', () => {
        // STOCK 15%. Preço atual 40, lote a 30. Vender R$2000 = 50 cotas.
        // ganho = (40-30)*50 = 500 → IR = 75.
        const asset = holding({
            priceNative: 40,
            quantity: 100,
            taxLots: [{ date: new Date('2023-01-01'), quantity: 100, price: 30 }],
            totalCostNative: 3000,
        });
        expect(estimateCapitalGainsTax(asset, 2000)).toBeCloseTo(75, 1);
    });

    it('não cobra IR de FII vendido no prejuízo', () => {
        const asset = holding({
            type: 'FII',
            priceNative: 90,
            quantity: 30,
            taxLots: [{ date: new Date('2023-01-01'), quantity: 30, price: 110 }],
            totalCostNative: 3300,
        });
        expect(estimateCapitalGainsTax(asset, 900)).toBe(0);
    });

    it('zera IR para Renda Fixa/Caixa (alíquota 0 na tabela)', () => {
        const rf = holding({ type: 'FIXED_INCOME', priceNative: 1.2 });
        expect(estimateCapitalGainsTax(rf, 500)).toBe(0);
    });
});

describe('buildRebalancePlan', () => {
    const makeValuation = () => ({
        totalEquity: 10000,
        usdRate: 5,
        valueByClass: { STOCK: 7000, FII: 3000, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 },
        assets: [
            holding({ ticker: 'AAAA3', type: 'STOCK', valueBr: 4000, priceBr: 40, priceNative: 40, quantity: 100, taxLots: [{ date: new Date('2023-01-01'), quantity: 100, price: 30 }], totalCostNative: 3000 }),
            holding({ ticker: 'BBBB3', type: 'STOCK', valueBr: 3000, priceBr: 30, priceNative: 30, quantity: 100, taxLots: [{ date: new Date('2023-01-01'), quantity: 100, price: 25 }], totalCostNative: 2500 }),
            holding({ ticker: 'CCCC11', type: 'FII', valueBr: 3000, priceBr: 100, priceNative: 100, quantity: 30, taxLots: [{ date: new Date('2023-01-01'), quantity: 30, price: 95 }], totalCostNative: 2850 }),
        ],
    });

    const engine = {
        scoreByTicker: {
            AAAA3: { score: 50, action: 'WAIT', bull: [], bear: ['Margem em queda'] },
            BBBB3: { score: 80, action: 'BUY', bull: ['ROE alto'], bear: [] },
            CCCC11: { score: 75, action: 'BUY', bull: ['Desconto patrimonial'], bear: [] },
        },
        idealBuysByClass: {
            STOCK: [],
            FII: [{ ticker: 'DDDD11', name: 'FII Novo', sector: 'Logística', type: 'FII', score: 78, currentPrice: 100, bull: ['FFO yield forte'] }],
            STOCK_US: [],
            CRYPTO: [],
        },
        coveredClasses: ['STOCK', 'FII'],
    };

    const build = (over = {}) =>
        buildRebalancePlan({
            valuation: makeValuation(),
            targetAllocation: baseTargets,
            targetReserve: 0,
            scoreByTicker: engine.scoreByTicker,
            idealBuysByClass: engine.idealBuysByClass,
            coveredClasses: engine.coveredClasses,
            riskProfile: 'MODERATE',
            dataAsOf: new Date('2026-06-01'),
            usdRate: 5,
            ...over,
        });

    it('vende a classe sobrealocada, cortando o pior score primeiro', () => {
        const plan = build();
        // STOCK 70% (meta 50%) → vender ~R$2000. Corta AAAA3 (score 50/WAIT) antes do BBBB3.
        expect(plan.sells).toHaveLength(1);
        expect(plan.sells[0].ticker).toBe('AAAA3');
        expect(plan.sells[0].amount).toBeCloseTo(2000, 0);
        expect(plan.sells[0].estTax).toBeCloseTo(75, 0); // (40-30)*50*0.15
    });

    it('compra na classe subalocada usando o ranking do perfil + reforço', () => {
        const plan = build();
        const buyTickers = plan.buys.map((b) => b.ticker);
        expect(buyTickers).toContain('DDDD11'); // novo top pick do perfil
        expect(buyTickers).toContain('CCCC11'); // reforço do que já é BUY
        const ddd = plan.buys.find((b) => b.ticker === 'DDDD11');
        expect(ddd.kind).toBe('NEW');
        expect(plan.summary.totalBuy).toBeCloseTo(2000, 0);
    });

    it('venda ≈ compra num rebalance neutro (sem aporte de reserva)', () => {
        const plan = build();
        expect(plan.summary.totalSell).toBeCloseTo(plan.summary.totalBuy, 0);
    });

    it('holding sem cobertura quant só é cortado por alocação, com motivo explícito', () => {
        // Remove o score do AAAA3: vira "sem cobertura". STOCK ainda está sobrealocado.
        const scoreByTicker = { BBBB3: engine.scoreByTicker.BBBB3, CCCC11: engine.scoreByTicker.CCCC11 };
        const plan = build({ scoreByTicker });
        const sold = plan.sells.find((s) => s.ticker === 'AAAA3');
        expect(sold).toBeTruthy(); // cortado por alocação (score null = 60, < BBBB3 80)
        expect(sold.reasons.join(' ')).toMatch(/sem cobertura quant/i);
    });

    it('carteira já na meta não gera ordens', () => {
        const valuation = {
            totalEquity: 10000,
            usdRate: 5,
            valueByClass: { STOCK: 5000, FII: 5000, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 },
            assets: [
                holding({ ticker: 'AAAA3', type: 'STOCK', valueBr: 5000, priceBr: 50, priceNative: 50 }),
                holding({ ticker: 'CCCC11', type: 'FII', valueBr: 5000, priceBr: 100, priceNative: 100 }),
            ],
        };
        const plan = build({ valuation });
        expect(plan.sells).toHaveLength(0);
        expect(plan.buys).toHaveLength(0);
        expect(plan.summary.tradeCount).toBe(0);
    });

    it('carteira vazia devolve plano vazio sem quebrar', () => {
        const plan = build({
            valuation: { totalEquity: 0, usdRate: 5, valueByClass: { STOCK: 0, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, OURO: 0, CASH: 0 }, assets: [] },
        });
        expect(plan.summary.tradeCount).toBe(0);
        expect(plan.classGaps).toEqual([]);
    });

    it('meta de Ouro subalocada gera compra de ouro (candidato do ranking GOLD)', () => {
        const valuation = {
            totalEquity: 10000,
            usdRate: 5,
            valueByClass: { STOCK: 5000, FII: 5000, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, OURO: 0, CASH: 0 },
            assets: [
                holding({ ticker: 'AAAA3', type: 'STOCK', valueBr: 5000, priceBr: 50, priceNative: 50 }),
                holding({ ticker: 'CCCC11', type: 'FII', valueBr: 5000, priceBr: 100, priceNative: 100 }),
            ],
        };
        const plan = build({
            valuation,
            // STOCK 50 (ok), FII 40 (sobra 10%), OURO 10 (falta 10%).
            targetAllocation: { STOCK: 50, FII: 40, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, OURO: 10 },
            idealBuysByClass: {
                STOCK: [], FII: [], STOCK_US: [], CRYPTO: [],
                // Candidato de ouro vem do ranking STOCK_US (USD) com sub-tipo GOLD.
                OURO: [{ ticker: 'GLD', name: 'SPDR Gold', sector: 'Commodities', type: 'STOCK_US', usSubType: 'GOLD', score: 75, currentPrice: 200, bull: ['Hedge de portfólio'] }],
            },
            coveredClasses: ['STOCK', 'FII', 'OURO'],
        });
        const goldBuy = plan.buys.find((b) => b.class === 'OURO');
        expect(goldBuy).toBeTruthy();
        expect(goldBuy.ticker).toBe('GLD');
        expect(goldBuy.amount).toBeCloseTo(1000, 0);
        // Preço convertido para BRL (200 USD × 5).
        expect(goldBuy.quantity).toBeCloseTo(1, 1);
    });

    it('sem meta de Ouro, nenhuma ordem de Ouro é gerada (regressão)', () => {
        const plan = build(); // baseTargets não tem OURO
        expect(plan.buys.some((b) => b.class === 'OURO')).toBe(false);
        expect(plan.sells.some((s) => s.class === 'OURO')).toBe(false);
    });

    it('meta de ETF subalocada gera compra de ETF (candidato do ranking STOCK_US sub-tipo ETF)', () => {
        const valuation = {
            totalEquity: 10000,
            usdRate: 5,
            valueByClass: { STOCK: 5000, FII: 5000, STOCK_US: 0, ETF: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 },
            assets: [
                holding({ ticker: 'AAAA3', type: 'STOCK', valueBr: 5000, priceBr: 50, priceNative: 50 }),
                holding({ ticker: 'CCCC11', type: 'FII', valueBr: 5000, priceBr: 100, priceNative: 100 }),
            ],
        };
        const plan = build({
            valuation,
            // STOCK 50 (ok), FII 40 (sobra 10%), ETF 10 (falta 10%).
            targetAllocation: { STOCK: 50, FII: 40, STOCK_US: 0, ETF: 10, CRYPTO: 0, FIXED_INCOME: 0 },
            idealBuysByClass: {
                STOCK: [], FII: [], STOCK_US: [], CRYPTO: [],
                // Candidato de ETF vem do ranking STOCK_US (USD) com sub-tipo ETF.
                ETF: [{ ticker: 'VOO', name: 'Vanguard S&P 500', sector: 'ETF', type: 'STOCK_US', usSubType: 'ETF', score: 80, currentPrice: 100, bull: ['Mercado amplo'] }],
            },
            coveredClasses: ['STOCK', 'FII', 'ETF'],
        });
        const etfBuy = plan.buys.find((b) => b.class === 'ETF');
        expect(etfBuy).toBeTruthy();
        expect(etfBuy.ticker).toBe('VOO');
        expect(etfBuy.amount).toBeCloseTo(1000, 0);
        // Preço convertido para BRL (100 USD × 5 = 500) → 1000 / 500 = 2 cotas.
        expect(etfBuy.quantity).toBeCloseTo(2, 1);
    });
});

// ─── PR3 — ramificação (sub-metas de RF e Exterior) ───────────────────────────
describe('buildRebalancePlan — ramificação por sub-metas', () => {
    // STOCK sobrealocado; classe-alvo (RF ou Exterior) zerada e abaixo da meta.
    const valuationRF = {
        totalEquity: 10000,
        usdRate: 5,
        valueByClass: { STOCK: 10000, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 },
        assets: [
            { ticker: 'AAAA3', type: 'STOCK', sector: null, quantity: 100, currency: 'BRL', valueBr: 10000, priceBr: 100, priceNative: 100, totalCostNative: 8000, taxLots: [{ date: new Date('2023-01-01'), quantity: 100, price: 80 }], multiplier: 1 },
        ],
    };
    const baseArgs = {
        valuation: valuationRF,
        targetReserve: 0,
        scoreByTicker: { AAAA3: { score: 80, action: 'BUY', bull: [], bear: [] } },
        idealBuysByClass: { STOCK: [], FII: [], STOCK_US: [], CRYPTO: [] },
        coveredClasses: ['STOCK'],
        riskProfile: 'MODERATE',
        usdRate: 5,
    };

    it('Renda Fixa: gera item genérico COM subBreakdown quando há sub-metas', () => {
        const plan = buildRebalancePlan({
            ...baseArgs,
            targetAllocation: { STOCK: 50, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 50 },
            targetSubAllocation: { FIXED_INCOME: { IPCA: 70, POS: 30, PRE: 0 } },
        });
        const rf = plan.buys.find((b) => b.class === 'FIXED_INCOME');
        expect(rf).toBeTruthy();
        expect(rf.kind).toBe('GENERIC');
        expect(rf.amount).toBeCloseTo(5000, 0);
        expect(rf.subBreakdown).toHaveLength(2); // PRE=0 omitido
        const bySub = Object.fromEntries(rf.subBreakdown.map((x) => [x.sub, x.amount]));
        expect(bySub.IPCA).toBeCloseTo(3500, 0);
        expect(bySub.POS).toBeCloseTo(1500, 0);
        expect(rf.subBreakdown.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(rf.amount, 0);
    });

    it('Renda Fixa: SEM sub-metas mantém 1 item genérico sem subBreakdown (regressão)', () => {
        const plan = buildRebalancePlan({
            ...baseArgs,
            targetAllocation: { STOCK: 50, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 50 },
            targetSubAllocation: {},
        });
        const rf = plan.buys.filter((b) => b.class === 'FIXED_INCOME');
        expect(rf).toHaveLength(1);
        expect(rf[0].subBreakdown).toBeFalsy();
    });

    it('Exterior: enviesa a compra para o sub-tipo defasado (REIT) ignorando o STOCK de score maior', () => {
        const plan = buildRebalancePlan({
            ...baseArgs,
            targetAllocation: { STOCK: 50, FII: 0, STOCK_US: 50, CRYPTO: 0, FIXED_INCOME: 0 },
            coveredClasses: ['STOCK', 'STOCK_US'],
            idealBuysByClass: {
                STOCK: [], FII: [], CRYPTO: [],
                STOCK_US: [
                    { ticker: 'OREIT', name: 'O', type: 'STOCK_US', usSubType: 'REIT', score: 70, currentPrice: 10, bull: [] },
                    { ticker: 'AAPL', name: 'Apple', type: 'STOCK_US', usSubType: 'STOCK', score: 90, currentPrice: 10, bull: [] },
                ],
            },
            targetSubAllocation: { STOCK_US: { STOCK: 0, ETF: 0, REIT: 100, DOLLAR: 0 } },
        });
        const usBuys = plan.buys.filter((b) => b.class === 'STOCK_US');
        const tickers = usBuys.map((b) => b.ticker);
        expect(tickers).toContain('OREIT');
        expect(tickers).not.toContain('AAPL'); // sub-gap zero → peso 0 → não entra
        const reit = usBuys.find((b) => b.ticker === 'OREIT');
        expect(reit.subLabel).toBe('REITs');
        expect(reit.amount).toBeCloseTo(5000, 0);
    });

    it('venda de RF/Exterior carrega o rótulo de sub-tipo (subLabel)', () => {
        const plan = buildRebalancePlan({
            ...baseArgs,
            valuation: {
                totalEquity: 10000,
                usdRate: 5,
                valueByClass: { STOCK: 0, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 10000, CASH: 0 },
                assets: [
                    { ticker: 'TSIPCA', type: 'FIXED_INCOME', sector: 'Renda Fixa', fixedIncomeIndex: 'IPCA', quantity: 1, currency: 'BRL', valueBr: 10000, priceBr: 10000, priceNative: 10000, totalCostNative: 9000, taxLots: [], multiplier: 1 },
                ],
            },
            targetAllocation: { STOCK: 0, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 50 },
            coveredClasses: [],
            scoreByTicker: {},
        });
        const sell = plan.sells.find((s) => s.ticker === 'TSIPCA');
        expect(sell).toBeTruthy();
        expect(sell.subLabel).toBe('IPCA');
    });
});
