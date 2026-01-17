import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';

export const CheckoutSuccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { refreshProfile } = useAuth();
    const plan = searchParams.get('plan');

    useEffect(() => {
        // Força a atualização do contexto do usuário assim que a página carrega
        refreshProfile();
    }, [refreshProfile]);

    return (
        <div className="min-h-screen bg-[#02040a] flex items-center justify-center p-6 relative overflow-hidden">
            {/* Confetti Background simulado com CSS ou SVG */}
            <div className="absolute inset-0 pointer-events-none">
                 <div className="absolute top-0 left-1/4 w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-100"></div>
                 <div className="absolute top-10 left-3/4 w-3 h-3 bg-emerald-500 rounded-full animate-bounce delay-300"></div>
                 <div className="absolute bottom-1/4 right-10 w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-500"></div>
            </div>

            <div className="max-w-md w-full bg-[#080C14] border border-slate-800 rounded-2xl p-8 text-center relative z-10 shadow-2xl shadow-blue-900/10">
                <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-emerald-500/30">
                    <CheckCircle2 size={40} className="text-emerald-500" />
                </div>
                
                <h1 className="text-2xl font-bold text-white mb-2">Pagamento Confirmado!</h1>
                <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                    Sua assinatura do plano <strong className="text-white">{plan}</strong> está ativa.
                    <br/>O Neural Engine já está calibrando sua nova experiência.
                </p>

                <div className="bg-slate-900/50 rounded-xl p-4 mb-8 border border-slate-800 text-left">
                    <div className="flex justify-between text-xs mb-2">
                        <span className="text-slate-500">Status</span>
                        <span className="text-emerald-500 font-bold">ATIVO</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Transação</span>
                        <span className="text-slate-300 font-mono">#{Math.random().toString(36).substr(2, 9).toUpperCase()}</span>
                    </div>
                </div>

                <Button onClick={() => navigate('/dashboard')} className="w-full">
                    Acessar Dashboard <ArrowRight size={16} className="ml-2" />
                </Button>
            </div>
        </div>
    );
};