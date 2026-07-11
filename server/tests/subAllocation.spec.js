/**
 * Ramificação (sub-metas) — funções puras de server/utils/subAllocation.js.
 * Sem Mongo/Express: mapeamento de sub-tipo, agregação por sub-tipo, rateio por
 * sub-meta (RF) e sub-gap (Exterior).
 */
import { describe, it, expect } from 'vitest';
import {
    fixedIncomeSubKey, usSubKeyOf, hasSubMetas,
    currentValueBySub, splitNeedBySubMeta, subGaps,
    FI_SUB_KEYS, US_SUB_KEYS,
} from '../utils/subAllocation.js';

describe('fixedIncomeSubKey', () => {
    it('mapeia índice explícito → IPCA/POS/PRE', () => {
        expect(fixedIncomeSubKey('IPCA')).toBe('IPCA');
        expect(fixedIncomeSubKey('SELIC')).toBe('POS');
        expect(fixedIncomeSubKey('CDI')).toBe('POS');
        expect(fixedIncomeSubKey('PRE')).toBe('PRE');
    });

    it('sem índice (%CDI manual): rate > 50 → POS; ≤ 50 → PRE; ausente → POS (espelha o accrual)', () => {
        expect(fixedIncomeSubKey(null, 100)).toBe('POS'); // 100% do CDI → pós-fixado
        expect(fixedIncomeSubKey(null, 110)).toBe('POS');
        expect(fixedIncomeSubKey(null, 12)).toBe('PRE');  // 12% a.a. → prefixado legado
        expect(fixedIncomeSubKey(null)).toBe('POS');      // rate ausente cai em 100 (%CDI)
    });
});

describe('usSubKeyOf', () => {
    it('usa o sub-tipo válido; ETF e ouro lastreado → ETF; null/desconhecido → STOCK', () => {
        expect(usSubKeyOf('REIT')).toBe('REIT');
        expect(usSubKeyOf('DOLLAR')).toBe('DOLLAR');
        expect(usSubKeyOf('ETF')).toBe('ETF');
        expect(usSubKeyOf('GOLD')).toBe('ETF'); // ouro lastreado conta como ETF do Exterior
        expect(usSubKeyOf(null)).toBe('STOCK');
        expect(usSubKeyOf('XYZ')).toBe('STOCK');
    });
});

describe('hasSubMetas', () => {
    it('true quando há alguma sub-meta > 0', () => {
        expect(hasSubMetas({ IPCA: 0, POS: 0, PRE: 0 })).toBe(false);
        expect(hasSubMetas({ IPCA: 68, POS: 32, PRE: 0 })).toBe(true);
        expect(hasSubMetas(undefined)).toBe(false);
    });
});

describe('currentValueBySub', () => {
    it('agrega RF por índice contratado', () => {
        const holdings = [
            { type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA', valueBr: 6800 },
            { type: 'FIXED_INCOME', fixedIncomeIndex: 'SELIC', valueBr: 2000 },
            { type: 'FIXED_INCOME', fixedIncomeIndex: 'CDI', valueBr: 1200 },
            { type: 'STOCK', valueBr: 9999 }, // ignorado
        ];
        const v = currentValueBySub(holdings, 'FIXED_INCOME');
        expect(v.IPCA).toBe(6800);
        expect(v.POS).toBe(3200);
        expect(v.PRE).toBe(0);
    });

    it('CDB %CDI manual (sem índice, rate > 50) agrega em pós-fixado, não prefixado', () => {
        const holdings = [
            { type: 'FIXED_INCOME', fixedIncomeIndex: null, fixedIncomeRate: 100, valueBr: 7000 }, // 100% CDI → POS
            { type: 'FIXED_INCOME', fixedIncomeIndex: null, fixedIncomeRate: 12, valueBr: 3000 },  // 12% a.a. → PRE
        ];
        const v = currentValueBySub(holdings, 'FIXED_INCOME');
        expect(v.POS).toBe(7000);
        expect(v.PRE).toBe(3000);
        expect(v.IPCA).toBe(0);
    });

    it('agrega Exterior por usSubType; ETFs internacionais e ouro lastreado → sub-tipo ETF', () => {
        const holdings = [
            { type: 'STOCK_US', usSubType: 'REIT', valueBr: 200 },
            { type: 'STOCK_US', usSubType: 'DOLLAR', valueBr: 300 },
            { type: 'STOCK_US', usSubType: 'ETF', valueBr: 100 },   // ETF internacional → ETF
            { type: 'STOCK_US', usSubType: 'GOLD', valueBr: 50 },   // ouro lastreado → ETF
            { type: 'STOCK_US', usSubType: null, valueBr: 500 },
            { type: 'ETF', valueBr: 999 },                          // ETF nacional: classe própria, ignorado
        ];
        const v = currentValueBySub(holdings, 'STOCK_US');
        expect(v.STOCK).toBe(500);
        expect(v.REIT).toBe(200);
        expect(v.DOLLAR).toBe(300);
        expect(v.ETF).toBe(150); // 100 + 50
    });
});

describe('splitNeedBySubMeta', () => {
    it('rateia proporcionalmente às sub-metas e conserva o total', () => {
        const out = splitNeedBySubMeta(1000, { IPCA: 68, POS: 32, PRE: 0 }, FI_SUB_KEYS);
        const bySub = Object.fromEntries(out.map((x) => [x.sub, x.amount]));
        expect(bySub.IPCA).toBeCloseTo(680, 2);
        expect(bySub.POS).toBeCloseTo(320, 2);
        expect(bySub.PRE).toBeUndefined(); // 0 → omitido
        expect(out.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1000, 2);
    });

    it('sem sub-metas ou need ≤ 0 → vazio', () => {
        expect(splitNeedBySubMeta(1000, { IPCA: 0, POS: 0, PRE: 0 }, FI_SUB_KEYS)).toEqual([]);
        expect(splitNeedBySubMeta(0, { IPCA: 68, POS: 32, PRE: 0 }, FI_SUB_KEYS)).toEqual([]);
    });
});

describe('subGaps', () => {
    it('só gaps positivos contam (sub-tipo defasado)', () => {
        // Classe-alvo 10.000. Meta REIT 20% = 2.000; já tem 2.500 → gap 0.
        // DOLLAR 30% = 3.000; tem 1.000 → gap 2.000. STOCK 50% = 5.000; tem 0 → gap 5.000.
        const g = subGaps(10000, { STOCK: 0, REIT: 2500, DOLLAR: 1000 },
            { STOCK: 50, REIT: 20, DOLLAR: 30 }, US_SUB_KEYS);
        expect(g.STOCK).toBe(5000);
        expect(g.DOLLAR).toBe(2000);
        expect(g.REIT).toBe(0);
        expect(g.ETF).toBe(0); // sem meta/valor de ETF → gap 0
    });

    it('sub-gap do Exterior inclui o sub-tipo ETF', () => {
        // Classe-alvo 10.000. Meta ETF 40% = 4.000 (tem 1.000 → gap 3.000);
        // STOCK 60% = 6.000 (tem 6.000 → gap 0).
        const g = subGaps(10000, { STOCK: 6000, REIT: 0, ETF: 1000, DOLLAR: 0 },
            { STOCK: 60, REIT: 0, ETF: 40, DOLLAR: 0 }, US_SUB_KEYS);
        expect(g.STOCK).toBe(0);
        expect(g.ETF).toBe(3000);
    });
});
