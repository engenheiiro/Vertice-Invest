import { useState } from 'react';
import { CreditCard, QrCode, RefreshCw, CalendarDays, Check, ArrowRight, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { BillingMode } from '../../services/subscription';

interface PaymentMethodModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (mode: BillingMode) => void;
    planLabel: string;
    price: string;
    isLoading?: boolean;
}

/**
 * Escolha do método antes do checkout.
 *
 * O modo não é uma preferência estética: define qual API do Mercado Pago será
 * usada. Cartão → PreApproval (assinatura, renova sozinha). Pix → Preference
 * (30 dias avulsos), porque o Pix não suporta recorrência no gateway. Por isso
 * as duas opções descrevem consequências diferentes, não só ícones diferentes.
 */
export const PaymentMethodModal = ({
    isOpen, onClose, onConfirm, planLabel, price, isLoading = false,
}: PaymentMethodModalProps) => {
    const [mode, setMode] = useState<BillingMode>('RECURRING');

    const options: Array<{
        value: BillingMode;
        icon: typeof CreditCard;
        title: string;
        badge?: string;
        accent: string;
        bullets: Array<{ icon: typeof RefreshCw; text: string }>;
    }> = [
        {
            value: 'RECURRING',
            icon: CreditCard,
            title: 'Cartão de crédito',
            badge: 'Recomendado',
            accent: 'blue',
            bullets: [
                { icon: RefreshCw, text: 'Renova automaticamente todo mês' },
                { icon: Check, text: 'Cancele quando quiser, sem multa' },
            ],
        },
        {
            value: 'ONE_TIME',
            icon: QrCode,
            title: 'Pix',
            accent: 'emerald',
            bullets: [
                { icon: CalendarDays, text: 'Libera 30 dias de acesso' },
                { icon: RefreshCw, text: 'Sem renovação — você paga de novo ao vencer' },
            ],
        },
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Como você quer pagar?" accent="border-t-blue-500">
            <div className="p-6 space-y-4">
                <div className="flex items-baseline justify-between gap-3 pb-4 border-b border-slate-800">
                    <span className="text-sm text-slate-400">{planLabel}</span>
                    <span className="text-lg font-bold text-white">R$ {price}<span className="text-xs font-normal text-slate-500">/mês</span></span>
                </div>

                <div className="space-y-3" role="radiogroup" aria-label="Método de pagamento">
                    {options.map((option) => {
                        const selected = mode === option.value;
                        const Icon = option.icon;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setMode(option.value)}
                                className={`w-full text-left p-4 rounded-xl border transition-all ${
                                    selected
                                        ? option.accent === 'blue'
                                            ? 'border-blue-500 bg-blue-950/30'
                                            : 'border-emerald-500 bg-emerald-950/20'
                                        : 'border-slate-800 bg-card hover:border-slate-700'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className={`mt-0.5 shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                                        selected
                                            ? option.accent === 'blue' ? 'bg-blue-600/20' : 'bg-emerald-600/20'
                                            : 'bg-slate-800'
                                    }`}>
                                        <Icon size={18} className={
                                            selected
                                                ? option.accent === 'blue' ? 'text-blue-400' : 'text-emerald-400'
                                                : 'text-slate-400'
                                        } />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-bold text-white">{option.title}</span>
                                            {option.badge && (
                                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-blue-600/20 text-blue-300 border border-blue-500/30">
                                                    {option.badge}
                                                </span>
                                            )}
                                        </div>
                                        <ul className="mt-2 space-y-1">
                                            {option.bullets.map((bullet, i) => {
                                                const BulletIcon = bullet.icon;
                                                return (
                                                    <li key={i} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                                        <BulletIcon size={11} className="shrink-0 text-slate-500" />
                                                        {bullet.text}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>

                                    <div className={`mt-1 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                        selected
                                            ? option.accent === 'blue' ? 'border-blue-500 bg-blue-500' : 'border-emerald-500 bg-emerald-500'
                                            : 'border-slate-600'
                                    }`}>
                                        {selected && <Check size={10} className="text-white" strokeWidth={4} />}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed">
                    Você será redirecionado ao Mercado Pago para concluir. Nenhum dado do seu cartão passa pela Vértice.
                </p>

                <button
                    type="button"
                    onClick={() => onConfirm(mode)}
                    disabled={isLoading}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-bold text-white transition-all active:scale-95"
                >
                    {isLoading
                        ? <><Loader2 size={16} className="animate-spin" /> Redirecionando...</>
                        : <>Continuar para o pagamento <ArrowRight size={16} /></>}
                </button>
            </div>
        </Modal>
    );
};
