import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Target, Sparkles, ArrowRight, ArrowDown, Trash2 } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import { goalsService, type Goal } from '../services/goals';
import { STALE_TIME } from '../config/queryConfig';
import { formatCurrency } from '../utils/format';
import { GoalCard } from '../components/goals/GoalCard';
import { CreateGoalModal } from '../components/goals/CreateGoalModal';
import { GoalDetailModal } from '../components/goals/GoalDetailModal';
import { ConfirmModal, EmptyState, SkeletonCard, SkeletonKpiGrid } from '../components/ui';

/** Constrói cadeias de metas sequenciais a partir do campo previousGoalId. */
function buildChains(goals: Goal[]): Goal[][] {
  const idSet = new Set(goals.map((g) => g._id));
  const processed = new Set<string>();
  const result: Goal[][] = [];

  const getNext = (id: string) => goals.find((g) => g.previousGoalId === id);

  for (const goal of goals) {
    if (processed.has(goal._id)) continue;
    // Raiz = sem previousGoalId válido no conjunto atual
    if (goal.previousGoalId && idSet.has(goal.previousGoalId)) continue;

    const chain: Goal[] = [goal];
    let current = goal;
    let next: Goal | undefined;
    while ((next = getNext(current._id)) !== undefined) {
      chain.push(next);
      current = next;
    }
    chain.forEach((g) => processed.add(g._id));
    result.push(chain);
  }

  // Órfãos (previousGoalId aponta para meta arquivada/excluída)
  for (const goal of goals) {
    if (!processed.has(goal._id)) result.push([goal]);
  }

  return result;
}

const ChainArrow: React.FC = () => (
  <>
    <div className="hidden sm:flex items-center justify-center shrink-0 px-1 text-slate-600">
      <ArrowRight size={18} />
    </div>
    <div className="sm:hidden flex items-center justify-center py-0.5 text-slate-600">
      <ArrowDown size={18} />
    </div>
  </>
);

export const Goals: React.FC = () => {
  const { isPrivacyMode } = useWallet();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: goalsService.getGoals,
    staleTime: STALE_TIME.REALTIME,
  });

  const clearAllMutation = useMutation({
    mutationFn: goalsService.clearAllGoals,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      addToast('Todas as metas foram removidas.', 'success');
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao limpar metas.', 'error'),
  });

  const goals = data?.goals || [];

  const chains = useMemo(() => buildChains(goals), [goals]);

  const summary = useMemo(() => {
    const active = goals.filter((g) => g.status === 'ACTIVE').length;
    let totalCurrent = 0;
    let totalTarget = 0;
    for (const chain of chains) {
      // currentValue: todas as metas com mirrorWallet compartilham o mesmo patrimônio —
      // conta uma vez (da última meta, que é o alvo atual da jornada).
      totalCurrent += chain[chain.length - 1].currentValue;
      // target: apenas o alvo final da jornada, não a soma dos marcos intermediários.
      totalTarget += chain[chain.length - 1].targetAmount;
    }
    return { totalTarget, totalCurrent, active };
  }, [chains, goals]);

  // Agrupa chains em "render items": cadeias (≥2) ficam em linha própria;
  // metas isoladas são agrupadas em lotes de até 3 para manter o grid.
  const renderItems = useMemo(() => {
    type Item =
      | { type: 'chain'; goals: Goal[] }
      | { type: 'singles'; goals: Goal[] };

    const items: Item[] = [];
    let buffer: Goal[] = [];

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      for (let i = 0; i < buffer.length; i += 3) {
        items.push({ type: 'singles', goals: buffer.slice(i, i + 3) });
      }
      buffer = [];
    };

    for (const chain of chains) {
      if (chain.length === 1) {
        buffer.push(chain[0]);
      } else {
        flushBuffer();
        items.push({ type: 'chain', goals: chain });
      }
    }
    flushBuffer();

    return items;
  }, [chains]);

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
          <div className="flex items-center gap-2 shrink-0">
            {goals.length > 0 && (
              <button
                onClick={() => setClearOpen(true)}
                className="flex items-center justify-center w-10 h-10 rounded-xl transition-all border bg-red-900/10 border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800 min-w-[44px]"
                title="Limpar todas as metas"
                aria-label="Limpar todas as metas"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-4 py-2.5 text-sm transition-colors"
            >
              <Plus size={16} /> <span className="hidden sm:inline">Nova meta</span>
            </button>
          </div>
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
          <div className="space-y-4" role="status" aria-label="Carregando metas">
            <SkeletonKpiGrid count={3} />
            <SkeletonCard className="h-48" />
            <SkeletonCard className="h-48" />
          </div>
        ) : goals.length === 0 ? (
          <div className="bg-card border border-slate-800 rounded-2xl">
            <EmptyState
              icon={<Sparkles size={28} className="text-emerald-400" />}
              title="Crie sua primeira meta"
              description="Defina um alvo (ex: o primeiro milhão), um aporte mensal, e acompanhe quanto falta — atualizando sozinho conforme você investe."
              action={
                <button
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors"
                >
                  <Plus size={16} /> Nova meta
                </button>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {renderItems.map((item, idx) =>
              item.type === 'singles' ? (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {item.goals.map((goal) => (
                    <GoalCard key={goal._id} goal={goal} privacy={isPrivacyMode} onClick={() => setSelectedId(goal._id)} />
                  ))}
                </div>
              ) : (
                <div key={item.goals[0]._id} className="flex flex-col sm:flex-row items-stretch gap-0">
                  {item.goals.map((goal, i) => (
                    <React.Fragment key={goal._id}>
                      {i > 0 && <ChainArrow />}
                      <div className="flex-1 min-w-0">
                        <GoalCard goal={goal} privacy={isPrivacyMode} onClick={() => setSelectedId(goal._id)} />
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              ),
            )}
          </div>
        )}
      </main>

      <CreateGoalModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
      {selectedId && (
        <GoalDetailModal isOpen={!!selectedId} onClose={() => setSelectedId(null)} goalId={selectedId} privacy={isPrivacyMode} />
      )}
      <ConfirmModal
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => clearAllMutation.mutate()}
        title="Excluir Todas as Metas?"
        message="ATENÇÃO: Esta ação é irreversível. Todas as metas e seus aportes manuais serão apagados."
        isDestructive
        confirmText="Sim, Excluir Tudo"
      />
    </div>
  );
};
