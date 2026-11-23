/**
 * Regras puras da página Carteira (WalletView): gates de plano das abas e
 * ações, textos do cabeçalho e a aba que o tutorial força. Sem React aqui —
 * a view só lê o resultado.
 */
import { FEATURE_LIMITS, PLAN_HIERARCHY } from '../../constants/subscription';
import type { User } from '../../contexts/AuthContext';
import { WALLET_STEPS } from '../tutorial/tutorialSteps';

export type WalletViewTab = 'OVERVIEW' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATEMENT' | 'TAX';

type ViewUser = Pick<User, 'plan' | 'role'> | null | undefined;

export interface WalletAccess {
    /** Relatório de IR: ELITE+ (ADMIN passa para QA); nunca no link público. */
    canAccessTax: boolean;
    /** Proventos: ESSENTIAL+; no link público o gate é do dono, no servidor. */
    canAccessDividends: boolean;
    canSmartContribute: boolean;
    canRebalance: boolean;
    /** Cadeado no botão do Aporte: só quando o plano conhecido é GUEST/ESSENTIAL. */
    smartLocked: boolean;
}

export const LIMIT_MESSAGES = {
    smart: 'O Aporte Inteligente é um recurso exclusivo dos planos Pro e Black.',
    rebalance: 'O Rebalanceamento Automático com IA é um recurso exclusivo dos planos Elite e Black.',
    tax: 'O Relatório de apoio ao Imposto de Renda é um recurso do plano Elite.',
    dividends: 'O painel de Proventos e Dividendos começa no plano Essential.',
} as const;

export const getWalletAccess = (user: ViewUser, isReadOnly: boolean): WalletAccess => {
    const plan = user?.plan || 'GUEST';
    const isAdmin = user?.role === 'ADMIN';
    const level = PLAN_HIERARCHY[plan];
    return {
        canAccessTax: !isReadOnly && (level >= PLAN_HIERARCHY.ELITE || isAdmin),
        canAccessDividends: isReadOnly || level >= PLAN_HIERARCHY.ESSENTIAL || isAdmin,
        canSmartContribute: FEATURE_LIMITS['smart_contribution'][plan] !== 0,
        canRebalance: plan === 'BLACK' || plan === 'ELITE',
        smartLocked: user?.plan === 'GUEST' || user?.plan === 'ESSENTIAL',
    };
};

export const walletSubtitle = (isReadOnly: boolean, ownerFirstName?: string | null): string => {
    if (!isReadOnly) return 'Gerencie seus ativos e acompanhe a evolução patrimonial.';
    const by = ownerFirstName ? ` por ${ownerFirstName}` : '';
    return `Carteira compartilhada${by}. Os dados são os mesmos que o investidor acompanha.`;
};

/** Selo USD/BRL: só com taxa positiva (sem taxa, o selo some — nunca número inventado). */
export const usdBadgeText = (usdRate: number | null | undefined): string | null =>
    usdRate != null && usdRate > 0 ? `USD/BRL R$${usdRate.toFixed(2)}` : null;

/** Classe que sobe a área acima do overlay do tutorial; fora dele, nada (antes saía a classe literal "false"). */
export const tourLayerClass = (isDemoMode: boolean): string => (isDemoMode ? 'relative z-[100]' : '');

/** Aba do passo atual do tutorial, pelo metadado `tab` (sem número mágico). */
export const tutorialTab = (currentStep: number): WalletViewTab => {
    const stepIndex = Math.min(currentStep, WALLET_STEPS.length - 1);
    return WALLET_STEPS[stepIndex]?.tab ?? 'OVERVIEW';
};

/** Cofre de Dividendos (Dashboard) manda pra cá com o editor da meta já aberto. */
export const wantsDividendGoalEditor = (state: unknown): boolean =>
    Boolean((state as { openDividendGoalEditor?: boolean } | null)?.openDividendGoalEditor);
