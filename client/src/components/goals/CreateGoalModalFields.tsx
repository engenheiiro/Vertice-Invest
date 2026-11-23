import React from 'react';
import { Sparkles, Wallet, TrendingUp, Link2, History } from 'lucide-react';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import type { Goal, RateContext } from '../../services/goals';
import { formatCurrency } from '../../utils/format';
import { ICON_OPTIONS, COLOR_OPTIONS, getGoalIcon, getGoalTheme } from './goalTheme';
import { formatPct, shortHistoryDays, walletHistoryRate } from './createGoalForm';

const LABEL = 'block text-xs font-semibold text-slate-400';
const FIELD = 'w-full bg-base border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none';
const HINT = 'text-[11px] text-slate-500';

interface AppearanceProps {
  fieldId: string;
  icon: string;
  color: string;
  onIcon: (icon: string) => void;
  onColor: (color: string) => void;
}

export const GoalAppearanceFields: React.FC<AppearanceProps> = ({ fieldId, icon, color, onIcon, onColor }) => {
  const theme = getGoalTheme(color);
  return (
    <>
      {/* Ícone */}
      <div>
        <p id={`${fieldId}-icon`} className={`${LABEL} mb-2`}>Ícone</p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${fieldId}-icon`}>
          {ICON_OPTIONS.map((key) => {
            const Ic = getGoalIcon(key);
            const tone = key === icon ? `${theme.bgSoft} ${theme.border} ${theme.text}` : 'bg-base border-slate-800 text-slate-500 hover:text-slate-300';
            return (
              <button
                key={key}
                type="button"
                onClick={() => onIcon(key)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${tone}`}
              >
                <Ic size={18} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Cor */}
      <div>
        <p id={`${fieldId}-color`} className={`${LABEL} mb-2`}>Cor</p>
        <div className="flex gap-2" role="group" aria-labelledby={`${fieldId}-color`}>
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              aria-label={c}
              className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-white' : 'border-transparent'}`}
              style={{ backgroundColor: getGoalTheme(c).stroke }}
            />
          ))}
        </div>
      </div>
    </>
  );
};

const CHIP_TONE = {
  suggested: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20',
  cdi: 'bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20',
  history: 'bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20',
};

const SUGGESTED_HINT = '"Minha carteira" é a média do que cada classe da sua carteira deve render '
  + '(caixa e renda fixa no CDI, renda variável com prêmio de risco). É premissa, não promessa.';

interface RateChipProps {
  tone: string;
  Icon: typeof Sparkles;
  label: string;
  value: number;
  onPick: (value: number) => void;
}

/** Atalho que cola uma taxa conhecida no campo. */
const RateChip: React.FC<RateChipProps> = ({ tone, Icon, label, value, onPick }) => (
  <button type="button" onClick={() => onPick(value)} className={`text-[11px] px-2 py-1 rounded-md ${tone} transition-colors inline-flex items-center gap-1`}>
    <Icon size={11} /> {label} ({formatPct(value)})
  </button>
);

interface RateProps {
  rate: string;
  rateCtx?: RateContext;
  onType: (value: string) => void;
  onPick: (value: number) => void;
}

export const GoalRateField: React.FC<RateProps> = ({ rate, rateCtx, onType, onPick }) => {
  const suggestedRate = rateCtx?.suggested ?? null;
  const cdiRate = rateCtx?.cdi ?? null;
  const historyRate = walletHistoryRate(rateCtx?.walletReturn);
  const historyDays = shortHistoryDays(rateCtx?.walletReturn);
  return (
    <div>
      <Input label="Rentabilidade esperada (% ao ano)" type="number" step="0.1" value={rate} onChange={(e) => onType(e.target.value)} />
      <div className="flex flex-wrap gap-2 mt-2">
        {suggestedRate !== null && <RateChip tone={CHIP_TONE.suggested} Icon={Sparkles} label="Minha carteira" value={suggestedRate} onPick={onPick} />}
        {cdiRate !== null && <RateChip tone={CHIP_TONE.cdi} Icon={TrendingUp} label="CDI" value={cdiRate} onPick={onPick} />}
        {historyRate !== null && <RateChip tone={CHIP_TONE.history} Icon={History} label="Meu histórico" value={historyRate} onPick={onPick} />}
      </div>
      {/* A taxa é METADE da projeção: com patrimônio grande e aporte pequeno,
          a maior parte do avanço previsto vem daqui. Dizer de onde ela sai
          evita que a data prevista pareça mágica. */}
      <p className={`${HINT} mt-2 leading-snug`}>
        {suggestedRate !== null
          ? <>{SUGGESTED_HINT}</>
          : <>Quanto você espera que o dinheiro renda por ano. É premissa, não promessa.</>}
        {historyDays !== null && <> Seu histórico ainda tem {historyDays} dias — curto demais para virar taxa anual.</>}
      </p>
    </div>
  );
};

interface PreviousProps {
  fieldId: string;
  options: Goal[];
  value: string;
  onChange: (id: string) => void;
}

/** Encadeamento sequencial: some quando não há meta elegível. */
export const GoalPreviousField: React.FC<PreviousProps> = ({ fieldId, options, value, onChange }) => {
  if (options.length === 0) return null;
  return (
    <div>
      <label htmlFor={`${fieldId}-prev`} className={`${LABEL} mb-1.5 flex items-center gap-1.5`}>
        <Link2 size={12} /> Continuação de (opcional)
      </label>
      <select id={`${fieldId}-prev`} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        <option value="">Nenhuma — meta independente</option>
        {options.map((g) => (
          <option key={g._id} value={g._id}>
            {g.name} — {formatCurrency(g.targetAmount)}
          </option>
        ))}
      </select>
      {value && (
        <p className={`${HINT} mt-1.5`}>
          Esta meta será exibida como próximo passo da jornada selecionada.
        </p>
      )}
    </div>
  );
};

interface DeadlineProps {
  fieldId: string;
  value: string;
  onChange: (date: string) => void;
}

/** Prazo opcional. */
export const GoalDeadlineField: React.FC<DeadlineProps> = ({ fieldId, value, onChange }) => (
  <div>
    <label htmlFor={`${fieldId}-date`} className={`${LABEL} mb-1.5`}>Prazo (opcional)</label>
    <input id={`${fieldId}-date`} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} [color-scheme:dark]`} />
  </div>
);

interface MirrorProps {
  on: boolean;
  onToggle: () => void;
}

/** Espelho da carteira: o patrimônio real conta como progresso. */
export const GoalMirrorToggle: React.FC<MirrorProps> = ({ on, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className="w-full flex items-center gap-3 bg-base border border-slate-800 rounded-xl p-3 text-left hover:border-slate-700 transition-colors"
  >
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${on ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
      <Wallet size={18} />
    </div>
    <div className="flex-1">
      <p className="text-xs font-bold text-slate-200">Espelhar minha carteira</p>
      <p className={HINT}>O patrimônio real da carteira conta como progresso da meta.</p>
    </div>
    <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-700'}`}>
      <div className={`w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </div>
  </button>
);

interface BaselineProps {
  isEdit: boolean;
  manualBalance: string;
  startValue: string;
  onManualBalance: (value: string) => void;
  onStartValue: (value: string) => void;
}

/** Criação pergunta o saldo fora da carteira; edição deixa corrigir o patrimônio inicial. */
export const GoalBaselineField: React.FC<BaselineProps> = ({ isEdit, manualBalance, startValue, onManualBalance, onStartValue }) => {
  if (!isEdit) {
    return <CurrencyInput label="Já tenho guardado fora da carteira (opcional)" value={manualBalance} onChange={onManualBalance} />;
  }
  return (
    <div>
      <CurrencyInput label="Patrimônio no início da meta" value={startValue} onChange={onStartValue} />
      <p className={`${HINT} mt-1.5`}>
        Ponto de partida da linha <span className="text-slate-400 font-semibold">Plano</span> no gráfico e base do
        “adiantado/atrasado”. Foi capturado na criação da meta — corrija se a carteira ainda não estava lançada.
      </p>
    </div>
  );
};
