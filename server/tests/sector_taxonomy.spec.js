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
import { getMacroSector, getFiiSegment, getConcentrationKey, isCyclicalSector, isStateControlled } from '../config/sectorTaxonomy.js';

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

describe('isCyclicalSector — barramento de cíclicas', () => {
    it('reconhece macro-setores cíclicos (INDUSTRIAL/COMMODITIES)', () => {
        expect(isCyclicalSector('Indústria')).toBe(true);        // SHUL4
        expect(isCyclicalSector('Bens Industriais')).toBe(true);
        expect(isCyclicalSector('Máquinas e Equipamentos')).toBe(true);
        expect(isCyclicalSector('Material de Transporte')).toBe(true);
        expect(isCyclicalSector('Mineração')).toBe(true);
        expect(isCyclicalSector('Siderurgia')).toBe(true);
        expect(isCyclicalSector('Basic Materials')).toBe(true);
        expect(isCyclicalSector('Industrials')).toBe(true);
    });
    it('reconhece sub-setor Consumo Cíclico (macro CONSUMO não é cíclico como um todo)', () => {
        expect(isCyclicalSector('Consumo Cíclico')).toBe(true);
        expect(isCyclicalSector('Consumer Cyclical')).toBe(true);
    });
    it('NÃO marca setores defensivos/perenes como cíclicos', () => {
        expect(isCyclicalSector('Energia Elétrica')).toBe(false);
        expect(isCyclicalSector('Bancos')).toBe(false);
        expect(isCyclicalSector('Saúde')).toBe(false);
        expect(isCyclicalSector('Saneamento')).toBe(false);
        expect(isCyclicalSector('Varejo')).toBe(false);
        expect(isCyclicalSector('')).toBe(false);
        expect(isCyclicalSector(null)).toBe(false);
    });
});

describe('isStateControlled — eixo de governança', () => {
    it('reconhece estatais federais e estaduais por classe (ON/PN/Unit)', () => {
        expect(isStateControlled('PETR4')).toBe(true);   // Petrobras (federal)
        expect(isStateControlled('PETR3')).toBe(true);
        expect(isStateControlled('BBAS3')).toBe(true);   // Banco do Brasil
        expect(isStateControlled('BBSE3')).toBe(true);   // BB Seguridade (indireta)
        expect(isStateControlled('SAPR11')).toBe(true);  // Sanepar (PR)
        expect(isStateControlled('CMIG4')).toBe(true);   // Cemig (MG)
        expect(isStateControlled('CSMG3')).toBe(true);   // Copasa (MG)
        expect(isStateControlled('BRSR6')).toBe(true);   // Banrisul (RS)
    });
    it('normaliza caixa/espaço e sufixo fracionário F', () => {
        expect(isStateControlled(' petr4 ')).toBe(true);
        expect(isStateControlled('PETR4F')).toBe(true);
    });
    it('NÃO marca privadas nem já-privatizadas (corporations sem controlador estatal)', () => {
        expect(isStateControlled('ITSA4')).toBe(false);  // Itaúsa (privada)
        expect(isStateControlled('ITUB4')).toBe(false);
        expect(isStateControlled('SBSP3')).toBe(false);  // Sabesp — privatizada 2024
        expect(isStateControlled('CPLE6')).toBe(false);  // Copel — privatizada 2023
        expect(isStateControlled('ELET3')).toBe(false);  // Eletrobras — só golden share
        expect(isStateControlled('WIZC3')).toBe(false);
        expect(isStateControlled('')).toBe(false);
        expect(isStateControlled(null)).toBe(false);
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
