import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './useCountUp';

/**
 * Count-up dos KPIs: anima do valor exibido até o novo com easeOutCubic,
 * termina exatamente no alvo, retoma do número na tela se o valor mudar no
 * meio e respeita prefers-reduced-motion.
 */

const original = window.matchMedia;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query }) as unknown as MediaQueryList);
};

/** Roda o próximo quadro pendente no instante `t` (ms desde o início). */
const frame = (t: number) => act(() => {
  const pending = [...frames.entries()];
  frames.clear();
  pending.forEach(([, cb]) => cb(t));
});

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(nextId, cb); return nextId++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  setReducedMotion(false);
});

afterEach(() => {
  window.matchMedia = original;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('anima com easeOutCubic e termina exatamente no alvo', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, 1000), { initialProps: { v: 0 } });
    expect(result.current).toBe(0);

    rerender({ v: 1000 });
    frame(500);
    // 1 - (1 - 0,5)^3 = 0,875
    expect(result.current).toBeCloseTo(875);
    frame(1200);
    expect(result.current).toBe(1000);
    expect(frames.size).toBe(0);
  });

  it('valor muda no meio: retoma do número exibido, sem pulo', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, 1000), { initialProps: { v: 0 } });
    rerender({ v: 1000 });
    frame(500);
    const shown = result.current;

    rerender({ v: 0 });
    // O quadro da animação anterior foi cancelado; a nova parte de `shown`.
    expect(frames.size).toBe(1);
    frame(500);
    expect(result.current).toBeCloseTo(shown * (1 - 0.875));
    frame(1000);
    expect(result.current).toBe(0);
  });

  it('prefers-reduced-motion vai direto ao valor final', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 10 } });
    rerender({ v: 250 });
    expect(result.current).toBe(250);
    expect(frames.size).toBe(0);
  });
});
