/**
 * Benchmark CDI do gráfico da carteira: taxa vigente no dia pela curva da série
 * SELIC, e a tabela anual cobrindo todo ano já FECHADO (2025 caía no legado de
 * 10% e encolhia o CDI contra a carteira).
 */
import { describe, it, expect } from 'vitest';
import { HISTORICAL_CDI_RATES } from '../config/financialConstants.js';
import { buildCdiCurve } from '../utils/cdiCurve.js';
import { getDailyFactorForDate } from '../controllers/walletController.js';

const factorFor = (annual) => Math.pow(1 + annual / 100, 1 / 252);

describe('HISTORICAL_CDI_RATES', () => {
    it('cobre todo ano-calendário já encerrado', () => {
        const lastClosedYear = new Date().getUTCFullYear() - 1;
        for (let y = 2015; y <= lastClosedYear; y++) {
            expect(HISTORICAL_CDI_RATES[y], `CDI de ${y} ausente`).toBeGreaterThan(0);
        }
    });
});

describe('getDailyFactorForDate', () => {
    it('usa a taxa gravada na curva para o dia', () => {
        const curve = buildCdiCurve([{ date: new Date('2026-03-10T00:00:00Z'), accumulatedFactor: factorFor(14.15) }], { currentRate: 13.65 });
        const f = getDailyFactorForDate(new Date('2026-03-10T00:00:00Z'), 13.65, curve);
        expect(f).toBeCloseTo(factorFor(14.15), 10);
    });

    it('sem a curva, ano fechado usa a tabela (2025 não cai mais nos 10%)', () => {
        const f = getDailyFactorForDate(new Date('2025-08-01T00:00:00Z'), 13.65);
        expect(f).toBeCloseTo(factorFor(HISTORICAL_CDI_RATES[2025]), 10);
        expect(f).toBeGreaterThan(factorFor(10));
    });
});
