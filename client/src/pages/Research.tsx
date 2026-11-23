
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Header } from '../components/dashboard/Header';
import { researchService, ResearchReport, RankingItem } from '../services/research';
import { ResearchViewer } from '../components/research/ResearchViewer';
import { AssetDetailModal } from '../components/research/AssetDetailModal';
import { ResearchAporteModal } from '../components/research/ResearchAporteModal';
import { TreasuryPanel } from '../components/research/TreasuryPanel';
import { ResearchToolbar } from '../components/research/ResearchToolbar';
import { ResearchLoading, ResearchLocked, ResearchNotice, ResearchWeeklyAnalysis } from '../components/research/ResearchPanels';
import {
    RESEARCH_ASSETS, hasResearchAccess, readResearchDeepLink, researchPanel, researchPlanLine, type AnalysisProfile,
} from '../components/research/researchPageView';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import type { ResearchAporteRequest } from '../utils/researchAporte';
import { STALE_TIME } from '../config/queryConfig';

export const Research = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation(); // Hook de location para pegar state

    // Deep link do Aporte Inteligente da Carteira. Lido UMA vez, no estado inicial:
    // aplicado por efeito, a página buscaria BRASIL_10 primeiro e a classe pedida
    // depois — duas respostas concorrentes, e a mais lenta sobrescrevia a outra
    // (o modal abria com o ranking errado).
    const [deepLink] = useState(() => readResearchDeepLink(location.state));
    const aporteLink: ResearchAporteRequest | null = deepLink.aporte;

    const [selectedAsset, setSelectedAsset] = useState(deepLink.initialAsset);
    // Dentro do Exterior, alterna entre dois rankings INDEPENDENTES: Ações US (STOCK_US)
    // e REITs (classe própria). Não é filtro client-side — troca a fonte buscada.
    const [exteriorView, setExteriorView] = useState<'STOCK' | 'REIT'>(deepLink.initialExteriorView);
    // Aba ETFs: origem visível (Nacional B3 / Internacional US). Espelha o sub-filtro do
    // TopPicksCard aqui em cima para que o modal de Aporte respeite a mesma seleção.
    const [etfOrigin, setEtfOrigin] = useState<'BR' | 'US'>(deepLink.initialEtfOrigin);
    const [viewMode, setViewMode] = useState<'ANALYSIS' | 'RANKING'>('RANKING');
    // Ticker do deep link (location.state.openTicker), consumido uma única vez.
    const pendingOpenTicker = useRef<string | null>(deepLink.openTicker);

    // Estado para controle do modal de asset direto
    const [directAsset, setDirectAsset] = useState<RankingItem | null>(null);
    // Modal "Aporte Inteligente" por ativo (distribui valor entre os COMPRAR).
    const [showAporte, setShowAporte] = useState(!!deepLink.initialAmount);
    // Valor herdado do Aporte Inteligente da Carteira (deep link). Zerado ao fechar
    // o modal para não re-semear um valor antigo numa abertura manual posterior.
    const [aporteSeed, setAporteSeed] = useState<number | null>(deepLink.initialAmount);
    // Perfil selecionado na aba "Relatório Semanal" (narrativa por perfil).
    const [analysisProfile, setAnalysisProfile] = useState<AnalysisProfile>('DEFENSIVE');

    // Renda Fixa é uma vitrine informativa (Tesouro) — não usa MarketAnalysis/ranking.
    const isFixedIncome = selectedAsset === 'FIXED_INCOME';
    const isExterior = selectedAsset === 'STOCK_US';
    // Classe efetivamente buscada: no Exterior, o sub-toggle pode apontar para REIT.
    const effectiveAsset = isExterior && exteriorView === 'REIT' ? 'REIT' : selectedAsset;

    const checkAccess = (assetId: string) => hasResearchAccess(user, assetId);
    const hasAccessToSelected = checkAccess(selectedAsset);
    // Renda Fixa não tem relatório de ranking — o TreasuryPanel busca seus próprios dados.
    const canFetchReport = !isFixedIncome && hasAccessToSelected;
    const strategy = 'BUY_HOLD';

    // Um cache por classe: voltar a uma aba já vista é instantâneo, e alternar
    // Top 10 ↔ Semanal não busca de novo (é o mesmo relatório). A chave inclui o
    // plano: no upgrade o gate libera a classe e a busca precisa sair — sem isso
    // ficava "Análise não encontrada". Resposta atrasada de outra aba escreve só
    // na chave dela, então não sobrescreve a aba atual.
    const reportQuery = useQuery<ResearchReport | null>({
        queryKey: ['researchReport', effectiveAsset, strategy, user?.plan],
        queryFn: () => researchService.getLatest(effectiveAsset, strategy),
        enabled: canFetchReport,
        staleTime: STALE_TIME.HOURLY,
    });
    const report: ResearchReport | null = canFetchReport ? (reportQuery.data ?? null) : null;
    const isLoading = canFetchReport && reportQuery.isLoading;

    // LÓGICA DE LINK DIRETO (DEEP LINKING VIA STATE)
    useEffect(() => {
        const targetTicker = pendingOpenTicker.current;
        const ranking = report?.content?.ranking;
        if (!targetTicker || !ranking) return;
        const found = ranking.find((item: RankingItem) => item.ticker === targetTicker);
        if (found) {
            pendingOpenTicker.current = null;
            setDirectAsset(found);
            window.history.replaceState({}, document.title);
        }
    }, [report]);

    // Ao sair do Exterior, volta o sub-toggle para Ações (evita herdar REIT noutra aba).
    useEffect(() => { if (!isExterior) setExteriorView('STOCK'); }, [isExterior]);

    // O state do deep link já foi consumido no estado inicial; limpa o history para
    // que voltar/atualizar não reabra o modal de Aporte.
    useEffect(() => {
        if (aporteLink) window.history.replaceState({}, document.title);
    }, [aporteLink]);

    const selectedMeta = RESEARCH_ASSETS.find(a => a.id === selectedAsset);
    const panel = researchPanel({ isLoading, hasAccess: hasAccessToSelected, isFixedIncome, report, viewMode });

    const renderPanel = () => {
        switch (panel) {
            case 'loading': return <ResearchLoading />;
            case 'locked': return (
                <ResearchLocked planLabel={selectedMeta?.minPlan || 'PRO'} assetLabel={selectedMeta?.label} onUpgrade={() => navigate('/pricing')} />
            );
            case 'fixedIncome': return <TreasuryPanel />;
            case 'missing': return (
                <ResearchNotice title="Análise não encontrada" text="Use o painel admin para gerar o relatório inaugural desta categoria." />
            );
            case 'analysis': return <ResearchWeeklyAnalysis report={report as ResearchReport} profile={analysisProfile} onProfile={setAnalysisProfile} />;
            case 'ranking': return (
                <ResearchViewer
                    report={report as ResearchReport}
                    view="RANKING"
                    onAporte={() => setShowAporte(true)}
                    onExteriorViewChange={isExterior ? setExteriorView : undefined}
                    onEtfOriginChange={setEtfOrigin}
                    initialEtfOrigin={aporteLink?.etfOrigin}
                />
            );
            default: return <ResearchNotice title="Ranking ainda não publicado" text="O admin ainda não publicou o Top 10 desta categoria." />;
        }
    };

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30 pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto p-4 md:p-8">
                <ResearchToolbar
                    planLine={researchPlanLine(user)}
                    selectedAsset={selectedAsset}
                    canAccess={checkAccess}
                    onSelectAsset={setSelectedAsset}
                    viewMode={viewMode}
                    onViewMode={setViewMode}
                    isFixedIncome={isFixedIncome}
                    isFetching={reportQuery.isFetching}
                    canRefresh={hasAccessToSelected}
                    onRefresh={() => { void reportQuery.refetch(); }}
                />

                <div className="min-h-[400px]">
                    {renderPanel()}
                </div>

                {/* Modal de Link Direto (Renderizado se houver ativo selecionado via state) */}
                {directAsset && (
                    <AssetDetailModal
                        isOpen={!!directAsset}
                        onClose={() => setDirectAsset(null)}
                        asset={directAsset}
                    />
                )}

                {report?.content?.ranking && (
                    <ResearchAporteModal
                        isOpen={showAporte}
                        onClose={() => { setShowAporte(false); setAporteSeed(null); }}
                        ranking={report.content.ranking}
                        assetClass={effectiveAsset}
                        etfOrigin={etfOrigin}
                        initialAmount={aporteSeed}
                    />
                )}

                {/* Disclaimer — o ranking usa termos fortes (COMPRAR/Recomendação IA);
                    a ressalva precisa estar na própria página, não só nos Termos. */}
                <p className="text-[10px] text-slate-600 text-center mt-10 pb-6 max-w-2xl mx-auto leading-relaxed">
                    Conteúdo informativo e educacional gerado por análise quantitativa; não constitui recomendação
                    individualizada de investimento. Investimentos envolvem risco de perda de capital.
                </p>

            </main>
        </div>
    );
};
