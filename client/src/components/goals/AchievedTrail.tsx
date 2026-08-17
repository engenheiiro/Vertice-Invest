import React from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { Goal } from '../../services/goals';
import { getGoalIcon, getGoalTheme } from './goalTheme';
import { formatCompact } from '../../utils/format';

interface AchievedTrailProps {
  goals: Goal[];
  privacy?: boolean;
  onExpand: () => void;
}

/** Teto de chips: acima disso a lista quebra em linhas e estica o trilho para
 *  além da altura dos cards da mesma linha. O excedente vira "+N". */
const MAX_CHIPS = 5;

/**
 * Marcos já conquistados de uma jornada, colapsados num único nó da cadeia.
 * Numa cadeia espelhada na carteira todo card conquistado repete o MESMO
 * patrimônio — quatro cards idênticos empurram as metas vivas para fora da
 * primeira tela. Aqui a conquista continua visível (é ela que dá a sensação de
 * progresso), mas ocupando o lugar de uma meta, não de quatro.
 */
export const AchievedTrail: React.FC<AchievedTrailProps> = ({ goals, privacy, onExpand }) => {
  const shown = goals.slice(0, MAX_CHIPS);
  const hidden = goals.length - shown.length;

  return (
    <button
      onClick={onExpand}
      title="Mostrar os marcos já conquistados"
      aria-label={`Mostrar os ${goals.length} marcos já conquistados`}
      className="group h-full w-full text-left bg-card/50 border border-dashed border-emerald-500/25 rounded-2xl p-5 hover:bg-elevated hover:border-emerald-500/40 transition-colors flex flex-col justify-center gap-3"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
        <span className="text-sm font-bold text-slate-200">{goals.length} metas conquistadas</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((goal) => {
          const Icon = getGoalIcon(goal.icon);
          const theme = getGoalTheme(goal.color);
          return (
            <span
              key={goal._id}
              className="inline-flex items-center gap-1 rounded-lg bg-elevated/70 border border-slate-800 px-2 py-1"
            >
              <Icon size={12} className={theme.text} />
              <span className="text-[11px] font-semibold text-slate-400">
                {formatCompact(goal.targetAmount, 'BRL', { privacy })}
              </span>
            </span>
          );
        })}
        {hidden > 0 && <span className="text-[11px] font-semibold text-slate-500 px-1">+{hidden}</span>}
      </div>

      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 group-hover:text-slate-300">
        <ChevronDown size={12} /> Ver os marcos
      </span>
    </button>
  );
};
