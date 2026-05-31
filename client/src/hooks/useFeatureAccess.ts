import { useAuth } from '../contexts/AuthContext';
import type { UserPlan } from '../contexts/AuthContext';
import { PLAN_HIERARCHY, PLAN_ACCESS, FEATURE_LIMITS } from '../constants/subscription';

/**
 * Fonte única para gating de plano no frontend. Substitui as comparações
 * ad-hoc espalhadas (`user.plan === 'PRO' || user.plan === 'BLACK'`, etc.).
 *
 * - `hasPlan(min)`  → o plano do usuário é >= o mínimo exigido (hierarquia).
 * - `hasFeature(k)` → a chave de feature está liberada para o plano (PLAN_ACCESS).
 * - `limitFor(k)`   → limite numérico da feature (9999 = ilimitado).
 */
export const useFeatureAccess = () => {
  const { user } = useAuth();
  const plan: UserPlan = user?.plan || 'GUEST';
  const level = PLAN_HIERARCHY[plan];

  const hasPlan = (minPlan: UserPlan) => level >= PLAN_HIERARCHY[minPlan];
  const hasFeature = (key: string) => PLAN_ACCESS[plan]?.includes(key) ?? false;
  const limitFor = (key: string) => FEATURE_LIMITS[key]?.[plan] ?? 0;

  return { plan, level, hasPlan, hasFeature, limitFor };
};
