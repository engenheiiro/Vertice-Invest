import React from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { EquityStatCard } from '../dashboard/EquityStatCard';

/**
 * Card de indicador da Carteira: o mesmo do Terminal (`EquityStatCard`), com o
 * tooltip em portal — dentro do grid ele seria cortado pelos limites do card.
 */
export const StatCard = (props: Omit<React.ComponentProps<typeof EquityStatCard>, 'Tooltip'>) => (
    <EquityStatCard {...props} Tooltip={InfoTooltip} />
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
