import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Loader2, ArrowUpRight, TrendingUp, TrendingDown, CheckCircle2,
  AlertTriangle, Info, Calendar, Target as TargetIcon, Flame, Sparkles, Trophy,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../../contexts/ToastContext';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';
import { useDemoGuard } from '../../hooks/useDemoGuard';
import { useConfirm } from '../../hooks/useConfirm';
import { goalsService, type Goal, type GoalDetail } from '../../services/goals';
import { formatCurrency, formatCompact } from '../../utils/format';
import { getCoachMessages, type CoachTone, type CoachMessage } from '../../utils/goalCoach';
import { getGoalTheme, getGoalIcon } from './goalTheme';
import {
  crossedMilestone, milestoneMessage, coachStateOf, buildPremise, buildWhatIf, buildMonthProgress,
  achievedDeltaText, planDeltaOf, valueVsPlanOf, projectedDateLabel, buildStats, buildMonthFacts, contributionMeta,
  type StatIcon,
} from './goalDetailView';
import { ContributionModal } from './ContributionModal';
import { CreateGoalModal } from './CreateGoalModal';
import { GoalTrajectoryChart } from './GoalTrajectoryChart';

interface GoalDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  goalId: string;
  privacy?: boolean;
}

type GoalPatch = Partial<{ monthlyTarget: number; lastCelebratedMilestone: number; expectedAnnualRate: number }>;

const fmtPct = (v: number): string => `${v.toFixed(1).replace('.', ',')}%`;
const fmtPp = (v: number): string => `${v.toFixed(1).replace('.', ',')} pp`;

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

const STAT_ICON: Record<StatIcon, React.ReactNode> = {
  calendar: <Calendar size={11} />,
  target: <TargetIcon size={11} />,
  arrow: <ArrowUpRight size={11} />,
  trend: <TrendingUp size={11} />,
  alert: <AlertTriangle size={11} />,
};

const DELTA_BADGE = {
  ahead: (label: string) => <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-400"><TrendingUp size={15} /> {label}</span>,
  behind: (label: string) => <span className="inline-flex items-center gap-1 text-sm font-bold text-yellow-400"><TrendingDown size={15} /> {label}</span>,
  onPlan: (label: string) => <span className="text-sm font-bold text-slate-300">{label}</span>,
};

const Stat: React.FC<{ label: string; value: React.ReactNode; icon: React.ReactNode; accent?: string }> = ({ label, value, icon, accent }) => (
  <div className="bg-base border border-slate-800 rounded-xl p-3">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
      {icon} {label}
    </div>
    <p className={`text-sm font-bold ${accent || 'text-slate-100'}`}>{value}</p>
  </div>
);

const HeroInsight = ({ hero }: { hero: CoachMessage }) => (
  <div className={`flex items-start gap-3 border rounded-xl p-4 ${HERO_WRAP[hero.tone]}`}>
    {HERO_ICON[hero.tone]}
    <div>
      <p className="text-sm font-bold text-slate-100">{hero.title}</p>
      <p className="text-xs text-slate-300 leading-snug mt-0.5">{hero.text}</p>
    </div>
  </div>
);

const ProgressHeader = ({ goal, privacy }: { goal: Goal; privacy?: boolean }) => {
  const theme = getGoalTheme(goal.color);
  const Icon = getGoalIcon(goal.icon);
  return (
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
  );
};

const AchievedDates = ({ goal, achievedAt }: { goal: Goal; achievedAt: string }) => {
  const delta = achievedDeltaText(goal.dateDeltaMonths);
  return (
    <div className="flex items-center gap-2">
      <Trophy className="text-emerald-400" size={18} />
      <div>
        <p className="text-sm font-bold text-emerald-400">Conquistada em {new Date(achievedAt).toLocaleDateString('pt-BR')}</p>
        {delta && <p className="text-[11px] text-slate-400">{delta}</p>}
      </div>
    </div>
  );
};

const PlannedDates = ({ goal, privacy }: { goal: Goal; privacy?: boolean }) => {
  const delta = planDeltaOf(goal.dateDeltaMonths);
  const vsPlan = valueVsPlanOf(goal.valueVsPlan, privacy);
  return (
    <>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Data prevista</p>
        <p className="text-base font-bold text-slate-100">{projectedDateLabel(goal)}</p>
      </div>
      {delta && (
        <div className="text-right">
          {DELTA_BADGE[delta.kind](delta.label)}
          {vsPlan && (
            <p className={`text-[11px] ${vsPlan.positive ? 'text-emerald-400/80' : 'text-yellow-400/80'}`}>
              {vsPlan.label}
            </p>
          )}
        </div>
      )}
    </>
  );
};

/** Bloco de datas: prevista vs plano, ou a data da conquista. */
const DatesBlock = ({ goal, privacy }: { goal: Goal; privacy?: boolean }) => (
  <div className="bg-base border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
    {goal.achieved && goal.achievedAt ? <AchievedDates goal={goal} achievedAt={goal.achievedAt} /> : <PlannedDates goal={goal} privacy={privacy} />}
  </div>
);

/** Premissa de rendimento: de onde vem a data prevista. */
const PremiseBlock = ({ goal, data, privacy, isPending, onAdoptRate }: {
  goal: Goal; data: GoalDetail; privacy?: boolean; isPending: boolean; onAdoptRate: (rate: number) => void;
}) => {
  const premise = useMemo(() => buildPremise(goal, new Date()), [goal]);
  if (!premise) return null;
  return (
    <div className="bg-base border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Premissa de rendimento</p>
        <span className="text-sm font-bold text-slate-200">{fmtPct(goal.expectedAnnualRate)} ao ano</span>
      </div>
      <p className="text-xs text-slate-400 leading-snug mt-1.5">
        A projeção soma seu aporte de <strong className="text-slate-300">{formatCurrency(goal.monthlyTarget, 'BRL', { privacy })}</strong> com
        {' '}<strong className="text-slate-300">{formatCurrency(premise.monthlyYield, 'BRL', { privacy })}</strong> de rendimento por mês.
        {premise.noYield && (
          <> Sem nenhum rendimento, a chegada seria em <strong className="text-slate-300">{premise.noYield.date}</strong> ({premise.noYield.months}).</>
        )}
      </p>
      {goal.rateStale && data.rateContext && (
        <div className="mt-3 flex items-start gap-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-2.5">
          <AlertTriangle className="text-yellow-400 shrink-0 mt-0.5" size={14} />
          <div className="flex-1">
            <p className="text-xs text-slate-300 leading-snug">
              Sua carteira hoje sugere <strong>{fmtPct(data.rateContext.suggested)} ao ano</strong> — {fmtPp(Math.abs(goal.rateDeltaPp))} {goal.rateDeltaPp > 0 ? 'abaixo' : 'acima'} da premissa salva nesta meta.
            </p>
            <button
              type="button"
              onClick={() => onAdoptRate(data.rateContext.suggested)}
              disabled={isPending}
              className="mt-1.5 text-[11px] font-semibold text-yellow-300 hover:text-yellow-200 transition-colors"
            >
              Atualizar para {fmtPct(data.rateContext.suggested)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const MonthContribution = ({ goal, data, privacy }: { goal: Goal; data: GoalDetail; privacy?: boolean }) => {
  const month = buildMonthProgress(goal, data, privacy);
  if (!month) return null;
  return (
    <div className="bg-base border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Aporte deste mês</p>
        <span className="text-[11px] text-slate-400">sugerido {formatCurrency(goal.monthlyTarget, 'BRL', { privacy })}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold text-slate-100">{formatCurrency(month.done, 'BRL', { privacy })}</span>
        <span className={`text-sm font-semibold ${month.hit ? 'text-emerald-400' : 'text-slate-400'}`}>
          {month.remainingLabel}
        </span>
      </div>
      <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${month.pct}%` }} />
      </div>
    </div>
  );
};

/** Simulador what-if. */
const WhatIfBlock = ({ goal, privacy, isPending, whatIfPmt, setWhatIfPmt, onAdopt }: {
  goal: Goal; privacy?: boolean; isPending: boolean; whatIfPmt: number | null; setWhatIfPmt: (v: number) => void; onAdopt: (pmt: number) => void;
}) => {
  const whatIf = useMemo(() => buildWhatIf(goal, whatIfPmt, new Date()), [goal, whatIfPmt]);
  return (
    <div className="bg-base border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">E se eu aportar…</p>
        <span className="text-sm font-bold text-blue-300">{formatCurrency(whatIf.pmt, 'BRL', { privacy })}/mês</span>
      </div>
      <input
        type="range"
        min={0}
        max={whatIf.max}
        step={50}
        value={whatIf.pmt}
        onChange={(e) => setWhatIfPmt(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
      <div className="flex items-center justify-between mt-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Nova data</p>
          <p className="font-bold text-slate-100">{whatIf.dateLabel}</p>
        </div>
        {whatIf.savedLabel && <span className="text-emerald-400 font-semibold text-xs">{whatIf.savedLabel}</span>}
        {whatIf.canAdopt && (
          <button
            onClick={() => onAdopt(whatIf.pmt)}
            disabled={isPending}
            className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
          >
            Adotar
          </button>
        )}
      </div>
    </div>
  );
};

/** Streak + decomposição do mês. */
const MonthFacts = ({ data, privacy }: { data: GoalDetail; privacy?: boolean }) => {
  const { streak, market } = buildMonthFacts(data, privacy);
  const marketTone = market?.positive ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="grid grid-cols-2 gap-2">
      {streak && (
        <div className="bg-base border border-slate-800 rounded-xl p-3 col-span-2 sm:col-span-1 flex items-center gap-2">
          <Flame className="text-orange-400" size={18} />
          <div>
            <p className="text-sm font-bold text-slate-100">{streak}</p>
            <p className="text-[10px] text-slate-500">aportando — não quebre a sequência</p>
          </div>
        </div>
      )}
      {market && (
        <div className="bg-base border border-slate-800 rounded-xl p-3 flex items-center gap-2">
          <TrendingUp className={marketTone} size={18} />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Mercado no mês</p>
            <p className={`text-sm font-bold ${marketTone}`}>
              {market.label}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const SecondaryInsights = ({ messages }: { messages: CoachMessage[] }) => (
  <div className="space-y-2">
    {messages.map((m, i) => {
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
);

/** Ledger de aportes manuais. */
const ContributionLedger = ({ data, privacy, onDelete }: { data: GoalDetail; privacy?: boolean; onDelete: (id: string) => void }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Aportes manuais</p>
    <div className="space-y-1.5 max-h-40 overflow-y-auto">
      {data.contributions.map((c) => (
        <div key={c._id} className="flex items-center justify-between bg-base border border-slate-800 rounded-lg px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-slate-200">{formatCurrency(c.amount, 'BRL', { privacy })}</p>
            <p className="text-[10px] text-slate-500">{contributionMeta(c.date, c.note)}</p>
          </div>
          <button onClick={() => onDelete(c._id)} className="text-slate-600 hover:text-red-400 transition-colors p-1" aria-label="Remover aporte">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  </div>
);

interface GoalBodyProps {
  goal: Goal;
  data: GoalDetail;
  privacy?: boolean;
  isPending: boolean;
  whatIfPmt: number | null;
  setWhatIfPmt: (v: number) => void;
  onPatch: (patch: GoalPatch) => void;
  onDeleteContrib: (id: string) => void;
  onContribute: () => void;
  onEdit: () => void;
  onDeleteGoal: () => void;
}

const GoalBody = ({ goal, data, privacy, isPending, whatIfPmt, setWhatIfPmt, onPatch, onDeleteContrib, onContribute, onEdit, onDeleteGoal }: GoalBodyProps) => {
  const coachMessages = useMemo(() => getCoachMessages(coachStateOf(goal, data)), [goal, data]);
  const theme = getGoalTheme(goal.color);
  const hero = coachMessages[0];
  return (
    <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
      {/* Insight-herói */}
      {hero && <HeroInsight hero={hero} />}

      {/* Cabeçalho de progresso */}
      <ProgressHeader goal={goal} privacy={privacy} />

      <DatesBlock goal={goal} privacy={privacy} />

      <PremiseBlock goal={goal} data={data} privacy={privacy} isPending={isPending} onAdoptRate={(rate) => onPatch({ expectedAnnualRate: rate })} />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {buildStats(goal, data.avgContribution3m, privacy).map((s) => (
          <Stat key={s.label} label={s.label} icon={STAT_ICON[s.icon]} value={s.value} accent={s.accent} />
        ))}
      </div>

      {/* Gráfico: Real + Plano + Projeção */}
      <GoalTrajectoryChart points={data.trajectory || []} targetAmount={goal.targetAmount} stroke={theme.stroke} />

      <MonthContribution goal={goal} data={data} privacy={privacy} />

      {!goal.achieved && <WhatIfBlock goal={goal} privacy={privacy} isPending={isPending} whatIfPmt={whatIfPmt} setWhatIfPmt={setWhatIfPmt} onAdopt={(pmt) => onPatch({ monthlyTarget: pmt })} />}

      <MonthFacts data={data} privacy={privacy} />

      {/* Insights secundários */}
      {coachMessages.length > 1 && <SecondaryInsights messages={coachMessages.slice(1)} />}

      {data.contributions.length > 0 && <ContributionLedger data={data} privacy={privacy} onDelete={onDeleteContrib} />}

      {/* Ações */}
      <div className="flex items-center gap-2 pt-2">
        <button onClick={onContribute} className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-3 text-sm transition-colors">
          <Plus size={16} /> Registrar aporte
        </button>
        <button onClick={onEdit} className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors" aria-label="Editar meta">
          <Pencil size={16} />
        </button>
        <button onClick={onDeleteGoal} className="px-4 py-3 rounded-xl bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/30 transition-colors" aria-label="Excluir meta">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};

export const GoalDetailModal: React.FC<GoalDetailModalProps> = ({ isOpen, onClose, goalId, privacy }) => {
  const { addToast } = useToast();
  const { activeWalletId } = useWallet();
  const { isDemoMode } = useDemo();
  const blockInDemo = useDemoGuard();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
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

  const invalidateGoal = () => {
    queryClient.invalidateQueries({ queryKey: ['goals'] });
    queryClient.invalidateQueries({ queryKey: ['goal', goalId] });
  };
  const toastError = (fallback: string) => (err: { message?: string } | null) => addToast(err?.message || fallback, 'error');

  const updateMutation = useMutation({
    mutationFn: (payload: GoalPatch) => goalsService.updateGoal(goalId, payload, activeWalletId),
    onSuccess: invalidateGoal,
  });

  const deleteGoalMutation = useMutation({
    mutationFn: () => goalsService.deleteGoal(goalId, activeWalletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      addToast('Meta removida.', 'success');
      onClose();
    },
    onError: toastError('Erro ao remover meta.'),
  });

  const deleteContribMutation = useMutation({
    mutationFn: (cid: string) => goalsService.deleteContribution(goalId, cid, activeWalletId),
    onSuccess: invalidateGoal,
    onError: toastError('Erro ao remover aporte.'),
  });

  // Comemoração de marco: dispara UMA vez ao cruzar 25/50/75/100%.
  useEffect(() => {
    if (!goal) return;
    const crossed = crossedMilestone(goal, celebratedRef.current);
    if (crossed) {
      celebratedRef.current = crossed;
      addToast(milestoneMessage(crossed), 'success');
      // Demo: comemora na tela, mas não grava o marco na meta real.
      if (!isDemoMode) updateMutation.mutate({ lastCelebratedMilestone: crossed });
    }
    // Deps propositalmente curtas: `updateMutation.mutate` invalida ['goal', id],
    // o refetch devolve um objeto `goal` novo e, com `goal`/`updateMutation` nas
    // deps, o efeito voltaria a rodar — laço infinito de mutação e toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goal/updateMutation nas deps geram laço de mutação e toast
  }, [goal?.progressPct, goal?.lastCelebratedMilestone]);

  const handlePatch = (patch: GoalPatch) => {
    if (blockInDemo()) return;
    updateMutation.mutate(patch);
  };

  const handleDeleteGoal = async () => {
    if (blockInDemo()) return;
    if (await confirm({ title: 'Excluir meta?', message: 'Isso remove a meta e seus aportes manuais. Sua carteira não é afetada.', isDestructive: true, confirmText: 'Excluir' })) {
      deleteGoalMutation.mutate();
    }
  };

  const handleDeleteContrib = async (cid: string) => {
    if (blockInDemo()) return;
    if (await confirm({ title: 'Remover aporte?', message: 'O saldo manual da meta será ajustado.', isDestructive: true, confirmText: 'Remover' })) {
      deleteContribMutation.mutate(cid);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={goal?.name || 'Meta'} maxWidth="max-w-3xl" accent={`border-t-4`}>
        {isLoading || !goal || !data ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="animate-spin text-slate-500" size={28} />
          </div>
        ) : (
          <GoalBody
            goal={goal}
            data={data}
            privacy={privacy}
            isPending={updateMutation.isPending}
            whatIfPmt={whatIfPmt}
            setWhatIfPmt={setWhatIfPmt}
            onPatch={handlePatch}
            onDeleteContrib={handleDeleteContrib}
            onContribute={() => setContribOpen(true)}
            onEdit={() => setEditOpen(true)}
            onDeleteGoal={handleDeleteGoal}
          />
        )}
      </Modal>

      {goal && contribOpen && <ContributionModal isOpen={contribOpen} onClose={() => setContribOpen(false)} goal={goal} />}
      {goal && editOpen && <CreateGoalModal isOpen={editOpen} onClose={() => setEditOpen(false)} goal={goal} />}
    </>
  );
};
