/**
 * Mapeamento puro quoteSummary → fundamentos (`fundamentals/yahooFundamentalsMapper`):
 * o que a fonte não trouxe fica de fora, e 0 só conta onde 0 é dado.
 */
import { describe, it, expect } from 'vitest';
import { extractFundamentals, assignKnownFundamentals } from '../services/fundamentals/yahooFundamentalsMapper.js';

describe('extractFundamentals', () => {
    it('resposta vazia: todo campo null, nada inventado', () => {
        const f = extractFundamentals('X', {});
        expect(Object.values(f).every(v => v === null)).toBe(true);
    });

    it('beta e preço caem no segundo módulo; liquidez é volume × preço', () => {
        const f = extractFundamentals('X', {
            summaryDetail: { beta: 1.2, regularMarketPrice: 10, averageVolume: 300 },
            defaultKeyStatistics: { beta: 0 },
        });
        expect(f.beta).toBe(1.2);
        expect(f.lastPrice).toBe(10);
        expect(f.avgLiquidity).toBe(3000);
    });

    it('PEG só com P/L e crescimento positivo', () => {
        const base = { summaryDetail: { trailingPE: 20 } };
        expect(extractFundamentals('X', { ...base, financialData: { earningsGrowth: 0.1 } }).peg).toBe(2);
        expect(extractFundamentals('X', { ...base, financialData: { earningsGrowth: -0.1 } }).peg).toBeNull();
    });
});

describe('assignKnownFundamentals', () => {
    it('null fica fora; 0 entra em campo "present" e não em marketCap/liquidez', () => {
        const payload = assignKnownFundamentals({ type: 'STOCK_US' }, {
            pl: null, dy: 0, marketCap: 0, avgLiquidity: 0, payoutRatio: 12, peg: null,
        });
        expect(payload).toEqual({ type: 'STOCK_US', dy: 0, payout: 12 });
    });
});
