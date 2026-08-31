
import React, { useState, useRef, useCallback } from 'react';
import { Check, ArrowLeft, Zap, Shield, Rocket, Gem, ExternalLink, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuth, UserPlan } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { subscriptionService, type BillingMode } from '../services/subscription';
import { Header } from '../components/dashboard/Header';
import { PaymentMethodModal } from '../components/subscription/PaymentMethodModal';
import { ANNUAL_INSTALLMENTS, PLAN_DETAILS, annualSavingsPercent, checkoutKeyFor, type BillingCycle } from '../constants/subscription';
import { HOME_ROUTE } from '../config/homeRoute';
import { PageMeta } from '../components/seo/PageMeta';

// Features exclusivas de cada tier — só o que é NOVO naquele plano.
// A grade segue o catálogo do plano comercial (planejamento/PLANO-DIVULGACAO-2026-08.html,
// seção 5). A Onda 3 fechou os gates: limites de carteira e de meta, Brasil TOP 10
// no Free, Proventos no Essential e relatório de IR no Elite. A Onda 4 pôs o ciclo
// anual à venda. Seguem SEM gate os níveis de curso (não existe catálogo para
// dividir) e o canal 24h do Elite, que é decisão operacional. A tabela da seção 6
// do plano registra o estado de cada promessa — atualize LÁ ao mexer AQUI.
const PLAN_EXCLUSIVE: Record<UserPlan, { key: string; label: string; highlight?: string }[]> = {
    GUEST: [
        { key: 'wallets',    label: '1 carteira' },
        { key: 'import',     label: 'Importe seus investimentos da B3 ou de uma planilha' },
        { key: 'wallet',     label: 'Gestão de Carteira, Rentabilidade e Extrato' },
        { key: 'goals',      label: 'Metas Financeiras Limitadas' },
        { key: 'indicators', label: 'Indicadores e Calculadora' },
        { key: 'academy',    label: 'Cursos Limitados' },
        { key: 'br10',       label: 'Carteira Brasil TOP 10',                    highlight: 'IA' },
    ],
    ESSENTIAL: [
        { key: 'wallets',         label: 'Até 3 carteiras' },
        { key: 'wallet',          label: 'Gestão de Carteira Completa, Proventos e Dividendos' },
        { key: 'goals',           label: 'Metas Financeiras Ilimitadas' },
        { key: 'fixed_income',    label: 'Carteira Brasil TOP 10 + Carteira de Renda Fixa', highlight: 'IA' },
        { key: 'delayed_signals', label: 'Radar Alpha (Day Trade) — sinais com 60 min', highlight: 'IA' },
        { key: 'academy',         label: 'Cursos até o Nível 1' },
    ],
    PRO: [
        { key: 'wallets',            label: 'Carteiras Ilimitadas' },
        { key: 'research',           label: 'Carteiras de Ações, FIIs e Cripto',       highlight: 'IA' },
        { key: 'buy_and_hold',       label: 'Carteira Aposentadoria (Buy & Hold)',     highlight: 'IA' },
        { key: 'radar',              label: 'Radar Alpha (Day Trade) — sinais em tempo real', highlight: 'IA' },
        { key: 'smart_contribution', label: 'Aporte Inteligente',                     highlight: 'IA' },
        { key: 'academy',            label: 'Cursos até o Nível 3' },
    ],
    ELITE: [
        { key: 'global',      label: 'Carteira de Ativos Globais (Stocks e REITs)', highlight: 'IA' },
        { key: 'rebalance',   label: 'Rebalanceamento de Carteira',          highlight: 'IA' },
        { key: 'ir',          label: 'Relatório de apoio ao IR em PDF' },
        { key: 'academy',     label: 'Cursos até o Nível 4' },
        { key: 'masterclass', label: 'Masterclass' },
        { key: 'support',     label: 'Suporte prioritário 24h' },
    ],
    // Aposentado: virou consultoria avulsa e não aparece mais na vitrine. A lista
    // fica porque o tipo é Record<UserPlan> e porque descreve o que o assinante
    // atual ainda recebe. Nada aqui é exclusivo: o relatório de IR desceu para o
    // Elite na Onda 3, e o Black entra por hierarquia.
    BLACK: [
        { key: 'ir', label: 'Relatório de apoio ao IR em PDF' },
    ],
};

// Linha de herança exibida no topo da lista de features de cada card
const PLAN_INHERITS: Partial<Record<UserPlan, string>> = {
    ESSENTIAL: 'Tudo do Free +',
    PRO:   'Tudo do Essential +',
    ELITE: 'Tudo do Pro +',
    BLACK: 'Tudo do Elite +',
};

type PlanConfig = {
    id: UserPlan;
    description: string;
    icon: React.ReactNode;
    isPopular?: boolean;
    // Free não passa pelo checkout: o card informa, não vende.
    isFree?: boolean;
    buttonVariant: 'outline' | 'primary';
    buttonColorClass: string;
    borderColor: string;
    hoverColor: string;
};

const PLANS_CONFIG: PlanConfig[] = [
    {
        id: 'GUEST',
        description: 'Para organizar a primeira carteira.',
        icon: <Rocket className="text-slate-300" size={20} />,
        isFree: true,
        buttonVariant: 'outline',
        buttonColorClass: '',
        borderColor: 'border-slate-700/50',
        hoverColor: 'hover:border-slate-600',
    },
    {
        id: 'ESSENTIAL',
        description: 'Para acompanhar os primeiros ativos.',
        icon: <Shield className="text-emerald-400" size={20} />,
        buttonVariant: 'outline',
        buttonColorClass: '!bg-transparent !text-emerald-400 !border-emerald-500/50 hover:!bg-emerald-500/10 hover:!border-emerald-400',
        borderColor: 'border-emerald-500/30',
        hoverColor: 'hover:border-emerald-500/50',
    },
    {
        id: 'PRO',
        description: 'Para decidir aportes com a Carteira Recomendada e gestão com IA.',
        icon: <Zap className="text-blue-400" size={20} fill="currentColor" />,
        isPopular: true,
        buttonVariant: 'primary',
        buttonColorClass: '',
        borderColor: 'border-blue-500/30',
        hoverColor: 'hover:border-blue-500/60',
    },
    {
        id: 'ELITE',
        description: 'Para portfólio global, rebalanceamento e rotina fiscal.',
        icon: <Gem className="text-purple-400" size={20} fill="currentColor" />,
        buttonVariant: 'outline',
        buttonColorClass: '!bg-transparent !text-purple-400 !border-purple-500/50 hover:!bg-purple-500/10 hover:!border-purple-400',
        borderColor: 'border-purple-500/30',
        hoverColor: 'hover:border-purple-500/60',
    },
];

export const Pricing = () => {
    const { user, isAuthenticated } = useAuth();
    const { addToast } = useToast();
    const navigate = useNavigate();
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [activeDot, setActiveDot] = useState(0);
    const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
    // Plano escolhido aguardando a escolha do método (cartão recorrente x Pix avulso).
    const [pendingPlan, setPendingPlan] = useState<UserPlan | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const isAnnual = cycle === 'ANNUAL';
    // O desconto varia por plano; o selo do toggle anuncia o teto e cada card
    // mostra o seu — prometer um número único seria falso para dois dos três.
    const maiorEconomia = Math.max(
        ...PLANS_CONFIG.map((plano) => annualSavingsPercent(plano.id) ?? 0),
    );

    const startCheckout = async (plan: UserPlan, mode: BillingMode) => {
        setLoadingPlan(plan);
        try {
            const response = await subscriptionService.initCheckout(checkoutKeyFor(plan, cycle), mode);
            if (response.redirectUrl) {
                window.location.href = response.redirectUrl;
            } else {
                throw new Error('URL de pagamento não gerada.');
            }
        } catch (error) {
            console.error('Erro ao iniciar checkout', error);
            addToast('Não foi possível conectar ao Mercado Pago. Tente novamente.', 'error');
            setLoadingPlan(null);
            setPendingPlan(null);
        }
    };

    /**
     * No MENSAL, cartão e Pix levam a APIs diferentes do Mercado Pago
     * (PreApproval x Preference) e a consequências diferentes de renovação — por
     * isso a escolha vem antes do redirect.
     *
     * No ANUAL não há escolha a fazer: é uma cobrança única, e o próprio checkout
     * do MP oferece cartão parcelado ou Pix na mesma tela. Abrir o modal ali seria
     * pedir uma decisão que não muda nada.
     */
    const handleSelectPlan = (planId: string) => {
        const plan = planId as UserPlan;
        // Visitante não tem conta para receber o plano, e o checkout exige
        // autenticação — mandá-lo ao Mercado Pago só produziria um 401.
        if (!isAuthenticated) {
            navigate('/register');
            return;
        }
        if (isAnnual) {
            void startCheckout(plan, 'ONE_TIME');
            return;
        }
        setPendingPlan(plan);
    };

    const handleConfirmMethod = (mode: BillingMode) => {
        if (!pendingPlan) return;
        void startCheckout(pendingPlan, mode);
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
            nickname={PLAN_DETAILS[plan.id].nickname}
            price={PLAN_DETAILS[plan.id].price}
            annualPrice={PLAN_DETAILS[plan.id].annualPrice}
            annualMonthly={PLAN_DETAILS[plan.id].annualMonthly}
            savingsPercent={annualSavingsPercent(plan.id)}
            cycle={cycle}
            originalPrice={PLAN_DETAILS[plan.id].originalPrice}
            promo={PLAN_DETAILS[plan.id].promo}
            description={plan.description}
            icon={plan.icon}
            exclusiveFeatures={PLAN_EXCLUSIVE[plan.id]}
            inheritsFrom={PLAN_INHERITS[plan.id]}
            isPopular={plan.isPopular}
            isFree={plan.isFree}
            current={user?.plan === plan.id}
            buttonVariant={plan.buttonVariant}
            buttonColorClass={plan.buttonColorClass}
            borderColor={plan.borderColor}
            hoverColor={plan.hoverColor}
            onSelect={handleSelectPlan}
            isLoading={loadingPlan === plan.id}
            isVisitor={!isAuthenticated}
        />
    );

    return (
        <>
        {/* A página passou a ser indexável (Onda 5). Sem título e descrição
            próprios, o resultado de busca herdaria os genéricos do index.html —
            a página que vende apareceria com a cara da inicial. */}
        <PageMeta
            title="Planos e Preços"
            description="Planos da Vértice Invest a partir de R$ 29,90/mês: carteira com importação da B3, proventos, carteiras recomendadas de Ações, FIIs e Cripto e ativos globais. No anual, até 12× sem renovação automática."
            canonical="/pricing"
        />
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30 pb-[calc(5rem+env(safe-area-inset-bottom))] xl:pb-20">
            {/* O Header do app depende do WalletProvider (carteira ativa, modo
                privacidade), que só existe na área logada. Visitante recebe uma
                barra própria, com os dois caminhos que fazem sentido para ele. */}
            {isAuthenticated ? <Header /> : <VitrineTopBar />}

            {pendingPlan && (
                <PaymentMethodModal
                    isOpen
                    onClose={() => setPendingPlan(null)}
                    onConfirm={handleConfirmMethod}
                    planLabel={PLAN_DETAILS[pendingPlan].label}
                    price={PLAN_DETAILS[pendingPlan].price}
                    isLoading={loadingPlan === pendingPlan}
                />
            )}

            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16 animate-fade-in">

                {/* Cabeçalho */}
                <div className="mb-12 text-center relative">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 hidden lg:block">
                        <Link to={isAuthenticated ? HOME_ROUTE : '/'} className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white transition-colors group">
                            <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                            Voltar
                        </Link>
                    </div>
                    <h1 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
                        Escolha sua Potência
                    </h1>
                    <p className="text-slate-400 text-sm max-w-xl mx-auto">
                        Potencialize seus retornos com a tecnologia Vértice.
                        {isAuthenticated && (
                            <span className="block sm:inline mt-2 sm:mt-0 sm:ml-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/50">
                                Plano Atual:{' '}
                                <span className="text-white font-bold uppercase ml-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                                    {PLAN_DETAILS[user?.plan || 'GUEST'].label}
                                </span>
                            </span>
                        )}
                    </p>
                    <div className="mt-6 lg:hidden text-left">
                        <Link to={isAuthenticated ? HOME_ROUTE : '/'} className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white">
                            <ArrowLeft size={14} /> {isAuthenticated ? 'Voltar à Carteira' : 'Voltar ao início'}
                        </Link>
                    </div>
                </div>

                {/* Ciclo de cobrança. O anual não é um desconto de campanha: é
                    outro produto (compra única de 12 meses), e o card muda de
                    número junto — mostrar só um selo de "%" esconderia o total. */}
                <div className="mb-10 flex flex-col items-center gap-2">
                    <div role="radiogroup" aria-label="Ciclo de cobrança" className="inline-flex items-center gap-1 p-1 rounded-xl bg-base border border-slate-800">
                        {([
                            { value: 'MONTHLY' as const, label: 'Mensal' },
                            { value: 'ANNUAL' as const, label: 'Anual' },
                        ]).map((opcao) => (
                            <button
                                key={opcao.value}
                                type="button"
                                role="radio"
                                aria-checked={cycle === opcao.value}
                                onClick={() => setCycle(opcao.value)}
                                className={`px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${
                                    cycle === opcao.value
                                        ? 'bg-blue-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                {opcao.label}
                                {opcao.value === 'ANNUAL' && (
                                    <span className="ml-2 text-[9px] font-bold text-emerald-400">
                                        até {maiorEconomia}% off
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-slate-500">
                        {isAnnual
                            ? `Cobrança única de 12 meses, em até ${ANNUAL_INSTALLMENTS}× no cartão. Não renova automaticamente.`
                            : 'No cartão, renova automaticamente todo mês. Cancele quando quiser.'}
                    </p>
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
                        {isAnnual
                            ? '* O plano anual é uma cobrança única que libera 12 meses de acesso e não é renovado automaticamente.'
                            : '* No cartão, a assinatura mensal é renovada automaticamente. No Pix, o acesso vale 30 dias e não renova.'}
                        {' '}O pagamento é processado de forma segura pelo <strong>Mercado Pago</strong>.
                    </p>
                    <div className="flex gap-2 opacity-60">
                        <img src="/assets/payment/visa.svg" alt="Visa" className="h-6" />
                        <img src="/assets/payment/mastercard.svg" alt="Mastercard" className="h-6" />
                        <img src="/assets/payment/pix.svg" alt="Pix" className="h-6" />
                    </div>
                </div>
            </div>
        </div>
        </>
    );
};

// ─────────────────────────────────────────────
// VitrineTopBar — barra do visitante (sem WalletProvider)
// ─────────────────────────────────────────────
const VitrineTopBar = () => (
    <nav aria-label="Navegação principal" className="w-full border-b border-slate-800 bg-base/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
                <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center rounded-lg shadow-lg shadow-blue-600/20">
                    <ShieldCheck size={16} className="text-white" />
                </div>
                <span className="text-base font-bold tracking-tight text-white">VÉRTICE</span>
            </Link>
            <div className="flex items-center gap-4">
                <Link to="/login" className="text-[12.5px] font-semibold text-slate-300 hover:text-white transition-colors">
                    Acessar Conta
                </Link>
                <Link to="/register" className="rounded-full bg-white px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-blue-50">
                    Começar Agora
                </Link>
            </div>
        </div>
    </nav>
);

// ─────────────────────────────────────────────
// PricingCard
// ─────────────────────────────────────────────
type ExclusiveFeature = { key: string; label: string; highlight?: string };

const CHECK_COLOR: Record<string, string> = {
    GUEST:     'text-slate-400',
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
    nickname,
    price,
    annualPrice,
    annualMonthly,
    savingsPercent,
    cycle,
    originalPrice,
    promo,
    description,
    icon,
    exclusiveFeatures,
    inheritsFrom,
    isPopular,
    isFree,
    current,
    buttonVariant,
    buttonColorClass = '',
    borderColor = 'border-slate-800',
    hoverColor = 'hover:border-slate-700',
    onSelect,
    isLoading,
    isVisitor,
}: {
    id: string;
    title: string;
    nickname?: string;
    price: string;
    annualPrice?: string;
    annualMonthly?: string;
    savingsPercent?: number | null;
    cycle: BillingCycle;
    originalPrice?: string;
    promo?: string;
    description: string;
    icon: React.ReactNode;
    exclusiveFeatures: ExclusiveFeature[];
    inheritsFrom?: string;
    isPopular?: boolean;
    isFree?: boolean;
    current?: boolean;
    buttonVariant: 'outline' | 'primary';
    buttonColorClass?: string;
    borderColor?: string;
    hoverColor?: string;
    onSelect: (id: string) => void;
    isLoading?: boolean;
    isVisitor?: boolean;
}) => {
    // O Free não é vendido no anual: sem preço anual, o card fica como está.
    const isAnnualCard = cycle === 'ANNUAL' && Boolean(annualPrice);

    return (
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
            <div className="flex items-center gap-2.5 mb-2">
                <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 shrink-0">{icon}</div>
                <h3 className="text-xl font-bold text-white truncate">{title}</h3>
                {isPopular && (
                    <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wider text-blue-400 bg-blue-900/20 px-2 py-1 rounded border border-blue-900/30">
                        Recomendado
                    </span>
                )}
            </div>
            {nickname && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{nickname}</p>
            )}
            <p className="text-sm text-slate-400 leading-snug">{description}</p>
        </div>

        {/* Preço. No anual o número grande é a PARCELA (total ÷ 12), e o total
            cobrado vem logo abaixo — anunciar só a parcela esconderia o valor
            que de fato sai da conta hoje. */}
        <div className="mb-6 relative z-10 border-b border-slate-800/50 pb-5">
            {promo && (
                <span className="inline-flex items-center gap-1 mb-2 text-[9px] font-bold uppercase tracking-wider text-blue-300 bg-blue-900/30 px-2 py-0.5 rounded border border-blue-700/40 animate-pulse">
                    🔥 {promo}
                </span>
            )}
            {isAnnualCard && savingsPercent ? (
                <span className="inline-flex items-center gap-1 mb-2 text-[9px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-900/25 px-2 py-0.5 rounded border border-emerald-700/40">
                    Economize {savingsPercent}%
                </span>
            ) : null}
            <div className="flex items-baseline gap-1">
                <span className="text-sm text-slate-500 font-bold">R$</span>
                <span className="text-4xl font-bold text-white tracking-tight">
                    {isAnnualCard ? annualMonthly : price}
                </span>
                <span className="text-xs text-slate-500">/mês</span>
            </div>
            {isAnnualCard ? (
                <p className="mt-1 text-xs text-slate-400">
                    {ANNUAL_INSTALLMENTS}× de R$ {annualMonthly} · <span className="text-slate-300 font-bold">R$ {annualPrice}</span> por ano
                </p>
            ) : originalPrice ? (
                <p className="mt-1 text-xs text-slate-500">
                    De{' '}
                    <span className="line-through decoration-red-500/60">R$ {originalPrice}</span>{' '}
                    por tempo limitado
                </p>
            ) : null}
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
                        <div className="flex-1">
                            <span>
                                {feature.label}
                                {feature.highlight && (
                                    <span
                                        className={`ml-1.5 align-middle whitespace-nowrap text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                                            HIGHLIGHT_STYLE[id] ?? 'text-blue-400 bg-blue-900/20 border-blue-900/30'
                                        }`}
                                    >
                                        {feature.highlight}
                                    </span>
                                )}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>

        {/* CTA */}
        <div className="relative z-10 mt-auto">
            {isFree && isVisitor ? (
                // Para o visitante o Free não é informação, é a porta de entrada.
                <Button
                    variant="outline"
                    className="w-full text-xs uppercase tracking-wide py-4"
                    onClick={() => onSelect(id)}
                >
                    Criar conta grátis
                </Button>
            ) : isFree && !current ? (
                <div className="w-full py-4 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-500 text-xs font-bold text-center cursor-default">
                    Incluído em toda conta Vértice
                </div>
            ) : current ? (
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
                    ) : isVisitor ? (
                        // Sem conta não há plano para creditar: o passo honesto é
                        // o cadastro, não uma ida ao Mercado Pago que daria 401.
                        'Criar conta para assinar'
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
};
