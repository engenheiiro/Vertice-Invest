import type { User, UserPlan, PaymentMethod } from '../../contexts/AuthContext';
import { PLAN_DETAILS } from '../../constants/subscription';

/**
 * O que o card de assinatura mostra, derivado do usuário — sem JSX, testável.
 *
 * Features REAIS, derivadas de PLAN_ACCESS/PLAN_EXCLUSIVE (constants/subscription
 * + Pricing) — cada tier herda o anterior ("Tudo do ...") e lista só o que agrega
 * de novo. Nome e preço vêm de PLAN_DETAILS: o assinante não pode ver aqui um
 * valor diferente do que a vitrine anuncia e o checkout cobra.
 */
const PLAN_FEATURES: Record<UserPlan, string[]> = {
    GUEST: ['1 carteira, com importação da B3', 'Carteira, rentabilidade e extrato', 'Metas financeiras limitadas', 'Carteira Brasil TOP 10, indicadores e cursos limitados'],
    ESSENTIAL: ['Tudo do Free', 'Até 3 carteiras e metas financeiras ilimitadas', 'Proventos e dividendos', 'Carteira Brasil TOP 10 + Renda Fixa', 'Radar Alpha (Day Trade) — sinais com 60 min'],
    PRO: ['Tudo do Essential', 'Carteiras ilimitadas', 'Carteiras de Ações, FIIs e Cripto', 'Carteira Aposentadoria (Buy & Hold)', 'Radar Alpha (Day Trade) e Aporte Inteligente'],
    ELITE: ['Tudo do Pro', 'Carteira de Ativos Globais (Stocks e REITs)', 'Rebalanceamento de Carteira com IA', 'Relatório de apoio ao IR em PDF', 'Suporte prioritário 24h'],
    // Plano aposentado: só quem já assina chega a ver este card.
    BLACK: ['Tudo do Elite', 'Relatório de apoio ao IR em PDF'],
};

/** `glow` é só a cor do brilho de fundo; sem ela (planos de entrada) não há brilho. */
const PLAN_STYLE: Record<UserPlan, { badge: string; glow: string | null; check: string }> = {
    GUEST: { badge: 'bg-slate-700 text-slate-300 border border-slate-600', glow: null, check: 'text-emerald-500' },
    ESSENTIAL: { badge: 'bg-slate-700 text-slate-300 border border-slate-600', glow: null, check: 'text-emerald-500' },
    PRO: { badge: 'bg-blue-600 border border-blue-500', glow: 'bg-blue-600/5', check: 'text-emerald-500' },
    ELITE: { badge: 'bg-purple-600/20 text-purple-300 border border-purple-500/40', glow: 'bg-purple-600/5', check: 'text-emerald-500' },
    BLACK: { badge: 'bg-gold/20 text-gold border border-gold/30', glow: 'bg-gold/5', check: 'text-gold' },
};

// Status como chip colorido (as classes de chip têm override [data-theme=light] no index.css).
const STATUS: Record<string, { label: string; classes: string; dot: string }> = {
    ACTIVE: { label: 'Ativo', classes: 'bg-emerald-900/30 text-emerald-400 border-emerald-900/50', dot: 'bg-emerald-400' },
    TRIAL: { label: 'Em teste', classes: 'bg-blue-900/30 text-blue-400 border-blue-900/50', dot: 'bg-blue-400' },
    PAST_DUE: { label: 'Pendente', classes: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/50', dot: 'bg-yellow-400' },
    CANCELED: { label: 'Cancelado', classes: 'bg-red-900/30 text-red-400 border-red-900/50', dot: 'bg-red-400' },
};
const INACTIVE = { label: 'Inativo', classes: 'bg-slate-800 text-slate-300 border-slate-700', dot: 'bg-slate-500' };

// Método de pagamento real (3.22), de Transaction.method exposto em user.paymentMethod.
const PAYMENT_LABEL: Record<PaymentMethod, string> = { CREDIT_CARD: 'Cartão de Crédito', PIX: 'Pix', CRYPTO: 'Criptomoeda' };

type SubscriptionUser = Partial<Pick<User,
    'plan' | 'subscriptionStatus' | 'subscriptionType' | 'billingCycle' | 'validUntil' | 'nextBillingDate' | 'cardBrand' | 'paymentMethod'>>;

const ptDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const plural = (n: number) => (n === 1 ? '' : 's');

const daysUntil = (iso: string | undefined, now: number): number | null =>
    iso ? Math.ceil((new Date(iso).getTime() - now) / 86_400_000) : null;

// Assinatura recorrente ativa não "expira" — ela renova. Mostrar contagem
// regressiva ali assustaria o assinante adimplente sem motivo.
const expiryBadgeOf = (isRenewing: boolean, daysLeft: number | null) => {
    if (isRenewing || daysLeft === null || daysLeft > 7) return null;
    return {
        label: daysLeft <= 0 ? 'Expirado' : `Expira em ${daysLeft} dia${plural(daysLeft)}`,
        classes: daysLeft <= 3
            ? 'bg-red-950/60 text-red-400 border border-red-800/60'
            : 'bg-yellow-950/60 text-yellow-400 border border-yellow-800/60',
    };
};

const paymentLabelOf = (u: SubscriptionUser, isRecurring: boolean): string => {
    if (u.subscriptionStatus === 'TRIAL') return 'Período de Testes';
    if (isRecurring) return `Cartão de Crédito${u.cardBrand ? ` (${u.cardBrand})` : ''} · Assinatura`;
    return u.paymentMethod ? `${PAYMENT_LABEL[u.paymentMethod]} · Mercado Pago` : 'Mercado Pago (Pré-pago)';
};

/** Validade + renovação (3.19). Sem validade de plano pago, o bloco é o do plano gratuito. */
const validityOf = (u: SubscriptionUser, isPaidPlan: boolean, isRenewing: boolean) => {
    if (!isPaidPlan || !u.validUntil) return null;
    const canceled = u.subscriptionStatus === 'CANCELED' ? 'Cancelada' : 'Manual';
    return {
        validUntil: ptDate(u.validUntil),
        // Data real da próxima cobrança quando há assinatura; senão deixa claro que não haverá renovação.
        renewalTitle: isRenewing ? 'Próxima cobrança' : 'Renovação',
        renewalValue: isRenewing ? ptDate(u.nextBillingDate || u.validUntil) : canceled,
        renewalTone: isRenewing ? 'text-slate-300' : 'text-slate-500',
    };
};

const cancelMessageOf = (u: SubscriptionUser, planName: string): string =>
    u.validUntil
        ? `Não haverá novas cobranças. Você mantém acesso completo ao ${planName} até ${ptDate(u.validUntil)} — o período já pago é seu.`
        : 'Não haverá novas cobranças. Você mantém o acesso até o fim do período já pago.';

/** Avisos e ações que dependem do tipo de cobrança. */
const billingActionsOf = (u: SubscriptionUser, isPaidPlan: boolean, isRecurring: boolean, daysLeft: number | null) => {
    const nearExpiry = daysLeft !== null && daysLeft <= 7 && daysLeft > 0;
    return {
        // Convite de migração: quem pagou avulso e está perto de vencer ganha o
        // caminho para o cartão recorrente, em vez de simplesmente perder o acesso.
        recurringInvite: isPaidPlan && !isRecurring && nearExpiry ? `Seu acesso vence em ${daysLeft} dia${plural(daysLeft ?? 0)}` : null,
        showPaymentFailed: isRecurring && u.subscriptionStatus === 'PAST_DUE',
        canCancel: isRecurring && u.subscriptionStatus !== 'CANCELED',
    };
};

export const buildSubscriptionView = (user: SubscriptionUser | null | undefined, now: number) => {
    const u: SubscriptionUser = user ?? {};
    const plan: UserPlan = u.plan && PLAN_FEATURES[u.plan] ? u.plan : 'GUEST';
    const isPaidPlan = plan !== 'GUEST';
    const daysLeft = isPaidPlan ? daysUntil(u.validUntil, now) : null;
    const isRecurring = u.subscriptionType === 'RECURRING';
    const isRenewing = isRecurring && u.subscriptionStatus === 'ACTIVE';
    const planName = PLAN_DETAILS[plan].label;
    return {
        plan,
        planName,
        features: PLAN_FEATURES[plan],
        style: PLAN_STYLE[plan],
        isBlack: plan === 'BLACK',
        isPaidPlan,
        status: STATUS[u.subscriptionStatus || ''] || INACTIVE,
        pulseDot: u.subscriptionStatus === 'ACTIVE',
        validity: validityOf(u, isPaidPlan, isRenewing),
        isRenewing,
        // Sem isto, um assinante anual vê "Renovação: Manual" sem saber que comprou 12 meses de uma vez.
        showAnnual: u.billingCycle === 'ANNUAL' && !isRenewing,
        expiryBadge: expiryBadgeOf(isRenewing, daysLeft),
        ...billingActionsOf(u, isPaidPlan, isRecurring, daysLeft),

        paymentMethod: u.paymentMethod ?? null,
        paymentLabel: paymentLabelOf(u, isRecurring),
        upgradeLabel: isPaidPlan ? 'Gerenciar / Upgrade' : 'Fazer Upgrade',
        cancelMessage: cancelMessageOf(u, planName),
    };
};

export type SubscriptionView = ReturnType<typeof buildSubscriptionView>;
