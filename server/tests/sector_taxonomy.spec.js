/**
 * Taxonomia de setores — chave de concentração.
 *
 * Garante que:
 *  - AÇÕES/ETFs (BR e US) usem MACRO-SETOR (risco sistêmico correlacionado);
 *  - FIIs usem SEGMENTO FINO (shopping ≠ logística ≠ papel ≠ fiagro), para não
 *    colapsar uma carteira 100% FII em ~3 baldes;
 *  - os nomes REAIS de setor do Yahoo (Consumer Cyclical/Defensive, Basic Materials)
 *    sejam mapeados (regressão: caíam em OUTROS).
 */
import { describe, it, expect } from 'vitest';
import { getMacroSector, getFiiSegment, getConcentrationKey } from '../config/sectorTaxonomy.js';

describe('getMacroSector — nomes de setor do Yahoo (US)', () => {
    it('mapeia Consumer Cyclical/Defensive para CONSUMO (não OUTROS)', () => {
        expect(getMacroSector('Consumer Cyclical')).toBe('CONSUMO');
        expect(getMacroSector('Consumer Defensive')).toBe('CONSUMO');
    });
    it('mapeia Basic Materials para COMMODITIES', () => {
        expect(getMacroSector('Basic Materials')).toBe('COMMODITIES');
    });
    it('mantém GICS clássico e setores BR', () => {
        expect(getMacroSector('Technology')).toBe('TECNOLOGIA');
        expect(getMacroSector('Bancos')).toBe('FINANCEIRO');
    });
});

describe('getFiiSegment — granularidade fina', () => {
    it('separa segmentos de tijolo que antes colapsavam em REAL_ESTATE', () => {
        expect(getFiiSegment('Shoppings')).toBe('FII_SHOPPING');
        expect(getFiiSegment('Logística')).toBe('FII_LOGISTICA');
        expect(getFiiSegment('Lajes Corporativas')).toBe('FII_LAJES');
        expect(getFiiSegment('Renda Urbana')).toBe('FII_RENDA_URBANA');
        expect(getFiiSegment('Híbrido')).toBe('FII_HIBRIDO');
    });
    it('separa segmentos de crédito/agro que antes colapsavam em FINANCEIRO/COMMODITIES', () => {
        expect(getFiiSegment('Papel')).toBe('FII_PAPEL');
        expect(getFiiSegment('Fundo de Fundos')).toBe('FII_FOF');
        expect(getFiiSegment('Fiagro')).toBe('FII_FIAGRO');
    });
    it('normaliza acento/caixa', () => {
        expect(getFiiSegment('LOGÍSTICA')).toBe('FII_LOGISTICA');
        expect(getFiiSegment('hibrido')).toBe('FII_HIBRIDO');
    });
    it('segmento desconhecido recebe balde próprio (nunca colapsa)', () => {
        expect(getFiiSegment('Algo Novo XYZ')).toBe('FII::algo novo xyz');
        expect(getFiiSegment('')).toBe('FII_OUTROS');
    });
});

describe('getConcentrationKey — por tipo de ativo', () => {
    it('FII → segmento fino', () => {
        expect(getConcentrationKey({ type: 'FII', sector: 'Shoppings' })).toBe('FII_SHOPPING');
    });
    it('STOCK/STOCK_US → macro-setor', () => {
        expect(getConcentrationKey({ type: 'STOCK', sector: 'Bancos' })).toBe('FINANCEIRO');
        expect(getConcentrationKey({ type: 'STOCK_US', sector: 'Consumer Cyclical' })).toBe('CONSUMO');
    });
    it('CRYPTO → balde único CRYPTO', () => {
        expect(getConcentrationKey({ type: 'CRYPTO', sector: 'Smart Contracts' })).toBe('CRYPTO');
    });
    it('asset nulo → OUTROS', () => {
        expect(getConcentrationKey(null)).toBe('OUTROS');
    });
});
