import React from 'react';
import { Info } from 'lucide-react';
import { FitText } from '../ui';

interface EquityStatCardProps {
    label: string;
    tooltipText?: string;
    icon: React.ReactNode;
    iconClass: string;
    value: React.ReactNode;
    valueClass?: string;
    subLabel: string;
    subValue: React.ReactNode;
    tag: React.ReactNode;
    tagClass: string;
    className?: string;
}

const InfoTooltip = ({ text }: { text: string }) => (
    <div className="group/info relative flex items-center">
        <Info size={11} className="text-slate-600 cursor-help hover:text-blue-400 transition-colors" />
        <div className="absolute left-0 top-6 w-48 p-3 bg-elevated border border-slate-700 rounded-xl shadow-xl z-50 opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none">
            <p className="text-[10px] text-slate-300 leading-relaxed font-medium">{text}</p>
            <div className="absolute -top-1.5 left-2 w-3 h-3 bg-elevated border-t border-l border-slate-700 transform rotate-45"></div>
        </div>
    </div>
);

// Card de indicador padrão: superfície + ícone tingido em quadrado + pílula de tag.
// Espelha o StatCard da aba Carteira; o valor usa <FitText> p/ nunca cortar dígitos.
export const EquityStatCard = ({
    label, tooltipText, icon, iconClass, value, valueClass, subLabel, subValue, tag, tagClass, className = '',
}: EquityStatCardProps) => (
    <div className={`h-full bg-base border border-slate-800 rounded-2xl p-[18px] flex flex-col transition-colors hover:border-slate-700 ${className}`}>
        <div className="relative flex min-h-[22px] items-start pr-10">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
                {tooltipText && <InfoTooltip text={tooltipText} />}
            </div>
            <span className={`absolute right-0 top-0 w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${iconClass}`}>
                {icon}
            </span>
        </div>

        <FitText className={`font-extrabold tracking-tight mt-1 mb-3 ${valueClass || 'text-white'}`} max={26} min={14}>
            {value}
        </FitText>

        {/* Valor secundário e selo compartilham a mesma linha — ver WalletSummary. */}
        <div className="mt-auto pt-3 border-t border-slate-800/80">
            <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">{subLabel}</p>
            <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0 text-sm font-bold text-slate-200 truncate">{subValue}</div>
                <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${tagClass}`}>
                    {tag}
                </span>
            </div>
        </div>
    </div>
);
