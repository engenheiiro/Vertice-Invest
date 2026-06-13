
import React, { useState, useRef, useCallback } from 'react';
import { Check, ArrowLeft, Zap, Shield, Crown, Gem, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth, UserPlan } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { subscriptionService } from '../services/subscription';
import { Header } from '../components/dashboard/Header';
import { PLAN_DETAILS } from '../constants/subscription';

// Features exclusivas de cada tier — só o que é NOVO naquele plano
const PLAN_EXCLUSIVE: Record<UserPlan, { key: string; label: string; highlight?: string }[]> = {
    GUEST: [],
    ESSENTIAL: [
        { key: 'terminal',        label: 'Terminal & Cotações em Tempo Real' },
        { key: 'wallet',          label: 'Gestão de Carteira & Rentabilidade' },
        { key: 'br10',            label: 'Research: Carteira Brasil 10' },
        { key: 'academy',         label: 'Vértice Academy (Cursos básicos)' },
        { key: 'delayed_signals', label: 'Sinais com Delay' },
    ],
    PRO: [
        { key: 'smart_contribution', label: 'Aporte Inteligente',             highlight: 'IA' },
        { key: 'radar',              label: 'Radar Alpha (Sinais Tempo Real)' },
        { key: 'stocks',             label: 'Research: Ações Brasileiras' },
        { key: 'fiis',               label: 'Research: Fundos Imobiliários' },
        { key: 'crypto',             label: 'Research: Criptoativos' },
        { key: 'reports',            label: 'Relatórios de Diagnóstico',      highlight: 'IA' },
    ],
    ELITE: [
        { key: 'rebalance',   label: 'Rebalanceamento Automático de Carteira', highlight: 'IA' },
        { key: 'global',      label: 'Research Global (Stocks & REITs)' },
        { key: 'masterclass', label: 'Masterclass & Estudos de Caso' },
    ],
    BLACK: [
        { key: 'private',  label: 'Carteiras Private & Estruturadas' },
        { key: 'ir',       label: 'Automação de Imposto de Renda' },
        { key: 'whatsapp', label: 'Concierge WhatsApp 24h' },
        { key: 'calls',    label: 'Calls Trimestrais com Analistas' },
    ],
};

// Linha de herança exibida no topo da lista de features de cada card
const PLAN_INHERITS: Partial<Record<UserPlan, string>> = {
    PRO:   'Tudo do Essential +',
    ELITE: 'Tudo do Pro +',
    BLACK: 'Tudo do Elite +',
};

type PlanConfig = {
    id: UserPlan;
    description: string;
    icon: React.ReactNode;
    isPopular?: boolean;
    buttonVariant: 'outline' | 'primary';
    buttonColorClass: string;
    borderColor: string;
    hoverColor: string;
};

const PLANS_CONFIG: PlanConfig[] = [
    {
        id: 'ESSENTIAL',
        description: 'Comece a investir com inteligência.',
        icon: <Shield className="text-emerald-400" size={20} />,
        buttonVariant: 'outline',
        buttonColorClass: '!bg-transparent !text-emerald-400 !border-emerald-500/50 hover:!bg-emerald-500/10 hover:!border-emerald-400',
        borderColor: 'border-emerald-500/30',
        hoverColor: 'hover:border-emerald-500/50',
    },
    {
        id: 'PRO',
        description: 'Alpha real. Research completo + IA no seu aporte.',
        icon: <Zap className="text-blue-400" size={20} fill="currentColor" />,
        isPopular: true,
        buttonVariant: 'primary',
        buttonColorClass: '',
        borderColor: 'border-blue-500/30',
        hoverColor: 'hover:border-blue-500/60',
    },
    {
        id: 'ELITE',
        description: 'O poder total da IA Vértice: globais e rebalanceamento automático.',
        icon: <Gem className="text-purple-400" size={20} fill="currentColor" />,
        buttonVariant: 'outline',
        buttonColorClass: '!bg-transparent !text-purple-400 !border-purple-500/50 hover:!bg-purple-500/10 hover:!border-purple-400',
        borderColor: 'border-purple-500/30',
        hoverColor: 'hover:border-purple-500/60',
    },
    {
        id: 'BLACK',
        description: 'Gestão institucional com concierge humano dedicado.',
        icon: <Crown className="text-gold" size={20} fill="currentColor" />,
        buttonVariant: 'outline',
        buttonColorClass: '!bg-transparent !text-gold !border-gold/50 hover:!bg-gold/10 hover:!border-gold',
        borderColor: 'border-gold/30',
        hoverColor: 'hover:border-gold/60',
    },
];

export const Pricing = () => {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [activeDot, setActiveDot] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const handleSelectPlan = async (planId: string) => {
        setLoadingPlan(planId);
        try {
            const response = await subscriptionService.initCheckout(planId);
            if (response.redirectUrl) {
                window.location.href = response.redirectUrl;
            } else {
                throw new Error('URL de pagamento não gerada.');
            }
        } catch (error) {
            console.error('Erro ao iniciar checkout', error);
            addToast('Não foi possível conectar ao Mercado Pago. Tente novamente.', 'error');
            setLoadingPlan(null);
        }
    };

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const idx = Math.round(el.scrollLeft / (el.scrollWidth / PLANS_CONFIG.length));
        setActiveDot(Math.min(Math.max(idx, 0), PLANS_CONFIG.length - 1));
    }, []);

    const scrollToDot = (i: number) => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ left: (el.scrollWidth / PLANS_CONFIG.length) * i, behavior: 'smooth' });
    };

    const renderCard = (plan: PlanConfig) => (
        <PricingCard
            key={plan.id}
            id={plan.id}
            title={PLAN_DETAILS[plan.id].label}
            price={PLAN_DETAILS[plan.id].price}
            originalPrice={PLAN_DETAILS[plan.id].originalPrice}
            promo={PLAN_DETAILS[plan.id].promo}
            description={plan.description}
            icon={plan.icon}
            exclusiveFeatures={PLAN_EXCLUSIVE[plan.id]}
            inheritsFrom={PLAN_INHERITS[plan.id]}
            isPopular={plan.isPopular}
            current={user?.plan === plan.id}
            buttonVariant={plan.buttonVariant}
            buttonColorClass={plan.buttonColorClass}
            borderColor={plan.borderColor}
            hoverColor={plan.hoverColor}
            onSelect={handleSelectPlan}
            isLoading={loadingPlan === plan.id}
        />
    );

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30 pb-20">
            <Header />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16 animate-fade-in">

                {/* Cabeçalho */}
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
                            Plano Atual:{' '}
                            <span className="text-white font-bold uppercase ml-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                                {PLAN_DETAILS[user?.plan || 'GUEST'].label}
                            </span>
                        </span>
                    </p>
                    <div className="mt-6 lg:hidden text-left">
                        <Link to="/dashboard" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white">
                            <ArrowLeft size={14} /> Voltar ao Terminal
                        </Link>
                    </div>
                </div>

                {/* ── MOBILE: carrossel horizontal com snap ── */}
                <div className="sm:hidden">
                    <div
                        ref={scrollRef}
                        onScroll={handleScroll}
                        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {PLANS_CONFIG.map((plan) => (
                            <div
                                key={plan.id}
                                className={`shrink-0 w-[82vw] snap-start${plan.isPopular ? ' relative z-10' : ''}`}
                            >
                                {plan.isPopular && (
                                    <div className="absolute inset-0 bg-blue-600/10 blur-[50px] rounded-full pointer-events-none" />
                                )}
                                {renderCard(plan)}
                            </div>
                        ))}
                    </div>

                    {/* Dots de paginação */}
                    <div className="flex justify-center items-center gap-2 mt-5">
                        {PLANS_CONFIG.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => scrollToDot(i)}
                                aria-label={`Ver plano ${PLANS_CONFIG[i].id}`}
                                className={`rounded-full transition-all duration-300 ${
                                    i === activeDot
                                        ? 'w-5 h-2 bg-white'
                                        : 'w-2 h-2 bg-slate-600 hover:bg-slate-400'
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* ── DESKTOP: grid 2 → 4 colunas ── */}
                <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {PLANS_CONFIG.map((plan) => (
                        <div key={plan.id} className={`h-full flex flex-col${plan.isPopular ? ' relative z-10' : ''}`}>
                            {plan.isPopular && (
                                <div className="absolute inset-0 bg-blue-600/10 blur-[50px] rounded-full pointer-events-none" />
                            )}
                            {renderCard(plan)}
                        </div>
                    ))}
                </div>

                <div className="mt-12 text-center border-t border-slate-800 pt-8 flex flex-col items-center gap-2">
                    <p className="text-[10px] text-slate-600 max-w-2xl mx-auto">
                        * A assinatura é renovada automaticamente. O pagamento é processado de forma segura pelo{' '}
                        <strong>Mercado Pago</strong>.
                    </p>
                    <div className="flex gap-2 opacity-60">
                        <img src="/assets/payment/visa.svg" alt="Visa" className="h-6" />
                        <img src="/assets/payment/mastercard.svg" alt="Mastercard" className="h-6" />
                        <img src="/assets/payment/pix.svg" alt="Pix" className="h-6" />
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// PricingCard
// ─────────────────────────────────────────────
type ExclusiveFeature = { key: string; label: string; highlight?: string };

const CHECK_COLOR: Record<string, string> = {
    ESSENTIAL: 'text-emerald-500',
    PRO:       'text-blue-500',
    ELITE:     'text-purple-500',
    BLACK:     'text-gold',
};

const INHERIT_STYLE: Record<string, string> = {
    ESSENTIAL: 'text-emerald-400 border-emerald-900/40 bg-emerald-900/10',
    PRO:       'text-blue-400 border-blue-900/40 bg-blue-900/10',
    ELITE:     'text-purple-400 border-purple-900/40 bg-purple-900/10',
    BLACK:     'text-gold border-gold/20 bg-gold/5',
};

const HIGHLIGHT_STYLE: Record<string, string> = {
    ESSENTIAL: 'text-emerald-400 bg-emerald-900/20 border-emerald-900/30',
    PRO:       'text-blue-400 bg-blue-900/20 border-blue-900/30',
    ELITE:     'text-purple-400 bg-purple-900/20 border-purple-900/30',
    BLACK:     'text-gold bg-gold/10 border-gold/20',
};

const PricingCard = ({
    id,
    title,
    price,
    originalPrice,
    promo,
    description,
    icon,
    exclusiveFeatures,
    inheritsFrom,
    isPopular,
    current,
    buttonVariant,
    buttonColorClass = '',
    borderColor = 'border-slate-800',
    hoverColor = 'hover:border-slate-700',
    onSelect,
    isLoading,
}: {
    id: string;
    title: string;
    price: string;
    originalPrice?: string;
    promo?: string;
    description: string;
    icon: React.ReactNode;
    exclusiveFeatures: ExclusiveFeature[];
    inheritsFrom?: string;
    isPopular?: boolean;
    current?: boolean;
    buttonVariant: 'outline' | 'primary';
    buttonColorClass?: string;
    borderColor?: string;
    hoverColor?: string;
    onSelect: (id: string) => void;
    isLoading?: boolean;
}) => (
    <div
        className={`bg-base border ${borderColor} rounded-2xl p-7 relative overflow-hidden flex flex-col h-full transition-all duration-300 ${
            isPopular
                ? 'shadow-2xl shadow-blue-900/10 ring-1 ring-blue-500/30 bg-card'
                : hoverColor
        }`}
    >
        {/* Barra superior colorida para o plano em destaque */}
        {isPopular && (
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-500" />
        )}

        {/* Ícone + badge */}
        <div className="mb-5 relative z-10">
            <div className="flex items-center justify-between mb-4">
                <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">{icon}</div>
                {isPopular && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-900/20 px-2.5 py-1 rounded border border-blue-900/30">
                        Recomendado
                    </span>
                )}
            </div>
            <h3 className="text-xl font-bold text-white mb-1.5">{title}</h3>
            <p className="text-sm text-slate-400 leading-snug">{description}</p>
        </div>

        {/* Preço */}
        <div className="mb-6 relative z-10 border-b border-slate-800/50 pb-5">
            {promo && (
                <span className="inline-flex items-center gap-1 mb-2 text-[9px] font-bold uppercase tracking-wider text-blue-300 bg-blue-900/30 px-2 py-0.5 rounded border border-blue-700/40 animate-pulse">
                    🔥 {promo}
                </span>
            )}
            <div className="flex items-baseline gap-1">
                <span className="text-sm text-slate-500 font-bold">R$</span>
                <span className="text-4xl font-bold text-white tracking-tight">{price}</span>
                <span className="text-xs text-slate-500">/mês</span>
            </div>
            {originalPrice && (
                <p className="mt-1 text-xs text-slate-500">
                    De{' '}
                    <span className="line-through decoration-red-500/60">R$ {originalPrice}</span>{' '}
                    por tempo limitado
                </p>
            )}
        </div>

        {/* Lista de features */}
        <div className="flex-1 mb-7 relative z-10 space-y-0">
            {/* Badge de herança ("Tudo do Essential +") */}
            {inheritsFrom && (
                <div
                    className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border mb-3 ${
                        INHERIT_STYLE[id] ?? 'text-slate-400 border-slate-700 bg-slate-800/40'
                    }`}
                >
                    <span className="opacity-70">✦</span>
                    {inheritsFrom}
                </div>
            )}

            <div className="space-y-2.5">
                {exclusiveFeatures.map((feature) => (
                    <div
                        key={feature.key}
                        className="flex items-start gap-2.5 text-xs font-medium leading-relaxed text-slate-300"
                    >
                        <div className={`mt-0.5 shrink-0 ${CHECK_COLOR[id] ?? 'text-emerald-500'}`}>
                            <Check size={13} strokeWidth={3} />
                        </div>
                        <div className="flex-1 flex items-center justify-between gap-2">
                            <span>{feature.label}</span>
                            {feature.highlight && (
                                <span
                                    className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                                        HIGHLIGHT_STYLE[id] ?? 'text-blue-400 bg-blue-900/20 border-blue-900/30'
                                    }`}
                                >
                                    {feature.highlight}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>

        {/* CTA */}
        <div className="relative z-10 mt-auto">
            {current ? (
                <div className="w-full py-4 rounded-xl bg-slate-800/50 border border-slate-700 text-slate-400 text-sm font-bold text-center cursor-default flex items-center justify-center gap-2">
                    <Check size={16} /> Seu Plano Atual
                </div>
            ) : (
                <Button
                    variant={buttonVariant}
                    className={`w-full text-xs uppercase tracking-wide py-4 ${buttonColorClass}`}
                    onClick={() => onSelect(id)}
                    status={isLoading ? 'loading' : 'idle'}
                >
                    {isLoading ? (
                        'Redirecionando...'
                    ) : (
                        <span className="flex items-center gap-2">
                            Assinar com Mercado Pago <ExternalLink size={12} />
                        </span>
                    )}
                </Button>
            )}
        </div>
    </div>
);
