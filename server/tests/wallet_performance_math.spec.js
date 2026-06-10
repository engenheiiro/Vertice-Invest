import { describe, it, expect } from 'vitest';
import { selectAnchorSnapshot, computeLiveQuota, benchmarkStep } from '../utils/mathUtils.js';

describe('selectAnchorSnapshot', () => {
    it('retorna null para lista vazia', () => {
        expect(selectAnchorSnapshot([])).toBeNull();
        expect(selectAnchorSnapshot(null)).toBeNull();
    });

    it('com 1 snapshot retorna o próprio', () => {
        const s = { quotaPrice: 100, totalEquity: 1000 };
        expect(selectAnchorSnapshot([s])).toBe(s);
    });

    it('conta nova (todas as cotas ~100): ancora no MAIS RECENTE', () => {
        const recent = { quotaPrice: 100.21, totalEquity: 10331 };
        const older = { quotaPrice: 100, totalEquity: 10310 };
        // ordem: mais recente -> mais antigo
        expect(selectAnchorSnapshot([recent, older])).toBe(recent);
    });

    it('pula snapshot resetado (~100) quando há histórico válido mais antigo', () => {
        const corrupted = { quotaPrice: 100, totalEquity: 10000 };
        const valid = { quotaPrice: 112.5, totalEquity: 11000 };
        expect(selectAnchorSnapshot([corrupted, valid])).toBe(valid);
    });
});

describe('computeLiveQuota', () => {
    it('sem âncora e sem fluxo retorna 100', () => {
        expect(computeLiveQuota(null, 0, 0)).toBe(100);
    });

    it('paridade KPI × gráfico: mesma âncora/fluxo → mesma cota', () => {
        const anchor = { quotaPrice: 100, totalEquity: 10310 };
        const liveEquity = 10331.65;
        const flow = 0;
        const q = computeLiveQuota(anchor, liveEquity, flow);
        // ~0,21% de retorno → cota ~100,21
        expect(q).toBeGreaterThan(100.1);
        expect(q).toBeLessThan(100.4);
        // TWRR derivado bate com o esperado do KPI
        expect((q / 100 - 1) * 100).toBeCloseTo(0.21, 1);
    });

    it('aporte no período não infla o retorno (Modified Dietz)', () => {
        // Aportou 1000 e o patrimônio subiu ~1000 → retorno ~0.
        const anchor = { quotaPrice: 100, totalEquity: 5000 };
        const q = computeLiveQuota(anchor, 6000, 1000);
        expect(q).toBeCloseTo(100, 0);
    });

    it('circuit breaker: variação absurda mantém a cota anterior', () => {
        const anchor = { quotaPrice: 110, totalEquity: 1000 };
        // retorno > 100% é descartado
        expect(computeLiveQuota(anchor, 5000, 0)).toBe(110);
    });
});

describe('benchmarkStep (cashflow-aware)', () => {
    it('cresce pelo fator do período', () => {
        expect(benchmarkStep(1000, 1.01, 0)).toBe(1010);
    });

    it('recebe o aporte do período sem render sobre ele no mesmo passo', () => {
        expect(benchmarkStep(1000, 1, 500)).toBe(1500);
    });

    it('sequência: aporte cresce no período seguinte', () => {
        let v = 0;
        v = benchmarkStep(v, 1, 1000);   // aporte inicial → 1000
        expect(v).toBe(1000);
        v = benchmarkStep(v, 1.10, 0);   // +10% → 1100
        expect(v).toBe(1100);
        v = benchmarkStep(v, 1.0, 500);  // novo aporte → 1600
        expect(v).toBe(1600);
        v = benchmarkStep(v, 1.10, 0);   // +10% sobre 1600 → 1760
        expect(v).toBeCloseTo(1760, 2);
    });

    it('valores ausentes são tratados com defaults seguros', () => {
        expect(benchmarkStep(undefined, undefined, undefined)).toBe(0);
        expect(benchmarkStep(1000, undefined, 0)).toBe(1000);
    });
});
