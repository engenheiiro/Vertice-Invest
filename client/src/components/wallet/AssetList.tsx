
import React, { useState } from 'react';
import { useWallet, AssetType, Asset } from '../../contexts/WalletContext';
import { TrendingUp, TrendingDown, Trash2, Folder, PieChart, History, ChevronDown, ChevronRight, EyeOff } from 'lucide-react';
import { AssetTransactionsModal } from './AssetTransactionsModal';

const TYPE_LABELS: Record<string, string> = {
    STOCK: 'Ações Brasil',
    FII: 'Fundos Imobiliários',
    STOCK_US: 'Exterior (Stocks/REITs)',
    CRYPTO: 'Criptoativos',
    FIXED_INCOME: 'Renda Fixa',
    CASH: 'Caixa / Reserva'
};

export const AssetList = () => {
    const { assets, removeAsset, kpis, targetAllocation, isPrivacyMode } = useWallet();
    const [historyTicker, setHistoryTicker] = useState<string | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const formatCurrency = (val: number | null | undefined, currency: string = 'BRL') => {
        if (isPrivacyMode) return '••••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val || 0);
    };

    const formatPercent = (val: number | null | undefined) => {
        const v = val || 0;
        if (!isFinite(v) || isNaN(v)) return '0.00%';
        return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
    };

    const toggleGroup = (type: string) => {
        setCollapsedGroups(prev => ({ ...prev, [type]: !prev[type] }));
    };

    const groupedAssets = assets.reduce((acc, asset) => {
        if (!acc[asset.type]) acc[asset.type] = [];
        acc[asset.type].push(asset);
        return acc;
    }, {} as Record<string, Asset[]>);

    const typeOrder = ['STOCK', 'FII', 'STOCK_US', 'FIXED_INCOME', 'CRYPTO', 'CASH'];
    const visibleTypes = typeOrder.filter(type => groupedAssets[type] && groupedAssets[type].length > 0);

    return (
        <>
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden animate-fade-in">
                <div className="p-5 border-b border-slate-800 bg-[#0B101A] flex justify-between items-center">
                    <h3 className="font-bold text-slate-200 flex items-center gap-2">
                        <Folder size={16} className="text-blue-500" />
                        Detalhamento por Classe
                    </h3>
                    {isPrivacyMode && (
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                            <EyeOff size={10} /> Modo Privado
                        </div>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-[#0B101A] border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                                <th className="p-4 font-bold">Ativo</th>
                                <th className="p-4 font-bold text-right">Preço Médio</th>
                                <th className="p-4 font-bold text-right">Preço Atual</th>
                                <th className="p-4 font-bold text-right">Saldo Atual (R$)</th>
                                <th className="p-4 font-bold text-right">Rentabilidade</th>
                                <th className="p-4 font-bold text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {visibleTypes.map(type => {
                                const groupItems = groupedAssets[type];
                                const isCollapsed = collapsedGroups[type];
                                
                                const totalValueGroup = groupItems.reduce((acc, item) => acc + (item.totalValue || 0), 0);
                                const totalCostGroup = groupItems.reduce((acc, item) => acc + (item.totalCost || 0), 0);
                                
                                const profitGroup = totalValueGroup - totalCostGroup;
                                const profitPercentGroup = totalCostGroup > 0 
                                    ? (profitGroup / totalCostGroup) * 100 
                                    : 0;
                                
                                const allocationPercent = (kpis.totalEquity || 0) > 0 ? (totalValueGroup / kpis.totalEquity) * 100 : 0;
                                const idealPercent = targetAllocation[type as AssetType] || 0;

                                return (
                                    <React.Fragment key={type}>
                                        <tr 
                                            className="bg-[#0F131E] border-y border-slate-800/50 cursor-pointer hover:bg-[#161b28] transition-colors"
                                            onClick={() => toggleGroup(type)}
                                        >
                                            <td colSpan={6} className="px-4 py-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                            <PieChart size={14} /> {TYPE_LABELS[type]}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800/50">
                                                            {groupItems.length} Ativos
                                                        </span>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-6 text-[10px] md:text-xs">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Total</span>
                                                            <span className="text-white font-mono font-bold">{formatCurrency(totalValueGroup)}</span>
                                                        </div>
                                                        
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Resultado</span>
                                                            <span className={`font-bold ${profitGroup >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                                {formatPercent(profitPercentGroup)}
                                                            </span>
                                                        </div>

                                                        <div className="flex flex-col items-end min-w-[100px]">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Alocação (Ideal: {idealPercent}%)</span>
                                                            <div className="flex items-center gap-2 w-full justify-end">
                                                                <span className="text-white font-bold">{allocationPercent.toFixed(1)}%</span>
                                                                <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(allocationPercent, 100)}%` }}></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>

                                        {!isCollapsed && groupItems.map((asset) => {
                                            const profit = asset.profit || 0;
                                            return (
                                                <tr key={asset.id} className="hover:bg-slate-800/30 transition-colors border-b border-slate-800/30 last:border-0 group animate-fade-in">
                                                    <td className="p-4 pl-8">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-xs border border-slate-700 ${
                                                                asset.type === 'CRYPTO' ? 'text-purple-400' :
                                                                asset.type === 'STOCK_US' ? 'text-blue-400' : 'text-slate-300'
                                                            }`}>
                                                                {asset.ticker.substring(0, 2)}
                                                            </div>
                                                            <div>
                                                                <p className="font-bold text-slate-200">{asset.ticker}</p>
                                                                <p className="text-[10px] text-slate-500">{asset.name}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right text-slate-400 font-mono">
                                                        {formatCurrency(asset.averagePrice, asset.currency)}
                                                    </td>
                                                    <td className="p-4 text-right text-slate-300 font-mono font-bold">
                                                        {formatCurrency(asset.currentPrice, asset.currency)}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <p className="font-bold text-white">
                                                            {formatCurrency(asset.totalValue, 'BRL')} 
                                                        </p>
                                                        <p className="text-[10px] text-slate-500">
                                                            {asset.quantity} un
                                                        </p>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <div className={`flex flex-col items-end ${profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                            <span className="font-bold flex items-center gap-1">
                                                                {profit >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                                {formatPercent(asset.profitPercent)}
                                                            </span>
                                                            <span className="text-[10px] opacity-80">
                                                                {profit >= 0 ? '+' : ''}{formatCurrency(profit, 'BRL')}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button 
                                                                onClick={() => setHistoryTicker(asset.ticker)}
                                                                className="p-2 text-slate-600 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                                                title="Ver Histórico"
                                                            >
                                                                <History size={16} />
                                                            </button>
                                                            <button 
                                                                onClick={() => {
                                                                    if(confirm(`Remover ${asset.ticker} e todo o histórico?`)) removeAsset(asset.id);
                                                                }}
                                                                className="p-2 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                                                title="Remover Ativo"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <AssetTransactionsModal 
                isOpen={!!historyTicker} 
                ticker={historyTicker || ''} 
                onClose={() => setHistoryTicker(null)} 
            />
        </>
    );
};
