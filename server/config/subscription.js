
// --- PREÇOS DE PRODUÇÃO ---
// PRO em promoção por tempo limitado (de 119,90 por 89,90). Hierarquia de valor:
// ESSENTIAL < PRO < ELITE < BLACK.
export const PLANS = {
    'ESSENTIAL': { price: 39.90,  days: 30, title: 'Vértice Essential' },
    'PRO':       { price: 89.90,  days: 30, title: 'Vértice Pro' },
    'ELITE':     { price: 120.00, days: 30, title: 'Vértice Elite' },
    'BLACK':     { price: 299.00, days: 30, title: 'Vértice Black' },

    // Variantes de teste: mesmo código, preço R$0,50 (visíveis só para admin)
    'ESSENTIAL_TEST': { price: 0.50, days: 30, title: 'Vértice Essential' },
    'PRO_TEST':       { price: 0.50, days: 30, title: 'Vértice Pro' },
    'ELITE_TEST':     { price: 0.50, days: 30, title: 'Vértice Elite' },
    'BLACK_TEST':     { price: 0.50, days: 30, title: 'Vértice Black' },
};

// Mapeia plano de teste → plano real
export const TEST_PLAN_MAP = {
    'ESSENTIAL_TEST': 'ESSENTIAL',
    'PRO_TEST':       'PRO',
    'ELITE_TEST':     'ELITE',
    'BLACK_TEST':     'BLACK',
};

// Definição de limites por feature e plano
export const LIMITS_CONFIG = {
    // Carteira
    'smart_contribution': {
        'GUEST': 0,
        'ESSENTIAL': 0,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    },
    // Rebalanceamento IA: a partir do ELITE (poder de IA). PRO não tem.
    'ai_rebalance': {
        'GUEST': 0,
        'ESSENTIAL': 0,
        'PRO': 0,
        'ELITE': 9999,
        'BLACK': 9999
    },

    // Terminal
    'radar_alpha': {
        'GUEST': 0,
        'ESSENTIAL': 0,
        'PRO': 1,
        'ELITE': 1,
        'BLACK': 1
    },

    // Research & Dados
    'research_br10': { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 1, 'ELITE': 1, 'BLACK': 1 },
    'research_general': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 1, 'ELITE': 1, 'BLACK': 1 },
    // Ativos Globais: a partir do ELITE. PRO não tem.
    'research_global': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 0, 'ELITE': 1, 'BLACK': 1 },

    // Cursos
    'courses_free': { 'GUEST': 1, 'ESSENTIAL': 1, 'PRO': 1, 'ELITE': 1, 'BLACK': 1 },
    'courses_essential': { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 1, 'ELITE': 1, 'BLACK': 1 },
    'courses_pro': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 1, 'ELITE': 1, 'BLACK': 1 },
    // Cursos Black (Masterclass): a partir do ELITE.
    'courses_black': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 0, 'ELITE': 1, 'BLACK': 1 },

    // Relatórios
    'report': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    }
};
