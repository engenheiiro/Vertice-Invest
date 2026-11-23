import React from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { FitText } from '../ui';

interface StatCardProps {
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

// Card de indicador padrão: superfície + ícone tingido em quadrado + pílula de tag,
// espelhando o layout do mock. Mantém os tokens de tema (bg-base/slate) p/ coerência
// com o resto do app (dark #080C14 / light branco).
export const StatCard = ({ label, tooltipText, icon, iconClass, value, valueClass, subLabel, subValue, tag, tagClass, className = '' }: StatCardProps) => (
    <div className={`h-full bg-base border border-slate-800 rounded-2xl p-[18px] flex flex-col transition-colors hover:border-slate-700 ${className}`}>
        <div className="relative flex min-h-[22px] items-start pr-10">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
                {tooltipText && (
                    <InfoTooltip text={tooltipText} />
                )}
            </div>
            <span className={`absolute right-0 top-0 w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${iconClass}`}>
                {icon}
            </span>
        </div>

        <FitText className={`font-extrabold tracking-tight mt-1 mb-3 ${valueClass || 'text-white'}`} max={26} min={14}>
            {value}
        </FitText>

        {/* Valor secundário e selo compartilham a mesma linha para manter todos os KPIs compactos. */}
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

type TooltipPosition = {
    left: number;
    top: number;
    arrowLeft: number;
    placement: 'above' | 'below';
};

export const InfoTooltip = ({ text, iconClass = 'text-slate-600 hover:text-blue-400' }: { text: string; iconClass?: string }) => {
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const [position, setPosition] = React.useState<TooltipPosition | null>(null);

    const showTooltip = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;

        const triggerRect = trigger.getBoundingClientRect();
        const tooltipWidth = 192;
        const halfWidth = tooltipWidth / 2;
        const viewportPadding = 8;
        const triggerCenter = triggerRect.left + triggerRect.width / 2;
        const left = Math.min(
            window.innerWidth - halfWidth - viewportPadding,
            Math.max(halfWidth + viewportPadding, triggerCenter)
        );
        // O padrão visual é abaixo do ícone. Se faltar espaço no fim da janela,
        // inverte para cima; o portal impede recorte pelos limites do card.
        const placement = window.innerHeight - triggerRect.bottom >= 80 ? 'below' : 'above';
        const top = placement === 'below' ? triggerRect.bottom + 8 : triggerRect.top - 8;
        const arrowLeft = Math.min(tooltipWidth - 12, Math.max(12, triggerCenter - (left - halfWidth)));

        setPosition({ left, top, arrowLeft, placement });
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                data-tooltip-trigger
                aria-label={text}
                onMouseEnter={showTooltip}
                onMouseLeave={() => setPosition(null)}
                onFocus={showTooltip}
                onBlur={() => setPosition(null)}
                className="relative flex items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
                <Info size={11} className={`${iconClass} cursor-help transition-colors`} />
            </button>
            {position && createPortal(
                <span
                    role="tooltip"
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: position.placement === 'above' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
                    }}
                    className="pointer-events-none fixed z-[200] w-48 rounded-xl border border-slate-700 bg-elevated p-3 text-left text-[10px] font-medium leading-relaxed text-slate-300 shadow-xl"
                >
                    {text}
                    <span
                        aria-hidden="true"
                        style={{ left: position.arrowLeft }}
                        className={`absolute h-3 w-3 -translate-x-1/2 rotate-45 bg-elevated ${position.placement === 'above'
                            ? '-bottom-1.5 border-b border-r border-slate-700'
                            : '-top-1.5 border-l border-t border-slate-700'
                            }`}
                    />
                </span>,
                document.body
            )}
        </>
    );
};
