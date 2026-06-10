import { describe, it, expect } from 'vitest';
import { countBusinessDays } from '../utils/dateUtils.js';
import {
    fixedIncomeDailyFactor,
    accrueFixedIncomeValue,
    brazilToday,
    brazilDateOnly,
} from '../utils/fixedIncome.js';

const CDI = 14.4;
const cdiDaily = Math.pow(1 + CDI / 100, 1 / 252); // ~1.000533

describe('fixedIncomeDailyFactor', () => {
    it('taxa 0 → padrão 100% do CDI', () => {
        expect(fixedIncomeDailyFactor(0, CDI)).toBeCloseTo(cdiDaily, 8);
    });

    it('taxa 100 → 100% do CDI (igual ao padrão)', () => {
        expect(fixedIncomeDailyFactor(100, CDI)).toBeCloseTo(cdiDaily, 8);
    });

    it('taxa 110 → 110% do CDI (rende mais que o CDI cheio)', () => {
        const f110 = fixedIncomeDailyFactor(110, CDI);
        expect(f110).toBeGreaterThan(cdiDaily);
        expect(f110 - 1).toBeCloseTo((cdiDaily - 1) * 1.1, 8);
    });

    it('taxa <= 50 → prefixada a.a.', () => {
        expect(fixedIncomeDailyFactor(12, CDI)).toBeCloseTo(Math.pow(1.12, 1 / 252), 8);
    });
});

describe('accrueFixedIncomeValue (CASH)', () => {
    it('lote comprado HOJE não rende (dias úteis = 0)', () => {
        const calcDate = brazilToday();
        const asset = { type: 'CASH', quantity: 1000, totalCost: 1000, fixedIncomeRate: 0, taxLots: [{ date: calcDate, quantity: 1000, price: 1 }] };
        expect(accrueFixedIncomeValue(asset, { cdiRate: CDI, calcDate })).toBeCloseTo(1000, 6);
    });

    it('acumula quantity × fator^dias úteis (100% CDI)', () => {
        const calcDate = new Date('2026-06-17T00:00:00.000Z'); // Qua
        const lotDate = new Date('2026-06-15T00:00:00.000Z');  // Seg
        const bd = countBusinessDays(lotDate, calcDate);
        expect(bd).toBeGreaterThan(0);
        const asset = { type: 'CASH', quantity: 10000, totalCost: 10000, fixedIncomeRate: 0, taxLots: [{ date: lotDate, quantity: 10000, price: 1 }] };
        const expected = 10000 * Math.pow(cdiDaily, bd);
        expect(accrueFixedIncomeValue(asset, { cdiRate: CDI, calcDate })).toBeCloseTo(expected, 4);
    });

    it('soma múltiplos lotes (datas diferentes)', () => {
        const calcDate = new Date('2026-06-17T00:00:00.000Z');
        const lotA = new Date('2026-06-15T00:00:00.000Z');
        const lotB = new Date('2026-06-16T00:00:00.000Z');
        const asset = { type: 'CASH', quantity: 1500, totalCost: 1500, fixedIncomeRate: 0, taxLots: [
            { date: lotA, quantity: 1000, price: 1 },
            { date: lotB, quantity: 500, price: 1 },
        ] };
        const expected = 1000 * Math.pow(cdiDaily, countBusinessDays(lotA, calcDate))
                       + 500 * Math.pow(cdiDaily, countBusinessDays(lotB, calcDate));
        expect(accrueFixedIncomeValue(asset, { cdiRate: CDI, calcDate })).toBeCloseTo(expected, 4);
    });

    it('sem taxLots usa quantity/startDate (fallback)', () => {
        const calcDate = new Date('2026-06-17T00:00:00.000Z');
        const startDate = new Date('2026-06-15T00:00:00.000Z');
        const bd = countBusinessDays(startDate, calcDate);
        const asset = { type: 'CASH', quantity: 2000, totalCost: 2000, fixedIncomeRate: 0, startDate };
        expect(accrueFixedIncomeValue(asset, { cdiRate: CDI, calcDate })).toBeCloseTo(2000 * Math.pow(cdiDaily, bd), 4);
    });
});

describe('accrueFixedIncomeValue (FIXED_INCOME)', () => {
    it('usa quantity × price × fator (prefixado)', () => {
        const calcDate = new Date('2026-06-17T00:00:00.000Z');
        const lotDate = new Date('2026-06-15T00:00:00.000Z');
        const bd = countBusinessDays(lotDate, calcDate);
        const rateDaily = Math.pow(1.12, 1 / 252);
        const asset = { type: 'FIXED_INCOME', quantity: 10, totalCost: 1000, fixedIncomeRate: 12, taxLots: [{ date: lotDate, quantity: 10, price: 100 }] };
        const expected = 10 * 100 * Math.pow(rateDaily, bd);
        expect(accrueFixedIncomeValue(asset, { cdiRate: CDI, calcDate })).toBeCloseTo(expected, 4);
    });
});

describe('helpers de data (fuso SP)', () => {
    it('brazilToday retorna meia-noite UTC de um dia puro', () => {
        const t = brazilToday();
        expect(t.getUTCHours()).toBe(0);
        expect(t.getUTCMinutes()).toBe(0);
        expect(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(t.toISOString())).toBe(true);
    });

    it('brazilDateOnly preserva data pura (sem shift)', () => {
        const d = new Date('2026-06-09T00:00:00.000Z');
        expect(brazilDateOnly(d).toISOString().split('T')[0]).toBe('2026-06-09');
    });

    it('brazilDateOnly converte horário noturno UTC para o dia BR correto', () => {
        // 2026-06-10 02:00 UTC = 2026-06-09 23:00 em São Paulo → dia BR = 09.
        const d = new Date('2026-06-10T02:00:00.000Z');
        expect(brazilDateOnly(d).toISOString().split('T')[0]).toBe('2026-06-09');
    });
});
