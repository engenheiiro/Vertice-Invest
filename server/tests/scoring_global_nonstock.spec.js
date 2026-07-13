import { describe, expect, it } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CONTEXT = {
    MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, NTNB_LONG: 6.4 },
};

const makeUsNonStock = (usSubType) => ({
    ticker: usSubType === 'GOLD' ? 'GLD' : usSubType === 'REIT' ? 'O' : 'SPY',
    type: 'STOCK_US',
    usSubType,
    name: `US ${usSubType}`,
    sector: usSubType === 'REIT' ? 'Real Estate' : usSubType === 'GOLD' ? 'Commodity' : 'ETF',
    price: 100,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        pl: 0,
        pvp: 1,
        roe: 0,
        roic: 0,
        netMargin: 0,
        evEbitda: 0,
        revenueGrowth: 0,
        debtToEquity: usSubType === 'REIT' ? 1 : 0,
        netDebt: 0,
        payout: 0,
        dy: usSubType === 'REIT' ? 6 : 2,
        marketCap: 100_000_000_000,
        avgLiquidity: 60_000_000,
        vacancy: 0,
        capRate: 0,
        qtdImoveis: 0,
        volatility: usSubType === 'GOLD' ? 15 : 18,
        beta: 1,
        sma200: 95,
        ema50: 98,
        _missing: {},
        _staleDays: 20,
    },
});

describe('scoringEngine — ativos globais não-ação', () => {
    it('ETF ignora valuation de empresa e usa preço de mercado como alvo', () => {
        const result = scoringEngine.processAsset(makeUsNonStock('ETF'), CONTEXT);

        expect(result._discarded).toBeUndefined();
        expect(result.targetPrice).toBe(100);
        expect(result.metrics.method).toBe('Mercado');
        expect(result.auditLog.some((entry) => entry.factor.startsWith('ETF:'))).toBe(true);
    });

    it('REIT usa Bazin de renda e produz auditoria específica do veículo', () => {
        const result = scoringEngine.processAsset(makeUsNonStock('REIT'), CONTEXT);

        expect(result._discarded).toBeUndefined();
        expect(result.metrics.method).toBe('Bazin (REIT)');
        expect(result.targetPrice).toBeCloseTo(100, 2);
        expect(result.auditLog.some((entry) => entry.factor.startsWith('REIT:'))).toBe(true);
    });

    it('ouro usa o modelo de commodity, sem fundamentos de empresa', () => {
        const result = scoringEngine.processAsset(makeUsNonStock('GOLD'), CONTEXT);

        expect(result._discarded).toBeUndefined();
        expect(result.targetPrice).toBe(100);
        expect(result.metrics.method).toBe('Mercado');
        expect(result.auditLog.some((entry) => entry.factor.startsWith('Ouro:'))).toBe(true);
    });
});
