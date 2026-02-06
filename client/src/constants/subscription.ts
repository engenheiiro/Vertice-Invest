
import { UserPlan } from "../contexts/AuthContext";

// Hierarquia numérica para comparações de acesso (quem é maior que quem)
export const PLAN_HIERARCHY: Record<UserPlan, number> = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'BLACK': 3
};

// Detalhes de Exibição e Preços
export const PLAN_DETAILS: Record<UserPlan, { label: string; price: string; color: string }> = {
    'GUEST': { label: 'Visitante', price: '0,00', color: 'slate' },
    'ESSENTIAL': { label: 'Essential', price: '39,90', color: 'emerald' },
    'PRO': { label: 'Vértice Pro', price: '119,90', color: 'blue' },
    'BLACK': { label: 'Black Elite', price: '349,90', color: 'gold' }
};

// Controle de Acesso a Features (Quais planos têm quais chaves)
export const PLAN_ACCESS: Record<UserPlan, string[]> = {
    'GUEST': ['terminal', 'wallet', 'br10', 'academy'],
    'ESSENTIAL': ['terminal', 'wallet', 'br10', 'academy', 'delayed_signals'],
    'PRO': ['terminal', 'wallet', 'br10', 'academy', 'smart_contribution', 'radar', 'stocks', 'fiis', 'crypto', 'reports'],
    'BLACK': ['terminal', 'wallet', 'br10', 'academy', 'smart_contribution', 'radar', 'stocks', 'fiis', 'crypto', 'reports', 'rebalance', 'global', 'private', 'ir', 'whatsapp', 'calls']
};

// Limites Numéricos (9999 = Ilimitado)
export const FEATURE_LIMITS: Record<string, Record<UserPlan, number>> = {
    'smart_contribution': {
        'GUEST': 0,
        'ESSENTIAL': 0, // Apenas Pro+
        'PRO': 9999,
        'BLACK': 9999
    },
    'report': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 9999,
        'BLACK': 9999
    }
};
