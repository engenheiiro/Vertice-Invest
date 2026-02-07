
import React from 'react';
import { CreditCard, CheckCircle2, ArrowRight, CalendarClock, Crown } from 'lucide-react';
import { useAuth, UserPlan } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const SubscriptionCard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Configurações de exibição baseadas no plano (PREÇOS REAIS)
    const planDetails: Record<UserPlan, { name: string; price: string; features: string[] }> = {
        GUEST: { name: 'Visitante', price: '0,00', features: ['Acesso Limitado', 'Cotações com Delay', 'Comunidade (Leitura)'] },
        ESSENTIAL: { name: 'Essential', price: '39,90', features: ['Carteira Brasil 10', 'Cursos Básicos', 'Sinais com Delay'] },
        PRO: { name: 'Vértice Pro', price: '119,90', features: ['Neural Engine Tempo Real', 'Todas as Carteiras', 'Morning Call Exclusivo'] },
        BLACK: { name: 'Black Elite', price: '349,90', features: ['Concierge 24/7', 'Carteira Private', 'Gestão Tributária'] }
    };

    const userPlan = user?.plan && planDetails[user.plan] ? user.plan : 'GUEST';
    const currentPlan = planDetails[userPlan];
    const isMaxTier = userPlan === 'BLACK';
    const isPaidPlan = userPlan !== 'GUEST';

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'Indeterminado';
        return new Date(dateStr).toLocaleDateString('pt-BR', { 
            day: '2-digit', 
            month: 'long', 
            year: 'numeric' 
        });
    };

    return (
        <div className="bg-gradient-to-br from-[#080C14] to-[#0A101F] border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
            {/* Efeitos de Fundo */}
            {userPlan === 'PRO' && <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-[80px] pointer-events-none"></div>}
            {userPlan === 'BLACK' && <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37]/5 rounded-full blur-[80px] pointer-events-none"></div>}

            <div className="flex flex-col md:flex-row justify-between items-start mb-6 relative z-10 gap-4">
                <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold text-white uppercase tracking-wider mb-2 ${
                        userPlan === 'BLACK' ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30' : 
                        userPlan === 'PRO' ? 'bg-blue-600 border border-blue-500' : 'bg-slate-700 text-slate-300 border border-slate-600'
                    }`}>
                        {userPlan === 'BLACK' && <Crown size={10} fill="currentColor" />}
                        Plano Atual
                    </span>
                    <h3 className="text-2xl font-bold text-white">{currentPlan.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-slate-400">Status: <span className="uppercase text-white font-bold">{user?.subscriptionStatus || 'Inativo'}</span></p>
                        {isPaidPlan && user?.validUntil && (
                            <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">
                                Renovação em {new Date(user.validUntil).getDate()}
                            </span>
                        )}
                    </div>
                </div>
                
                <div className="text-left md:text-right bg-slate-900/50 p-3 rounded-xl border border-slate-800/50 w-full md:w-auto">
                    <p className="text-2xl font-mono text-white">R$ {currentPlan.price}<span className="text-sm text-slate-500">/mês</span></p>
                    {isPaidPlan && user?.validUntil ? (
                        <div className="flex items-center justify-start md:justify-end gap-1.5 mt-1 text-emerald-400">
                            <CalendarClock size={12} />
                            <p className="text-[10px] font-bold uppercase tracking-wide">
                                Válido até {formatDate(user.validUntil)}
                            </p>
                        </div>
                    ) : (
                        <p className="text-[10px] text-slate-500 mt-1">Gratuito vitalício</p>
                    )}
                </div>
            </div>

            <div className="space-y-2 mb-6 relative z-10 bg-[#0B101A] p-4 rounded-xl border border-slate-800/50">
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Recursos Ativos</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {currentPlan.features.map((feat, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                            <CheckCircle2 size={14} className={userPlan === 'BLACK' ? 'text-[#D4AF37]' : 'text-emerald-500'} />
                            <span>{feat}</span>
                        </div>
                    ))}
                </div>
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
                            {user?.subscriptionStatus === 'TRIAL' ? 'Período de Testes' : 'Mercado Pago (Pré-pago)'}
                        </p>
                    </div>
                </div>
                
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
    );
};
