import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  Plus, Pencil, Trash2, Loader2, ArrowUpRight, TrendingUp, TrendingDown, CheckCircle2,
  AlertTriangle, Info, Calendar, Target as TargetIcon, Flame, Sparkles, Trophy,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../../contexts/ToastContext';
import { useWallet } from '../../contexts/WalletContext';
import { useConfirm } from '../../hooks/useConfirm';
import { goalsService, type Goal } from '../../services/goals';
import { formatCurrency, formatCompact } from '../../utils/format';
import { monthsRemaining, monthsSaved, addMonths } from '../../utils/goalMath';
import { getCoachMessages, type CoachTone, type CoachMessage } from '../../utils/goalCoach';
import { getGoalTheme, getGoalIcon, formatMonths } from './goalTheme';
import { ContributionModal } from './ContributionModal';
import { CreateGoalModal } from './CreateGoalModal';

interface GoalDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  goalId: string;
  privacy?: boolean;
}

const TONE_STYLES: Record<CoachTone, { wrap: string; icon: React.ReactNode }> = {
  success: { wrap: 'bg-emerald-500/5 border-emerald-500/20', icon: <CheckCircle2 className="text-emerald-400 shrink-0" size={16} /> },
  info: { wrap: 'bg-blue-500/5 border-blue-500/20', icon: <Info className="text-blue-400 shrink-0" size={16} /> },
  warning: { wrap: 'bg-yellow-500/5 border-yellow-500/20', icon: <AlertTriangle className="text-yellow-400 shrink-0" size={16} /> },
};

const HERO_ICON: Record<CoachTone, React.ReactNode> = {
  success: <Sparkles className="text-emerald-400 shrink-0" size={20} />,
  info: <Info className="text-blue-400 shrink-0" size={20} />,
  warning: <AlertTriangle className="text-yellow-400 shrink-0" size={20} />,
};

const HERO_WRAP: Record<CoachTone, string> = {
  success: 'bg-emerald-500/10 border-emerald-500/30',
  info: 'bg-blue-500/10 border-blue-500/30',
  warning: 'bg-yellow-500/10 border-yellow-500/30',
};

const Stat: React.FC<{ label: string; value: React.ReactNode; icon: React.ReactNode; accent?: string }> = ({ label, value, icon, accent }) => (
  <div className="bg-base border border-slate-800 rounded-xl p-3">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
      {icon} {label}
    </div>
    <p className={`text-sm font-bold ${accent || 'text-slate-100'}`}>{value}</p>
  </div>
);

const MILESTONES = [25, 50, 75, 100];

export const GoalDetailModal: React.FC<GoalDetailModalProps> = ({ isOpen, onClose, goalId, privacy }) => {
  const { addToast } = useToast();
  const { activeWalletId } = useWallet();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { theme: uiTheme } = useTheme();
  const chartTooltipStyle = uiTheme === 'light'
    ? { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#0f172a' }
    : { background: '#0B101A', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 };
  const [contribOpen, setContribOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [whatIfPmt, setWhatIfPmt] = useState<number | null>(null);
  const celebratedRef = useRef<number>(0);

  const { data, isLoading } = useQuery({
    queryKey: ['goal', goalId, activeWalletId],
    queryFn: () => goalsService.getGoal(goalId, activeWalletId),
    enabled: isOpen && !!goalId,
  });

  const goal: Goal | undefined = data?.goal;

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<{ monthlyTarget: number; lastCelebratedMilestone: number }>) => goalsService.updateGoal(goalId, payload, activeWalletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['goal', goalId] });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: () => goalsService.deleteGoal(goalId, activeWalletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      addToast('Meta removida.', 'success');
      onClose();
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao remover meta.', 'error'),
  });

  const deleteContribMutation = useMutation({
    mutationFn: (cid: string) => goalsService.deleteContribution(goalId, cid, activeWalletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['goal', goalId] });
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao remover aporte.', 'error'),
  });

  // Comemoração de marco: dispara UMA vez ao cruzar 25/50/75/100%.
  useEffect(() => {
    if (!goal) return;
    const already = Math.max(goal.lastCelebratedMilestone || 0, celebratedRef.current);
    const crossed = MILESTONES.filter((m) => goal.progressPct >= m && m > already).pop();
    if (crossed) {
      celebratedRef.current = crossed;
      addToast(crossed >= 100 ? '🏆 Meta conquistada!' : `🎉 Você cruzou ${crossed}% da meta!`, 'success');
      updateMutation.mutate({ lastCelebratedMilestone: crossed });
    }
  }, [goal?.progressPct, goal?.lastCelebratedMilestone]);

  const chartData = data?.trajectory || [];

  const coachMessages: CoachMessage[] = useMemo(() => {
    if (!goal || !data) return [];
    return getCoachMessages({
      progressPct: goal.progressPct,
      onTrack: goal.onTrack,
      achieved: goal.achieved,
      monthsRemaining: goal.monthsRemaining,
      monthlyTarget: goal.monthlyTarget,
      requiredMonthlyForDeadline: goal.requiredMonthlyForDeadline,
      hasDeadline: !!goal.targetDate,
      fromContribution: data.currentMonth.fromContribution,
      fromMarket: data.currentMonth.fromMarket,
      dateDeltaMonths: goal.dateDeltaMonths,
      valueVsPlan: goal.valueVsPlan,
      streak: data.streak,
      avgContribution3m: data.avgContribution3m,
    });
  }, [goal, data]);

  // Simulador what-if.
  const whatIf = useMemo(() => {
    if (!goal) return null;
    const pmt = whatIfPmt ?? goal.monthlyTarget;
    const n = monthsRemaining(goal.currentValue, pmt, goal.expectedAnnualRate, goal.targetAmount);
    const date = Number.isFinite(n) ? addMonths(new Date(), n) : null;
    const saved = monthsSaved(goal.currentValue, goal.monthlyTarget, goal.expectedAnnualRate, goal.targetAmount, pmt - goal.monthlyTarget);
    return { pmt, n, date, saved };
  }, [goal, whatIfPmt]);

  const handleDeleteGoal = async () => {
    if (await confirm({ title: 'Excluir meta?', message: 'Isso remove a meta e seus aportes manuais. Sua carteira não é afetada.', isDestructive: true, confirmText: 'Excluir' })) {
      deleteGoalMutation.mutate();
    }
  };

  const handleDeleteContrib = async (cid: string) => {
    if (await confirm({ title: 'Remover aporte?', message: 'O saldo manual da meta será ajustado.', isDestructive: true, confirmText: 'Remover' })) {
      deleteContribMutation.mutate(cid);
    }
  };

  const theme = goal ? getGoalTheme(goal.color) : getGoalTheme('emerald');
  const Icon = getGoalIcon(goal?.icon);
  const fmtAxis = (t: string) => new Date(t).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

  const hero = coachMessages[0];
  const monthAportado = data?.currentMonth.contributions ?? 0;
  const monthRemaining = goal ? Math.max(0, goal.monthlyTarget - monthAportado) : 0;
  const monthPct = goal && goal.monthlyTarget > 0 ? Math.min(100, (monthAportado / goal.monthlyTarget) * 100) : 0;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={goal?.name || 'Meta'} maxWidth="max-w-3xl" accent={`border-t-4`}>
        {isLoading || !goal ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="animate-spin text-slate-500" size={28} />
          </div>
        ) : (
          <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
            {/* Insight-herói */}
            {hero && (
              <div className={`flex items-start gap-3 border rounded-xl p-4 ${HERO_WRAP[hero.tone]}`}>
                {HERO_ICON[hero.tone]}
                <div>
                  <p className="text-sm font-bold text-slate-100">{hero.title}</p>
                  <p className="text-xs text-slate-300 leading-snug mt-0.5">{hero.text}</p>
                </div>
              </div>
            )}

            {/* Cabeçalho de progresso */}
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl ${theme.bgSoft} flex items-center justify-center shrink-0`}>
                <Icon className={theme.text} size={28} />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-extrabold text-slate-100">{formatCurrency(goal.currentValue, 'BRL', { privacy })}</span>
                  <span className="text-sm text-slate-500">de {formatCompact(goal.targetAmount, 'BRL', { privacy })}</span>
                </div>
                {/* Barra com marcos 25/50/75% */}
                <div className="mt-2 relative h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, goal.progressPct)}%`, backgroundColor: theme.stroke }} />
                  {[25, 50, 75].map((m) => (
                    <span key={m} className="absolute top-0 bottom-0 w-px bg-slate-950/60" style={{ left: `${m}%` }} />
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{goal.progressPct.toFixed(1).replace('.', ',')}% · faltam {formatCurrency(goal.remainingAmount, 'BRL', { privacy })}</p>
              </div>
            </div>

            {/* Bloco de datas: prevista vs plano */}
            <div className="bg-base border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              {goal.achieved && goal.achievedAt ? (
                <div className="flex items-center gap-2">
                  <Trophy className="text-emerald-400" size={18} />
                  <div>
                    <p className="text-sm font-bold text-emerald-400">Conquistada em {new Date(goal.achievedAt).toLocaleDateString('pt-BR')}</p>
                    {goal.dateDeltaMonths !== null && goal.dateDeltaMonths !== 0 && (
                      <p className="text-[11px] text-slate-400">{Math.abs(goal.dateDeltaMonths)} {Math.abs(goal.dateDeltaMonths) === 1 ? 'mês' : 'meses'} {goal.dateDeltaMonths > 0 ? 'antes' : 'depois'} do previsto</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Data prevista</p>
                    <p className="text-base font-bold text-slate-100">{goal.projectedDate ? new Date(goal.projectedDate).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '—'}</p>
                  </div>
                  {goal.dateDeltaMonths !== null && (
                    <div className="text-right">
                      {goal.dateDeltaMonths > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-400"><TrendingUp size={15} /> {formatMonths(goal.dateDeltaMonths)} adiantado</span>
                      ) : goal.dateDeltaMonths < 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-yellow-400"><TrendingDown size={15} /> {formatMonths(Math.abs(goal.dateDeltaMonths))} atrasado</span>
                      ) : (
                        <span className="text-sm font-bold text-slate-300">No plano</span>
                      )}
                      {Math.abs(goal.valueVsPlan) >= 1 && (
                        <p className={`text-[11px] ${goal.valueVsPlan >= 0 ? 'text-emerald-400/80' : 'text-yellow-400/80'}`}>
                          {goal.valueVsPlan >= 0 ? '+' : '−'}{formatCurrency(Math.abs(goal.valueVsPlan), 'BRL', { privacy })} vs. plano
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Faltam" icon={<Calendar size={11} />} value={goal.achieved ? 'Concluída' : formatMonths(goal.monthsRemaining)} accent={goal.achieved ? 'text-emerald-400' : undefined} />
              <Stat label="Planejada" icon={<TargetIcon size={11} />} value={goal.plannedDate ? new Date(goal.plannedDate).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '—'} />
              <Stat label="Aporte/mês" icon={<ArrowUpRight size={11} />} value={formatCompact(goal.monthlyTarget, 'BRL', { privacy })} />
              <Stat
                label={goal.targetDate ? 'Necessário/mês' : 'Ritmo 3m'}
                icon={goal.onTrack ? <TrendingUp size={11} /> : <AlertTriangle size={11} />}
                value={goal.targetDate && goal.requiredMonthlyForDeadline !== null ? formatCompact(goal.requiredMonthlyForDeadline, 'BRL', { privacy }) : formatCompact(data?.avgContribution3m || 0, 'BRL', { privacy })}
                accent={goal.onTrack ? 'text-emerald-400' : 'text-yellow-400'}
              />
            </div>

            {/* Gráfico: Real + Plano + Projeção */}
            {chartData.length > 1 && (
              <div className="bg-base border border-slate-800 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Trajetória da meta</p>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="goalReal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={theme.stroke} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={theme.stroke} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={48} tickFormatter={(v) => formatCompact(v, null)} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={{ color: '#94a3b8' }}
                      labelFormatter={(t) => new Date(t).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                      formatter={(value: number, key: string) => [formatCurrency(value), key === 'real' ? 'Real' : key === 'planned' ? 'Plano' : 'Projeção']}
                    />
                    <ReferenceLine y={goal.targetAmount} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
                    <Area type="monotone" dataKey="real" stroke={theme.stroke} strokeWidth={2} fill="url(#goalReal)" connectNulls={false} dot={false} />
                    <Line type="monotone" dataKey="planned" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls />
                    <Line type="monotone" dataKey="projected" stroke="#60a5fa" strokeWidth={2} strokeDasharray="2 3" dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap items-center gap-4 mt-2 text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ background: theme.stroke }} /> Real</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-slate-400" /> Plano</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-blue-400" /> Projeção</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-amber-500" /> Meta</span>
                </div>
              </div>
            )}

            {/* Aporte do mês */}
            {!goal.achieved && goal.monthlyTarget > 0 && (
              <div className="bg-base border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Aporte deste mês</p>
                  <span className="text-[11px] text-slate-400">sugerido {formatCurrency(goal.monthlyTarget, 'BRL', { privacy })}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-bold text-slate-100">{formatCurrency(monthAportado, 'BRL', { privacy })}</span>
                  <span className={`text-sm font-semibold ${monthRemaining <= 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {monthRemaining <= 0 ? '✓ meta do mês batida' : `faltam ${formatCurrency(monthRemaining, 'BRL', { privacy })}`}
                  </span>
                </div>
                <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${monthPct}%` }} />
                </div>
              </div>
            )}

            {/* What-if */}
            {!goal.achieved && whatIf && (
              <div className="bg-base border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">E se eu aportar…</p>
                  <span className="text-sm font-bold text-blue-300">{formatCurrency(whatIf.pmt, 'BRL', { privacy })}/mês</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(goal.monthlyTarget * 3, 1000)}
                  step={50}
                  value={whatIf.pmt}
                  onChange={(e) => setWhatIfPmt(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex items-center justify-between mt-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Nova data</p>
                    <p className="font-bold text-slate-100">{whatIf.date ? whatIf.date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '—'}</p>
                  </div>
                  {whatIf.pmt !== goal.monthlyTarget && Number.isFinite(whatIf.saved) && whatIf.saved > 0 && (
                    <span className="text-emerald-400 font-semibold text-xs">chega {formatMonths(Math.round(whatIf.saved))} antes</span>
                  )}
                  {whatIf.pmt !== goal.monthlyTarget && (
                    <button
                      onClick={() => updateMutation.mutate({ monthlyTarget: whatIf.pmt })}
                      disabled={updateMutation.isPending}
                      className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
                    >
                      Adotar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Streak + decomposição do mês */}
            <div className="grid grid-cols-2 gap-2">
              {(data?.streak ?? 0) >= 1 && (
                <div className="bg-base border border-slate-800 rounded-xl p-3 col-span-2 sm:col-span-1 flex items-center gap-2">
                  <Flame className="text-orange-400" size={18} />
                  <div>
                    <p className="text-sm font-bold text-slate-100">{data!.streak} {data!.streak === 1 ? 'mês' : 'meses'} seguidos</p>
                    <p className="text-[10px] text-slate-500">aportando — não quebre a sequência</p>
                  </div>
                </div>
              )}
              {(data!.currentMonth.fromContribution !== 0 || data!.currentMonth.fromMarket !== 0) && (
                <div className="bg-base border border-slate-800 rounded-xl p-3 flex items-center gap-2">
                  <TrendingUp className={data!.currentMonth.fromMarket >= 0 ? 'text-emerald-400' : 'text-red-400'} size={18} />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Mercado no mês</p>
                    <p className={`text-sm font-bold ${data!.currentMonth.fromMarket >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {data!.currentMonth.fromMarket >= 0 ? '+' : ''}{formatCurrency(data!.currentMonth.fromMarket, 'BRL', { privacy })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Insights secundários */}
            {coachMessages.length > 1 && (
              <div className="space-y-2">
                {coachMessages.slice(1).map((m, i) => {
                  const st = TONE_STYLES[m.tone];
                  return (
                    <div key={i} className={`flex items-start gap-2.5 border rounded-xl p-3 ${st.wrap}`}>
                      {st.icon}
                      <div>
                        <p className="text-xs font-bold text-slate-200">{m.title}</p>
                        <p className="text-[11px] text-slate-400 leading-snug">{m.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Ledger de aportes manuais */}
            {data!.contributions.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Aportes manuais</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {data!.contributions.map((c) => (
                    <div key={c._id} className="flex items-center justify-between bg-base border border-slate-800 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-200">{formatCurrency(c.amount, 'BRL', { privacy })}</p>
                        <p className="text-[10px] text-slate-500">{new Date(c.date).toLocaleDateString('pt-BR')}{c.note ? ` · ${c.note}` : ''}</p>
                      </div>
                      <button onClick={() => handleDeleteContrib(c._id)} className="text-slate-600 hover:text-red-400 transition-colors p-1" aria-label="Remover aporte">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ações */}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={() => setContribOpen(true)} className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-3 text-sm transition-colors">
                <Plus size={16} /> Registrar aporte
              </button>
              <button onClick={() => setEditOpen(true)} className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors" aria-label="Editar meta">
                <Pencil size={16} />
              </button>
              <button onClick={handleDeleteGoal} className="px-4 py-3 rounded-xl bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/30 transition-colors" aria-label="Excluir meta">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}
      </Modal>

      {goal && contribOpen && <ContributionModal isOpen={contribOpen} onClose={() => setContribOpen(false)} goal={goal} />}
      {goal && editOpen && <CreateGoalModal isOpen={editOpen} onClose={() => setEditOpen(false)} goal={goal} />}
    </>
  );
};
