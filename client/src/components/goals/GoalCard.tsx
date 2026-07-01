import React from 'react';
import { CheckCircle2, TrendingUp, TrendingDown, AlertTriangle, CalendarClock } from 'lucide-react';
import type { Goal } from '../../services/goals';
import { getGoalTheme, getGoalIcon, formatMonths } from './goalTheme';
import { formatCurrency, formatCompact } from '../../utils/format';

interface ProgressRingProps {
  pct: number;
  stroke: string;
  size?: number;
}

const ProgressRing: React.FC<ProgressRingProps> = ({ pct, stroke, size = 72 }) => {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e293b" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={stroke}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
};

interface GoalCardProps {
  goal: Goal;
  privacy?: boolean;
  onClick: () => void;
}

export const GoalCard: React.FC<GoalCardProps> = ({ goal, privacy, onClick }) => {
  const theme = getGoalTheme(goal.color);
  const Icon = getGoalIcon(goal.icon);
  const achieved = goal.achieved || goal.status === 'ACHIEVED';
  const targetYear = goal.projectedDate ? new Date(goal.projectedDate).getFullYear() : null;

  return (
    <button
      onClick={onClick}
      className={`relative text-left bg-card border ${theme.border} rounded-2xl p-5 hover:bg-elevated transition-colors w-full group`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl ${theme.bgSoft} flex items-center justify-center shrink-0`}>
            <Icon className={theme.text} size={22} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 leading-tight">{goal.name}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Meta: {formatCompact(goal.targetAmount, 'BRL', { privacy })}
            </p>
          </div>
        </div>

        <div className="relative shrink-0">
          <ProgressRing pct={goal.progressPct} stroke={theme.stroke} />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-200">
            {Math.round(goal.progressPct)}%
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Você já tem</p>
          <p className="text-lg font-bold text-slate-100">{formatCurrency(goal.currentValue, 'BRL', { privacy })}</p>
        </div>
        <div className="text-right">
          {achieved ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
              <CheckCircle2 size={14} /> Conquistada
            </span>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1 justify-end">
                <CalendarClock size={11} /> Faltam
              </p>
              <p className="text-sm font-bold text-slate-200">
                {formatMonths(goal.monthsRemaining)}
                {targetYear && <span className="text-slate-500 font-medium"> · {targetYear}</span>}
              </p>
            </>
          )}
        </div>
      </div>

      {achieved ? (
        // Footer também no estado conquistado → mantém a MESMA altura dos demais cards.
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-[11px] font-medium">
          {goal.currentValue > goal.targetAmount ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <TrendingUp size={12} /> {formatCurrency(goal.currentValue - goal.targetAmount, 'BRL', { privacy })} acima da meta
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 size={12} /> Objetivo alcançado
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-[11px] font-medium">
          {goal.dateDeltaMonths !== null && goal.dateDeltaMonths > 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <TrendingUp size={12} /> {formatMonths(goal.dateDeltaMonths)} adiantado
            </span>
          ) : goal.dateDeltaMonths !== null && goal.dateDeltaMonths < 0 ? (
            <span className="inline-flex items-center gap-1 text-yellow-400">
              <TrendingDown size={12} /> {formatMonths(Math.abs(goal.dateDeltaMonths))} atrasado
            </span>
          ) : goal.onTrack ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <TrendingUp size={12} /> No caminho · {formatCurrency(goal.monthlyTarget, 'BRL', { privacy })}/mês
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-yellow-400">
              <AlertTriangle size={12} /> Ritmo abaixo do necessário
            </span>
          )}
        </div>
      )}
    </button>
  );
};
