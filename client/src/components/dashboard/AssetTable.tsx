import React from 'react';
import { PieChart, MoreHorizontal, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
                <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500 bg-[#0B101A]">
                            <th className="p-4 font-bold">Ativo</th>
                            <th className="p-4 font-bold text-right">Preço</th>
                            <th className="p-4 font-bold text-right">Posição</th>
                            <th className="p-4 font-bold w-48">Desempenho (Médio vs Atual)</th>
                            <th className="p-4 font-bold text-right">Sentimento IA</th>
                            <th className="p-4 font-bold text-center">Ação</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-slate-800/50">
                        {items.map((item) => {
                            const profit = item.currentPrice - item.avgPrice;
                            const profitPercent = (profit / item.avgPrice) * 100;
                            const maxRange = Math.max(item.currentPrice, item.avgPrice) * 1.2; // Escala do gráfico

                            return (
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
                                    
                                    {/* Gráfico Visual de Performance */}
                                    <td className="p-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex justify-between text-[9px] font-bold">
                                                <span className="text-slate-500">PM: {item.avgPrice.toFixed(2)}</span>
                                                <span className={profit >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                                                    {profit >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                                                {/* Marcador de Preço Médio (Centro relativo) */}
                                                <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${(item.avgPrice / maxRange) * 100}%` }}></div>
                                                
                                                {/* Barra de Preço Atual */}
                                                <div 
                                                    className={`h-full rounded-full transition-all duration-700 ${profit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                    style={{ width: `${(item.currentPrice / maxRange) * 100}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </td>

                                    <td className="p-4 text-right">
                                        <SentimentBadge sentiment={item.aiSentiment} score={item.aiScore} />
                                    </td>
                                    <td className="p-4 text-center">
                                        <button className="text-slate-500 hover:text-blue-400 transition-colors p-1 hover:bg-slate-800 rounded">
                                            <MoreHorizontal size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SentimentBadge = ({ sentiment, score }: { sentiment: string, score: number }) => {
    let colorClass = 'text-slate-500 bg-slate-800 border-slate-700';
    let label = 'MANTER';
    let Icon = Minus;

    if (sentiment === 'BULLISH') {
        colorClass = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        label = 'COMPRA';
        Icon = TrendingUp;
    } else if (sentiment === 'BEARISH') {
        colorClass = 'text-red-500 bg-red-500/10 border-red-500/20';
        label = 'VENDA';
        Icon = TrendingDown;
    }

    return (
        <div className="flex flex-col items-end gap-0.5">
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${colorClass}`}>
                <span>{label}</span>
                <Icon size={12} />
            </div>
            <span className="text-[9px] text-slate-500 font-mono">Score: {score}</span>
        </div>
    );
};