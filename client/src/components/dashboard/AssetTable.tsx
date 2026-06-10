
import React, { useState } from 'react';
import { PieChart, TrendingUp, RefreshCw, Folder, ChevronDown, ChevronRight, Lock, Medal } from 'lucide-react';
import { PortfolioItem } from '../../hooks/useDashboardData';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';
import { useToast } from '../../contexts/ToastContext';
import { useNavigate } from 'react-router-dom';
import { formatCurrency as fmtCurrency } from '../../utils/format';
import { SmartContributionModal } from '../wallet/SmartContributionModal';
import { RebalanceModal } from '../wallet/RebalanceModal';
import { ConfirmModal } from '../ui/ConfirmModal';

interface AssetTableProps {
    items: PortfolioItem[];
    isLoading?: boolean;
    isResearchLoading?: boolean;
}

const GROUP_NAMES: Record<string, string> = {
    'STOCK': 'Ações Brasil',
    'FII': 'Fundos Imobiliários',
    'STOCK_US': 'Exterior',
    'CRYPTO': 'Criptoativos',
    'FIXED_INCOME': 'Renda Fixa',
    'CASH': 'Caixa / Reserva',
    'OUTROS': 'Outros'
};

export const AssetTable: React.FC<AssetTableProps> = ({ items, isLoading = false, isResearchLoading = false }) => {
    const { hasPlan, limitFor } = useFeatureAccess();
    const { isPrivacyMode } = useWallet();
    const { isDemoMode } = useDemo();
    const { addToast } = useToast();
    const navigate = useNavigate();

    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);
    const [isRebalanceModalOpen, setIsRebalanceModalOpen] = useState(false);
    const [limitModalOpen, setLimitModalOpen] = useState(false);
    const [limitMessage, setLimitMessage] = useState('');

    const isPro = hasPlan('PRO');
    const canRebalance = hasPlan('ELITE'); // Rebalanceamento IA: ELITE e Black

    const formatCurrency = (val: number) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });

    // Abre o modal no próprio Terminal (mesma lógica/gating da Carteira).
    const handleOpenSmartContribution = () => {
        if (limitFor('smart_contribution') === 0) {
            setLimitMessage('O Aporte Inteligente é um recurso exclusivo dos planos Pro e Black.');
            setLimitModalOpen(true);
            return;
        }
        setIsSmartModalOpen(true);
    };

    const handleRebalance = () => {
        if (!hasPlan('ELITE')) {
            setLimitMessage('O Rebalanceamento Automático com IA é um recurso exclusivo dos planos Elite e Black.');
            setLimitModalOpen(true);
            return;
        }
        if (isDemoMode) {
            addToast('O Rebalanceamento IA usa os dados reais da sua carteira.', 'info');
            return;
        }
        setIsRebalanceModalOpen(true);
    };

    const toggleGroup = (groupName: string) => {
        setCollapsedGroups(prev => ({
            ...prev,
            [groupName]: !prev[groupName]
        }));
    };

    const groupedItems = items.reduce((acc, item) => {
        const type = item.type || 'OUTROS';
        const groupName = GROUP_NAMES[type] || 'Outros';

        if (!acc[groupName]) acc[groupName] = [];
        acc[groupName].push(item);
        return acc;
    }, {} as Record<string, PortfolioItem[]>);

    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full min-h-[400px]">
            <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card">
                <h3 className="font-bold text-slate-200 flex items-center gap-2">
                    <PieChart size={16} className="text-blue-500" />
                    Carteira Inteligente
                </h3>
                
                <div className="flex gap-2">
                    <button
                        onClick={handleOpenSmartContribution}
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border flex items-center gap-1.5 ${
                            isPro
                            ? 'bg-blue-600/10 text-blue-400 border-blue-600/30 hover:bg-blue-600/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                        }`}
                        title={isPro ? "Aporte Inteligente" : "Exclusivo Pro"}
                    >
                        {!isPro && <Lock size={11} />}
                        <TrendingUp size={12} /> Aporte Inteligente
                    </button>

                    <button
                        onClick={handleRebalance}
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border flex items-center gap-1.5 ${
                            canRebalance
                            ? 'bg-gold/10 text-gold border-gold/30 hover:bg-gold/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                        }`}
                        title={canRebalance ? "Rebalanceamento Automático" : "Exclusivo Elite e Black"}
                    >
                        {!canRebalance && <Lock size={11} />}
                        <RefreshCw size={12} /> Rebalanceamento IA
                    </button>
                </div>
            </div>
            
            {/* Tabela completa — desktop (inalterada) */}
            <div className="hidden md:block overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[750px]">
                    {/* (A2) scope="col" associa cada cabeçalho à sua coluna p/ leitores de tela */}
                    <caption className="sr-only">Ativos da carteira com preço, posição, performance e recomendação</caption>
                    <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500 bg-card">
                            <th scope="col" className="p-4 font-bold">Ativo</th>
                            <th scope="col" className="p-4 font-bold text-right">Preço Atual</th>
                            <th scope="col" className="p-4 font-bold text-right">Preço Médio</th>
                            <th scope="col" className="p-4 font-bold text-right">Posição</th>
                            <th scope="col" className="p-4 font-bold w-48">Performance</th>
                            <th scope="col" className="p-4 font-bold text-right">IA Score</th>
                            <th scope="col" className="p-4 font-bold text-center">Recomendação</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-slate-800/50">
                        {isLoading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="p-4"><div className="flex gap-3"><div className="w-8 h-8 bg-slate-800 rounded"></div><div className="space-y-1"><div className="h-3 w-16 bg-slate-800 rounded"></div><div className="h-2 w-24 bg-slate-800 rounded"></div></div></div></td>
                                    <td className="p-4 text-right"><div className="h-3 w-12 bg-slate-800 rounded ml-auto"></div></td>
                                    <td className="p-4 text-right"><div className="h-3 w-12 bg-slate-800 rounded ml-auto"></div></td>
                                    <td className="p-4 text-right"><div className="h-3 w-20 bg-slate-800 rounded ml-auto"></div></td>
                                    <td className="p-4"><div className="h-2 w-full bg-slate-800 rounded"></div></td>
                                    <td className="p-4 text-right"><div className="h-3 w-8 bg-slate-800 rounded ml-auto"></div></td>
                                    <td className="p-4 text-center"><div className="h-6 w-16 bg-slate-800 rounded mx-auto"></div></td>
                                </tr>
                            ))
                        ) : (
                            Object.entries(groupedItems).map(([group, groupItems]) => (
                                <React.Fragment key={group}>
                                    <tr 
                                        className="bg-panel border-y border-slate-800/50 cursor-pointer hover:bg-[#161b28] transition-colors"
                                        onClick={() => toggleGroup(group)}
                                    >
                                        <td colSpan={7} className="px-4 py-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                                    {collapsedGroups[group] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                    <Folder size={12} /> {group}
                                                </span>
                                                <span className="text-[9px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                                    {(groupItems as PortfolioItem[]).length} Ativos
                                                </span>
                                            </div>
                                        </td>
                                    </tr>

                                    {!collapsedGroups[group] && (groupItems as PortfolioItem[]).map((item) => {
                                        const profit = item.currentPrice - item.avgPrice;
                                        const profitPercent = item.avgPrice > 0 ? (profit / item.avgPrice) * 100 : 0;
                                        const maxRange = Math.max(item.currentPrice, item.avgPrice) * 1.2;
                                        const isChampion = profitPercent > 15; // Regra visual para 'Campeã'

                                        return (
                                            <tr key={item.ticker} className="hover:bg-slate-800/30 transition-colors group">
                                                <td className="p-4">
                                                    {isDemoMode ? (
                                                        <div className="flex items-center gap-3 opacity-60">
                                                            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center border border-slate-700 text-slate-500">
                                                                <Lock size={12} />
                                                            </div>
                                                            <div>
                                                                <div className="h-4 w-16 bg-slate-700/50 rounded blur-[3px] mb-1"></div>
                                                                <div className="h-2 w-24 bg-slate-800/50 rounded blur-[3px]"></div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 border border-slate-700">
                                                                {item.ticker.substring(0,2)}
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <p className="font-bold text-slate-200">{item.ticker}</p>
                                                                    {isChampion && (
                                                                        <span title="Campeã: Retorno > 15%" className="text-gold animate-pulse">
                                                                            <Medal size={12} fill="currentColor" />
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[10px] text-slate-500">{item.name}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-4 text-right font-mono text-slate-300">
                                                    {formatCurrency(item.currentPrice)}
                                                </td>
                                                <td className="p-4 text-right font-mono text-slate-400">
                                                    {formatCurrency(item.avgPrice)}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <p className="font-bold text-slate-200">{formatCurrency(item.currentPrice * item.shares)}</p>
                                                    <p className="text-[10px] text-slate-500">{item.shares} un</p>
                                                </td>
                                                
                                                <td className="p-4">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex justify-between text-[9px] font-bold">
                                                            <span className="text-slate-500">Var. Total</span>
                                                            <span className={profit >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                                                                {profit >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                                                            <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${Math.min((item.avgPrice / maxRange) * 100, 100)}%` }}></div>
                                                            <div 
                                                                className={`h-full rounded-full transition-all duration-700 ${profit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                                style={{ width: `${Math.min((item.currentPrice / maxRange) * 100, 100)}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="p-4 text-right">
                                                    {isResearchLoading && item.aiScore === 0 ? (
                                                        <div className="flex flex-col items-end gap-1 opacity-60">
                                                            <div className="h-3 w-8 bg-slate-700 rounded animate-pulse"></div>
                                                        </div>
                                                    ) : item.aiScore > 0 ? (
                                                        <span className="font-black text-xs text-white">{item.aiScore}</span>
                                                    ) : (
                                                        <span className="text-[10px] text-slate-600 italic">--</span>
                                                    )}
                                                </td>

                                                <td className="p-4 text-center">
                                                    {isResearchLoading && item.aiScore === 0 ? (
                                                        <div className="h-5 w-16 bg-slate-700 rounded animate-pulse mx-auto"></div>
                                                    ) : item.aiScore > 0 ? (
                                                        <span className={`inline-block text-[9px] font-black uppercase px-2 py-1 rounded border min-w-[70px] text-center ${
                                                            item.aiSentiment === 'BULLISH' ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' :
                                                            item.aiSentiment === 'BEARISH' ? 'text-red-500 border-red-500/30 bg-red-500/10' :
                                                            'text-slate-400 border-slate-700 bg-slate-800'
                                                        }`}>
                                                            {item.aiSentiment === 'BULLISH' ? 'COMPRA' : item.aiSentiment === 'BEARISH' ? 'VENDA' : 'MANTER'}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] text-slate-600">--</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </React.Fragment>
                            ))
                        )}
                        
                        {!isLoading && items.length === 0 && (
                            <tr>
                                <td colSpan={7} className="p-10 text-center text-slate-500">
                                    Nenhum ativo na carteira.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Lista em cards — mobile (md:hidden). Mesma lógica de grupos/colapso da tabela. */}
            <div className="md:hidden p-3 space-y-3">
                {isLoading ? (
                    [...Array(4)].map((_, i) => (
                        <div key={i} className="animate-pulse bg-card border border-slate-800 rounded-xl p-4 h-24" />
                    ))
                ) : items.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">Nenhum ativo na carteira.</div>
                ) : (
                    Object.entries(groupedItems).map(([group, groupItems]) => (
                        <div key={group} className="space-y-2">
                            <button
                                onClick={() => toggleGroup(group)}
                                className="w-full flex items-center justify-between bg-panel border border-slate-800/50 rounded-lg px-3 py-2"
                            >
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                    {collapsedGroups[group] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                    <Folder size={12} /> {group}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                    {(groupItems as PortfolioItem[]).length} Ativos
                                </span>
                            </button>

                            {!collapsedGroups[group] && (groupItems as PortfolioItem[]).map((item) => {
                                const profit = item.currentPrice - item.avgPrice;
                                const profitPercent = item.avgPrice > 0 ? (profit / item.avgPrice) * 100 : 0;
                                const isChampion = profitPercent > 15;

                                return (
                                    <div key={item.ticker} className="bg-card border border-slate-800 rounded-xl p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-9 h-9 shrink-0 rounded bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 border border-slate-700">
                                                    {isDemoMode ? <Lock size={12} /> : item.ticker.substring(0, 2)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="font-bold text-slate-200">{isDemoMode ? '••••' : item.ticker}</p>
                                                        {isChampion && !isDemoMode && (
                                                            <span title="Campeã: Retorno > 15%" className="text-gold">
                                                                <Medal size={12} fill="currentColor" />
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-slate-500 truncate">{isDemoMode ? '•••••••' : item.name}</p>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="font-bold text-slate-200 text-sm">{formatCurrency(item.currentPrice * item.shares)}</p>
                                                <p className="text-[10px] text-slate-500">{item.shares} un</p>
                                            </div>
                                        </div>

                                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                                            <div className="bg-slate-900/40 rounded-lg py-2">
                                                <p className="text-[9px] text-slate-500 uppercase">Var.</p>
                                                <p className={`text-xs font-bold ${profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {profit >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                                                </p>
                                            </div>
                                            <div className="bg-slate-900/40 rounded-lg py-2">
                                                <p className="text-[9px] text-slate-500 uppercase">IA Score</p>
                                                <p className="text-xs font-black text-white">
                                                    {item.aiScore > 0 ? item.aiScore : '--'}
                                                </p>
                                            </div>
                                            <div className="flex items-center justify-center">
                                                {item.aiScore > 0 ? (
                                                    <span className={`inline-block text-[9px] font-black uppercase px-2 py-1 rounded border text-center ${
                                                        item.aiSentiment === 'BULLISH' ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' :
                                                        item.aiSentiment === 'BEARISH' ? 'text-red-500 border-red-500/30 bg-red-500/10' :
                                                        'text-slate-400 border-slate-700 bg-slate-800'
                                                    }`}>
                                                        {item.aiSentiment === 'BULLISH' ? 'COMPRA' : item.aiSentiment === 'BEARISH' ? 'VENDA' : 'MANTER'}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-600">--</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))
                )}
            </div>

            {/* Modais (createPortal) — reusam a lógica da Carteira, no próprio Terminal. */}
            <SmartContributionModal isOpen={isSmartModalOpen} onClose={() => setIsSmartModalOpen(false)} />
            <RebalanceModal isOpen={isRebalanceModalOpen} onClose={() => setIsRebalanceModalOpen(false)} />
            <ConfirmModal
                isOpen={limitModalOpen}
                onClose={() => setLimitModalOpen(false)}
                onConfirm={() => navigate('/pricing')}
                title="Acesso Restrito"
                message={`${limitMessage}\n\nDeseja fazer um upgrade agora?`}
                confirmText="Ver Planos"
                isDestructive={false}
            />
        </div>
    );
};
