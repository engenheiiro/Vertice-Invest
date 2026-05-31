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
