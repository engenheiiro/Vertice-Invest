
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import { subscriptionService } from '../services/subscription';

export const CheckoutSuccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { refreshProfile } = useAuth();
    
    const plan = searchParams.get('plan');
    const paymentId = searchParams.get('payment_id'); // ID retornado pelo MP
    const status = searchParams.get('status'); // approved, pending, etc.

    const [isVerifying, setIsVerifying] = useState(true);
    const [verificationStatus, setVerificationStatus] = useState<'success' | 'error'>('success');
    const [message, setMessage] = useState('Verificando pagamento com o banco...');

    useEffect(() => {
        const verify = async () => {
            // Se tivermos um ID de pagamento, forçamos a sincronização com o backend
            // Isso resolve o problema de delay do Webhook ou falha em localhost
            if (paymentId && status === 'approved') {
                try {
                    await subscriptionService.syncPayment(paymentId);
                    await refreshProfile(); // Atualiza o contexto do usuário com o novo plano
                    setMessage('Pagamento confirmado e plano ativado!');
                    setVerificationStatus('success');
                } catch (error) {
                    console.error("Erro ao sincronizar:", error);
                    // Mesmo se der erro no sync manual, tentamos atualizar o perfil caso o webhook tenha funcionado
                    await refreshProfile();
                    setMessage('Pagamento recebido. Seu plano será ativado em instantes.');
                    setVerificationStatus('success'); // Mantemos sucesso visual pois o pagamento no MP foi OK
                }
            } else {
                await refreshProfile();
                setMessage('Assinatura processada.');
            }
            setIsVerifying(false);
        };

        // Pequeno delay para garantir que o backend do MP já processou se for muito rápido
        setTimeout(verify, 1500);
    }, [paymentId, status, refreshProfile]);

    return (
        <div className="min-h-screen bg-[#02040a] flex items-center justify-center p-6 relative overflow-hidden">
            {/* Confetti Background */}
            <div className="absolute inset-0 pointer-events-none">
                 <div className="absolute top-0 left-1/4 w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-100"></div>
                 <div className="absolute top-10 left-3/4 w-3 h-3 bg-emerald-500 rounded-full animate-bounce delay-300"></div>
                 <div className="absolute bottom-1/4 right-10 w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-500"></div>
            </div>

            <div className="max-w-md w-full bg-[#080C14] border border-slate-800 rounded-2xl p-8 text-center relative z-10 shadow-2xl shadow-blue-900/10">
                
                {isVerifying ? (
                    <div className="py-10">
                        <Loader2 size={48} className="text-blue-500 animate-spin mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-white">Validando Transação...</h2>
                        <p className="text-slate-400 text-sm mt-2">Aguarde enquanto confirmamos sua assinatura.</p>
                    </div>
                ) : (
                    <>
                        <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-emerald-500/30 animate-fade-in">
                            <CheckCircle2 size={40} className="text-emerald-500" />
                        </div>
                        
                        <h1 className="text-2xl font-bold text-white mb-2">Sucesso!</h1>
                        <p className="text-slate-300 text-sm mb-6 leading-relaxed">
                            {message}
                        </p>

                        <div className="bg-slate-900/50 rounded-xl p-4 mb-8 border border-slate-800 text-left space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Plano Selecionado</span>
                                <span className="text-white font-bold">{plan}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Status</span>
                                <span className="text-emerald-500 font-bold uppercase">{status || 'PROCESSANDO'}</span>
                            </div>
                            {paymentId && (
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">ID Transação</span>
                                    <span className="text-slate-400 font-mono">{paymentId}</span>
                                </div>
                            )}
                        </div>

                        <Button onClick={() => navigate('/dashboard')} className="w-full">
                            Acessar Dashboard <ArrowRight size={16} className="ml-2" />
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};
