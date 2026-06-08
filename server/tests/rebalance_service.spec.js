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
            valuation: { totalEquity: 0, usdRate: 5, valueByClass: { STOCK: 0, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 }, assets: [] },
        });
        expect(plan.summary.tradeCount).toBe(0);
        expect(plan.classGaps).toEqual([]);
    });
});
