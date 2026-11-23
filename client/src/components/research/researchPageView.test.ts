import { describe, expect, it } from 'vitest';
import type { ResearchReport } from '../../services/research';
import { hasResearchAccess, pickAnalysisText, readResearchDeepLink, researchPanel, researchPlanLine } from './researchPageView';

const report = (over: Partial<ResearchReport> = {}) => ({ content: { ranking: [] }, ...over } as unknown as ResearchReport);

describe('researchPageView — regras da página Research', () => {
    it('acesso: Brasil 10 aberto ao GUEST; Exterior só ELITE+; admin vê tudo; sem login nada', () => {
        expect(hasResearchAccess({ plan: 'GUEST' }, 'BRASIL_10')).toBe(true);
        expect(hasResearchAccess({ plan: 'PRO' }, 'STOCK_US')).toBe(false);
        expect(hasResearchAccess({ plan: 'ELITE' }, 'STOCK_US')).toBe(true);
        expect(hasResearchAccess({ plan: 'ESSENTIAL' }, 'FIXED_INCOME')).toBe(true);
        expect(hasResearchAccess({ plan: 'XPTO' }, 'STOCK')).toBe(false);
        expect(hasResearchAccess({ plan: 'GUEST', role: 'ADMIN' }, 'STOCK_US')).toBe(true);
        expect(hasResearchAccess(null, 'BRASIL_10')).toBe(false);
        expect(hasResearchAccess({ plan: 'BLACK' }, 'NAO_EXISTE')).toBe(false);
    });

    it('painel: carregando > bloqueado > renda fixa > sem relatório > semanal > ranking (publicado ou não)', () => {
        const base = { isLoading: false, hasAccess: true, isFixedIncome: false, report: report({ isRankingPublished: true }), viewMode: 'RANKING' as const };
        expect(researchPanel({ ...base, isLoading: true, hasAccess: false })).toBe('loading');
        expect(researchPanel({ ...base, hasAccess: false, isFixedIncome: true })).toBe('locked');
        expect(researchPanel({ ...base, isFixedIncome: true, report: null })).toBe('fixedIncome');
        expect(researchPanel({ ...base, report: null })).toBe('missing');
        expect(researchPanel({ ...base, viewMode: 'ANALYSIS' })).toBe('analysis');
        expect(researchPanel(base)).toBe('ranking');
        expect(researchPanel({ ...base, report: report({ isRankingPublished: false }) })).toBe('rankingUnpublished');
    });

    it('narrativa: perfil sem texto cede ao primeiro com texto; sem narrativa por perfil vale a geral', () => {
        const porPerfil = report({
            generatedExplainableAI: 'geral',
            generatedExplainableAIByProfile: { DEFENSIVE: ' ', MODERATE: 'mod', BOLD: 'arr' },
        } as Partial<ResearchReport>);
        const r = pickAnalysisText(porPerfil, 'DEFENSIVE');
        expect(r.profilesWithText.map((p) => p.id)).toEqual(['MODERATE', 'BOLD']);
        expect([r.effectiveProfile, r.activeText]).toEqual(['MODERATE', 'mod']);
        expect(pickAnalysisText(porPerfil, 'BOLD').activeText).toBe('arr');
        expect(pickAnalysisText(report({ generatedExplainableAI: 'geral' } as Partial<ResearchReport>), 'BOLD'))
            .toMatchObject({ effectiveProfile: 'BOLD', activeText: 'geral', profilesWithText: [] });
    });

    it('deep link: padrões sem state; Aporte da Carteira semeia classe, origem e valor', () => {
        expect(readResearchDeepLink(null)).toEqual({
            aporte: null, openTicker: null, initialAsset: 'BRASIL_10', initialExteriorView: 'STOCK', initialEtfOrigin: 'US', initialAmount: null,
        });
        const link = readResearchDeepLink({ aporte: { assetClass: 'ETF', etfOrigin: 'BR', amount: 500 }, openTicker: 'VALE3' });
        expect(link).toMatchObject({ openTicker: 'VALE3', initialAsset: 'ETF', initialEtfOrigin: 'BR', initialAmount: 500 });
    });

    it('linha do plano: admin, plano ativo ou INICIANTE', () => {
        expect(researchPlanLine({ role: 'ADMIN', plan: 'GUEST' })).toBe('ADMIN ACCESS: Todas as categorias liberadas');
        expect(researchPlanLine({ plan: 'PRO' })).toBe('Plano Ativo: PRO');
        expect(researchPlanLine(null)).toBe('Plano Ativo: INICIANTE');
    });
});
