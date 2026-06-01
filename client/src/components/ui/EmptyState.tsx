import React from 'react';

/**
 * (U3) Estado vazio padronizado do design system.
 *
 * Substitui os "Nenhum item encontrado" soltos por uma tela com ícone, título,
 * descrição e uma ação opcional (CTA). Usado quando uma lista/seção não tem
 * dados — carteira sem ativos, sem proventos, sem sinais, etc.
 */
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Botão/CTA opcional (ex.: "Adicionar ativo"). */
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => (
  <div className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}>
    {icon && (
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/50 border border-slate-700/50 text-slate-500">
        {icon}
      </div>
    )}
    <h3 className="text-base font-bold text-slate-200">{title}</h3>
    {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
