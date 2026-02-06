
import React, { useState } from 'react';
import { Check, X, ArrowLeft, Zap, Shield, Crown } from 'lucide-react';
// @ts-ignore
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth, UserPlan } from '../contexts/AuthContext';
import { subscriptionService } from '../services/subscription';
import { Header } from '../components/dashboard/Header';
import { PLAN_ACCESS, PLAN_DETAILS } from '../constants/subscription';

export const Pricing = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

    const handleSelectPlan = async (planId: string) => {
        setLoadingPlan(planId);
        try {
            const response = await subscriptionService.initCheckout(planId);
            navigate(response.redirectUrl); 
        } catch (error) {
            console.error("Erro ao iniciar checkout", error);
            alert("Não foi possível iniciar o pagamento. Tente novamente.");
        } finally {
            setLoadingPlan(null);
        }
    };

    // Lista Mestra de Recursos
    const MASTER_FEATURES = [
        { key: 'terminal', label: "Terminal & Cotações em Tempo Real" },
        { key: 'wallet', label: "Gestão de Carteira & Rentabilidade" },
        { key: 'br10', label: "Research: Carteira Brasil 10" },
        { key: 'academy', label: "Vértice Academy (Cursos)" },
        
        { key: 'smart_contribution', label: "Aporte Inteligente (IA)", highlight: 'IA' },
        { key: 'radar', label: "Radar Alpha (Sinais Tempo Real)" },
        { key: 'stocks', label: "Research: Ações Brasileiras" },
        { key: 'fiis', label: "Research: Fundos Imobiliários" },
        { key: 'crypto', label: "Research: Criptoativos" },
        { key: 'reports', label: "Relatórios de Diagnóstico (IA)" },
        
        { key: 'rebalance', label: "Rebalanceamento Automático", highlight: 'AUTO' },
        { key: 'global', label: "Research Global (Stocks & REITs)" },
        { key: 'private', label: "Carteiras Private & Estruturadas" },
        { key: 'ir', label: "Automação de Imposto de Renda" },
        { key: 'whatsapp', label: "Concierge WhatsApp 24h" },
        { key: 'calls', label: "Calls Trimestrais com Analistas" },
    ];

    const buildFeaturesForPlan = (planKey: UserPlan) => {
        const allowed = PLAN_ACCESS[planKey] || [];
        return MASTER_FEATURES.map(f => ({
            ...f,
            available: allowed.includes(f.key)
        }));
    };

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30 pb-20">
            <Header />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16 animate-fade-in">
                
                {/* Header */}
                <div className="mb-12 text-center relative">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 hidden lg:block">
                         <Link to="/dashboard" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white transition-colors group">
                            <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                            Voltar
                        </Link>
                    </div>
                    
                    <h1 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
                        Escolha sua Potência
                    </h1>
                    <p className="text-slate-400 text-sm max-w-xl mx-auto">
                        Potencialize seus retornos com a tecnologia Vértice.
                        <span className="block sm:inline mt-2 sm:mt-0 sm:ml-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/50">
                            Plano Atual: <span className="text-white font-bold uppercase ml-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">{PLAN_DETAILS[user?.plan || 'GUEST'].label}</span>
                        </span>
                    </p>
                    
                    {/* Mobile Back Button */}
                    <div className="mt-6 lg:hidden text-left">
                        <Link to="/dashboard" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white">
                            <ArrowLeft size={14} /> Voltar ao Terminal
                        </Link>
                    </div>
                </div>

                {/* Grid de Planos */}
                <div className="grid md:grid-cols-3 gap-6 lg:gap-8 items-start">
                    
                    <PricingCard 
                        id="ESSENTIAL"
                        title={PLAN_DETAILS['ESSENTIAL'].label}
                        price={PLAN_DETAILS['ESSENTIAL'].price}
                        description="Para começar a investir com inteligência."
                        icon={<Shield className="text-emerald-400" size={20} />}
                        features={buildFeaturesForPlan('ESSENTIAL')}
                        current={user?.plan === 'ESSENTIAL'}
                        buttonVariant="outline"
                        borderColor="border-emerald-500/30"
                        hoverColor="hover:border-emerald-500/50"
                        onSelect={handleSelectPlan}
                        isLoading={loadingPlan === 'ESSENTIAL'}
                    />

                    <div className="relative z-10">
                        <div className="absolute inset-0 bg-blue-600/10 blur-[50px] rounded-full pointer-events-none"></div>
                        <PricingCard 
                            id="PRO"
                            title={PLAN_DETAILS['PRO'].label}
                            price={PLAN_DETAILS['PRO'].price}
                            description="Alpha real para o investidor ativo."
                            icon={<Zap className="text-blue-400" size={20} fill="currentColor" />}
                            features={buildFeaturesForPlan('PRO')}
                            isPopular
                            current={user?.plan === 'PRO'}
                            buttonVariant="primary"
                            borderColor="border-blue-500/30"
                            hoverColor="hover:border-blue-500/60"
                            onSelect={handleSelectPlan}
                            isLoading={loadingPlan === 'PRO'}
                        />
                    </div>

                    <PricingCard 
                        id="BLACK"
                        title={PLAN_DETAILS['BLACK'].label}
                        price={PLAN_DETAILS['BLACK'].price}
                        description="Gestão de nível institucional."
                        icon={<Crown className="text-[#D4AF37]" size={20} fill="currentColor" />}
                        features={buildFeaturesForPlan('BLACK')}
                        current={user?.plan === 'BLACK'}
                        buttonVariant="outline"
                        borderColor="border-[#D4AF37]/30"
                        hoverColor="hover:border-[#D4AF37]/60"
                        onSelect={handleSelectPlan}
                        isLoading={loadingPlan === 'BLACK'}
                    />
                </div>
                
                <div className="mt-12 text-center border-t border-slate-800 pt-8">
                    <p className="text-[10px] text-slate-600 max-w-2xl mx-auto">
                        * A assinatura é renovada automaticamente. O pagamento será cobrado em sua conta na confirmação da compra.
                    </p>
                </div>
            </div>
        </div>
    );
};

const PricingCard = ({ id, title, price, description, icon, features, isPopular, current, buttonVariant, borderColor = "border-slate-800", hoverColor = "hover:border-slate-700", onSelect, isLoading }: any) => (
    <div className={`bg-[#080C14] border ${borderColor} rounded-2xl p-8 relative overflow-hidden flex flex-col h-full transition-all duration-300 ${isPopular ? 'shadow-2xl shadow-blue-900/10 ring-1 ring-blue-500/30 bg-[#0B101A]' : hoverColor}`}>
        
        {isPopular && (
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
        )}
        
        <div className="mb-6 relative z-10">
            <div className="flex items-center justify-between mb-4">
                <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                    {icon}
                </div>
                {isPopular && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-900/20 px-2.5 py-1 rounded border border-blue-900/30">
                        Recomendado
                    </span>
                )}
            </div>
            <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-slate-400 min-h-[40px]">{description}</p>
        </div>

        <div className="mb-8 relative z-10 border-b border-slate-800/50 pb-6">
            <div className="flex items-baseline gap-1">
                <span className="text-sm text-slate-500 font-bold">R$</span>
                <span className="text-4xl font-bold text-white tracking-tight">{price}</span>
                <span className="text-xs text-slate-500">/mês</span>
            </div>
        </div>

        <div className="flex-1 space-y-3 mb-8 relative z-10">
            {features.map((feature: any, idx: number) => (
                <div key={idx} className={`flex items-start gap-3 text-xs font-medium leading-relaxed ${feature.available ? 'text-slate-300' : 'text-slate-600 opacity-60'}`}>
                    <div className={`mt-0.5 shrink-0 ${feature.available ? (isPopular ? 'text-blue-500' : 'text-emerald-500') : 'text-slate-800'}`}>
                        {feature.available ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={2} />}
                    </div>
                    <div className="flex-1 flex items-center justify-between gap-2">
                        <span className={`${!feature.available && 'line-through decoration-slate-700 decoration-1'}`}>
                            {feature.label}
                        </span>
                        {feature.highlight && feature.available && (
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                                id === 'BLACK' ? 'text-[#D4AF37] bg-[#D4AF37]/10 border-[#D4AF37]/20' : 'text-blue-400 bg-blue-900/20 border-blue-900/30'
                            }`}>
                                {feature.highlight}
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </div>

        <div className="relative z-10 mt-auto">
            {current ? (
                <div className="w-full py-4 rounded-xl bg-slate-800/50 border border-slate-700 text-slate-400 text-sm font-bold text-center cursor-default flex items-center justify-center gap-2">
                    <Check size={16} /> Seu Plano Atual
                </div>
            ) : (
                <Button 
                    variant={buttonVariant} 
                    className="w-full text-xs uppercase tracking-wide py-4"
                    onClick={() => onSelect(id)}
                    status={isLoading ? 'loading' : 'idle'}
                >
                    {title === "Black Elite" ? "Aplicar para Black" : "Fazer Upgrade"}
                </Button>
            )}
        </div>
    </div>
);
