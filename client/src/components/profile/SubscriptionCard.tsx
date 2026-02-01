import React from 'react';
import { CreditCard, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuth, UserPlan } from '../../contexts/AuthContext';
// @ts-ignore
import { useNavigate } from 'react-router-dom';

export const SubscriptionCard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Configurações de exibição baseadas no plano
    const planDetails: Record<UserPlan, { name: string; price: string; features: string[] }> = {
        GUEST: { name: 'Visitante', price: '0,00', features: ['Acesso Limitado', 'Cotações com Delay', 'Comunidade (Leitura)'] },
        ESSENTIAL: { name: 'Essential', price: '39,90', features: ['Carteira Brasil 10', 'Cursos Básicos', 'Sinais com Delay'] },
        PRO: { name: 'Vértice Pro', price: '119,90', features: ['Neural Engine Tempo Real', 'Todas as Carteiras', 'Morning Call Exclusivo'] },
        BLACK: { name: 'Black Elite', price: '349,90', features: ['Concierge 24/7', 'Carteira Private', 'Gestão Tributária'] }
    };

    // Fallback para GUEST se o plano do usuário não for reconhecido
    const userPlan = user?.plan && planDetails[user.plan] ? user.plan : 'GUEST';
    const currentPlan = planDetails[userPlan];
    const isMaxTier = userPlan === 'BLACK';

    return (
        <div className="bg-gradient-to-br from-[#080C14] to-[#0A101F] border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
            {/* Efeito de brilho no fundo condicional */}
            {userPlan === 'PRO' && <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-[80px] pointer-events-none"></div>}
            {userPlan === 'BLACK' && <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37]/5 rounded-full blur-[80px] pointer-events-none"></div>}

            <div className="flex justify-between items-start mb-6 relative z-10">
                <div>
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider mb-2 ${
                        userPlan === 'BLACK' ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 
                        userPlan === 'PRO' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'
                    }`}>
                        Plano Atual
                    </span>
                    <h3 className="text-2xl font-bold text-white">{currentPlan.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">Status: <span className="uppercase text-white font-bold">{user?.subscriptionStatus || 'Inativo'}</span></p>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-mono text-white">R$ {currentPlan.price}<span className="text-sm text-slate-500">/mês</span></p>
                </div>
            </div>

            <div className="space-y-2 mb-6 relative z-10">
                {currentPlan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                        <CheckCircle2 size={14} className={userPlan === 'BLACK' ? 'text-[#D4AF37]' : 'text-emerald-500'} />
                        <span>{feat}</span>
                    </div>
                ))}
            </div>

            <div className="pt-4 border-t border-slate-800/50 flex items-center justify-between relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-slate-800 rounded border border-slate-700">
                        <CreditCard size={14} className="text-slate-300" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white">
                            Método de Pagamento
                        </p>
                        <p className="text-[10px] text-slate-500">
                            {user?.subscriptionStatus === 'TRIAL' ? 'Período de Testes' : 'Gerenciar no Portal'}
                        </p>
                    </div>
                </div>
                
                {!isMaxTier && (
                    <button 
                        onClick={() => navigate('/pricing')}
                        className="text-xs font-bold text-blue-400 hover:text-white hover:bg-blue-600 px-3 py-1.5 rounded transition-all flex items-center gap-1"
                    >
                        Fazer Upgrade <ArrowRight size={12} />
                    </button>
                )}
            </div>
        </div>
    );
};