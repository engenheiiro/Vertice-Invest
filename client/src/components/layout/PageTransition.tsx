import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface PageTransitionProps {
  children: React.ReactNode;
}

/**
 * Envolve o conteúdo de cada rota e aplica a animação `page-enter`
 * sempre que o pathname muda.
 *
 * Respeita `prefers-reduced-motion`: se o usuário preferir movimento reduzido
 * a animação não dispara (o CSS do Tailwind não é afetado, mas o wrapper fica
 * com opacity-100 e sem transform para não causar flash).
 */
export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    el.classList.remove('animate-page-enter');
    // Force reflow so the class removal is applied before re-adding.
    void el.offsetWidth;
    el.classList.add('animate-page-enter');
  }, [location.pathname]);

  return (
    <div ref={ref} className="animate-page-enter">
      {children}
    </div>
  );
};
