
// --- CATÁLOGO COMERCIAL ---
// Preço por plano e por CICLO de cobrança (plano comercial de 30/08/2026,
// planejamento/PLANO-DIVULGACAO-2026-08.html, seção 5).
// `annual` é o valor TOTAL dos 12 meses — é ele que o Mercado Pago cobra. O
// "12× R$ 49,90" do card é o PARCELAMENTO no cartão, não um preço mensal
// diferente; quem paga no Pix paga o total à vista.
// O espelho de exibição vive em client/src/constants/subscription.ts e é
// comparado com este arquivo pelo teste client/src/constants/subscription.test.ts.
// O BLACK segue na tabela por causa de quem já assina, mas saiu da venda
// (RETIRED_PLAN_KEYS) — por isso nunca ganhou ciclo anual.
export const PLAN_CATALOG = {
    'ESSENTIAL': { title: 'Vértice Essential', monthly: 29.90,  annual: 238.80 },
    'PRO':       { title: 'Vértice Pro',       monthly: 69.90,  annual: 598.80 },
    'ELITE':     { title: 'Vértice Elite',     monthly: 129.90, annual: 1198.80 },
    'BLACK':     { title: 'Vértice Black',     monthly: 299.00, annual: null },
};

// --- CICLOS DE COBRANÇA ---
// MONTHLY: 30 dias. No cartão vira assinatura (PreApproval) e renova sozinha.
// ANNUAL: 365 dias em cobrança ÚNICA, parcelável em até 12× no cartão. NÃO
// renova sozinha, e isso não é omissão: o PreApproval do Mercado Pago não
// parcela, e parcelar é justamente o que torna o anual vendável.
export const BILLING_CYCLES = ['MONTHLY', 'ANNUAL'];
export const ANNUAL_DAYS = 365;
export const ANNUAL_INSTALLMENTS = 12;
const MONTHLY_DAYS = 30;

// Variantes de teste: mesmo código, preço mínimo (visíveis só para admin).
// Já subimos para R$5,00 achando que o antifraude recusava valor irrisório —
// recusou igual. O valor não é a variável; não vale gastar mais nisso.
const TEST_PRICE = 0.50;

/**
 * A tabela de checkout é DERIVADA do catálogo: cada plano rende até quatro
 * chaves (mensal, anual e as duas de teste). Escrever as 14 linhas à mão era
 * convite para a variante de teste ficar para trás quando o preço mudasse.
 */
const buildPlanTable = () => {
    const table = {};
    for (const [base, { title, monthly, annual }] of Object.entries(PLAN_CATALOG)) {
        table[base] = { price: monthly, days: MONTHLY_DAYS, cycle: 'MONTHLY', title };
        table[`${base}_TEST`] = { price: TEST_PRICE, days: MONTHLY_DAYS, cycle: 'MONTHLY', title };
        if (annual === null) continue;
        table[`${base}_ANNUAL`] = { price: annual, days: ANNUAL_DAYS, cycle: 'ANNUAL', title };
        table[`${base}_ANNUAL_TEST`] = { price: TEST_PRICE, days: ANNUAL_DAYS, cycle: 'ANNUAL', title };
    }
    return table;
};

// Chaves de CHECKOUT (o que o MP cobra), não de acesso. O que o usuário recebe
// é sempre o plano base — ver basePlanOf().
export const PLANS = buildPlanTable();

/** Chave de checkout a partir do plano base + ciclo + se é teste. */
export const checkoutKeyFor = (basePlan, { cycle = 'MONTHLY', test = false } = {}) =>
    `${basePlan}${cycle === 'ANNUAL' ? '_ANNUAL' : ''}${test ? '_TEST' : ''}`;

/**
 * Plano realmente creditado ao usuário. Ciclo e preço de teste são dimensões do
 * CHECKOUT: `user.plan` só aceita os degraus da hierarquia, então PRO_ANNUAL,
 * PRO_TEST e PRO_ANNUAL_TEST creditam todos PRO.
 */
export const basePlanOf = (planKey) => String(planKey ?? '').replace(/_ANNUAL(_TEST)?$|_TEST$/, '');

// Uma variante _TEST cobra R$0,50 mas credita o plano real. Ela só pode nascer
// de POST /subscription/test-checkout, que é requireAdmin. Nunca derive a lista
// de planos vendáveis de `Object.keys(PLANS)` — isso expõe as variantes de teste
// ao checkout público e vende BLACK por R$0,50. Use sempre PUBLIC_PLAN_KEYS /
// isTestPlan().
export const isTestPlan = (planKey) => String(planKey ?? '').endsWith('_TEST');

/** Fail-closed: chave desconhecida não é anual e cai no fluxo mensal. */
export const isAnnualPlan = (planKey) => PLANS[planKey]?.cycle === 'ANNUAL';

// --- PLANOS APOSENTADOS ---
// Continuam existindo para quem já assina: o gate (LIMITS_CONFIG, SIGNAL_DELAY_MINUTES,
// PLAN_HIERARCHY) precisa reconhecer a chave, senão o assinante atual perde acesso de
// um deploy para o outro. O que muda é que ninguém novo consegue comprar.
// O BLACK saiu da grade de assinaturas e virou consultoria avulsa, cobrada fora do
// checkout — ele prometia concierge, calls e carteiras private sem operação por trás.
export const RETIRED_PLAN_KEYS = ['BLACK'];
export const isRetiredPlan = (planKey) => RETIRED_PLAN_KEYS.includes(basePlanOf(planKey));

// Planos realmente vendáveis pelo checkout público (fonte única). Inclui as
// chaves anuais: o anual é um produto vendável, não um modo de pagamento.
export const PUBLIC_PLAN_KEYS = Object.keys(PLANS)
    .filter((key) => !isTestPlan(key) && !isRetiredPlan(key));

// Só o mensal vira assinatura recorrente — é o único ciclo que a troca de plano
// (cancelar preapproval e recriar) sabe operar.
export const PUBLIC_MONTHLY_PLAN_KEYS = PUBLIC_PLAN_KEYS.filter((key) => !isAnnualPlan(key));

// --- HIERARQUIA DE PLANOS ---
// Ordem de poder. Fonte única do "plano X é pelo menos Y" no backend — o gate de
// rota (requireMinPlan), o teto de carteiras e o teto de metas leem daqui, e o
// espelho de exibição vive em client/src/constants/subscription.ts.
// BLACK segue no topo por causa de quem já assina, mesmo fora da venda.
export const PLAN_HIERARCHY = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'ELITE': 3,
    'BLACK': 4,
};

/**
 * O usuário está no degrau `minPlan` ou acima? Fail-closed: plano desconhecido
 * ou ausente vale GUEST. ADMIN passa sempre — mesmo critério dos demais gates
 * (QA/suporte precisa abrir a tela do cliente).
 */
export const hasPlanAtLeast = (user, minPlan) => {
    if (user?.role === 'ADMIN') return true;
    const level = PLAN_HIERARCHY[user?.plan] ?? 0;
    return level >= (PLAN_HIERARCHY[minPlan] ?? Infinity);
};

// --- ASSINATURA RECORRENTE ---
// Modos de cobrança aceitos pelo checkout. O cartão é sempre RECURRING
// (PreApproval); Pix/boleto são sempre ONE_TIME (o Pix não suporta recorrência
// no Mercado Pago).
export const BILLING_MODES = ['ONE_TIME', 'RECURRING'];

// Folga entre o vencimento do período e o rebaixamento para GUEST, aplicada só a
// assinaturas RECURRING. O MP cobra na data de aniversário em horário próprio e
// ainda faz retentativas ("recycling") por alguns dias — sem essa carência, uma
// renovação processada às 10h deixaria o assinante como GUEST desde a meia-noite.
export const RECURRING_GRACE_DAYS = 3;

// --- SINAIS QUANTITATIVOS (Radar Alfa) ---
// Atraso de entrega em MINUTOS por plano. `0` = tempo real, `null` = sem acesso.
// O ESSENTIAL recebe o sinal ÍNTEGRO (mesmo ticker, mesmo valor), só fora da
// janela quente — nunca um payload adulterado. O GUEST não recebe sinal algum;
// só a contagem agregada em `meta`, que não identifica ativo.
// Calibração: o scan roda a cada 15 min, então 60 = 4 ciclos de defasagem.
export const SIGNAL_DELAY_MINUTES = {
    'GUEST': null,
    'ESSENTIAL': 60,
    'PRO': 0,
    'ELITE': 0,
    'BLACK': 0,
};

/**
 * Resolve o nível de acesso a sinais de um usuário. Fail-closed: plano
 * desconhecido ou ausente cai em 'NONE'. ADMIN vê em tempo real (QA/suporte),
 * mesmo critério dos demais gates.
 * @returns {{ tier: 'REALTIME'|'DELAYED'|'NONE', delayMinutes: number|null }}
 */
export const getSignalAccess = (user) => {
    if (user?.role === 'ADMIN') return { tier: 'REALTIME', delayMinutes: 0 };

    const delayMinutes = SIGNAL_DELAY_MINUTES[user?.plan ?? 'GUEST'] ?? null;
    if (delayMinutes === null) return { tier: 'NONE', delayMinutes: null };

    return { tier: delayMinutes > 0 ? 'DELAYED' : 'REALTIME', delayMinutes };
};

// Definição de limites por feature e plano
export const LIMITS_CONFIG = {
    // Quantas carteiras a conta pode ter (9999 = ilimitado). O teto absoluto de
    // MAX_WALLETS_PER_USER (walletsController) continua valendo por cima como
    // rede anti-abuso: "ilimitado" comercial não é ilimitado de infraestrutura.
    'wallets': {
        'GUEST': 1,
        'ESSENTIAL': 3,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    },
    // Metas do Planejador. "Metas Financeiras Limitadas" (Free) = 3 marcos;
    // do ESSENTIAL para cima é ilimitado.
    'goals': {
        'GUEST': 3,
        'ESSENTIAL': 9999,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    },

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
    // Carteira Brasil TOP 10 é a vitrine do Free: o GUEST vê o ranking completo.
    // É o único ranking aberto — todo o resto começa no PRO (research_general).
    'research_br10': { 'GUEST': 1, 'ESSENTIAL': 1, 'PRO': 1, 'ELITE': 1, 'BLACK': 1 },
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
