import { describe, expect, it } from 'vitest';
import { buildBrasil10, stripStockCalibrationInternals } from '../services/aiResearchService.js';

const processed = (ticker, score, structural) => ({
    ticker,
    type: 'STOCK',
    sector: 'Bancos',
    scores: { DEFENSIVE: score, MODERATE: score, BOLD: score },
    metrics: { structural },
});

describe('payload publico do ranking STOCK', () => {
    it('remove eixos e cobertura administrativos sem alterar o score publico', () => {
        const publicItem = stripStockCalibrationInternals({
            ticker: 'PETR4',
            score: 77,
            action: 'BUY',
            riskProfile: 'MODERATE',
            stockCalibration: { version: 'STOCK_BH_SHADOW_V3', axes: { durability: 76 } },
            coverage: { readyForSectorCalibration: true },
            shadowAuditByProfile: { MODERATE: {} },
            scores: { MODERATE: 77 },
        });

        expect(publicItem).toEqual({
            ticker: 'PETR4', score: 77, action: 'BUY', riskProfile: 'MODERATE',
        });
    });
});

describe('buildBrasil10 — contratos de ranking', () => {
    it('mantém o threshold global: 70 é BUY e 69 é WAIT', () => {
        const ranking = buildBrasil10([
            processed('BUY3', 70, { quality: 60, valuation: 60, risk: 60 }),
            processed('WAIT3', 69, { quality: 60, valuation: 60, risk: 60 }),
        ], []);

        expect(ranking.find((asset) => asset.ticker === 'BUY3').action).toBe('BUY');
        expect(ranking.find((asset) => asset.ticker === 'WAIT3').action).toBe('WAIT');
    });

    it('desempata scores iguais pelo composite estrutural', () => {
        const ranking = buildBrasil10([
            processed('LOW3', 80, { quality: 40, valuation: 40, risk: 40 }),
            processed('HIGH3', 80, { quality: 90, valuation: 90, risk: 90 }),
        ], []);

        expect(ranking.map((asset) => asset.ticker)).toEqual(['HIGH3', 'LOW3']);
        expect(ranking.map((asset) => asset.position)).toEqual([1, 2]);
    });
});
