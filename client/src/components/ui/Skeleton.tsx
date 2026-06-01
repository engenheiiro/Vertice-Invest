interface SkeletonProps {
  /** Classes Tailwind extras (largura/altura/forma). */
  className?: string;
  /** Atalho para `rounded-full` (avatares, badges circulares). */
  circle?: boolean;
}

/**
 * Bloco de carregamento padronizado (M11). Usa `animate-pulse` sobre o tom de
 * card do design system. Substitui os `div animate-pulse` ad-hoc espalhados.
 *
 * Ex.: `<Skeleton className="h-4 w-32" />` ou `<Skeleton circle className="h-10 w-10" />`
 */
export const Skeleton = ({ className = '', circle = false }: SkeletonProps) => (
  <div
    className={`animate-pulse bg-slate-800/60 ${circle ? 'rounded-full' : 'rounded-lg'} ${className}`}
    aria-hidden="true"
  />
);

/** Conjunto de linhas de texto skeleton. */
export const SkeletonText = ({ lines = 3, className = '' }: { lines?: number; className?: string }) => (
  <div className={`space-y-2 ${className}`} aria-hidden="true">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
    ))}
  </div>
);

/**
 * (I12) Skeletons compostos — vocabulário padronizado para os padrões de
 * carregamento recorrentes (card, gráfico, grid de KPIs, linhas de tabela).
 * Todos marcados `role="status"` + `aria-label` p/ leitores de tela (A11y).
 */

/** Card genérico em carregamento (altura configurável). */
export const SkeletonCard = ({ className = 'h-40' }: { className?: string }) => (
  <div
    role="status"
    aria-label="Carregando"
    className={`bg-card border border-slate-800 rounded-2xl p-5 ${className}`}
  >
    <Skeleton className="h-4 w-1/3 mb-4" />
    <SkeletonText lines={3} />
  </div>
);

/** Placeholder de gráfico (título + área). */
export const SkeletonChart = ({ className = 'h-64' }: { className?: string }) => (
  <div
    role="status"
    aria-label="Carregando gráfico"
    className={`bg-card border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 ${className}`}
  >
    <Skeleton className="h-4 w-40" />
    <Skeleton className="flex-1 w-full" />
  </div>
);

/** Grade de KPIs (cards). */
export const SkeletonKpiGrid = ({ count = 4, className = '' }: { count?: number; className?: string }) => (
  <div
    role="status"
    aria-label="Carregando indicadores"
    className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}
  >
    {Array.from({ length: count }).map((_, i) => (
      <Skeleton key={i} className="h-[140px] rounded-2xl" />
    ))}
  </div>
);

/** Linhas de tabela/lista em carregamento. */
export const SkeletonTableRows = ({ rows = 5, className = '' }: { rows?: number; className?: string }) => (
  <div role="status" aria-label="Carregando lista" className={`space-y-3 ${className}`}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-4">
        <Skeleton circle className="h-9 w-9 shrink-0" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-20" />
      </div>
    ))}
  </div>
);
