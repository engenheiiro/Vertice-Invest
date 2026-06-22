/**
 * PR9 — Classe ETF nacional: integridade da lista curada (BR_ETF_LIST) e chave de
 * concentração por tema (getConcentrationKey) para o draft do ranking de ETFs.
 */
import { describe, it, expect } from 'vitest';
import { BR_ETF_LIST } from '../config/brEtfList.js';
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

    it('seedYield (quando presente) é só p/ distribuidores, positivo e plausível (<15%)', () => {
        const seeded = BR_ETF_LIST.filter((e) => e.seedYield != null);
        // Fallback curado existe apenas p/ os poucos ETFs que distribuem proventos.
        expect(seeded.map((e) => e.ticker)).toEqual(expect.arrayContaining(['DIVO11']));
        for (const e of seeded) {
            expect(e.seedYield).toBeGreaterThan(0);
            expect(e.seedYield).toBeLessThan(15); // sanidade: yield de ETF não é absurdo
        }
        // A maioria (acumuladores) NÃO tem seed → dy=0 permanece correto.
        expect(seeded.length).toBeLessThan(BR_ETF_LIST.length / 2);
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
