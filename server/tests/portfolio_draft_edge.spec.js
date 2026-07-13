import { describe, expect, it } from 'vitest';
import { portfolioEngine } from '../services/engines/portfolioEngine.js';

const scoredAsset = (overrides = {}) => ({
    ticker: 'AAAA3',
    type: 'STOCK',
    sector: 'Bancos',
    score: 80,
    riskProfile: 'DEFENSIVE',
    thesis: 'Top Pick',
    auditLog: [],
    metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
    ...overrides,
});

const draftAsset = (ticker, sector, defensive, structural) => ({
    ticker,
    type: 'FII',
    sector,
    scores: { DEFENSIVE: defensive, MODERATE: 0, BOLD: 0 },
    metrics: { structural },
});

describe('portfolioEngine — concentrações e desempate', () => {
    it('penaliza o 3º FII da mesma gestora, mesmo em segmentos diferentes', () => {
        const portfolio = [
            scoredAsset({ ticker: 'KNCR11', type: 'FII', sector: 'Papel' }),
            scoredAsset({ ticker: 'KNRI11', type: 'FII', sector: 'Logística' }),
            scoredAsset({ ticker: 'KNIP11', type: 'FII', sector: 'Híbrido' }),
        ];

        const result = portfolioEngine.applyConcentrationPenalty(portfolio);
        const third = result.find((asset) => asset.ticker === 'KNIP11');

        expect(third.score).toBe(60);
        expect(third.action).toBe('WAIT');
        expect(third.auditLog).toContainEqual(expect.objectContaining({
            factor: 'Penalidade de Concentração', points: -20, category: 'Risco',
        }));
    });

    it('não aplica penalidade setorial em ranking mono-setor relaxado', () => {
        const portfolio = ['A3', 'B3', 'C3', 'D3'].map((ticker) =>
            scoredAsset({ ticker, sector: 'Bancos', score: 80 })
        );

        const result = portfolioEngine.applyConcentrationPenalty(portfolio, {
            relaxSectorConcentration: true,
        });

        expect(result.map((asset) => asset.score)).toEqual([80, 80, 80, 80]);
        expect(result.every((asset) => asset.auditLog.length === 0)).toBe(true);
    });

    it('desempata candidatos de mesmo score pelo composite estrutural', () => {
        const assets = [
            draftAsset('LOW11', 'Papel', 80, { quality: 30, valuation: 30, risk: 30 }),
            draftAsset('TOP11', 'Papel', 80, { quality: 90, valuation: 90, risk: 90 }),
            draftAsset('MID11', 'Papel', 80, { quality: 80, valuation: 80, risk: 80 }),
            draftAsset('HIGH11', 'Papel', 80, { quality: 70, valuation: 70, risk: 70 }),
        ];

        const ranking = portfolioEngine.performCompetitiveDraft(assets);
        const defensive = ranking.filter((asset) => asset.riskProfile === 'DEFENSIVE');

        expect(defensive.map((asset) => asset.ticker)).toEqual(['TOP11', 'MID11', 'HIGH11']);
        expect(defensive.map((asset) => asset.ticker)).not.toContain('LOW11');
    });
});
