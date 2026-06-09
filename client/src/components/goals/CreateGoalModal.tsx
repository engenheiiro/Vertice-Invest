import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Wallet, TrendingUp } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { useWallet } from '../../contexts/WalletContext';
import { goalsService, type Goal } from '../../services/goals';
import { researchService } from '../../services/research';
import { STALE_TIME } from '../../config/queryConfig';
import { parseCurrencyToFloat } from '../../utils/assetTransaction';
import { formatCurrency } from '../../utils/format';
import { monthsRemaining, requiredMonthly, addMonths } from '../../utils/goalMath';
import { ICON_OPTIONS, COLOR_OPTIONS, getGoalIcon, getGoalTheme, formatMonths } from './goalTheme';

interface CreateGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Quando passado, edita uma meta existente em vez de criar. */
  goal?: Goal | null;
}

const num = (v: string): number => {
  const n = parseCurrencyToFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const CreateGoalModal: React.FC<CreateGoalModalProps> = ({ isOpen, onClose, goal }) => {
  const isEdit = !!goal;
  const { addToast } = useToast();
  const { kpis } = useWallet();
  const queryClient = useQueryClient();

  const [name, setName] = useState(goal?.name || '');
  const [icon, setIcon] = useState(goal?.icon || 'target');
  const [color, setColor] = useState(goal?.color || 'emerald');
  const [targetAmount, setTargetAmount] = useState(goal ? String(goal.targetAmount.toFixed(2)).replace('.', ',') : '');
  const [monthlyTarget, setMonthlyTarget] = useState(goal ? String(goal.monthlyTarget.toFixed(2)).replace('.', ',') : '');
  const [rate, setRate] = useState(goal ? String(goal.expectedAnnualRate) : '10');
  const [mirrorWallet, setMirrorWallet] = useState(goal ? goal.mirrorWallet : true);
  const [targetDate, setTargetDate] = useState(goal?.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : '');
  const [manualBalance, setManualBalance] = useState('');

  // Sugestão de taxa: CDI atual (macro) e TWRR real da carteira.
  const { data: macro } = useQuery({ queryKey: ['macroData'], queryFn: researchService.getMacroData, staleTime: STALE_TIME.LONG });
  const cdiRate = macro?.cdi?.value || macro?.selic?.value || null;
  const twrr = kpis.weightedRentability || null;

  const mutation = useMutation({
    mutationFn: (payload: any) => (isEdit ? goalsService.updateGoal(goal!._id, payload) : goalsService.createGoal(payload)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['goal', goal!._id] });
      addToast(isEdit ? 'Meta atualizada.' : 'Meta criada com sucesso!', 'success');
      onClose();
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao salvar meta.', 'error'),
  });

  // Preview "what-if" ao vivo (espelho do goalMath do backend).
  const preview = useMemo(() => {
    const target = num(targetAmount);
    if (target <= 0) return null;
    const baseline = (mirrorWallet ? kpis.totalEquity : 0) + num(manualBalance);
    const rateN = parseFloat(rate) || 0;
    const n = monthsRemaining(baseline, num(monthlyTarget), rateN, target);
    const projDate = Number.isFinite(n) ? addMonths(new Date(), n) : null;
    let required: number | null = null;
    if (targetDate) {
      const months = (new Date(targetDate).getTime() - Date.now()) / (30.4375 * 24 * 3600 * 1000);
      const req = requiredMonthly(baseline, rateN, target, months);
      required = Number.isFinite(req) ? req : null;
    }
    return { baseline, n, projDate, required };
  }, [targetAmount, monthlyTarget, rate, mirrorWallet, manualBalance, targetDate, kpis.totalEquity]);

  const handleSubmit = () => {
    const target = num(targetAmount);
    if (!name.trim()) return addToast('Dê um nome para a meta.', 'error');
    if (target <= 0) return addToast('Defina um valor-alvo maior que zero.', 'error');

    const payload: any = {
      name: name.trim(),
      icon,
      color,
      targetAmount: target,
      monthlyTarget: num(monthlyTarget),
      expectedAnnualRate: parseFloat(rate) || 0,
      mirrorWallet,
      targetDate: targetDate || null,
    };
    if (!isEdit && num(manualBalance) > 0) payload.manualBalance = num(manualBalance);
    mutation.mutate(payload);
  };

  const theme = getGoalTheme(color);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar meta' : 'Nova meta'} maxWidth="max-w-xl" accent="border-t-emerald-500">
      <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        <Input label="Nome da meta" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: O Milhão" maxLength={60} />

        {/* Ícone */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-2">Ícone</label>
          <div className="flex flex-wrap gap-2">
            {ICON_OPTIONS.map((key) => {
              const Ic = getGoalIcon(key);
              const active = key === icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${active ? `${theme.bgSoft} ${theme.border} ${theme.text}` : 'bg-base border-slate-800 text-slate-500 hover:text-slate-300'}`}
                >
                  <Ic size={18} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Cor */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-2">Cor</label>
          <div className="flex gap-2">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-white' : 'border-transparent'}`}
                style={{ backgroundColor: getGoalTheme(c).stroke }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CurrencyInput label="Valor-alvo (R$)" value={targetAmount} onChange={setTargetAmount} />
          <CurrencyInput label="Aporte mensal (R$)" value={monthlyTarget} onChange={setMonthlyTarget} />
        </div>

        {/* Taxa esperada + sugestões */}
        <div>
          <Input
            label="Rentabilidade esperada (% ao ano)"
            type="number"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {cdiRate && (
              <button type="button" onClick={() => setRate(String(cdiRate))} className="text-[11px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20 transition-colors inline-flex items-center gap-1">
                <Sparkles size={11} /> CDI ({cdiRate.toFixed(2).replace('.', ',')}%)
              </button>
            )}
            {twrr ? (
              <button type="button" onClick={() => setRate(twrr.toFixed(1))} className="text-[11px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors inline-flex items-center gap-1">
                <TrendingUp size={11} /> Minha carteira ({twrr.toFixed(1).replace('.', ',')}%)
              </button>
            ) : null}
          </div>
        </div>

        {/* Prazo opcional */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Prazo (opcional)</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full bg-base border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none [color-scheme:dark]"
          />
        </div>

        {/* Espelho da carteira */}
        <button
          type="button"
          onClick={() => setMirrorWallet((v) => !v)}
          className="w-full flex items-center gap-3 bg-base border border-slate-800 rounded-xl p-3 text-left hover:border-slate-700 transition-colors"
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${mirrorWallet ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
            <Wallet size={18} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-200">Espelhar minha carteira</p>
            <p className="text-[11px] text-slate-500">O patrimônio real da carteira conta como progresso da meta.</p>
          </div>
          <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${mirrorWallet ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <div className={`w-5 h-5 rounded-full bg-white transition-transform ${mirrorWallet ? 'translate-x-4' : ''}`} />
          </div>
        </button>

        {!isEdit && (
          <CurrencyInput
            label="Já tenho guardado fora da carteira (opcional)"
            value={manualBalance}
            onChange={setManualBalance}
          />
        )}

        {/* Preview ao vivo */}
        {preview && (
          <div className="bg-base border border-slate-800 rounded-xl p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Projeção</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Você já tem</span>
              <span className="font-bold text-slate-100">{formatCurrency(preview.baseline)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Tempo estimado</span>
              <span className={`font-bold ${Number.isFinite(preview.n) ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {Number.isFinite(preview.n) ? `~${formatMonths(Math.ceil(preview.n))}` : 'Sem caminho de chegada'}
              </span>
            </div>
            {preview.projDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Data prevista</span>
                <span className="font-bold text-slate-200">{preview.projDate.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>
              </div>
            )}
            {preview.required !== null && (
              <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-800">
                <span className="text-slate-400">Aporte p/ bater o prazo</span>
                <span className="font-bold text-blue-300">{formatCurrency(preview.required)}/mês</span>
              </div>
            )}
          </div>
        )}

        <Button onClick={handleSubmit} isLoading={mutation.isPending}>
          {isEdit ? 'Salvar alterações' : 'Criar meta'}
        </Button>
      </div>
    </Modal>
  );
};
