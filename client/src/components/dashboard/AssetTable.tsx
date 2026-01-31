
import React, { useState } from 'react';
import { PieChart, MoreHorizontal, TrendingUp, TrendingDown, Minus, RefreshCw, Crown, Folder, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { PortfolioItem } from '../../hooks/useDashboardData';
import { useAuth } from '../../contexts/AuthContext';
import { useWallet } from '../../contexts/WalletContext';
import { useNavigate } from 'react-router-dom';

interface AssetTableProps {
    items: PortfolioItem[];
    isLoading?: boolean; // Carregamento estrutural (Carteira vazia/sync inicial)
    isResearchLoading?: boolean; // Carregamento de dados de IA (Scores)
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
    const { user } = useAuth();
    const { isPrivacyMode } = useWallet(); 
    const navigate = useNavigate();
    
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const isPro = user?.plan !== 'GUEST' && user?.plan !== 'ESSENTIAL';
    const isBlack = user?.plan === 'BLACK';

    const formatCurrency = (val: number) => {
        if (isPrivacyMode) return '••••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const toggleGroup = (groupName: string) => {
        setCollapsedGroups(prev => ({
            ...prev,
            [groupName]: !prev[groupName]
        }));
    };

    const groupedItems = items.reduce((acc, item) => {
        let type = 'OUTROS';
        if (item.ticker.endsWith('11') || item.ticker.endsWith('11B')) type = 'FII'; 
        else if (item.ticker.length <= 6 && !item.ticker.includes('-')) type = 'STOCK';
        else if (item.ticker.includes('-') || item.ticker === 'BTC' || item.ticker === 'ETH') type = 'CRYPTO';

        const groupName = GROUP_NAMES[type] || 'Outros';

        if (!acc[groupName]) acc[groupName] = [];
        acc[groupName].push(item);
        return acc;
    }, {} as Record<string, PortfolioItem[]>);

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full min-h-[400px]">
            <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0B101A]">
                <h3 className="font-bold text-slate-200 flex items-center gap-2">
                    <PieChart size={16} className="text-blue-500" />
                    Carteira Inteligente
                </h3>
                
                <div className="flex gap-2">
                    <button 
                        onClick={() => navigate('/wallet')} 
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border flex items-center gap-1.5 ${
                            isPro 
                            ? 'bg-blue-600/10 text-blue-400 border-blue-600/30 hover:bg-blue-600/20' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 opacity-50 cursor-not-allowed'
                        }`}
                        title={isPro ? "Aporte Inteligente" : "Exclusivo Pro"}
                    >
                        <TrendingUp size={12} /> Aporte Inteligente
                    </button>

                    <button 
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border flex items-center gap-1.5 ${
                            isBlack 
                            ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30 hover:bg-[#D4AF37]/20' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 opacity-50 cursor-not-allowed'
                        }`}
                        title={isBlack ? "Rebalanceamento Automático" : "Exclusivo Black"}
                    >
                        <RefreshCw size={12} /> Rebalanceamento IA
                    </button>
                </div>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[750px]">
                    <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500 bg-[#0B101A]">
                            <th className="p-4 font-bold">Ativo</th>
                            <th className="p-4 font-bold text-right">Preço Atual</th>
                            <th className="p-4 font-bold text-right">Preço Médio</th>
                            <th className="p-4 font-bold text-right">Posição</th>
                            <th className="p-4 font-bold w-48">Performance</th>
                            <th className="p-4 font-bold text-right">IA Score</th>
                            <th className="p-4 font-bold text-center">Ação</th>
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
                                    <td className="p-4 text-center"><div className="h-6 w-6 bg-slate-800 rounded mx-auto"></div></td>
                                </tr>
                            ))
                        ) : (
                            Object.entries(groupedItems).map(([group, groupItems]) => (
                                <React.Fragment key={group}>
                                    <tr 
                                        className="bg-[#0F131E] border-y border-slate-800/50 cursor-pointer hover:bg-[#161b28] transition-colors"
                                        onClick={() => toggleGroup(group)}
                                    >
                                        <td colSpan={7} className="px-4 py-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                                    {collapsedGroups[group] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                    <Folder size={12} /> {group}
                                                </span>
                                                <span className="text-[9px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                                    {groupItems.length} Ativos
                                                </span>
                                            </div>
                                        </td>
                                    </tr>

                                    {!collapsedGroups[group] && (groupItems as PortfolioItem[]).map((item) => {
                                        const profit = item.currentPrice - item.avgPrice;
                                        const profitPercent = item.avgPrice > 0 ? (profit / item.avgPrice) * 100 : 0;
                                        const maxRange = Math.max(item.currentPrice, item.avgPrice) * 1.2;

                                        return (
                                            <tr key={item.ticker} className="hover:bg-slate-800/30 transition-colors group">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 border border-slate-700">
                                                            {item.ticker.substring(0,2)}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-200">{item.ticker}</p>
                                                            <p className="text-[10px] text-slate-500">{item.name}</p>
                                                        </div>
                                                    </div>
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
                                                            {/* Marker do PM */}
                                                            <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${Math.min((item.avgPrice / maxRange) * 100, 100)}%` }}></div>
                                                            <div 
                                                                className={`h-full rounded-full transition-all duration-700 ${profit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                                style={{ width: `${Math.min((item.currentPrice / maxRange) * 100, 100)}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* COLUNA IA SCORE - Skeleton Híbrido */}
                                                <td className="p-4 text-right">
                                                    {isResearchLoading && item.aiScore === 0 ? (
                                                        <div className="flex flex-col items-end gap-1 opacity-60">
                                                            <div className="h-3 w-8 bg-slate-700 rounded animate-pulse"></div>
                                                            <div className="h-2 w-12 bg-slate-700 rounded animate-pulse"></div>
                                                        </div>
                                                    ) : item.aiScore > 0 ? (
                                                        <div className="flex flex-col items-end gap-0.5 animate-fade-in">
                                                            <div className="font-black text-xs text-white">{item.aiScore}</div>
                                                            <div className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                                                                item.aiSentiment === 'BULLISH' ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' :
                                                                item.aiSentiment === 'BEARISH' ? 'text-red-500 border-red-500/30 bg-red-500/10' :
                                                                'text-slate-500 border-slate-700 bg-slate-800'
                                                            }`}>
                                                                {item.aiSentiment === 'BULLISH' ? 'Compra' : item.aiSentiment === 'BEARISH' ? 'Venda' : 'Manter'}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-slate-600 italic">--</span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <button className="text-slate-500 hover:text-blue-400 transition-colors p-1 hover:bg-slate-800 rounded">
                                                        <MoreHorizontal size={16} />
                                                    </button>
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
        </div>
    );
};
