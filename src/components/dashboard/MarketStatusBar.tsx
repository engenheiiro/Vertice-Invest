import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
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
                
                {indices.map((idx) => (
                    <div key={idx.ticker} className="flex items-center gap-2 shrink-0 group cursor-default">
                        <span className="text-[10px] font-bold text-slate-300 font-mono group-hover:text-blue-400 transition-colors">{idx.ticker}</span>
                        <div className={`flex items-center gap-1 text-[10px] font-mono ${idx.changePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {idx.changePercent >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            <span>{idx.value.toLocaleString()}</span>
                            <span className={`px-1 rounded ${idx.changePercent >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                                {idx.changePercent > 0 ? '+' : ''}{idx.changePercent}%
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};