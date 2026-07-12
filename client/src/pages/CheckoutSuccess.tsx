import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import { subscriptionService } from '../services/subscription';
import { authService } from '../services/auth';

type CheckoutPhase = 'verifying' | 'activated' | 'pending' | 'rejected' | 'error';

type SubscriptionStatusResponse = {
    current?: { plan?: string };
    lastPayment?: { gatewayId?: string; status?: string; plan?: string };
};

const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 2_000;
const TEST_PLAN_SUFFIX = '_TEST';

export const getCheckoutReturnDetails = (params: URLSearchParams) => {
    const paymentId = params.get('payment_id') || params.get('collection_id');
    const status = (params.get('status') || params.get('collection_status') || params.get('return_status') || 'processing').toLowerCase();
    const rawPlan = params.get('plan');
    const expectedPlan = rawPlan?.endsWith(TEST_PLAN_SUFFIX)
        ? rawPlan.slice(0, -TEST_PLAN_SUFFIX.length)
        : rawPlan;

    return { paymentId, status, rawPlan, expectedPlan };
};

export const isActivationRecorded = (
    data: SubscriptionStatusResponse,
    paymentId: string,
    expectedPlan: string | null,
) => {
    const transaction = data.lastPayment;
    return transaction?.gatewayId === paymentId
        && transaction.status === 'PAID'
        && (!expectedPlan || (transaction.plan === expectedPlan && data.current?.plan === expectedPlan));
};

const isRejectedStatus = (status: string) => ['rejected', 'cancelled', 'canceled', 'failure'].includes(status);

const phaseDetails: Record<Exclude<CheckoutPhase, 'verifying'>, { title: string; defaultMessage: string; tone: string }> = {
    activated: {
        title: 'Pagamento confirmado!',
        defaultMessage: 'Seu plano está ativo e pronto para uso.',
        tone: 'emerald',
    },
    pending: {
        title: 'Pagamento em processamento',
        defaultMessage: 'Ainda estamos aguardando a confirmação do Mercado Pago. Seu acesso será liberado assim que o pagamento for aprovado.',
        tone: 'amber',
    },
    rejected: {
        title: 'Pagamento não aprovado',
        defaultMessage: 'O pagamento não foi aprovado. Você pode tentar novamente quando quiser.',
        tone: 'red',
    },
    error: {
        title: 'Não foi possível confirmar agora',
        defaultMessage: 'Não conseguimos consultar o pagamento neste momento. Nenhum acesso foi liberado sem confirmação.',
        tone: 'red',
    },
};

export const CheckoutSuccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { refreshProfile } = useAuth();
    const [attempt, setAttempt] = useState(0);
    const [phase, setPhase] = useState<CheckoutPhase>('verifying');
    const [message, setMessage] = useState('Verificando o pagamento com o Mercado Pago...');

    const { paymentId, status, rawPlan, expectedPlan } = useMemo(
        () => getCheckoutReturnDetails(searchParams),
        [searchParams],
    );

    useEffect(() => {
        let cancelled = false;
        const sleep = () => new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        const setResult = (nextPhase: Exclude<CheckoutPhase, 'verifying'>, nextMessage?: string) => {
            if (cancelled) return;
            setPhase(nextPhase);
            setMessage(nextMessage || phaseDetails[nextPhase].defaultMessage);
        };

        const waitForRecordedActivation = async () => {
            if (!paymentId) return false;

            for (let index = 0; index < POLL_ATTEMPTS; index += 1) {
                try {
                    const response = await authService.api('/api/subscription/status');
                    if (response.ok) {
                        const data = await response.json() as SubscriptionStatusResponse;
                        if (isActivationRecorded(data, paymentId, expectedPlan)) {
                            await refreshProfile();
                            return true;
                        }
                    }
                } catch {
                    // O próximo ciclo ou o botão de atualização tenta novamente.
                }

                if (index < POLL_ATTEMPTS - 1 && !cancelled) await sleep();
            }

            return false;
        };

        const verifyPayment = async () => {
            let effectiveStatus = status;
            if (!paymentId) {
                if (isRejectedStatus(effectiveStatus)) {
                    setResult('rejected');
                } else {
                    setResult('pending', 'Não recebemos um identificador de pagamento no retorno. Atualize esta página em alguns instantes ou consulte seu perfil.');
                }
                return;
            }

            try {
                // Backup seguro para o webhook: o endpoint consulta o Mercado Pago,
                // verifica ownership e usa gatewayId único antes de ativar qualquer plano.
                const syncResult = await subscriptionService.syncPayment(paymentId);
                if (syncResult?.status) effectiveStatus = String(syncResult.status).toLowerCase();
            } catch {
                // Mesmo se o backup falhar, o webhook pode concluir enquanto fazemos polling.
            }

            if (await waitForRecordedActivation()) {
                setResult('activated');
                return;
            }

            if (isRejectedStatus(effectiveStatus)) {
                setResult('rejected');
            } else {
                setResult('pending');
            }
        };

        setPhase('verifying');
        setMessage('Verificando o pagamento com o Mercado Pago...');
        void verifyPayment();

        return () => { cancelled = true; };
    }, [attempt, expectedPlan, paymentId, refreshProfile, status]);

    const detail = phase === 'verifying' ? null : phaseDetails[phase];
    const Icon = phase === 'activated'
        ? CheckCircle2
        : phase === 'pending'
            ? Clock3
            : phase === 'rejected'
                ? XCircle
                : AlertCircle;
    const iconClasses = phase === 'activated'
        ? 'bg-emerald-500/10 ring-emerald-500/30 text-emerald-500'
        : phase === 'pending'
            ? 'bg-amber-500/10 ring-amber-500/30 text-amber-400'
            : 'bg-red-500/10 ring-red-500/30 text-red-400';

    return (
        <div className="min-h-screen bg-deep flex items-center justify-center p-6 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/4 w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-100" />
                <div className="absolute top-10 left-3/4 w-3 h-3 bg-emerald-500 rounded-full animate-bounce delay-300" />
                <div className="absolute bottom-1/4 right-10 w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-500" />
            </div>

            <div className="max-w-md w-full bg-base border border-slate-800 rounded-2xl p-8 text-center relative z-10 shadow-2xl shadow-blue-900/10">
                {phase === 'verifying' ? (
                    <div className="py-10">
                        <Loader2 size={48} className="text-blue-500 animate-spin mx-auto mb-4" />
                        <h1 className="text-xl font-bold text-white">Validando transação...</h1>
                        <p className="text-slate-400 text-sm mt-2">{message}</p>
                    </div>
                ) : (
                    <>
                        <div className={`w-20 h-20 ${iconClasses} rounded-full flex items-center justify-center mx-auto mb-6 ring-1 animate-fade-in`}>
                            <Icon size={40} />
                        </div>

                        <h1 className="text-2xl font-bold text-white mb-2">{detail?.title}</h1>
                        <p className="text-slate-300 text-sm mb-6 leading-relaxed">{message}</p>

                        <div className="bg-slate-900/50 rounded-xl p-4 mb-6 border border-slate-800 text-left space-y-2">
                            <div className="flex justify-between text-xs gap-3">
                                <span className="text-slate-500">Plano selecionado</span>
                                <span className="text-white font-bold text-right">{rawPlan?.replace(TEST_PLAN_SUFFIX, '') || '—'}</span>
                            </div>
                            <div className="flex justify-between text-xs gap-3">
                                <span className="text-slate-500">Status do retorno</span>
                                <span className={`font-bold uppercase text-right ${detail?.tone === 'emerald' ? 'text-emerald-500' : detail?.tone === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                                    {status}
                                </span>
                            </div>
                            {paymentId && (
                                <div className="flex justify-between text-xs gap-3">
                                    <span className="text-slate-500">ID da transação</span>
                                    <span className="text-slate-400 font-mono text-right break-all">{paymentId}</span>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            {phase !== 'activated' && (
                                <Button onClick={() => setAttempt(value => value + 1)} className="w-full" variant="outline">
                                    <RefreshCw size={16} className="mr-2" /> Atualizar status
                                </Button>
                            )}
                            <Button onClick={() => navigate(phase === 'rejected' ? '/pricing' : '/dashboard')} className="w-full">
                                {phase === 'rejected' ? 'Tentar novamente' : 'Acessar Dashboard'} <ArrowRight size={16} className="ml-2" />
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
