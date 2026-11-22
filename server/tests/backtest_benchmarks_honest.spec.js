/**
 * Backtest do algoritmo: benchmark sem dado é null (não 0), e o CDI é composto
 * por DIA ÚTIL pela curva histórica — não pela taxa de hoje sobre dias corridos.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { seriesReturnBetween, cdiReturnBetween } = await import('../scripts/runBacktestEngine.js');
const { buildCdiCurve } = await import('../utils/cdiCurve.js');

const weekdayOnly = (dayKey) => {
    const dow = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6;
};

describe('cdiReturnBetween', () => {
    it('90 dias corridos ≈ 64 dias úteis: ~3,4% a 14% a.a., não 4,8%', () => {
        const start = new Date('2026-08-24T00:00:00Z');
        const end = new Date('2026-11-22T00:00:00Z'); // 90 dias corridos
        const f = Math.pow(1.14, 1 / 252);
        const rows = [];
        for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
            rows.push({ date: new Date(d), accumulatedFactor: f });
        }
        const curve = buildCdiCurve(rows, { currentRate: 14 });
        const out = cdiReturnBetween(curve, start, end, weekdayOnly);
        const bizDays = rows.filter(r => weekdayOnly(r.date.toISOString().slice(0, 10))).length;
        expect(out).toBeCloseTo((Math.pow(1.14, bizDays / 252) - 1) * 100, 6);
        expect(out).toBeLessThan(4);
        // A conta antiga (dias corridos / 252) dava isto:
        expect((Math.pow(1.14, 90 / 252) - 1) * 100).toBeGreaterThan(4.6);
    });

    it('usa a taxa VIGENTE de cada dia (curva com dois regimes)', () => {
        const rows = [
            { date: new Date('2026-11-16T00:00:00Z'), accumulatedFactor: Math.pow(1.15, 1 / 252) },
            { date: new Date('2026-11-17T00:00:00Z'), accumulatedFactor: Math.pow(1.10, 1 / 252) },
        ];
        const curve = buildCdiCurve(rows, { currentRate: 10 });
        const out = cdiReturnBetween(curve, new Date('2026-11-16T00:00:00Z'), new Date('2026-11-18T00:00:00Z'), weekdayOnly);
        expect(out).toBeCloseTo((Math.pow(1.15, 1 / 252) * Math.pow(1.10, 1 / 252) - 1) * 100, 8);
    });

    it('sem curva → null (não 0, não 10,65% inventado)', () => {
        expect(cdiReturnBetween(null, new Date('2026-01-01'), new Date('2026-02-01'))).toBeNull();
        expect(cdiReturnBetween({ size: 0, annualRateFor: () => 14 }, new Date('2026-01-01'), new Date('2026-02-01'))).toBeNull();
    });
});

describe('seriesReturnBetween', () => {
    const asc = [
        { date: '2026-01-02', close: 100 },
        { date: '2026-02-02', close: 110 },
        { date: '2026-03-02', close: 121 },
    ];

    it('variação entre o primeiro ponto ≥ início e o último ≤ fim', () => {
        expect(seriesReturnBetween(asc, new Date('2026-01-01'), new Date('2026-02-15'))).toBeCloseTo(10, 8);
    });

    it('série vazia ou ausente → null (antes era 0 gravado como medido)', () => {
        expect(seriesReturnBetween([], new Date('2026-01-01'), new Date('2026-02-01'))).toBeNull();
        expect(seriesReturnBetween(null, new Date('2026-01-01'), new Date('2026-02-01'))).toBeNull();
    });

    it('ponto sem fechamento utilizável → null', () => {
        expect(seriesReturnBetween([{ date: '2026-01-02', close: 0 }, { date: '2026-02-02', close: 5 }],
            new Date('2026-01-01'), new Date('2026-03-01'))).toBeNull();
    });
});
