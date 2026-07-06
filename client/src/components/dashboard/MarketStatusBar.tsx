
import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Percent, Clock } from 'lucide-react';
import { MarketIndex } from '../../hooks/useDashboardData';

interface MarketStatusBarProps {
    indices: MarketIndex[];
}

export const MarketStatusBar: React.FC<MarketStatusBarProps> = ({ indices }) => {
    
    const marketStatus = useMemo(() => {
        const now = new Date();
        const day = now.getDay(); // 0 = Domingo, 6 = Sábado
        const hour = now.getHours();
        
        // Lógica B3 Básica: Seg-Sex, 10:00 - 18:00
        const isWeekday = day > 0 && day < 6;
        const isOpenHours = hour >= 10 && hour < 18;
        
        if (isWeekday && isOpenHours) {
            return { label: 'Mercado Aberto', color: 'text-emerald-500', dot: 'bg-emerald-500 animate-pulse' };
        } else {
            return { label: 'Mercado Fechado', color: 'text-slate-500', dot: 'bg-slate-600' };
        }
    }, []);

    return (
        <div className="w-full bg-deep border-b border-slate-800/60 py-2 overflow-hidden">
            <div className="max-w-[1360px] mx-auto px-6 flex items-center gap-5 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2 pr-4 border-r border-slate-800/60 shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.dot}`}></span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${marketStatus.color}`}>
                        {marketStatus.label}
                    </span>
                </div>

                {indices.map((idx) => {
                    const change = idx.changePercent || 0;
                    const val = idx.value || 0;
                    const isRate = idx.type === 'RATE'; // CDI, SELIC

                    let Icon = Minus;
                    let colorClass = 'text-slate-400';
                    let chipClass = 'bg-slate-800/60 text-slate-400';

                    if (change > 0) {
                        Icon = TrendingUp;
                        colorClass = 'text-emerald-500';
                        chipClass = 'bg-emerald-500/10 text-emerald-500';
                    } else if (change < 0) {
                        Icon = TrendingDown;
                        colorClass = 'text-red-500';
                        chipClass = 'bg-red-500/10 text-red-500';
                    } else if (isRate) {
                        colorClass = 'text-slate-300';
                        Icon = Percent;
                    }

                    const displayValue = val < 100
                        ? val.toFixed(2)
                        : val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

                    return (
                        <div key={idx.ticker} className="flex items-center gap-2 shrink-0 group cursor-default">
                            <span className="text-[10px] font-bold text-slate-400 font-mono tracking-wide group-hover:text-blue-400 transition-colors">{idx.ticker}</span>
                            <div className={`flex items-center gap-1.5 text-[11px] font-mono font-semibold tabular-nums ${colorClass}`}>
                                {!isRate && <Icon size={11} />}
                                <span className="text-slate-200">{displayValue}</span>

                                {isRate ? (
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wide">a.a.</span>
                                ) : (
                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${chipClass}`}>
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
