import { useId, useState, type ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Posição do tooltip relativa ao alvo (default `top`). */
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const SIDE_CLASSES: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/**
 * Tooltip acessível (M11). Aparece no hover e no foco por teclado (A10),
 * associado ao alvo via `aria-describedby`.
 */
export const Tooltip = ({ content, children, side = 'top', className = '' }: TooltipProps) => {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute z-[110] whitespace-nowrap rounded-lg bg-card border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 shadow-xl pointer-events-none ${SIDE_CLASSES[side]}`}
        >
          {content}
        </span>
      )}
    </span>
  );
};
