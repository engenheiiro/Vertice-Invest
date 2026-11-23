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

// Regra 13: todo número do Yahoo passa por um leitor só (número finito ou
// `{ raw: finito }`); texto, objeto sem raw, NaN e ±Infinity viram null.
describe('extractFundamentals — leitor único de número (regressões)', () => {
    const LIXO = ['1.5', { fmt: '1.5' }, { raw: NaN }, { raw: '2' }, NaN, Infinity, -Infinity];

    it('pvp/beta/vpa com texto, objeto sem raw ou não finito saem null (eram gravados por serem truthy)', () => {
        for (const lixo of LIXO) {
            const f = extractFundamentals('X', {
                defaultKeyStatistics: { priceToBook: lixo, beta: lixo, bookValue: lixo },
                summaryDetail: { beta: lixo },
            });
            expect([f.pvp, f.beta, f.vpa]).toEqual([null, null, null]);
        }
    });

    it('pvp/beta/vpa em `{ raw }` são lidos pelo número (era o objeto cru)', () => {
        const f = extractFundamentals('X', {
            defaultKeyStatistics: { priceToBook: { raw: 2.5, fmt: '2.5' }, beta: { raw: -0.3 }, bookValue: { raw: -12 } },
        });
        expect([f.pvp, f.beta, f.vpa]).toEqual([2.5, -0.3, -12]);
    });

    it('beta, pvp e vpa negativos reais ficam (patrimônio negativo é dado)', () => {
        const f = extractFundamentals('X', { defaultKeyStatistics: { priceToBook: -3, beta: -0.4, bookValue: -8 } });
        expect([f.pvp, f.beta, f.vpa]).toEqual([-3, -0.4, -8]);
    });

    it('debtToEquity em texto sai null (dividia "47.49" por 100 e gravava 0,4749)', () => {
        expect(extractFundamentals('X', { financialData: { debtToEquity: '47.49' } }).debtToEquity).toBeNull();
    });

    it('debtToEquity em `{ raw }` vira razão (dava NaN)', () => {
        expect(extractFundamentals('X', { financialData: { debtToEquity: { raw: 47.49 } } }).debtToEquity).toBeCloseTo(0.4749, 10);
    });

    it('ROE/margem/crescimentos/payout iguais a 0 são gravados como 0 (viravam null)', () => {
        const f = extractFundamentals('X', {
            financialData: { returnOnEquity: 0, profitMargins: 0, revenueGrowth: 0, earningsGrowth: 0 },
            summaryDetail: { payoutRatio: 0 },
        });
        expect([f.roe, f.netMargin, f.revenueGrowth, f.earningsGrowth, f.payoutRatio]).toEqual([0, 0, 0, 0, 0]);
    });

    it('ROE/margem/crescimentos/payout Infinity ou texto saem null (Infinity passava)', () => {
        for (const lixo of LIXO) {
            const f = extractFundamentals('X', {
                financialData: { returnOnEquity: lixo, profitMargins: lixo, revenueGrowth: lixo, earningsGrowth: lixo },
                summaryDetail: { payoutRatio: lixo },
            });
            expect([f.roe, f.netMargin, f.revenueGrowth, f.earningsGrowth, f.payoutRatio]).toEqual([null, null, null, null, null]);
        }
    });

    it('DY negativo do Yahoo não é gravado (era aceito)', () => {
        expect(extractFundamentals('X', { summaryDetail: { dividendYield: -0.02 } }).dy).toBeNull();
        expect(extractFundamentals('X', { summaryDetail: { yield: { raw: 0.05 } } }).dy).toBe(5);
    });

    it('avgLiquidity não finita ou negativa sai null (era gravada)', () => {
        const liq = (sd) => extractFundamentals('X', { summaryDetail: { regularMarketPrice: 10, ...sd } }).avgLiquidity;
        expect(liq({ averageVolume: Infinity })).toBeNull();
        expect(liq({ averageVolume: -300 })).toBeNull();
        expect(liq({ averageVolume: '300' })).toBeNull();
    });
});
