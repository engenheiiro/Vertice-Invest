
import React from 'react';
import { TrendingUp, TrendingDown, Minus, Percent } from 'lucide-react';
import { MarketIndex } from '../../hooks/useDashboardData';

interface MarketStatusBarProps {
    indices: MarketIndex[];
}

export const MarketStatusBar: React.FC<MarketStatusBarProps> = ({ indices }) => {
    return (
        <div className="w-full bg-[#02040a] border-b border-slate-800/60 py-1.5 overflow-hidden">
            <div className="max-w-[1600px] mx-auto px-6 flex items-center gap-6 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2 pr-4 border-r border-slate-800/60 shrink-0">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Mercado Aberto</span>
                </div>
                
                {indices.map((idx) => {
                    const change = idx.changePercent || 0;
                    const val = idx.value || 0;
                    const isRate = idx.type === 'RATE'; // CDI, SELIC
                    
                    let Icon = Minus;
                    let colorClass = 'text-slate-400';
                    let bgClass = 'bg-slate-800/50';

                    if (change > 0) {
                        Icon = TrendingUp;
                        colorClass = 'text-emerald-500';
                        bgClass = 'bg-emerald-500/10';
                    } else if (change < 0) {
                        Icon = TrendingDown;
                        colorClass = 'text-red-500';
                        bgClass = 'bg-red-500/10';
                    } else if (isRate) {
                        // Estilo neutro/destacado para taxas que não oscilam no dia
                        colorClass = 'text-slate-300'; 
                        Icon = Percent;
                    }

                    const displayValue = val < 100 
                        ? val.toFixed(2) 
                        : val.toLocaleString('pt-BR', { maximumFractionDigits: 3 }); 

                    return (
                        <div key={idx.ticker} className="flex items-center gap-2 shrink-0 group cursor-default">
                            <span className="text-[10px] font-bold text-slate-300 font-mono group-hover:text-blue-400 transition-colors">{idx.ticker}</span>
                            <div className={`flex items-center gap-1 text-[10px] font-mono ${colorClass}`}>
                                {!isRate && <Icon size={10} />}
                                <span>{displayValue}</span>
                                
                                {isRate ? (
                                    <span className="px-1 text-[9px] text-slate-500 font-bold uppercase">a.a.</span>
                                ) : (
                                    <span className={`px-1 rounded ${bgClass}`}>
                                        {change > 0 ? '+' : ''}{change.toFixed(2)}%
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
