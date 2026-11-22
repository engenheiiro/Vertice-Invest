
import React, { useState } from 'react';
import { CreditCard, CheckCircle2, ArrowRight, CalendarClock, Crown, AlertTriangle, QrCode, Bitcoin, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth, PaymentMethod } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../ui/ConfirmModal';
import { subscriptionService } from '../../services/subscription';
import { useToast } from '../../contexts/ToastContext';
import { buildSubscriptionView, type SubscriptionView } from './subscriptionCardView';

// Método de pagamento real (3.22) → ícone; sem transação cai no padrão Mercado Pago.
const PAYMENT_ICON: Record<PaymentMethod, React.ReactNode> = {
    CREDIT_CARD: <CreditCard size={14} className="text-slate-300" />,
    PIX: <QrCode size={14} className="text-emerald-400" />,
    CRYPTO: <Bitcoin size={14} className="text-amber-400" />,
};

/** Bloco coeso de assinatura: validade + renovação (3.19). O preço fica no /pricing. */
const ValidityPanel = ({ view }: { view: SubscriptionView }) => {
    const { validity, isRenewing, showAnnual, expiryBadge } = view;
    if (!validity) {
        return (
            <div className="md:text-right">
                <p className="text-sm font-bold text-white">Plano Gratuito</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Acesso vitalício</p>
            </div>
        );
    }
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <CalendarClock size={11} className="text-emerald-400" /> Válido até
                </span>
                <span className="text-[11px] font-bold text-emerald-400">{validity.validUntil}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {validity.renewalTitle}
                </span>
                <span className={`text-[11px] font-bold ${validity.renewalTone}`}>
                    {validity.renewalValue}
                </span>
            </div>
            {isRenewing && (
                <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950/60 text-blue-300 border border-blue-800/60">
                    <RefreshCw size={9} /> Renovação automática
                </span>
            )}
            {showAnnual && (
                <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                    <CalendarClock size={9} /> Plano anual (12 meses)
                </span>
            )}
            {expiryBadge && (
                <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${expiryBadge.classes}`}>
                    <AlertTriangle size={9} />
                    {expiryBadge.label}
                </span>
            )}
        </div>
    );
};

const PaymentFailedAlert = ({ onUpdate }: { onUpdate: () => void }) => (
    <div className="mb-4 relative z-10 flex items-start gap-3 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-300">Não conseguimos renovar sua assinatura</p>
            <p className="text-[11px] text-red-400/80 mt-0.5 leading-relaxed">
                A cobrança no seu cartão foi recusada. O Mercado Pago vai tentar de novo nos próximos dias —
                se preferir não esperar, atualize a forma de pagamento agora.
            </p>
            <button
                onClick={onUpdate}
                className="mt-2 text-[11px] font-bold text-red-300 hover:text-white transition-colors inline-flex items-center gap-1"
            >
                Atualizar pagamento <ArrowRight size={11} />
            </button>
        </div>
    </div>
);

const RecurringInvite = ({ title, onActivate }: { title: string; onActivate: () => void }) => (
    <div className="mb-4 relative z-10 flex items-start gap-3 p-4 rounded-xl bg-blue-950/30 border border-blue-800/50">
        <RefreshCw size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-blue-200">{title}</p>
            <p className="text-[11px] text-blue-300/80 mt-0.5 leading-relaxed">
                Cadastre um cartão e a renovação passa a ser automática — sem precisar lembrar de pagar todo mês.
            </p>
            <button
                onClick={onActivate}
                className="mt-2 text-[11px] font-bold text-blue-300 hover:text-white transition-colors inline-flex items-center gap-1"
            >
                Ativar renovação automática <ArrowRight size={11} />
            </button>
        </div>
    </div>
);

export const SubscriptionCard = () => {
    const { user, refreshProfile } = useAuth();
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [isCancelOpen, setCancelOpen] = useState(false);
    const [isCanceling, setCanceling] = useState(false);

    const view = buildSubscriptionView(user, Date.now());
    const goToPricing = () => navigate('/pricing');

    const handleCancel = async () => {
        setCanceling(true);
        try {
            const result = await subscriptionService.cancelSubscription();
            await refreshProfile();
            const until = result?.validUntil ? new Date(result.validUntil).toLocaleDateString('pt-BR') : null;
            addToast(
                until
                    ? `Assinatura cancelada. Seu acesso continua até ${until}.`
                    : 'Assinatura cancelada.',
                'success',
            );
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Não foi possível cancelar a assinatura.', 'error');
        } finally {
            setCanceling(false);
        }
    };

    return (
        <div className="bg-gradient-to-br from-base to-card border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
            {/* Efeitos de Fundo */}
            {view.style.glow && <div className={`absolute top-0 right-0 w-64 h-64 ${view.style.glow} rounded-full blur-[80px] pointer-events-none`}></div>}

            <div className="flex flex-col md:flex-row justify-between items-start mb-6 relative z-10 gap-4">
                <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold text-white uppercase tracking-wider mb-2 ${view.style.badge}`}>
                        {view.isBlack && <Crown size={10} fill="currentColor" />}
                        Plano Atual
                    </span>
                    <h3 className="text-2xl font-bold text-white">{view.planName}</h3>
                    <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-slate-400">Status:</span>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${view.status.classes}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${view.status.dot} ${view.pulseDot ? 'animate-pulse' : ''}`}></span>
                            {view.status.label}
                        </span>
                    </div>
                </div>

                <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800/50 w-full md:w-auto md:min-w-[200px]">
                    <ValidityPanel view={view} />
                </div>
            </div>

            {view.showPaymentFailed && <PaymentFailedAlert onUpdate={goToPricing} />}
            {view.recurringInvite && <RecurringInvite title={view.recurringInvite} onActivate={goToPricing} />}

            <div className="space-y-2 mb-6 relative z-10 bg-card p-4 rounded-xl border border-slate-800/50">
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Recursos Ativos</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {view.features.map((feat, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                            <CheckCircle2 size={14} className={view.style.check} />
                            <span>{feat}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="pt-4 border-t border-slate-800/50 flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-slate-800 rounded border border-slate-700">
                        {view.paymentMethod ? PAYMENT_ICON[view.paymentMethod] : <CreditCard size={14} className="text-slate-300" />}
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white">
                            Método de Pagamento
                        </p>
                        <p className="text-[10px] text-slate-500">
                            {view.paymentLabel}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {view.canCancel && (
                        <button
                            onClick={() => setCancelOpen(true)}
                            disabled={isCanceling}
                            className="text-xs font-bold text-slate-400 hover:text-red-400 px-3 py-2 rounded-lg transition-all inline-flex items-center gap-1.5 disabled:opacity-60"
                        >
                            {isCanceling && <Loader2 size={12} className="animate-spin" />}
                            Cancelar
                        </button>
                    )}
                    {!view.isBlack && (
                        <button
                            onClick={goToPricing}
                            className="text-xs font-bold text-blue-400 hover:text-white hover:bg-blue-600 px-4 py-2 rounded-lg transition-all flex items-center gap-1 border border-blue-500/30 hover:border-transparent"
                        >
                            {view.upgradeLabel} <ArrowRight size={12} />
                        </button>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={isCancelOpen}
                onClose={() => setCancelOpen(false)}
                onConfirm={handleCancel}
                title="Cancelar assinatura?"
                message={view.cancelMessage}
                confirmText="Sim, cancelar"
            />
        </div>
    );
};
