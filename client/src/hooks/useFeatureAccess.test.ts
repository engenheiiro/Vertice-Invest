import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFeatureAccess } from './useFeatureAccess';
import { useAuth } from '../contexts/AuthContext';

// Mocka só o AuthContext — as constantes de plano (PLAN_HIERARCHY/ACCESS/LIMITS)
// são as reais, para o teste validar o gating de verdade.
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

const asPlan = (plan: string | null) =>
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: plan ? { plan } : null,
  });

beforeEach(() => vi.clearAllMocks());

describe('useFeatureAccess — hasPlan (hierarquia)', () => {
  it('PRO satisfaz PRO e abaixo, mas não BLACK', () => {
    asPlan('PRO');
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.hasPlan('ESSENTIAL')).toBe(true);
    expect(result.current.hasPlan('PRO')).toBe(true);
    expect(result.current.hasPlan('BLACK')).toBe(false);
  });

  it('sem usuário assume GUEST (nível 0)', () => {
    asPlan(null);
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.plan).toBe('GUEST');
    expect(result.current.hasPlan('ESSENTIAL')).toBe(false);
  });
});

describe('useFeatureAccess — hasFeature (PLAN_ACCESS)', () => {
  it('PRO tem radar/stocks mas não global (exclusivo BLACK)', () => {
    asPlan('PRO');
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.hasFeature('radar')).toBe(true);
    expect(result.current.hasFeature('stocks')).toBe(true);
    expect(result.current.hasFeature('global')).toBe(false);
  });

  it('BLACK tem features exclusivas (global, rebalance)', () => {
    asPlan('BLACK');
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.hasFeature('global')).toBe(true);
    expect(result.current.hasFeature('rebalance')).toBe(true);
  });
});

describe('useFeatureAccess — limitFor (FEATURE_LIMITS)', () => {
  it('smart_contribution: PRO ilimitado (9999), ESSENTIAL 0', () => {
    asPlan('PRO');
    expect(renderHook(() => useFeatureAccess()).result.current.limitFor('smart_contribution')).toBe(9999);
    asPlan('ESSENTIAL');
    expect(renderHook(() => useFeatureAccess()).result.current.limitFor('smart_contribution')).toBe(0);
  });

  it('report: ESSENTIAL tem 1; chave inexistente → 0', () => {
    asPlan('ESSENTIAL');
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.limitFor('report')).toBe(1);
    expect(result.current.limitFor('chave_inexistente')).toBe(0);
  });
});
