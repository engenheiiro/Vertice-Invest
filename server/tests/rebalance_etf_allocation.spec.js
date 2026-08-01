import { afterEach, describe, expect, it, vi } from 'vitest';
import MarketAnalysis from '../models/MarketAnalysis.js';
import { buildRebalancePlan, loadEngineData } from '../services/rebalanceService.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('rebalanceamento de ETF B3 com exposição internacional', () => {
    it('move IVVB11 do ranking ETF para os candidatos de Exterior', async () => {
        const analyses = {
            ETF: {
                createdAt: new Date('2026-07-31T12:00:00Z'),
                content: {
                    fullAuditLog: [],
                    ranking: [
                        {
                            ticker: 'IVVB11', name: 'iShares S&P 500', sector: 'Exterior (S&P 500)',
                            type: 'ETF', currency: 'BRL', riskProfile: 'MODERATE', action: 'BUY',
                            score: 82, currentPrice: 400, bullThesis: ['Exposição global'],
                        },
                        {
                            ticker: 'BOVA11', name: 'iShares Ibovespa', sector: 'Índice Amplo',
                            type: 'ETF', currency: 'BRL', riskProfile: 'MODERATE', action: 'BUY',
                            score: 75, currentPrice: 120, bullThesis: ['Mercado brasileiro'],
                        },
                    ],
                },
            },
        };

        vi.spyOn(MarketAnalysis, 'findOne').mockImplementation(({ assetClass }) => ({
            sort: () => ({
                select: () => ({
                    lean: () => Promise.resolve(analyses[assetClass] || null),
                }),
            }),
        }));

        const result = await loadEngineData('MODERATE');

        expect(result.idealBuysByClass.STOCK_US).toEqual([
            expect.objectContaining({
                ticker: 'IVVB11', type: 'ETF', currency: 'BRL',
                allocationClass: 'STOCK_US', usSubType: 'ETF',
            }),
        ]);
        expect(result.idealBuysByClass.ETF).toEqual([
            expect.objectContaining({ ticker: 'BOVA11', allocationClass: 'STOCK' }),
        ]);
    });

    it('compra IVVB11 em Exterior sem aplicar câmbio novamente sobre o preço em BRL', () => {
        const valuation = {
            totalEquity: 10000,
            usdRate: 5,
            valueByClass: {
                STOCK: 5000, FII: 5000, STOCK_US: 0, CRYPTO: 0,
                FIXED_INCOME: 0, OURO: 0, CASH: 0,
            },
            assets: [
                {
                    ticker: 'AAAA3', type: 'STOCK', rawType: 'STOCK', quantity: 100,
                    currency: 'BRL', valueBr: 5000, priceBr: 50, priceNative: 50,
                    totalCostNative: 4500, taxLots: [], multiplier: 1,
                },
                {
                    ticker: 'CCCC11', type: 'FII', rawType: 'FII', quantity: 50,
                    currency: 'BRL', valueBr: 5000, priceBr: 100, priceNative: 100,
                    totalCostNative: 4500, taxLots: [], multiplier: 1,
                },
            ],
        };

        const plan = buildRebalancePlan({
            valuation,
            targetAllocation: {
                STOCK: 50, FII: 40, STOCK_US: 10, CRYPTO: 0,
                FIXED_INCOME: 0, OURO: 0,
            },
            targetReserve: 0,
            scoreByTicker: {
                AAAA3: { score: 80, action: 'BUY', bull: [], bear: [] },
                CCCC11: { score: 75, action: 'BUY', bull: [], bear: [] },
            },
            idealBuysByClass: {
                STOCK: [], FII: [], ETF: [], CRYPTO: [], OURO: [],
                STOCK_US: [{
                    ticker: 'IVVB11', name: 'iShares S&P 500', type: 'ETF',
                    allocationClass: 'STOCK_US', currency: 'BRL', usSubType: 'ETF',
                    score: 82, currentPrice: 100, bull: ['Exposição global'],
                }],
            },
            // A cobertura ETF também deve habilitar os candidatos locais em Exterior.
            coveredClasses: ['STOCK', 'FII', 'ETF'],
            riskProfile: 'MODERATE',
            dataAsOf: new Date('2026-07-31T12:00:00Z'),
            usdRate: 5,
        });

        const buy = plan.buys.find((item) => item.ticker === 'IVVB11');
        expect(buy).toBeTruthy();
        expect(buy.class).toBe('STOCK_US');
        expect(buy.subLabel).toBe('ETFs');
        expect(buy.amount).toBeCloseTo(1000, 0);
        // R$ 1.000 / R$ 100 = 10 cotas. Se multiplicasse pelo dólar novamente, seriam 2.
        expect(buy.quantity).toBeCloseTo(10, 1);
    });
});
