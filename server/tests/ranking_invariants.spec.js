/**
 * Invariantes de ranking pós-draft/penalidade.
 * Trava as regras de negócio invioláveis sobre a saída real do pipeline de seleção
 * (portfolioEngine): action ↔ threshold 70 DEPOIS da penalidade de concentração,
 * sem ticker duplicado, e o rastro de auditoria da penalidade.
 */
import { describe, it, expect } from 'vitest';
import { portfolioEngine } from '../services/engines/portfolioEngine.js';

const stock = (ticker, sector, scores) => ({
    ticker,
    type: 'STOCK',
    sector,
    scores,
    metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
});

const draft = (assets, opts) =>
    portfolioEngine.applyConcentrationPenalty(portfolioEngine.performCompetitiveDraft(assets, opts), opts);

describe('invariantes de ranking', () => {
    it('action === (score >= 70 ? BUY : WAIT) para TODO item após a penalidade', () => {
        // 3 ativos mesmo setor/perfil em 73: o 3º leva -5 → 68 → deve virar WAIT.
        const assets = ['A3', 'B3', 'C3'].map((t) => stock(t, 'Bancos', { DEFENSIVE: 73, MODERATE: 0, BOLD: 0 }));
        const ranking = draft(assets);

        for (const r of ranking) {
            expect(r.action).toBe(r.score >= 70 ? 'BUY' : 'WAIT');
        }
        // A penalidade efetivamente rebaixou ao menos um para WAIT.
        expect(ranking.some((r) => r.action === 'WAIT')).toBe(true);
    });

    it('nenhum ticker se repete dentro do ranking (usedTickers)', () => {
        const assets = ['A3', 'B3', 'C3', 'D3'].map((t) =>
            stock(t, 'Bancos', { DEFENSIVE: 80, MODERATE: 75, BOLD: 70 })
        );
        const ranking = draft(assets);
        const tickers = ranking.map((r) => r.ticker);
        expect(new Set(tickers).size).toBe(tickers.length);
    });

    it('itens penalizados carregam "Penalidade de Concentração" no auditLog', () => {
        const assets = ['A3', 'B3', 'C3'].map((t) => stock(t, 'Bancos', { DEFENSIVE: 80, MODERATE: 0, BOLD: 0 }));
        const ranking = draft(assets);
        const penalized = ranking.filter((r) => r.riskProfile === 'DEFENSIVE' && r.score < 80);
        expect(penalized.length).toBeGreaterThan(0);
        expect(
            penalized.every((r) => (r.auditLog || []).some((a) => a.factor === 'Penalidade de Concentração'))
        ).toBe(true);
    });
});
