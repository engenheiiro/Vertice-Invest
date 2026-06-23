/**
 * Ramificação (sub-metas) — funções puras de server/utils/subAllocation.js.
 * Sem Mongo/Express: mapeamento de sub-tipo, agregação por sub-tipo, rateio por
 * sub-meta (RF) e sub-gap (Exterior).
 */
import { describe, it, expect } from 'vitest';
import {
    fixedIncomeSubKey, usSubKeyOf, etfSubKeyOf, resolveAllocClass, hasSubMetas,
    currentValueBySub, splitNeedBySubMeta, subGaps,
    FI_SUB_KEYS, US_SUB_KEYS, ETF_SUB_KEYS,
} from '../utils/subAllocation.js';

describe('fixedIncomeSubKey', () => {
    it('mapeia índice → IPCA/POS/PRE (legado → PRE)', () => {
        expect(fixedIncomeSubKey('IPCA')).toBe('IPCA');
        expect(fixedIncomeSubKey('SELIC')).toBe('POS');
        expect(fixedIncomeSubKey('CDI')).toBe('POS');
        expect(fixedIncomeSubKey('PRE')).toBe('PRE');
        expect(fixedIncomeSubKey(null)).toBe('PRE');
    });
});

describe('usSubKeyOf', () => {
    it('usa o sub-tipo válido; null/desconhecido → STOCK', () => {
        expect(usSubKeyOf('REIT')).toBe('REIT');
        expect(usSubKeyOf('DOLLAR')).toBe('DOLLAR');
        // ETF deixou de ser sub-tipo do Exterior (virou classe própria) → cai em STOCK.
        expect(usSubKeyOf('ETF')).toBe('STOCK');
        expect(usSubKeyOf(null)).toBe('STOCK');
        expect(usSubKeyOf('XYZ')).toBe('STOCK');
    });
});

describe('etfSubKeyOf / resolveAllocClass', () => {
    it('ETF nacional → BR; internacional (STOCK_US + ETF/GOLD) → US; senão null', () => {
        expect(etfSubKeyOf({ type: 'ETF' })).toBe('BR');
        expect(etfSubKeyOf({ type: 'STOCK_US', usSubType: 'ETF' })).toBe('US');
        expect(etfSubKeyOf({ type: 'STOCK_US', usSubType: 'GOLD' })).toBe('US');
        expect(etfSubKeyOf({ type: 'STOCK_US', usSubType: 'STOCK' })).toBe(null);
        expect(etfSubKeyOf({ type: 'FII' })).toBe(null);
    });

    it('reclassifica ETF internacional de Exterior para a classe ETF', () => {
        expect(resolveAllocClass({ type: 'ETF' })).toBe('ETF');
        expect(resolveAllocClass({ type: 'STOCK_US', usSubType: 'ETF' })).toBe('ETF');
        expect(resolveAllocClass({ type: 'STOCK_US', usSubType: 'GOLD' })).toBe('ETF');
        expect(resolveAllocClass({ type: 'STOCK_US', usSubType: 'STOCK' })).toBe('STOCK_US');
        expect(resolveAllocClass({ type: 'STOCK' })).toBe('STOCK');
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

    it('agrega Exterior por usSubType e EXCLUI os ETFs internacionais (vão p/ classe ETF)', () => {
        const holdings = [
            { type: 'STOCK_US', usSubType: 'REIT', valueBr: 200 },
            { type: 'STOCK_US', usSubType: 'DOLLAR', valueBr: 300 },
            { type: 'STOCK_US', usSubType: 'ETF', valueBr: 100 }, // reclassificado p/ ETF
            { type: 'STOCK_US', usSubType: null, valueBr: 500 },
        ];
        const v = currentValueBySub(holdings, 'STOCK_US');
        expect(v.STOCK).toBe(500); // só o null; o ETF saiu do Exterior
        expect(v.REIT).toBe(200);
        expect(v.DOLLAR).toBe(300);
    });

    it('agrega a classe ETF por sub-tipo (BR nacional, US internacional + ouro)', () => {
        const holdings = [
            { type: 'ETF', valueBr: 600 },                          // nacional → BR
            { type: 'STOCK_US', usSubType: 'ETF', valueBr: 300 },   // internacional → US
            { type: 'STOCK_US', usSubType: 'GOLD', valueBr: 100 },  // ouro lastreado → US
            { type: 'STOCK_US', usSubType: 'STOCK', valueBr: 999 }, // ignorado (fica no Exterior)
            { type: 'STOCK', valueBr: 999 },                        // ignorado
        ];
        const v = currentValueBySub(holdings, 'ETF');
        expect(v.BR).toBe(600);
        expect(v.US).toBe(400); // 300 + 100
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
        expect(g.ETF).toBeUndefined();
    });

    it('sub-gap da classe ETF (Nacional/Internacional)', () => {
        // Classe-alvo 10.000. Meta BR 60% = 6.000 (tem 6.000 → gap 0);
        // US 40% = 4.000 (tem 1.000 → gap 3.000).
        const g = subGaps(10000, { BR: 6000, US: 1000 }, { BR: 60, US: 40 }, ETF_SUB_KEYS);
        expect(g.BR).toBe(0);
        expect(g.US).toBe(3000);
    });
});
