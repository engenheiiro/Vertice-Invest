import { useEffect, useRef, useState } from 'react';

/**
 * (U4) Anima um número do valor anterior até o atual (efeito "count-up") via
 * requestAnimationFrame — sem biblioteca. Usado nos KPIs (patrimônio) para dar
 * a sensação de algo "vivo" quando os dados chegam/atualizam.
 *
 * Respeita `prefers-reduced-motion`: se o usuário pediu menos movimento, vai
 * direto ao valor final sem animar. Se o valor mudar no meio, anima a partir do
 * número atualmente exibido (sem "pulo").
 */
export function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const from = displayRef.current;
    const to = value;

    if (prefersReduced || from === to) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (to - from) * eased;
      displayRef.current = current;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = to;
        setDisplay(to);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return display;
}
