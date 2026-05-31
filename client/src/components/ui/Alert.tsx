import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type AlertVariant = 'success' | 'error' | 'warning' | 'info';

interface AlertProps {
  variant?: AlertVariant;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const VARIANTS: Record<AlertVariant, { icon: LucideIcon; text: string; border: string; bg: string }> = {
  success: { icon: CheckCircle2, text: 'text-emerald-400', border: 'border-emerald-900/40', bg: 'bg-emerald-900/10' },
  error: { icon: XCircle, text: 'text-red-400', border: 'border-red-900/40', bg: 'bg-red-900/10' },
  warning: { icon: AlertTriangle, text: 'text-yellow-400', border: 'border-yellow-900/40', bg: 'bg-yellow-900/10' },
  info: { icon: Info, text: 'text-blue-400', border: 'border-blue-900/40', bg: 'bg-blue-900/10' },
};

/**
 * Caixa de alerta padronizada (M11), seguindo o semáforo do design system.
 * `role="alert"` para erros/avisos (lido por leitores de tela — A5/A11).
 */
export const Alert = ({ variant = 'info', title, children, className = '' }: AlertProps) => {
  const v = VARIANTS[variant];
  const Icon = v.icon;
  const assertive = variant === 'error' || variant === 'warning';

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${v.border} ${v.bg} ${className}`}
    >
      <Icon size={18} className={`${v.text} mt-0.5 shrink-0`} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className={`text-sm font-bold ${v.text}`}>{title}</p>}
        {children && <div className="text-sm text-slate-300 leading-relaxed">{children}</div>}
      </div>
    </div>
  );
};
