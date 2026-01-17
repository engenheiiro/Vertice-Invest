import React from 'react';
import { PieChart, MoreHorizontal, TrendingUp, TrendingDown } from 'lucide-react';
import { PortfolioItem } from '../../hooks/useDashboardData';

interface AssetTableProps {
    items: PortfolioItem[];
}

export const AssetTable: React.FC<AssetTableProps> = ({ items }) => {
    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#0B101A]">
                <h3 className="font-bold text-slate-200 flex items-center gap-2">
                    <PieChart size={16} className="text-blue-500" />
                    Carteira Inteligente
                </h3>
                <div className="flex gap-2">
                    <button className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-slate-700">
                        Rebalancear
                    </button>
                </div>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500 bg-[#0B101A]">
                            <th className="p-4 font-bold">Ativo</th>
                            <th className="p-4 font-bold text-right">Preço</th>
                            <th className="p-4 font-bold text-right">Posição</th>
                            <th className="p-4 font-bold text-center">IA Score (0-100)</th>
                            <th className="p-4 font-bold text-right">Sentimento</th>
                            <th className="p-4 font-bold text-center">Ação</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-slate-800/50">
                        {items.map((item) => (
                            <tr key={item.ticker} className="hover:bg-slate-800/30 transition-colors group">
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 border border-slate-700">
                                            {item.ticker[0]}
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
                                <td className="p-4 text-right">
                                    <p className="font-bold text-slate-200">{formatCurrency(item.currentPrice * item.shares)}</p>
                                    <p className="text-[10px] text-slate-500">{item.shares} un</p>
                                </td>
                                <td className="p-4 text-center">
                                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-slate-700 bg-slate-900 font-bold text-xs shadow-inner" style={{
                                        color: item.aiScore > 70 ? '#34d399' : item.aiScore < 40 ? '#f87171' : '#fbbf24',
                                        borderColor: item.aiScore > 70 ? 'rgba(52, 211, 153, 0.2)' : item.aiScore < 40 ? 'rgba(248, 113, 113, 0.2)' : 'rgba(251, 191, 36, 0.2)'
                                    }}>
                                        {item.aiScore}
                                    </div>
                                </td>
                                <td className="p-4 text-right">
                                    <SentimentBadge sentiment={item.aiSentiment} />
                                </td>
                                <td className="p-4 text-center">
                                    <button className="text-slate-500 hover:text-blue-400 transition-colors p-1 hover:bg-slate-800 rounded">
                                        <MoreHorizontal size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SentimentBadge = ({ sentiment }: { sentiment: string }) => {
    if (sentiment === 'BULLISH') {
        return (
            <div className="flex items-center justify-end gap-1.5 text-emerald-500">
                <span className="text-[10px] font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">COMPRA</span>
                <TrendingUp size={14} />
            </div>
        );
    }
    if (sentiment === 'BEARISH') {
        return (
            <div className="flex items-center justify-end gap-1.5 text-red-500">
                <span className="text-[10px] font-bold bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">VENDA</span>
                <TrendingDown size={14} />
            </div>
        );
    }
    return (
        <div className="flex items-center justify-end gap-1.5 text-slate-500">
            <span className="text-[10px] font-bold bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">MANTER</span>
            <MoreHorizontal size={14} />
        </div>
    );
};