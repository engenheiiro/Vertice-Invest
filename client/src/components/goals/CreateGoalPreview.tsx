import React from 'react';
import { formatCurrency } from '../../utils/format';
import { formatMonths } from './goalTheme';
import type { GoalPreview } from './createGoalForm';

const ROW = 'flex items-center justify-between text-sm';

/** Projeção ao vivo do formulário de metas; some sem valor-alvo. */
export const CreateGoalPreview: React.FC<{ preview: GoalPreview | null }> = ({ preview }) => {
  if (!preview) return null;
  const reachable = Number.isFinite(preview.n);
  return (
    <div className="bg-base border border-slate-800 rounded-xl p-4 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Projeção</p>
      <div className={ROW}>
        <span className="text-slate-400">Você já tem</span>
        <span className="font-bold text-slate-100">{formatCurrency(preview.baseline)}</span>
      </div>
      <div className={ROW}>
        <span className="text-slate-400">Tempo estimado</span>
        <span className={`font-bold ${reachable ? 'text-emerald-400' : 'text-yellow-400'}`}>
          {preview.months !== null ? `~${formatMonths(preview.months)}` : 'Sem caminho de chegada'}
        </span>
      </div>
      {preview.projDate && (
        <div className={ROW}>
          <span className="text-slate-400">Data prevista</span>
          <span className="font-bold text-slate-200">{preview.projDate.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>
        </div>
      )}
      {preview.required !== null && (
        <div className={`${ROW} pt-2 border-t border-slate-800`}>
          <span className="text-slate-400">Aporte p/ bater o prazo</span>
          <span className="font-bold text-blue-300">{formatCurrency(preview.required)}/mês</span>
        </div>
      )}
    </div>
  );
};
