import {
  Target, Home, Car, Plane, GraduationCap, PiggyBank, Rocket, Gift, Heart, Shield,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Mapas estáticos de ícone/cor das metas. Estáticos (não construídos por
 * interpolação) para que o Tailwind não purgue as classes no build.
 */
export const GOAL_ICONS: Record<string, LucideIcon> = {
  target: Target,
  home: Home,
  car: Car,
  plane: Plane,
  graduation: GraduationCap,
  piggy: PiggyBank,
  rocket: Rocket,
  gift: Gift,
  heart: Heart,
  shield: Shield,
};

export interface GoalColorTheme {
  text: string;
  bgSoft: string;
  border: string;
  stroke: string; // cor hex para o SVG do anel
}

export const GOAL_COLORS: Record<string, GoalColorTheme> = {
  emerald: { text: 'text-emerald-400', bgSoft: 'bg-emerald-500/10', border: 'border-emerald-500/30', stroke: '#34d399' },
  blue: { text: 'text-blue-400', bgSoft: 'bg-blue-500/10', border: 'border-blue-500/30', stroke: '#60a5fa' },
  purple: { text: 'text-purple-400', bgSoft: 'bg-purple-500/10', border: 'border-purple-500/30', stroke: '#a78bfa' },
  yellow: { text: 'text-yellow-400', bgSoft: 'bg-yellow-500/10', border: 'border-yellow-500/30', stroke: '#facc15' },
  red: { text: 'text-red-400', bgSoft: 'bg-red-500/10', border: 'border-red-500/30', stroke: '#f87171' },
  cyan: { text: 'text-cyan-400', bgSoft: 'bg-cyan-500/10', border: 'border-cyan-500/30', stroke: '#22d3ee' },
};

export const ICON_OPTIONS = Object.keys(GOAL_ICONS);
export const COLOR_OPTIONS = Object.keys(GOAL_COLORS);

export const getGoalTheme = (color?: string): GoalColorTheme => GOAL_COLORS[color || 'emerald'] || GOAL_COLORS.emerald;
export const getGoalIcon = (icon?: string): LucideIcon => GOAL_ICONS[icon || 'target'] || Target;

/** Formata meses como "Xa Ym" (ou "Y meses" se < 1 ano). */
export const formatMonths = (months: number | null): string => {
  if (months === null || !Number.isFinite(months)) return '—';
  if (months <= 0) return 'concluído';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} ${rest === 1 ? 'mês' : 'meses'}`;
  if (rest === 0) return `${years} ${years === 1 ? 'ano' : 'anos'}`;
  return `${years}a ${rest}m`;
};
