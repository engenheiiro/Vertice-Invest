
import React, { useState } from 'react';
import { CreditCard, CheckCircle2, ArrowRight, CalendarClock, Crown, AlertTriangle, QrCode, Bitcoin, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth, UserPlan, PaymentMethod } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../ui/ConfirmModal';
import { subscriptionService } from '../../services/subscription';
import { useToast } from '../../contexts/ToastContext';

export const SubscriptionCard = () => {
    const { user, refreshProfile } = useAuth();
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [isCancelOpen, setCancelOpen] = useState(false);
    const [isCanceling, setCanceling] = useState(false);

    // Configurações de exibição por plano. Features REAIS, derivadas de
    // PLAN_ACCESS/PLAN_EXCLUSIVE (constants/subscription + Pricing) — cada tier
    // herda o anterior ("Tudo do ...") e lista só o que agrega de novo.
    const planDetails: Record<UserPlan, { name: string; price: string; features: string[] }> = {
        GUEST: { name: 'Visitante', price: '0,00', features: ['Gestão de Carteira', 'Research Brasil 10', 'Vértice Academy (grátis)', 'Cotações com delay'] },
        ESSENTIAL: { name: 'Essential', price: '39,90', features: ['Carteira & Brasil 10', 'Sinais técnicos (com delay)', 'Cursos Essenciais', 'Relatório mensal'] },
        PRO: { name: 'Vértice Pro', price: '89,90', features: ['Tudo do Essential', 'Aporte Inteligente (IA)', 'Radar Alpha tempo real', 'Research Ações, FIIs & Cripto', 'Relatórios de diagnóstico (IA)'] },
        ELITE: { name: 'Vértice Elite', price: '120,00', features: ['Tudo do Pro', 'Rebalanceamento IA', 'Research Global (Stocks & REITs)', 'Masterclass & Estudos de Caso'] },
        BLACK: { name: 'Vértice Black', price: '299,00', features: ['Tudo do Elite', 'Carteiras Private', 'Automação de Imposto de Renda', 'Concierge WhatsApp 24h', 'Calls com Analistas'] }
    };

    // Método de pagamento real (3.22) → ícone + rótulo. Deriva de Transaction.method
    // exposto em user.paymentMethod; sem transação cai no padrão Mercado Pago.
    const paymentDisplay: Record<PaymentMethod, { icon: React.ReactNode; label: string }> = {
        CREDIT_CARD: { icon: <CreditCard size={14} className="text-slate-300" />, label: 'Cartão de Crédito' },
        PIX: { icon: <QrCode size={14} className="text-emerald-400" />, label: 'Pix' },
        CRYPTO: { icon: <Bitcoin size={14} className="text-amber-400" />, label: 'Criptomoeda' },
    };

    const userPlan = user?.plan && planDetails[user.plan] ? user.plan : 'GUEST';
    const currentPlan = planDetails[userPlan];
    const isMaxTier = userPlan === 'BLACK';
    const isPaidPlan = userPlan !== 'GUEST';

    const getDaysLeft = (dateStr?: string): number | null => {
        if (!dateStr) return null;
        const diff = new Date(dateStr).getTime() - Date.now();
        return Math.ceil(diff / 86_400_000);
    };

    // Status da assinatura como chip colorido (bonito nos 2 temas — as classes
    // de chip já têm override [data-theme=light] no index.css).
    const statusConfig: Record<string, { label: string; classes: string; dot: string }> = {
        ACTIVE:   { label: 'Ativo',     classes: 'bg-emerald-900/30 text-emerald-400 border-emerald-900/50', dot: 'bg-emerald-400' },
        TRIAL:    { label: 'Em teste',  classes: 'bg-blue-900/30 text-blue-400 border-blue-900/50',          dot: 'bg-blue-400' },
        PAST_DUE: { label: 'Pendente',  classes: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/50',    dot: 'bg-yellow-400' },
        CANCELED: { label: 'Cancelado', classes: 'bg-red-900/30 text-red-400 border-red-900/50',             dot: 'bg-red-400' },
    };
    const status = statusConfig[user?.subscriptionStatus || ''] || { label: 'Inativo', classes: 'bg-slate-800 text-slate-300 border-slate-700', dot: 'bg-slate-500' };

    const daysLeft = isPaidPlan ? getDaysLeft(user?.validUntil) : null;
    // Assinatura recorrente ativa não "expira" — ela renova. Mostrar contagem
    // regressiva ali assustaria o assinante adimplente sem motivo.
    const isRecurring = user?.subscriptionType === 'RECURRING';
    const isRenewing = isRecurring && user?.subscriptionStatus === 'ACTIVE';
    const expiryBadge = !isRenewing && daysLeft !== null && daysLeft <= 7
        ? { label: daysLeft <= 0 ? 'Expirado' : `Expira em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`, urgent: daysLeft <= 3 }
        : null;

    // Convite de migração: quem pagou avulso e está perto de vencer ganha o
    // caminho para o cartão recorrente, em vez de simplesmente perder o acesso.
    const showRecurringInvite = isPaidPlan && !isRecurring && daysLeft !== null && daysLeft <= 7 && daysLeft > 0;
    const showPaymentFailed = isRecurring && user?.subscriptionStatus === 'PAST_DUE';
    const canCancel = isRecurring && user?.subscriptionStatus !== 'CANCELED';

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
            {userPlan === 'PRO' && <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-[80px] pointer-events-none"></div>}
            {userPlan === 'ELITE' && <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/5 rounded-full blur-[80px] pointer-events-none"></div>}
            {userPlan === 'BLACK' && <div className="absolute top-0 right-0 w-64 h-64 bg-gold/5 rounded-full blur-[80px] pointer-events-none"></div>}

            <div className="flex flex-col md:flex-row justify-between items-start mb-6 relative z-10 gap-4">
                <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold text-white uppercase tracking-wider mb-2 ${
                        userPlan === 'BLACK' ? 'bg-gold/20 text-gold border border-gold/30' :
                        userPlan === 'ELITE' ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40' :
                        userPlan === 'PRO' ? 'bg-blue-600 border border-blue-500' : 'bg-slate-700 text-slate-300 border border-slate-600'
                    }`}>
                        {userPlan === 'BLACK' && <Crown size={10} fill="currentColor" />}
                        Plano Atual
                    </span>
                    <h3 className="text-2xl font-bold text-white">{currentPlan.name}</h3>
                    <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-slate-400">Status:</span>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${status.classes}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${user?.subscriptionStatus === 'ACTIVE' ? 'animate-pulse' : ''}`}></span>
                            {status.label}
                        </span>
                    </div>
                </div>

                {/* Bloco coeso de assinatura: validade + renovação (3.19).
                    O preço foi removido daqui de propósito — fica no /pricing. */}
                <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800/50 w-full md:w-auto md:min-w-[200px]">
                    {isPaidPlan && user?.validUntil ? (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center gap-1">
                                    <CalendarClock size={11} className="text-emerald-400" /> Válido até
                                </span>
                                <span className="text-[11px] font-bold text-emerald-400">{new Date(user.validUntil).toLocaleDateString('pt-BR')}</span>
                            </div>
                            {/* Data real da próxima cobrança quando há assinatura; caso
                                contrário deixa claro que não haverá renovação. */}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                                    {isRenewing ? 'Próxima cobrança' : 'Renovação'}
                                </span>
                                <span className={`text-[11px] font-bold ${isRenewing ? 'text-slate-300' : 'text-slate-500'}`}>
                                    {isRenewing
                                        ? new Date(user.nextBillingDate || user.validUntil).toLocaleDateString('pt-BR')
                                        : user?.subscriptionStatus === 'CANCELED' ? 'Cancelada' : 'Manual'}
                                </span>
                            </div>
                            {isRenewing && (
                                <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950/60 text-blue-300 border border-blue-800/60">
                                    <RefreshCw size={9} /> Renovação automática
                                </span>
                            )}
                            {expiryBadge && (
                                <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    expiryBadge.urgent
                                        ? 'bg-red-950/60 text-red-400 border border-red-800/60'
                                        : 'bg-yellow-950/60 text-yellow-400 border border-yellow-800/60'
                                }`}>
                                    <AlertTriangle size={9} />
                                    {expiryBadge.label}
                                </span>
                            )}
                        </div>
                    ) : (
                        <div className="md:text-right">
                            <p className="text-sm font-bold text-white">Plano Gratuito</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Acesso vitalício</p>
                        </div>
                    )}
                </div>
            </div>

            {showPaymentFailed && (
                <div className="mb-4 relative z-10 flex items-start gap-3 p-4 rounded-xl bg-red-950/40 border border-red-800/60">
                    <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-red-300">Não conseguimos renovar sua assinatura</p>
                        <p className="text-[11px] text-red-400/80 mt-0.5 leading-relaxed">
                            A cobrança no seu cartão foi recusada. O Mercado Pago vai tentar de novo nos próximos dias —
                            se preferir não esperar, atualize a forma de pagamento agora.
                        </p>
                        <button
                            onClick={() => navigate('/pricing')}
                            className="mt-2 text-[11px] font-bold text-red-300 hover:text-white transition-colors inline-flex items-center gap-1"
                        >
                            Atualizar pagamento <ArrowRight size={11} />
                        </button>
                    </div>
                </div>
            )}

            {showRecurringInvite && (
                <div className="mb-4 relative z-10 flex items-start gap-3 p-4 rounded-xl bg-blue-950/30 border border-blue-800/50">
                    <RefreshCw size={16} className="text-blue-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-blue-200">Seu acesso vence em {daysLeft} dia{daysLeft === 1 ? '' : 's'}</p>
                        <p className="text-[11px] text-blue-300/80 mt-0.5 leading-relaxed">
                            Cadastre um cartão e a renovação passa a ser automática — sem precisar lembrar de pagar todo mês.
                        </p>
                        <button
                            onClick={() => navigate('/pricing')}
                            className="mt-2 text-[11px] font-bold text-blue-300 hover:text-white transition-colors inline-flex items-center gap-1"
                        >
                            Ativar renovação automática <ArrowRight size={11} />
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-2 mb-6 relative z-10 bg-card p-4 rounded-xl border border-slate-800/50">
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Recursos Ativos</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {currentPlan.features.map((feat, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                            <CheckCircle2 size={14} className={userPlan === 'BLACK' ? 'text-gold' : 'text-emerald-500'} />
                            <span>{feat}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="pt-4 border-t border-slate-800/50 flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-slate-800 rounded border border-slate-700">
                        {user?.paymentMethod ? paymentDisplay[user.paymentMethod].icon : <CreditCard size={14} className="text-slate-300" />}
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white">
                            Método de Pagamento
                        </p>
                        <p className="text-[10px] text-slate-500">
                            {user?.subscriptionStatus === 'TRIAL'
                                ? 'Período de Testes'
                                : isRecurring
                                    ? `Cartão de Crédito${user?.cardBrand ? ` (${user.cardBrand})` : ''} · Assinatura`
                                    : user?.paymentMethod
                                        ? `${paymentDisplay[user.paymentMethod].label} · Mercado Pago`
                                        : 'Mercado Pago (Pré-pago)'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {canCancel && (
                        <button
                            onClick={() => setCancelOpen(true)}
                            disabled={isCanceling}
                            className="text-xs font-bold text-slate-400 hover:text-red-400 px-3 py-2 rounded-lg transition-all inline-flex items-center gap-1.5 disabled:opacity-60"
                        >
                            {isCanceling && <Loader2 size={12} className="animate-spin" />}
                            Cancelar
                        </button>
                    )}
                    {!isMaxTier && (
                        <button
                            onClick={() => navigate('/pricing')}
                            className="text-xs font-bold text-blue-400 hover:text-white hover:bg-blue-600 px-4 py-2 rounded-lg transition-all flex items-center gap-1 border border-blue-500/30 hover:border-transparent"
                        >
                            {isPaidPlan ? 'Gerenciar / Upgrade' : 'Fazer Upgrade'} <ArrowRight size={12} />
                        </button>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={isCancelOpen}
                onClose={() => setCancelOpen(false)}
                onConfirm={handleCancel}
                title="Cancelar assinatura?"
                message={
                    user?.validUntil
                        ? `Não haverá novas cobranças. Você mantém acesso completo ao ${currentPlan.name} até ${new Date(user.validUntil).toLocaleDateString('pt-BR')} — o período já pago é seu.`
                        : 'Não haverá novas cobranças. Você mantém o acesso até o fim do período já pago.'
                }
                confirmText="Sim, cancelar"
            />
        </div>
    );
};
