
// --- PREÇOS DE TESTE (Produção) ---
export const PLANS = {
    'ESSENTIAL': { price: 1.00, days: 30, title: 'Vértice Essential (Teste)' },
    'PRO': { price: 2.00, days: 30, title: 'Vértice Pro (Teste)' },
    'BLACK': { price: 3.00, days: 30, title: 'Vértice Black (Teste)' }
};

// Definição de limites por feature e plano
export const LIMITS_CONFIG = {
    // Carteira
    'smart_contribution': {
        'GUEST': 0,
        'ESSENTIAL': 0,
        'PRO': 9999,
        'BLACK': 9999
    },
    'ai_rebalance': {
        'GUEST': 0,
        'ESSENTIAL': 0,
        'PRO': 0,
        'BLACK': 9999
    },
    
    // Terminal
    'radar_alpha': {
        'GUEST': 0,
        'ESSENTIAL': 0,
        'PRO': 1,
        'BLACK': 1
    },

    // Research & Dados
    'research_br10': { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 1, 'BLACK': 1 },
    'research_general': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 1, 'BLACK': 1 },
    'research_global': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 0, 'BLACK': 1 },

    // Cursos
    'courses_free': { 'GUEST': 1, 'ESSENTIAL': 1, 'PRO': 1, 'BLACK': 1 },
    'courses_essential': { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 1, 'BLACK': 1 },
    'courses_pro': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 1, 'BLACK': 1 },
    'courses_black': { 'GUEST': 0, 'ESSENTIAL': 0, 'PRO': 0, 'BLACK': 1 },

    // Relatórios
    'report': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 9999,
        'BLACK': 9999 
    }
};
