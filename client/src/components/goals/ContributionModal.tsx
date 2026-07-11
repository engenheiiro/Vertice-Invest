import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { useWallet } from '../../contexts/WalletContext';
import { goalsService, type Goal } from '../../services/goals';
import { parseCurrencyToFloat, getLocalDateString } from '../../utils/assetTransaction';
import { formatMonths } from './goalTheme';

interface ContributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  goal: Goal;
}

export const ContributionModal: React.FC<ContributionModalProps> = ({ isOpen, onClose, goal }) => {
  const { addToast } = useToast();
  const { activeWalletId } = useWallet();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getLocalDateString());
  const [note, setNote] = useState('');
  const [accelerated, setAccelerated] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const value = parseCurrencyToFloat(amount);
      return goalsService.addContribution(goal._id, { amount: value, date, note: note || undefined }, activeWalletId);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['goal', goal._id] });
      setAccelerated(res.monthsAccelerated);
      if (res.monthsAccelerated && res.monthsAccelerated >= 1) {
        addToast(`Aporte registrado! Você adiantou ${Math.round(res.monthsAccelerated)} ${Math.round(res.monthsAccelerated) === 1 ? 'mês' : 'meses'}.`, 'success');
      } else {
        addToast('Aporte registrado!', 'success');
      }
    },
    onError: (err: any) => addToast(err?.message || 'Erro ao registrar aporte.', 'error'),
  });

  const handleSubmit = () => {
    const value = parseCurrencyToFloat(amount);
    if (!Number.isFinite(value) || value === 0) return addToast('Informe um valor de aporte.', 'error');
    mutation.mutate();
  };

  const handleClose = () => {
    setAmount('');
    setNote('');
    setDate(getLocalDateString());
    setAccelerated(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Aporte em "${goal.name}"`} maxWidth="max-w-md" accent="border-t-emerald-500">
      <div className="p-6 space-y-4">
        {accelerated !== null && accelerated >= 1 ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
              <Rocket className="text-emerald-400" size={26} />
            </div>
            <p className="text-lg font-bold text-emerald-400">Você adiantou {formatMonths(Math.round(accelerated))}!</p>
            <p className="text-sm text-slate-400 mt-1">Esse aporte aproximou a data da sua meta. Continue assim.</p>
            <Button onClick={handleClose} className="mt-5">Fechar</Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Lance um aporte manual (dinheiro guardado fora da carteira). Compras de ativos registradas na carteira já contam automaticamente.
            </p>
            <CurrencyInput label="Valor do aporte (R$)" value={amount} onChange={setAmount} autoFocus />
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-base border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none [color-scheme:dark]"
              />
            </div>
            <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: 13º salário" maxLength={120} />
            <Button onClick={handleSubmit} isLoading={mutation.isPending}>Registrar aporte</Button>
          </>
        )}
      </div>
    </Modal>
  );
};
