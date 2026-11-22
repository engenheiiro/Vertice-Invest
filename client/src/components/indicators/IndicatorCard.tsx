import React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { changeTrend, fmtCardValue } from '../../pages/indicatorsView';

interface IndicatorCardProps {
    label: string;
    value?: number;
    suffix?: string;
    desc: string;
    color?: string;
    icon?: React.ReactNode;
    isCurrency?: boolean;
    currencyPrefix?: string;
    change?: number;
    stale?: boolean;
}

const ChangeBadge = ({ change }: { change?: number }) => {
    const trend = changeTrend(change);
    if (!trend || change === undefined) return null;
    const ChangeIcon = trend.direction === 'up' ? TrendingUp : TrendingDown;
    return (
        <span className={`text-[10px] font-bold flex items-center ${trend.color}`}>
            <ChangeIcon size={10} className="mr-1" />
            {Math.abs(change).toFixed(2)}%
        </span>
    );
};

export const IndicatorCard = ({
    label, value, suffix = '', desc, color = 'text-white', icon, isCurrency = false, currencyPrefix = 'R$', change, stale = false,
}: IndicatorCardProps) => (
    <div className={`bg-base border p-5 rounded-2xl flex flex-col justify-between transition-colors relative overflow-hidden group ${stale ? 'border-yellow-500/40' : 'border-slate-800 hover:border-slate-700'}`}>
        <div className="flex justify-between items-start mb-2 relative z-10">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                {label}
                {stale && <AlertTriangle size={10} className="text-yellow-400" aria-label="Dado em fallback (BCB indisponível)" />}
            </span>
            {icon && <div className="text-slate-600">{icon}</div>}
        </div>

        <div className="relative z-10">
            <p className={`text-xl font-black ${color} tracking-tight`}>
                {fmtCardValue(value, isCurrency, currencyPrefix)}
                {suffix}
            </p>

            <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-slate-600 font-medium">{desc}</span>
                <ChangeBadge change={change} />
            </div>
        </div>
        <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-slate-800/50 rounded-full blur-[40px] group-hover:bg-slate-700/50 transition-colors"></div>
    </div>
);
