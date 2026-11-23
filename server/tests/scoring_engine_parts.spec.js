import { describe, expect, it } from 'vitest';
import { scoreCryptoProfiles } from '../services/engines/cryptoProfileRules.js';
import { calculateConfidenceScore, clampProfileScores } from '../services/engines/scoringConfidence.js';
import { generateDynamicTheses } from '../services/engines/scoringTheses.js';
import { calculateIntrinsicValue } from '../services/engines/scoringValuation.js';

// Peças extraídas do scoringEngine: um caso de cada regra, com a conta à mão.
const ctx = { MACRO: { SELIC: 10, NTNB_LONG: 6 } };

describe('scoringValuation.calculateIntrinsicValue', () => {
    it('Graham puro: √(22,5 × LPA × VPA)', () => {
        expect(calculateIntrinsicValue({ pl: 10, pvp: 1 }, 'STOCK', 10, ctx)).toEqual(
            { fairPrice: 15, method: 'Graham', grahamPrice: 15, bazinPrice: 0, pegRatio: null });
    });

    it('híbrido 40/60 com Bazin a 6% para ação US', () => {
        const v = calculateIntrinsicValue({ pl: 10, pvp: 1, dy: 6 }, 'STOCK_US', 10, ctx);
        expect(v).toMatchObject({ fairPrice: 12, method: 'Híbrido (Bazin 6.0% + Graham)', bazinPrice: 10 });
    });

    it('PEG reverso sem Graham nem Bazin, capado em 2,5× o preço', () => {
        expect(calculateIntrinsicValue({ pl: 5, revenueGrowth: 20 }, 'STOCK_US', 10, ctx)).toEqual(
            { fairPrice: 25, method: 'PEG Reverso', grahamPrice: 0, bazinPrice: 0, pegRatio: 0.25 });
    });

    it('REIT por Bazin, FII de papel pelo VP e ETF pelo mercado', () => {
        expect(calculateIntrinsicValue({ dy: 3 }, 'STOCK_US', 100, ctx, 'REIT')).toMatchObject({ fairPrice: 50, method: 'Bazin (REIT)' });
        expect(calculateIntrinsicValue({ vpCota: 95, fiiSubType: 'PAPEL' }, 'FII', 100, ctx)).toMatchObject({ fairPrice: 95, method: 'VP (Papel)' });
        expect(calculateIntrinsicValue({}, 'ETF', 42.5, ctx)).toMatchObject({ fairPrice: 42.5, method: 'Mercado' });
    });
});

describe('scoringTheses.generateDynamicTheses', () => {
    it('FII: Selic, spread sobre NTN-B e mono-ativo, nessa ordem', () => {
        const asset = { type: 'FII', ticker: 'X11', price: 100, fiiSubType: 'TIJOLO', metrics: { dy: 12, qtdImoveis: 1, beta: 0.9 } };
        expect(generateDynamicTheses(asset, ctx)).toEqual({
            bull: ['Yield (12.0%) supera a Selic.', 'Alto prêmio de risco: Spread de 6.0% sobre NTN-B.'],
            bear: ['Risco Mono-Ativo: Dependência total de um único imóvel.'],
        });
    });

    it('cripto: blue chip, porte, liquidez e volume/market cap', () => {
        const asset = { type: 'CRYPTO', ticker: 'BTC', price: 1, metrics: { marketCap: 1e12, avgLiquidity: 2e9 } };
        const { bull, bear } = generateDynamicTheses(asset, ctx);
        expect(bull).toHaveLength(3);
        expect(bear).toEqual(['Volume/MarketCap muito baixo (0.2%), indicando desinteresse do mercado.']);
    });
});

describe('scoringConfidence', () => {
    it('soma as penalidades de dado ausente, liquidez e data desconhecida', () => {
        const { confidence, audit } = calculateConfidenceScore({ _missing: { revenueGrowth: true }, avgLiquidity: 5e5 }, 'STOCK');
        expect(confidence).toBe(40);
        expect(audit.map(a => a.points)).toEqual([-25, -30, -5]);
    });

    it('teto 70 abaixo de 60 de confiança, piso 10, e só o teto vira auditoria', () => {
        const audit = { DEFENSIVE: [], MODERATE: [], BOLD: [] };
        expect(clampProfileScores({ defScore: 90, modScore: 5, boldScore: 50 }, 40, audit)).toEqual({ DEFENSIVE: 70, MODERATE: 10, BOLD: 50 });
        expect(audit.DEFENSIVE).toEqual([{ factor: 'Teto por Confiança de Dados (máx. 70)', points: -20, type: 'penalty' }]);
        expect(audit.MODERATE).toEqual([]);
    });
});

describe('cryptoProfileRules.scoreCryptoProfiles', () => {
    const emptyAudit = () => ({ DEFENSIVE: [], MODERATE: [], BOLD: [] });

    it('blue chip líquida, pouco volátil e acima da SMA200', () => {
        const audit = emptyAudit();
        const asset = { ticker: 'ETH', price: 100, metrics: { marketCap: 1e11, avgLiquidity: 2e9, volatility: 30, sma200: 50 } };
        expect(scoreCryptoProfiles(asset, audit)).toEqual({ defScore: 95, modScore: 20, boldScore: 10 });
        expect(audit.DEFENSIVE.map(a => a.points)).toEqual([75, 6, 4]);
    });

    it('small cap ilíquida perde em todos os perfis', () => {
        const asset = { ticker: 'PEPE', price: 1, metrics: { marketCap: 1e8, avgLiquidity: 1e7 } };
        expect(scoreCryptoProfiles(asset, emptyAudit())).toEqual({ defScore: -30, modScore: -20, boldScore: 40 });
    });
});
