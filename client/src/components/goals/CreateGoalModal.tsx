import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { useWallet } from '../../contexts/WalletContext';
import { useDemoGuard } from '../../hooks/useDemoGuard';
import { goalsService, type Goal } from '../../services/goals';
import { STALE_TIME } from '../../config/queryConfig';
import {
  buildGoalPayload, computeGoalPreview, eligiblePreviousGoals, initialGoalForm, validateGoalForm,
  type GoalFormPayload, type GoalFormState,
} from './createGoalForm';
import {
  GoalAppearanceFields, GoalBaselineField, GoalDeadlineField, GoalMirrorToggle, GoalPreviousField, GoalRateField,
} from './CreateGoalModalFields';
import { CreateGoalPreview } from './CreateGoalPreview';

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Quando passado, edita uma meta existente em vez de criar. */
  goal?: Goal | null;
}

/** Grava a meta (cria ou atualiza), invalida o cache, avisa e fecha. */
const useSaveGoal = (goal: Goal | null | undefined, activeWalletId: string | undefined, onClose: () => void) => {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GoalFormPayload) => (goal
      ? goalsService.updateGoal(goal._id, payload, activeWalletId)
      : goalsService.createGoal(payload, activeWalletId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      if (goal) queryClient.invalidateQueries({ queryKey: ['goal', goal._id] });
      addToast(goal ? 'Meta atualizada.' : 'Meta criada com sucesso!', 'success');
      onClose();
    },
    onError: (err: { message?: string } | null | undefined) => addToast(err?.message || 'Erro ao salvar meta.', 'error'),
  });
};

export const CreateGoalModal: React.FC<CreateGoalModalProps> = ({ isOpen, onClose, goal }) => {
  const isEdit = !!goal;
  const { addToast } = useToast();
  const { kpis, activeWalletId, isWalletScopeReady } = useWallet();
  const blockInDemo = useDemoGuard();

  const [form, setForm] = useState<GoalFormState>(() => initialGoalForm(goal));
  const set = <K extends keyof GoalFormState>(key: K) => (value: GoalFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fieldId = useId();

  // Sugestões de taxa vindas do servidor (goalRate.js): a esperada, ponderada
  // pela composição REAL da carteira, o CDI e o histórico da carteira JÁ
  // ANUALIZADO. Até 08/09/2026 o atalho "Minha carteira" colava
  // `kpis.weightedRentability` — rentabilidade ACUMULADA da cota, de 2 meses ou
  // de 5 anos — num campo que significa "ao ano". Nunca voltar a ler taxa anual
  // de um KPI acumulado.
  const { data: rateCtx } = useQuery({
    queryKey: ['goalRateSuggestion', activeWalletId],
    queryFn: () => goalsService.getRateSuggestion(activeWalletId),
    staleTime: STALE_TIME.LONG,
    enabled: isOpen && isWalletScopeReady,
  });
  // Metas existentes para o seletor de encadeamento (usa cache da página de Metas).
  // Só com o escopo de carteira pronto: antes disso o id é indefinido e a busca
  // sairia sem escopo (e de novo quando o id chegasse).
  const { data: goalsData } = useQuery({
    queryKey: ['goals', activeWalletId],
    queryFn: () => goalsService.getGoals(activeWalletId),
    staleTime: STALE_TIME.REALTIME,
    enabled: isOpen && isWalletScopeReady,
  });
  const suggestedRate = rateCtx?.suggested ?? null;

  // Meta NOVA começa na taxa da carteira, não num "10" redondo — mas só até o
  // usuário encostar no campo: sobrescrever o que ele digitou porque a sugestão
  // chegou depois seria roubar a premissa dele.
  const rateTouched = useRef(false);
  useEffect(() => {
    if (isEdit || rateTouched.current || suggestedRate === null) return;
    setForm((f) => ({ ...f, rate: String(suggestedRate) }));
  }, [isEdit, suggestedRate]);

  const typeRate = (value: string) => {
    rateTouched.current = true;
    setForm((f) => ({ ...f, rate: value }));
  };

  const eligiblePrevious = eligiblePreviousGoals(goalsData?.goals || [], goal?._id);
  const mutation = useSaveGoal(goal, activeWalletId, onClose);

  const { targetAmount, monthlyTarget, rate, mirrorWallet, manualBalance, targetDate } = form;
  const preview = useMemo(
    () => computeGoalPreview({ targetAmount, monthlyTarget, rate, mirrorWallet, manualBalance, targetDate }, kpis.totalEquity),
    [targetAmount, monthlyTarget, rate, mirrorWallet, manualBalance, targetDate, kpis.totalEquity],
  );

  const handleSubmit = () => {
    if (blockInDemo()) return;
    const error = validateGoalForm(form);
    if (error) return addToast(error, 'error');
    mutation.mutate(buildGoalPayload(form, isEdit));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar meta' : 'Nova meta'} maxWidth="max-w-xl" accent="border-t-emerald-500">
      <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        <Input label="Nome da meta" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Ex: O Milhão" maxLength={60} />
        <GoalAppearanceFields fieldId={fieldId} icon={form.icon} color={form.color} onIcon={set('icon')} onColor={set('color')} />
        <div className="grid grid-cols-2 gap-3">
          <CurrencyInput label="Valor-alvo (R$)" value={form.targetAmount} onChange={set('targetAmount')} />
          <CurrencyInput label="Aporte mensal (R$)" value={form.monthlyTarget} onChange={set('monthlyTarget')} />
        </div>
        <GoalRateField rate={form.rate} rateCtx={rateCtx} onType={typeRate} onPick={(v) => typeRate(String(v))} />
        <GoalPreviousField fieldId={fieldId} options={eligiblePrevious} value={form.previousGoalId} onChange={set('previousGoalId')} />
        <GoalDeadlineField fieldId={fieldId} value={form.targetDate} onChange={set('targetDate')} />
        <GoalMirrorToggle on={form.mirrorWallet} onToggle={() => setForm((f) => ({ ...f, mirrorWallet: !f.mirrorWallet }))} />
        <GoalBaselineField
          isEdit={isEdit}
          manualBalance={form.manualBalance}
          startValue={form.startValue}
          onManualBalance={set('manualBalance')}
          onStartValue={set('startValue')}
        />
        <CreateGoalPreview preview={preview} />
        <Button onClick={handleSubmit} isLoading={mutation.isPending}>
          {isEdit ? 'Salvar alterações' : 'Criar meta'}
        </Button>
      </div>
    </Modal>
  );
};
