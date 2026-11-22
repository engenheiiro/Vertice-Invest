/**
 * Caracterização de buildRebalancePlan: o plano inteiro (valores, ordem das ordens
 * e ordem das chaves) de cenários que exercitam todos os ramos — venda com e sem
 * score, AGUARDAR com tese, rótulos de sub-tipo, compra genérica de Reserva/RF
 * com e sem sub-metas, classe sem ranking, reforço × novo, viés por sub-gap,
 * conversão de dólar e rateio igualitário. Rede para refatorar sem mudar saída.
 * O snapshot é o JSON (string) para travar também a ordem das chaves.
 */
import { describe, it, expect } from 'vitest';
import { buildRebalancePlan } from '../services/rebalanceService.js';

const holding = (over = {}) => ({
    ticker: 'AAAA3', type: 'STOCK', sector: null, quantity: 100, currency: 'BRL',
    valueBr: 1000, priceBr: 10, priceNative: 10, totalCostNative: 800,
    taxLots: [{ date: new Date('2023-01-01'), quantity: 100, price: 8 }], multiplier: 1,
    ...over,
});

const plan = (args) => JSON.stringify(buildRebalancePlan(args), null, 1);

describe('buildRebalancePlan — caracterização (plano completo)', () => {
    it('venda: sem score, AGUARDAR com tese, BUY acima da meta; rótulos RF/Exterior/ETF nacional', () => {
        const out = plan({
            valuation: {
                totalEquity: 100000,
                valueByClass: { STOCK: 60000, FII: 0, STOCK_US: 20000, CRYPTO: 0, FIXED_INCOME: 20000, CASH: 0 },
                assets: [
                    holding({ ticker: 'NULL3', valueBr: 15000, priceBr: 15 }),
                    holding({ ticker: 'WAIT3', valueBr: 15000, priceBr: 30 }),
                    holding({ ticker: 'GOOD3', valueBr: 15000, priceBr: 0 }),
                    holding({ ticker: 'BOVA11', rawType: 'ETF', valueBr: 15000, priceBr: 100 }),
                    holding({ ticker: 'CDB1', type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA', fixedIncomeRate: 6, valueBr: 20000, priceBr: 1 }),
                    holding({ ticker: 'O', type: 'STOCK_US', usSubType: 'REIT', currency: 'USD', valueBr: 20000, priceBr: 300, multiplier: 5 }),
                ],
            },
            targetAllocation: { STOCK: 20, FII: 30, STOCK_US: 0, CRYPTO: 30, FIXED_INCOME: 10, ETF: 0 },
            targetReserve: 10000,
            scoreByTicker: {
                WAIT3: { score: 50, action: 'WAIT', bull: [], bear: ['Margem em queda'] },
                GOOD3: { score: 85, action: 'BUY', bull: ['ROE alto'], bear: [] },
                BOVA11: { score: 72, action: 'BUY', bull: [], bear: [] },
                O: { score: 40, action: 'WAIT', bull: [], bear: [] },
            },
            idealBuysByClass: {
                FII: [
                    { ticker: 'HGLG11', type: 'FII', score: 80, currentPrice: 160, bull: ['Vacância baixa'] },
                    { ticker: 'XPLG11', type: 'FII', score: 70, currentPrice: 100, bull: [] },
                ],
            },
            coveredClasses: ['STOCK', 'FII', 'STOCK_US'],
            riskProfile: 'MODERATE',
            dataAsOf: new Date('2026-06-01T00:00:00Z'),
            usdRate: 5,
        });
        expect(out).toMatchSnapshot();
    });

    it('compra: sub-metas em Ações BR (ETF nacional) e Exterior, dólar convertido, RF com sub-metas, classe sem candidato', () => {
        const out = plan({
            valuation: {
                totalEquity: 50000,
                valueByClass: { STOCK: 5000, FII: 45000, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 },
                assets: [
                    holding({ ticker: 'ITUB4', valueBr: 5000, priceBr: 25 }),
                    holding({ ticker: 'KNRI11', type: 'FII', valueBr: 45000, priceBr: 150 }),
                ],
            },
            targetAllocation: { STOCK: 30, FII: 10, STOCK_US: 30, CRYPTO: 10, FIXED_INCOME: 20, ETF: 5 },
            targetSubAllocation: {
                STOCK: { STOCK: 50, ETF: 50 },
                STOCK_US: { STOCK: 60, REIT: 40, ETF: 0, DOLLAR: 0 },
                FIXED_INCOME: { IPCA: 70, POS: 30, PRE: 0 },
            },
            targetReserve: 0,
            scoreByTicker: {
                ITUB4: { score: 78, action: 'BUY', bull: ['Banco sólido'], bear: [] },
                KNRI11: { score: 60, action: 'WAIT', bull: [], bear: [] },
            },
            idealBuysByClass: {
                STOCK: [
                    { ticker: 'ITUB4', type: 'STOCK', score: 78, currentPrice: 25, bull: [] },
                    { ticker: 'WEGE3', type: 'STOCK', score: 82, currentPrice: 40, bull: ['Crescimento'] },
                ],
                ETF: [{ ticker: 'BOVA11', type: 'ETF', score: 75, currentPrice: 120, currency: 'BRL', bull: [] }],
                STOCK_US: [
                    { ticker: 'AAPL', type: 'STOCK_US', usSubType: 'STOCK', score: 88, currentPrice: 200, currency: 'USD', bull: ['Caixa'] },
                    { ticker: 'IVVB11', type: 'ETF', usSubType: 'ETF', score: 70, currentPrice: 300, currency: 'BRL', bull: [] },
                    { ticker: 'PLD', type: 'STOCK_US', usSubType: 'REIT', score: 65, currentPrice: 110, bull: [] },
                ],
                CRYPTO: [],
            },
            coveredClasses: ['STOCK', 'ETF', 'STOCK_US', 'CRYPTO'],
            riskProfile: 'BOLD',
            usdRate: 5.5,
        });
        expect(out).toMatchSnapshot();
    });

    it('compra sem sub-metas, pesos todos zero (rateio igualitário) e classe fora de cobertura', () => {
        const out = plan({
            valuation: {
                totalEquity: 10000,
                valueByClass: { STOCK: 10000 },
                assets: [holding({ ticker: 'AAAA3', valueBr: 10000, priceBr: 100 })],
            },
            targetAllocation: { STOCK: 40, FII: 30, STOCK_US: 0, CRYPTO: 30, FIXED_INCOME: 0 },
            targetReserve: 0,
            scoreByTicker: { AAAA3: { score: 90, action: 'BUY', bull: [], bear: [] } },
            idealBuysByClass: {
                FII: [
                    { ticker: 'ZERO11', type: 'FII', score: 0, currentPrice: 0, bull: [] },
                    { ticker: 'NADA11', type: 'FII', score: 0, currentPrice: 10, bull: [] },
                ],
                CRYPTO: [{ ticker: 'BTC', type: 'CRYPTO', score: 90, currentPrice: 1, bull: [] }],
            },
            coveredClasses: ['FII'],
            riskProfile: 'DEFENSIVE',
            usdRate: 5,
        });
        expect(out).toMatchSnapshot();
    });

    it('patrimônio zero devolve o plano vazio', () => {
        const out = plan({
            valuation: { totalEquity: 0, valueByClass: {}, assets: [] },
            targetAllocation: { STOCK: 100 },
            targetReserve: 0,
            scoreByTicker: {},
            idealBuysByClass: {},
            coveredClasses: null,
            riskProfile: 'MODERATE',
        });
        expect(out).toMatchSnapshot();
    });
});
