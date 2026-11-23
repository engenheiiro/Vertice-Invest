import type { ResearchReport } from '../../services/research';
import type { ResearchAporteRequest } from '../../utils/researchAporte';

/**
 * Regras puras da página Research: abas por classe com o plano mínimo, acesso,
 * qual painel mostrar e qual narrativa semanal exibir. Sem JSX.
 */

// minPlan espelha o gate autoritativo do backend (RESEARCH_FEATURE_BY_CLASS em
// researchController + LIMITS_CONFIG). A Carteira Brasil TOP 10 é a vitrine do
// Free: o GUEST vê o ranking inteiro — é a única classe aberta.
export const RESEARCH_ASSETS = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', color: 'bg-emerald-600', minPlan: 'GUEST' },
    { id: 'STOCK', label: 'Ações BR', color: 'bg-blue-600', minPlan: 'PRO' },
    { id: 'FII', label: 'FIIs', color: 'bg-indigo-600', minPlan: 'PRO' },
    { id: 'CRYPTO', label: 'Cripto', color: 'bg-purple-600', minPlan: 'PRO' },
    { id: 'STOCK_US', label: 'Exterior', color: 'bg-slate-700', minPlan: 'ELITE' },
    { id: 'ETF', label: 'ETFs', color: 'bg-teal-600', minPlan: 'PRO' },
    { id: 'FIXED_INCOME', label: 'Renda Fixa', color: 'bg-emerald-700', minPlan: 'ESSENTIAL' },
];

const PLAN_LEVELS: Record<string, number> = { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 2, 'ELITE': 3, 'BLACK': 4 };

interface ResearchUser { plan?: string; role?: string }

/** Admin vê tudo; sem login ou classe desconhecida, nada; plano desconhecido conta como GUEST. */
export const hasResearchAccess = (user: ResearchUser | null | undefined, assetId: string): boolean => {
    if (user?.role === 'ADMIN') return true;
    const asset = RESEARCH_ASSETS.find(a => a.id === assetId);
    if (!asset || !user) return false;
    const userLevel = PLAN_LEVELS[user.plan || 'GUEST'] || 0;
    return userLevel >= PLAN_LEVELS[asset.minPlan];
};

export type ResearchPanel = 'loading' | 'locked' | 'fixedIncome' | 'missing' | 'analysis' | 'ranking' | 'rankingUnpublished';

/** Qual painel a página mostra, na ordem de precedência de sempre. */
export const researchPanel = ({ isLoading, hasAccess, isFixedIncome, report, viewMode }: {
    isLoading: boolean; hasAccess: boolean; isFixedIncome: boolean; report: ResearchReport | null; viewMode: 'ANALYSIS' | 'RANKING';
}): ResearchPanel => {
    if (isLoading) return 'loading';
    if (!hasAccess) return 'locked';
    if (isFixedIncome) return 'fixedIncome';
    if (!report) return 'missing';
    if (viewMode === 'ANALYSIS') return 'analysis';
    return report.isRankingPublished ? 'ranking' : 'rankingUnpublished';
};

export type AnalysisProfile = 'DEFENSIVE' | 'MODERATE' | 'BOLD';

const ANALYSIS_PROFILES = [
    { id: 'DEFENSIVE', label: 'Defensivo' },
    { id: 'MODERATE', label: 'Moderado' },
    { id: 'BOLD', label: 'Arrojado' },
] as const;

/**
 * Narrativa semanal a exibir. Só entram no seletor os perfis com texto; o
 * perfil escolhido que ficou sem texto cede ao primeiro que tem. Sem narrativa
 * por perfil, vale o texto geral do relatório.
 */
export const pickAnalysisText = (report: ResearchReport, chosen: AnalysisProfile) => {
    const byProfile: Partial<Record<AnalysisProfile, string>> = report.generatedExplainableAIByProfile || {};
    const profilesWithText = ANALYSIS_PROFILES.filter(p => (byProfile[p.id] || '').trim());
    const effectiveProfile: AnalysisProfile = profilesWithText.some(p => p.id === chosen)
        ? chosen
        : (profilesWithText[0]?.id ?? chosen);
    const activeText = profilesWithText.length > 0
        ? (byProfile[effectiveProfile] || '')
        : (report.generatedExplainableAI || '');
    return { profilesWithText, effectiveProfile, activeText };
};

/**
 * Deep links que chegam por `location.state`: o Aporte Inteligente da Carteira
 * (classe, sub-visão, origem do ETF e valor) e o ticker a abrir direto. Lidos
 * UMA vez, no estado inicial da página.
 */
export const readResearchDeepLink = (state: unknown) => {
    const linkState = (state ?? null) as { aporte?: ResearchAporteRequest; openTicker?: string } | null;
    const aporte = linkState?.aporte ?? null;
    return {
        aporte,
        openTicker: linkState?.openTicker ?? null,
        initialAsset: aporte?.assetClass || 'BRASIL_10',
        initialExteriorView: aporte?.exteriorView || 'STOCK',
        initialEtfOrigin: aporte?.etfOrigin || 'US',
        initialAmount: aporte?.amount ?? null,
    };
};

/** Linha abaixo do título: admin vê tudo; os demais, o plano (ou INICIANTE sem plano). */
export const researchPlanLine = (user: ResearchUser | null | undefined): string => (
    user?.role === 'ADMIN' ? 'ADMIN ACCESS: Todas as categorias liberadas' : `Plano Ativo: ${user?.plan || 'INICIANTE'}`
);
