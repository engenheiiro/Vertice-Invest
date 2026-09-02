/**
 * PR9 — Classe ETF nacional: integridade da lista curada (BR_ETF_LIST) e chave de
 * concentração por tema (getConcentrationKey) para o draft do ranking de ETFs.
 */
import { describe, it, expect } from 'vitest';
import { BR_ETF_LIST, isAccumulatingBrEtf } from '../config/brEtfList.js';
import { getConcentrationKey } from '../config/sectorTaxonomy.js';

describe('BR_ETF_LIST', () => {
    it('tem entradas e o formato esperado { ticker, name, sector }', () => {
        expect(BR_ETF_LIST.length).toBeGreaterThan(10);
        for (const etf of BR_ETF_LIST) {
            expect(typeof etf.ticker).toBe('string');
            expect(etf.ticker).toMatch(/^[A-Z]{4}\d{1,2}$/); // formato B3 (recebe .SA no quote)
            expect(etf.name && etf.name.length).toBeGreaterThan(0);
            expect(etf.sector && etf.sector.length).toBeGreaterThan(0);
        }
    });

    it('não tem tickers duplicados', () => {
        const tickers = BR_ETF_LIST.map((e) => e.ticker);
        expect(new Set(tickers).size).toBe(tickers.length);
    });

    it('marca ETFs locais de exposição internacional com allocationClass STOCK_US', () => {
        const byTicker = new Map(BR_ETF_LIST.map((e) => [e.ticker, e]));
        for (const ticker of ['IVVB11', 'SPXI11', 'NASD11', 'WRLD11', 'ACWI11', 'XINA11']) {
            expect(byTicker.get(ticker)?.allocationClass).toBe('STOCK_US');
        }
        expect(byTicker.get('BOVA11')?.allocationClass).toBeUndefined();
    });

    // Este teste já afirmou o CONTRÁRIO: que DIVO11 era distribuidor e merecia um
    // `seedYield` curado. Era falso — DIVO11, BOVA11 e SMAL11 são de acumulação
    // (reinvestem os proventos na cota). O seed era, na prática, a única fonte de `dy`
    // p/ ETF `.SA`, e injetava renda inexistente na projeção da carteira e no ranking.
    // Nenhum yield de ETF pode ser mantido à mão: ou vem de fonte viva/TTM, ou é 0.
    it('nenhum ETF declara yield semeado à mão (seedYield foi removido)', () => {
        const seeded = BR_ETF_LIST.filter((e) => e.seedYield != null);
        expect(seeded.map((e) => e.ticker)).toEqual([]);
    });

    it('reconhece IVVB11 como ETF de acumulação mesmo com caixa ou sufixo Yahoo', () => {
        expect(isAccumulatingBrEtf('IVVB11')).toBe(true);
        expect(isAccumulatingBrEtf(' ivvb11.sa ')).toBe(true);
        expect(isAccumulatingBrEtf('DIVD11')).toBe(false);
    });
});

describe('getConcentrationKey — classe ETF', () => {
    it('concentra ETF pelo tema/índice (não cai em OUTROS)', () => {
        expect(getConcentrationKey({ type: 'ETF', sector: 'Índice Amplo' })).toBe('Índice Amplo');
        expect(getConcentrationKey({ type: 'ETF', sector: 'Cripto' })).toBe('Cripto');
        // Sem setor → balde genérico 'ETF' (e não 'OUTROS').
        expect(getConcentrationKey({ type: 'ETF' })).toBe('ETF');
    });
});
