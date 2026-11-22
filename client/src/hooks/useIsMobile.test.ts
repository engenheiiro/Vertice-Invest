import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

/**
 * Breakpoint do layout mobile (< xl/1280px): lê a media query no mount, reage
 * a resize/rotação e solta o listener ao desmontar — com fallback para o
 * addListener do Safari antigo.
 */

type Listener = (e: MediaQueryListEvent) => void;

const fakeMql = (matches: boolean, modern = true) => {
  const listeners = new Set<Listener>();
  const add = vi.fn((_type: string, l: Listener) => { listeners.add(l); });
  const remove = vi.fn((_type: string, l: Listener) => { listeners.delete(l); });
  const legacyAdd = vi.fn((l: Listener) => { listeners.add(l); });
  const legacyRemove = vi.fn((l: Listener) => { listeners.delete(l); });
  const mql = {
    matches,
    media: '',
    addEventListener: modern ? add : undefined,
    removeEventListener: remove,
    addListener: legacyAdd,
    removeListener: legacyRemove,
  };
  const fire = (next: boolean) => listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
  return { mql, fire, listeners, legacyAdd, legacyRemove };
};

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

describe('useIsMobile', () => {
  it('consulta o breakpoint xl e reflete o estado inicial', () => {
    const { mql } = fakeMql(true);
    const matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
    window.matchMedia = matchMedia;

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 1279px)');
  });

  it('reage à mudança de viewport e solta o listener ao desmontar', () => {
    const { mql, fire, listeners } = fakeMql(false);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => fire(true));
    expect(result.current).toBe(true);

    unmount();
    expect(listeners.size).toBe(0);
  });

  it('Safari antigo: usa addListener/removeListener', () => {
    const { mql, fire, legacyAdd, legacyRemove } = fakeMql(false, false);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    const { result, unmount } = renderHook(() => useIsMobile());
    act(() => fire(true));

    expect(legacyAdd).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
    unmount();
    expect(legacyRemove).toHaveBeenCalledTimes(1);
  });
});
