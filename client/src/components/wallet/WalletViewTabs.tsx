import React, { lazy, Suspense } from 'react';
import { Plus, Lock, BarChart2, CircleDollarSign, FileText, Landmark, Upload, ShieldCheck } from 'lucide-react';
import { AssetList } from './AssetList';
// Aba default (OVERVIEW): import estático para não piscar fallback no load inicial.
import { EvolutionChart } from './EvolutionChart';
import { AllocationChart } from './AllocationChart';
import { SkeletonChart, SkeletonTableRows, EmptyState, Button } from '../ui'; // (I12) skeletons padronizados + (U3) empty state
import { PieSlices } from '../ui/icons';
import type { WalletAccess, WalletViewTab } from './walletViewModel';
// (I8) Abas secundárias: lazy — só baixam o chunk (recharts etc.) quando abertas.
const PerformanceChart = lazy(() => import('./PerformanceChart').then(m => ({ default: m.PerformanceChart })));
const MonthlyReturnsTable = lazy(() => import('./MonthlyReturnsTable').then(m => ({ default: m.MonthlyReturnsTable })));
const DividendDashboard = lazy(() => import('./DividendDashboard').then(m => ({ default: m.DividendDashboard })));
const CashFlowHistory = lazy(() => import('./CashFlowHistory').then(m => ({ default: m.CashFlowHistory })));
const TaxReport = lazy(() => import('./TaxReport').then(m => ({ default: m.TaxReport })));

interface TabButtonProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}

// Tab estilo "underline": a aba ativa recebe texto emerald + sublinhado emerald
// (a borda inferior de 2px sobrepõe a divisória do container via -mb-px). Mais
// limpo que a pílula cinza e coerente com o semáforo do design system.
const TabButton = ({ active, onClick, icon, label }: TabButtonProps) => (
    <button
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

interface WalletTabsBarProps {
    activeTab: WalletViewTab;
    access: WalletAccess;
    isReadOnly: boolean;
    tourLayer: string;
    onSelect: (tab: WalletViewTab) => void;
    onDividends: () => void;
    onTax: () => void;
}

const TABS_BAR = 'flex gap-1 sm:gap-2 mb-5 md:mb-6 border-b border-slate-800/60 overflow-x-auto overscroll-x-contain snap-x snap-proximity '
    + 'no-scrollbar transition-opacity duration-500';

/** A barra INTEIRA é o alvo do tutorial: destacar um botão isolado deixava o card por cima do conteúdo descrito. */
export const WalletTabsBar: React.FC<WalletTabsBarProps> = ({ activeTab, access, isReadOnly, tourLayer, onSelect, onDividends, onTax }) => (
    <div
        id="tour-wallet-tabs"
        aria-label="Seções da carteira"
        className={`${TABS_BAR} ${tourLayer}`}
    >
        <TabButton active={activeTab === 'OVERVIEW'} onClick={() => onSelect('OVERVIEW')} icon={<PieSlices size={16} />} label="Visão Geral" />
        <TabButton active={activeTab === 'PERFORMANCE'} onClick={() => onSelect('PERFORMANCE')} icon={<BarChart2 size={16} />} label="Rentabilidade" />
        <TabButton
            active={activeTab === 'DIVIDENDS'}
            onClick={onDividends}
            icon={access.canAccessDividends ? <CircleDollarSign size={16} /> : <Lock size={16} />}
            label="Proventos"
        />
        <TabButton active={activeTab === 'STATEMENT'} onClick={() => onSelect('STATEMENT')} icon={<FileText size={16} />} label="Extrato" />
        {!isReadOnly && (
            <TabButton
                active={activeTab === 'TAX'}
                onClick={onTax}
                icon={access.canAccessTax ? <Landmark size={16} /> : <Lock size={16} />}
                label="Imposto de Renda"
            />
        )}
    </div>
);

// (I8/I12) Fallback enquanto o chunk da aba é baixado — skeletons padronizados.
const TabFallback = () => (
    <div className="space-y-6">
        <SkeletonChart className="h-64" />
        <SkeletonTableRows rows={3} />
    </div>
);

export const WalletLoading = () => (
    <div className="space-y-6">
        <SkeletonChart className="h-64" />
        <SkeletonTableRows rows={4} />
    </div>
);

interface OverviewProps {
    hasAssets: boolean;
    isReadOnly: boolean;
    autoOpenDividendGoal: boolean;
    onAutoOpenHandled: () => void;
    onImport: () => void;
    onAdd: () => void;
}

const EmptyOverview: React.FC<Omit<OverviewProps, 'hasAssets' | 'isReadOnly'>> = ({ autoOpenDividendGoal, onAutoOpenHandled, onImport, onAdd }) => (
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
                description={'Já investe pela B3? Importe o extrato e traga a carteira inteira de uma vez, com o histórico real de compras e vendas. '
                    + 'Ou comece adicionando o primeiro ativo.'}
                action={
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex flex-col sm:flex-row gap-2.5">
                            <Button onClick={onImport} className="!w-auto px-6 gap-2">
                                <Upload size={16} /> Importar carteira
                            </Button>
                            <Button variant="outline" onClick={onAdd} className="!w-auto px-6 gap-2">
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
            <AllocationChart initialViewMode="IDEAL" autoOpenDividendGoal={autoOpenDividendGoal} onAutoOpenHandled={onAutoOpenHandled} />
        </div>
    </div>
);

const OverviewTab: React.FC<OverviewProps> = ({ hasAssets, isReadOnly, ...emptyProps }) => {
    if (!hasAssets && isReadOnly) {
        // Visitante não tem o que configurar nem cadastrar: só o aviso.
        return (
            <div className="bg-base border border-slate-800 rounded-2xl animate-fade-in">
                <EmptyState
                    icon={<PieSlices size={28} />}
                    title="Carteira sem ativos"
                    description="O investidor ainda não cadastrou posições nesta carteira."
                />
            </div>
        );
    }
    if (!hasAssets) return <EmptyOverview {...emptyProps} />;
    return (
        <>
            <div id="tour-wallet-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-fade-in">
                <div className="lg:col-span-2">
                    <EvolutionChart />
                </div>
                <div className="lg:col-span-1">
                    <AllocationChart autoOpenDividendGoal={emptyProps.autoOpenDividendGoal} onAutoOpenHandled={emptyProps.onAutoOpenHandled} />
                </div>
            </div>
            <div className="mb-8 animate-fade-in">
                <AssetList />
            </div>
        </>
    );
};

const LazyTab: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
    <Suspense fallback={<TabFallback />}>
        <div className={className}>{children}</div>
    </Suspense>
);

const PerformanceTab = () => (
    <LazyTab className="animate-fade-in">
        <div className="grid grid-cols-1 gap-6 mb-8">
            <PerformanceChart />
            <MonthlyReturnsTable />
        </div>
        <div className="p-6 bg-slate-900/30 border border-slate-800 rounded-xl text-center text-slate-500 text-xs">
            * O benchmark comparativo considera a data do primeiro aporte como base 100.
        </div>
    </LazyTab>
);

interface WalletTabContentProps extends OverviewProps {
    activeTab: WalletViewTab;
    access: WalletAccess;
    tourLayer: string;
}

/** Conteúdo da aba ativa. Proventos e IR só montam com o gate aberto. */
export const WalletTabContent: React.FC<WalletTabContentProps> = ({ activeTab, access, tourLayer, ...overview }) => (
    <div id="tour-wallet-content" className={`transition-opacity duration-500 ${tourLayer}`}>
        {activeTab === 'OVERVIEW' && <OverviewTab {...overview} />}
        {activeTab === 'PERFORMANCE' && <PerformanceTab />}
        {activeTab === 'DIVIDENDS' && access.canAccessDividends && (
            <LazyTab className="animate-fade-in"><DividendDashboard /></LazyTab>
        )}
        {activeTab === 'STATEMENT' && (
            <LazyTab className="animate-fade-in max-w-4xl mx-auto"><CashFlowHistory /></LazyTab>
        )}
        {activeTab === 'TAX' && access.canAccessTax && (
            <LazyTab className="animate-fade-in max-w-5xl mx-auto"><TaxReport /></LazyTab>
        )}
    </div>
);
