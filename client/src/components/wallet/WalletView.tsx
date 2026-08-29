import React, { useState, useEffect, lazy, Suspense } from 'react';
import { WalletSummary } from './WalletSummary';
import { AssetList } from './AssetList';
import { AddAssetModal } from './AddAssetModal';
// Aba default (OVERVIEW): import estático para não piscar fallback no load inicial.
import { EvolutionChart } from './EvolutionChart';
import { AllocationChart } from './AllocationChart';
// (I8) Abas secundárias: lazy — só baixam o chunk (recharts etc.) quando abertas.
const PerformanceChart = lazy(() => import('./PerformanceChart').then(m => ({ default: m.PerformanceChart })));
const MonthlyReturnsTable = lazy(() => import('./MonthlyReturnsTable').then(m => ({ default: m.MonthlyReturnsTable })));
const DividendDashboard = lazy(() => import('./DividendDashboard').then(m => ({ default: m.DividendDashboard })));
const CashFlowHistory = lazy(() => import('./CashFlowHistory').then(m => ({ default: m.CashFlowHistory })));
const TaxReport = lazy(() => import('./TaxReport').then(m => ({ default: m.TaxReport })));
import { SmartContributionModal } from './SmartContributionModal';
import { RebalanceModal } from './RebalanceModal';
// Importação de carteira: lazy porque arrasta o leitor de planilha (fflate) e os
// parsers junto — peso que quem nunca importa não precisa baixar.
const ImportWalletModal = lazy(() => import('./import/ImportWalletModal').then(m => ({ default: m.ImportWalletModal })));
import { RenameWalletModal } from './RenameWalletModal';
import { WalletSwitcher } from './WalletSwitcher';
import { ConfirmModal } from '../ui/ConfirmModal';
import { SkeletonChart, SkeletonTableRows, EmptyState, Button } from '../ui'; // (I12) skeletons padronizados + (U3) empty state
import { Plus, Lock, RefreshCw, TrendingUp, PlusCircle, Trash2, BarChart2, CircleDollarSign, FileText, Loader2, DollarSign, Landmark, Pencil, Eye, Upload, ShieldCheck } from 'lucide-react';
import { PieSlices } from '../ui/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { useDemo } from '../../contexts/DemoContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { FEATURE_LIMITS } from '../../constants/subscription';
import { WALLET_STEPS } from '../tutorial/tutorialSteps';

interface WalletViewProps {
    /** Só em modo leitura: assina o cabeçalho com o primeiro nome do dono. */
    ownerFirstName?: string | null;
}

/**
 * Corpo da página Carteira.
 *
 * É a MESMA view em dois contextos: na área logada (WalletProvider) e no link
 * público compartilhado (PublicWalletProvider). O que muda vem do contexto —
 * `isReadOnly` retira tudo que escreve (transação, aporte, rebalanceamento,
 * reset, renomear, trocar de carteira, IR) — e não de uma segunda página. Cada
 * página só monta a sua própria moldura (Header logado × barra de visitante).
 */
export const WalletView: React.FC<WalletViewProps> = ({ ownerFirstName }) => {
    const { user } = useAuth();
    const { assets, resetWallet, isLoading, isRefreshing, usdRate, activeWalletId, activeWalletName, isReadOnly } = useWallet();
    const { addToast } = useToast();
    const { isDemoMode, currentStep } = useDemo();
    const navigate = useNavigate();
    const location = useLocation();

    // (B1) Cofre de Dividendos (Dashboard) manda direto pra cá com o editor já aberto
    // na Meta de Renda Passiva, em vez de só cair na tela da Carteira.
    const [autoOpenDividendGoal, setAutoOpenDividendGoal] = useState(
        Boolean((location.state as { openDividendGoalEditor?: boolean } | null)?.openDividendGoalEditor)
    );
    useEffect(() => {
        if (autoOpenDividendGoal) {
            // Limpa o state da navegação para não reabrir num refresh/voltar.
            window.history.replaceState({}, document.title);
        }
    }, [autoOpenDividendGoal]);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);
    const [isRebalanceModalOpen, setIsRebalanceModalOpen] = useState(false);
    const [isRenameWalletOpen, setIsRenameWalletOpen] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [limitModalOpen, setLimitModalOpen] = useState(false);
    const [limitMessage, setLimitMessage] = useState('');

    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATEMENT' | 'TAX'>('OVERVIEW');

    // (7.11) Relatório de IR é exclusivo do plano BLACK (ADMIN passa para QA).
    // O link público nunca expõe a aba: é declaração fiscal do dono.
    const canAccessTax = !isReadOnly && (user?.plan === 'BLACK' || user?.role === 'ADMIN');

    // --- AUTOMAÇÃO DO TUTORIAL ---
    // A aba ativa é derivada do metadado `tab` do passo atual (sem número mágico),
    // de modo que reordenar/editar WALLET_STEPS não quebra a sincronização.
    useEffect(() => {
        if (!isDemoMode) return;
        const stepIndex = Math.min(currentStep, WALLET_STEPS.length - 1);
        setActiveTab(WALLET_STEPS[stepIndex]?.tab ?? 'OVERVIEW');
    }, [isDemoMode, currentStep]);

    // CHECK DE PERMISSÃO: APORTE INTELIGENTE
    const handleOpenSmartContribution = () => {
        const plan = user?.plan || 'GUEST';
        const limit = FEATURE_LIMITS['smart_contribution'][plan];

        if (limit === 0) {
            setLimitMessage("O Aporte Inteligente é um recurso exclusivo dos planos Pro e Black.");
            setLimitModalOpen(true);
            return;
        }
        setIsSmartModalOpen(true);
    };

    // CHECK DE PERMISSÃO: REBALANCEAMENTO (ELITE+)
    const handleRebalance = () => {
        const plan = user?.plan || 'GUEST';
        if (plan !== 'BLACK' && plan !== 'ELITE') {
            setLimitMessage("O Rebalanceamento Automático com IA é um recurso exclusivo dos planos Elite e Black.");
            setLimitModalOpen(true);
            return;
        }
        // Demo usa dados mock — o plano depende da carteira real, então não chama a API.
        if (isDemoMode) {
            addToast('O Rebalanceamento IA usa os dados reais da sua carteira.', 'info');
            return;
        }
        setIsRebalanceModalOpen(true);
    };

    // CHECK DE PERMISSÃO: RELATÓRIO DE IR (BLACK+)
    const handleTaxTab = () => {
        if (!canAccessTax) {
            setLimitMessage("O Relatório de Imposto de Renda é um recurso exclusivo do plano Black.");
            setLimitModalOpen(true);
            return;
        }
        setActiveTab('TAX');
    };

    return (
        <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto p-4 md:p-6 animate-fade-in relative">

            {/* Header Actions */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 md:gap-6 mb-5 md:mb-8">
                <div>
                    <div className="flex items-center gap-2.5 min-w-0">
                        {!isReadOnly && (
                            <div className="xl:hidden shrink-0">
                                <WalletSwitcher compact />
                            </div>
                        )}
                        <h1 className="text-2xl md:text-[27px] font-extrabold text-white tracking-[-0.02em] truncate">
                            {activeWalletName || 'Minha Carteira'}
                        </h1>
                        {!isReadOnly && (
                            <button
                                onClick={() => setIsRenameWalletOpen(true)}
                                title="Renomear carteira"
                                aria-label="Renomear carteira"
                                // -m-2: área de toque de 40px sem deslocar o título.
                                className="hidden xl:inline-flex min-h-[40px] min-w-[40px] -m-2 items-center justify-center text-slate-500 hover:text-blue-400 transition-colors shrink-0"
                            >
                                <Pencil size={16} />
                            </button>
                        )}
                        {isReadOnly && (
                            <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 bg-slate-800/60 border border-slate-700 rounded-full text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                <Eye size={11} /> Somente leitura
                            </span>
                        )}
                        {isRefreshing && (
                            <div className="flex items-center gap-2 px-2 py-1 bg-blue-900/20 rounded-full border border-blue-900/50 animate-fade-in">
                                <Loader2 size={14} className="text-blue-400 animate-spin" />
                                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Atualizando...</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-start gap-2.5 mt-1">
                        <p className="text-slate-400 text-sm leading-relaxed max-w-md">
                            {isReadOnly
                                ? `Carteira compartilhada${ownerFirstName ? ` por ${ownerFirstName}` : ''}. Os dados são os mesmos que o investidor acompanha.`
                                : 'Gerencie seus ativos e acompanhe a evolução patrimonial.'}
                        </p>
                        {usdRate > 0 && (
                            <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/20 border border-blue-900/40 rounded-full">
                                <DollarSign size={10} className="text-blue-400" />
                                <span className="text-[10px] text-blue-400 font-bold tabular-nums">
                                    USD/BRL R${usdRate.toFixed(2)}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {!isReadOnly && (
                    <div id="tour-wallet-actions" className={`grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 md:gap-3 transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                        {/* No mobile, rótulos curtos deixam as ações reconhecíveis sem
                            apertar o layout; aria-label preserva o nome completo. */}
                        <button aria-label="Nova Transação" title="Nova Transação" className="w-full sm:w-auto flex items-center justify-center gap-2 px-3 md:px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 border border-transparent whitespace-nowrap transition-all active:scale-95 min-w-[44px]" onClick={() => setIsAddModalOpen(true)}>
                            <PlusCircle size={16} /> <span className="sm:hidden">Transação</span><span className="hidden sm:inline">Nova Transação</span>
                        </button>

                        {/* Importar carteira NÃO fica aqui: a barra de ações é do dia
                            a dia de quem já tem carteira, e importar é um gesto de
                            uma vez só. A porta é o estado vazio da Visão Geral —
                            some sozinha assim que existe o primeiro ativo. */}

                        {/* Botão Aporte Inteligente */}
                        <button aria-label="Aporte Inteligente" title="Aporte Inteligente" className="w-full sm:w-auto flex items-center justify-center gap-2 px-3 md:px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 border border-transparent whitespace-nowrap transition-all active:scale-95 min-w-[44px]" onClick={handleOpenSmartContribution}>
                            {(user?.plan === 'GUEST' || user?.plan === 'ESSENTIAL') && <Lock size={12} />}
                            <TrendingUp size={16} /> <span className="sm:hidden">Aporte</span><span className="hidden sm:inline">Aporte Inteligente</span>
                        </button>

                        {/* Botão Rebalanceamento (Black) */}
                        <button aria-label="Rebalanceamento IA" title="Rebalanceamento IA" className="w-full sm:w-auto flex items-center justify-center gap-2 px-3 md:px-5 py-2.5 h-10 rounded-xl text-xs font-bold bg-gradient-to-r from-[#D4AF37] via-[#F2D06B] to-[#D4AF37] text-black hover:brightness-110 shadow-lg shadow-[#D4AF37]/20 border-none whitespace-nowrap transition-all active:scale-95 min-w-[44px]" onClick={handleRebalance}>
                            {(user?.plan !== 'BLACK' && user?.plan !== 'ELITE') ? <Lock size={12} className="text-black/80" /> : <RefreshCw size={16} className="text-black/80" />}
                            <span className="sm:hidden">Rebalancear</span><span className="hidden sm:inline">Rebalanceamento IA</span>
                        </button>

                        <div className="w-px h-8 bg-slate-800 hidden lg:block mx-1"></div>
                        <button onClick={() => assets.length > 0 && setIsResetModalOpen(true)} className={`w-full sm:w-10 px-3 sm:px-0 flex items-center justify-center gap-2 h-10 rounded-xl transition-all border min-w-[44px] text-xs font-bold ${assets.length === 0 ? 'opacity-50 cursor-not-allowed border-slate-800 text-slate-600' : 'bg-red-900/10 border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800'}`} title="Resetar Carteira" aria-label="Resetar Carteira" disabled={assets.length === 0}>
                            <Trash2 size={16} /><span className="sm:hidden">Resetar</span>
                        </button>
                    </div>
                )}
            </div>

            <div id="tour-wallet-kpis" className={`transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                <WalletSummary />
            </div>

            {/* A barra INTEIRA é o alvo do tutorial: destacar um botão de aba
                isolado deixava o card por cima justamente do conteúdo descrito. */}
            <div id="tour-wallet-tabs" aria-label="Seções da carteira" className={`flex gap-1 sm:gap-2 mb-5 md:mb-6 border-b border-slate-800/60 overflow-x-auto overscroll-x-contain snap-x snap-proximity no-scrollbar transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                <TabButton active={activeTab === 'OVERVIEW'} onClick={() => setActiveTab('OVERVIEW')} icon={<PieSlices size={16} />} label="Visão Geral" />
                <TabButton active={activeTab === 'PERFORMANCE'} onClick={() => setActiveTab('PERFORMANCE')} icon={<BarChart2 size={16} />} label="Rentabilidade" />
                <TabButton active={activeTab === 'DIVIDENDS'} onClick={() => setActiveTab('DIVIDENDS')} icon={<CircleDollarSign size={16} />} label="Proventos" />
                <TabButton active={activeTab === 'STATEMENT'} onClick={() => setActiveTab('STATEMENT')} icon={<FileText size={16} />} label="Extrato" />
                {!isReadOnly && (
                    <TabButton active={activeTab === 'TAX'} onClick={handleTaxTab} icon={canAccessTax ? <Landmark size={16} /> : <Lock size={16} />} label="Imposto de Renda" />
                )}
            </div>

            {isLoading ? (
                <div className="space-y-6">
                    <SkeletonChart className="h-64" />
                    <SkeletonTableRows rows={4} />
                </div>
            ) : (
                <div id="tour-wallet-content" className={`transition-opacity duration-500 ${isDemoMode && 'relative z-[100]'}`}>
                    {activeTab === 'OVERVIEW' && (
                        assets.length === 0 && !isLoading ? (
                            isReadOnly ? (
                                // Visitante não tem o que configurar nem cadastrar: só o aviso.
                                <div className="bg-base border border-slate-800 rounded-2xl animate-fade-in">
                                    <EmptyState
                                        icon={<PieSlices size={28} />}
                                        title="Carteira sem ativos"
                                        description="O investidor ainda não cadastrou posições nesta carteira."
                                    />
                                </div>
                            ) : (
                                // Carteira vazia: ainda assim exibimos a Distribuição (em modo Ideal)
                                // para o usuário definir sua alocação-alvo ANTES de cadastrar ativos.
                                // Mantém a MESMA ordem do layout com ativos (Evolução à esquerda /
                                // Distribuição à direita): aqui o EmptyState ocupa a coluna larga.
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
                                    <div className="lg:col-span-2 bg-base border border-slate-800 rounded-2xl flex">
                                        <EmptyState
                                            className="h-full w-full"
                                            icon={<PieSlices size={28} />}
                                            title="Sua carteira está vazia"
                                            description="Já investe pela B3? Importe o extrato e traga a carteira inteira de uma vez, com o histórico real de compras e vendas. Ou comece adicionando o primeiro ativo."
                                            action={
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="flex flex-col sm:flex-row gap-2.5">
                                                        <Button onClick={() => setIsImportModalOpen(true)} className="!w-auto px-6 gap-2">
                                                            <Upload size={16} /> Importar carteira
                                                        </Button>
                                                        <Button variant="outline" onClick={() => setIsAddModalOpen(true)} className="!w-auto px-6 gap-2">
                                                            <Plus size={16} /> Adicionar ativo
                                                        </Button>
                                                    </div>
                                                    <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                                        <ShieldCheck size={12} className="text-emerald-500/80 shrink-0" />
                                                        O arquivo é lido no seu navegador — CPF e corretora não saem daqui.
                                                    </p>
                                                </div>
                                            }
                                        />
                                    </div>
                                    <div className="lg:col-span-1">
                                        <AllocationChart
                                            initialViewMode="IDEAL"
                                            autoOpenDividendGoal={autoOpenDividendGoal}
                                            onAutoOpenHandled={() => setAutoOpenDividendGoal(false)}
                                        />
                                    </div>
                                </div>
                            )
                        ) : (
                            <>
                                <div id="tour-wallet-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-fade-in">
                                    <div className="lg:col-span-2">
                                        <EvolutionChart />
                                    </div>
                                    <div className="lg:col-span-1">
                                        <AllocationChart
                                            autoOpenDividendGoal={autoOpenDividendGoal}
                                            onAutoOpenHandled={() => setAutoOpenDividendGoal(false)}
                                        />
                                    </div>
                                </div>
                                <div className="mb-8 animate-fade-in">
                                    <AssetList />
                                </div>
                            </>
                        )
                    )}

                    {activeTab === 'PERFORMANCE' && (
                        <Suspense fallback={<TabFallback />}>
                            <div className="animate-fade-in">
                                <div className="grid grid-cols-1 gap-6 mb-8">
                                    <PerformanceChart />
                                    <MonthlyReturnsTable />
                                </div>
                                <div className="p-6 bg-slate-900/30 border border-slate-800 rounded-xl text-center text-slate-500 text-xs">
                                    * O benchmark comparativo considera a data do primeiro aporte como base 100.
                                </div>
                            </div>
                        </Suspense>
                    )}

                    {activeTab === 'DIVIDENDS' && (
                        <Suspense fallback={<TabFallback />}>
                            <div className="animate-fade-in">
                                <DividendDashboard />
                            </div>
                        </Suspense>
                    )}

                    {activeTab === 'STATEMENT' && (
                        <Suspense fallback={<TabFallback />}>
                            <div className="animate-fade-in max-w-4xl mx-auto">
                                <CashFlowHistory />
                            </div>
                        </Suspense>
                    )}

                    {activeTab === 'TAX' && canAccessTax && (
                        <Suspense fallback={<TabFallback />}>
                            <div className="animate-fade-in max-w-5xl mx-auto">
                                <TaxReport />
                            </div>
                        </Suspense>
                    )}
                </div>
            )}

            {/* Modais existem só onde há escrita — o link público não os monta. */}
            {!isReadOnly && (
                <>
                    <AddAssetModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
                    {/* Só monta quando aberto: o chunk do leitor de planilha e dos
                        parsers não é baixado por quem nunca clica em Importar. */}
                    {isImportModalOpen && (
                        <Suspense fallback={null}>
                            <ImportWalletModal isOpen onClose={() => setIsImportModalOpen(false)} />
                        </Suspense>
                    )}
                    <SmartContributionModal isOpen={isSmartModalOpen} onClose={() => setIsSmartModalOpen(false)} />
                    <RebalanceModal isOpen={isRebalanceModalOpen} onClose={() => setIsRebalanceModalOpen(false)} />
                    <RenameWalletModal
                        isOpen={isRenameWalletOpen}
                        mode="rename"
                        walletId={activeWalletId}
                        currentName={activeWalletName}
                        onClose={() => setIsRenameWalletOpen(false)}
                    />

                    <ConfirmModal
                        isOpen={limitModalOpen}
                        onClose={() => setLimitModalOpen(false)}
                        onConfirm={() => navigate('/pricing')}
                        title="Acesso Restrito"
                        message={`${limitMessage}\n\nDeseja fazer um upgrade agora?`}
                        confirmText="Ver Planos"
                        isDestructive={false}
                    />

                    <ConfirmModal
                        isOpen={isResetModalOpen}
                        onClose={() => setIsResetModalOpen(false)}
                        onConfirm={resetWallet}
                        title="Excluir Carteira Permanentemente?"
                        message="ATENÇÃO: Esta ação é irreversível. Todo o histórico será apagado."
                        isDestructive={true}
                        confirmText="Sim, Excluir Tudo"
                    />
                </>
            )}

        </main>
    );
};

// (I8/I12) Fallback enquanto o chunk da aba é baixado — skeletons padronizados.
const TabFallback = () => (
    <div className="space-y-6">
        <SkeletonChart className="h-64" />
        <SkeletonTableRows rows={3} />
    </div>
);

// Tab estilo "underline": a aba ativa recebe texto emerald + sublinhado emerald
// (a borda inferior de 2px sobrepõe a divisória do container via -mb-px). Mais
// limpo que a pílula cinza e coerente com o semáforo do design system.
const TabButton = ({ active, onClick, icon, label, id }: any) => (
    <button
        id={id}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`
            relative snap-start flex items-center gap-[7px] px-3 sm:px-4 py-[11px] -mb-px text-[13.5px] font-bold whitespace-nowrap
            border-b-[2.5px] transition-colors duration-200
            ${active
                ? 'text-emerald-400 border-emerald-400'
                : 'text-slate-500 border-transparent hover:text-slate-300 hover:border-slate-700'
            }
        `}
    >
        {icon} {label}
    </button>
);
