
import React from 'react';
import { CreditCard, CheckCircle2, ArrowRight, CalendarClock, Crown, AlertTriangle } from 'lucide-react';
import { useAuth, UserPlan } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const SubscriptionCard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Configurações de exibição baseadas no plano (PREÇOS REAIS)
    const planDetails: Record<UserPlan, { name: string; price: string; features: string[] }> = {
        GUEST: { name: 'Visitante', price: '0,00', features: ['Acesso Limitado', 'Cotações com Delay', 'Comunidade (Leitura)'] },
        ESSENTIAL: { name: 'Essential', price: '39,90', features: ['Carteira Brasil 10', 'Cursos Básicos', 'Sinais com Delay'] },
        PRO: { name: 'Vértice Pro', price: '89,90', features: ['Neural Engine Tempo Real', 'Todas as Carteiras', 'Morning Call Exclusivo'] },
        ELITE: { name: 'Vértice Elite', price: '120,00', features: ['Tudo do Pro', 'Ativos Globais', 'Rebalanceamento IA', 'Masterclass'] },
        BLACK: { name: 'Vértice Black', price: '299,00', features: ['Concierge 24/7', 'Carteira Private', 'Gestão Tributária'] }
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

    const getDaysLeft = (dateStr?: string): number | null => {
        if (!dateStr) return null;
        const diff = new Date(dateStr).getTime() - Date.now();
        return Math.ceil(diff / 86_400_000);
    };

    const daysLeft = isPaidPlan ? getDaysLeft(user?.validUntil) : null;
    const expiryBadge = daysLeft !== null && daysLeft <= 7
        ? { label: daysLeft <= 0 ? 'Expirado' : `Expira em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`, urgent: daysLeft <= 3 }
        : null;

    return (
        <div className="bg-gradient-to-br from-[#080C14] to-[#0A101F] border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
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
                        <div className="flex flex-col items-start md:items-end gap-1 mt-1">
                            <div className="flex items-center gap-1.5 text-emerald-400">
                                <CalendarClock size={12} />
                                <p className="text-[10px] font-bold uppercase tracking-wide">
                                    Válido até {formatDate(user.validUntil)}
                                </p>
                            </div>
                            {expiryBadge && (
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
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
                        <p className="text-[10px] text-slate-500 mt-1">Gratuito vitalício</p>
                    )}
                </div>
            </div>

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
