import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Target, Loader2, Sparkles } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { useWallet } from '../contexts/WalletContext';
import { goalsService } from '../services/goals';
import { STALE_TIME } from '../config/queryConfig';
import { formatCurrency } from '../utils/format';
import { GoalCard } from '../components/goals/GoalCard';
import { CreateGoalModal } from '../components/goals/CreateGoalModal';
import { GoalDetailModal } from '../components/goals/GoalDetailModal';

export const Goals: React.FC = () => {
  const { isPrivacyMode } = useWallet();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: goalsService.getGoals,
    staleTime: STALE_TIME.REALTIME,
  });

  const goals = data?.goals || [];

  const summary = useMemo(() => {
    const totalTarget = goals.reduce((acc, g) => acc + g.targetAmount, 0);
    const totalCurrent = goals.reduce((acc, g) => acc + g.currentValue, 0);
    const active = goals.filter((g) => g.status === 'ACTIVE').length;
    return { totalTarget, totalCurrent, active };
  }, [goals]);

  return (
    <div className="min-h-screen bg-deep text-white pb-24 md:pb-8">
      <Header />
      <main id="main-content" className="max-w-[1600px] mx-auto p-4 md:p-6">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Target className="text-emerald-400" size={24} /> Metas
            </h1>
            <p className="text-sm text-slate-500 mt-1">Planeje, acompanhe e acelere seus objetivos patrimoniais.</p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-4 py-2.5 text-sm transition-colors shrink-0"
          >
            <Plus size={16} /> <span className="hidden sm:inline">Nova meta</span>
          </button>
        </div>

        {/* Resumo */}
        {goals.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Metas ativas</p>
              <p className="text-xl font-bold text-slate-100 mt-1">{summary.active}</p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Acumulado nas metas</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(summary.totalCurrent, 'BRL', { privacy: isPrivacyMode })}</p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4 col-span-2 md:col-span-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Soma dos alvos</p>
              <p className="text-xl font-bold text-slate-100 mt-1">{formatCurrency(summary.totalTarget, 'BRL', { privacy: isPrivacyMode })}</p>
            </div>
          </div>
        )}

        {/* Conteúdo */}
        {isLoading ? (
          <div className="py-20 flex items-center justify-center">
            <Loader2 className="animate-spin text-slate-500" size={28} />
          </div>
        ) : goals.length === 0 ? (
          <div className="text-center py-16 px-4 bg-card border border-slate-800 rounded-2xl">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="text-emerald-400" size={30} />
            </div>
            <h2 className="text-lg font-bold text-slate-100">Crie sua primeira meta</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Defina um alvo (ex: <span className="text-slate-300 font-semibold">o primeiro milhão</span>), um aporte mensal,
              e acompanhe quanto falta — atualizando sozinho conforme você investe.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-5 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors"
            >
              <Plus size={16} /> Nova meta
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {goals.map((goal) => (
              <GoalCard key={goal._id} goal={goal} privacy={isPrivacyMode} onClick={() => setSelectedId(goal._id)} />
            ))}
          </div>
        )}
      </main>

      <CreateGoalModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
      {selectedId && (
        <GoalDetailModal isOpen={!!selectedId} onClose={() => setSelectedId(null)} goalId={selectedId} privacy={isPrivacyMode} />
      )}
    </div>
  );
};
