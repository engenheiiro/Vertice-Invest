
import { UserPlan } from "../contexts/AuthContext";

// Hierarquia numérica para comparações de acesso (quem é maior que quem)
export const PLAN_HIERARCHY: Record<UserPlan, number> = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'ELITE': 3,
    'BLACK': 4
};

// Detalhes de Exibição e Preços — ESPELHO de server/config/subscription.js, que é
// quem manda o valor para o Mercado Pago. Os dois arquivos são comparados pelo teste
// em subscription.test.ts: mudou o preço lá, muda aqui (ou o teste quebra).
// `nickname` é o apelido comercial do degrau ("Investidor Iniciante"), usado na
// vitrine; `label` continua sendo o nome do plano no produto.
// `originalPrice` + `promo` ativam o selo de preço riscado. Só preencher durante
// uma campanha com data de início e fim definidas: preço riscado permanente não é
// promoção, é preço de tabela disfarçado — corrói confiança e é risco consumerista.
//
// `annualPrice` é o TOTAL cobrado pelos 12 meses; `annualMonthly` é só ele
// dividido por 12, o número grande do card no modo anual. Quem não tem os dois
// não é vendido no anual (o Free não cobra, o Black saiu da venda).
export const PLAN_DETAILS: Record<UserPlan, {
    label: string; nickname?: string; price: string; color: string;
    originalPrice?: string; promo?: string;
    annualPrice?: string; annualMonthly?: string;
}> = {
    'GUEST': { label: 'Free', nickname: 'Primeiros Passos', price: '0,00', color: 'slate' },
    'ESSENTIAL': { label: 'Essential', nickname: 'Investidor Iniciante', price: '29,90', color: 'emerald', annualPrice: '238,80', annualMonthly: '19,90' },
    'PRO': { label: 'Pro', nickname: 'Investidor Estratégico', price: '69,90', color: 'blue', annualPrice: '598,80', annualMonthly: '49,90' },
    'ELITE': { label: 'Elite', nickname: 'Investidor Global', price: '129,90', color: 'purple', annualPrice: '1.198,80', annualMonthly: '99,90' },
    // Aposentado: virou consultoria avulsa (RETIRED_PLAN_KEYS no servidor). Fica aqui
    // para quem já assina continuar vendo o nome e o valor do próprio plano.
    'BLACK': { label: 'Vértice Black', price: '299,00', color: 'gold' }
};

// Ciclo de cobrança. Espelha BILLING_CYCLES do servidor. MENSAL no cartão vira
// assinatura recorrente; ANUAL é compra única parcelável em 12× e NÃO renova
// sozinha — a diferença precisa aparecer na tela, não só no banco.
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export const ANNUAL_INSTALLMENTS = 12;

/**
 * Chave de checkout enviada ao servidor. `user.plan` continua sendo só o degrau
 * de acesso: o ciclo é uma dimensão da COMPRA (ver basePlanOf no backend).
 */
export const checkoutKeyFor = (plan: UserPlan, cycle: BillingCycle) =>
    cycle === 'ANNUAL' ? `${plan}_ANNUAL` : plan;

/** '1.198,80' → 1198.8. Os preços moram como texto de exibição; só a conta
 *  precisa do número. */
const paraNumero = (valor: string) => Number(valor.replace(/\./g, '').replace(',', '.'));

/**
 * Valor REALMENTE cobrado no ciclo escolhido — o que vai no evento de funil.
 * No anual é o total do ano, não a parcela: o débito é único, e reportar 49,90
 * onde saíram 598,80 tornaria qualquer cálculo de retorno de campanha ficção.
 */
export const priceOf = (plan: UserPlan, cycle: BillingCycle): number => {
    const detalhes = PLAN_DETAILS[plan];
    if (cycle === 'ANNUAL') return detalhes.annualPrice ? paraNumero(detalhes.annualPrice) : 0;
    return paraNumero(detalhes.price);
};

/** Quanto o anual economiza sobre 12 mensalidades, em % inteiros. */
export const annualSavingsPercent = (plan: UserPlan): number | null => {
    const detalhes = PLAN_DETAILS[plan];
    if (!detalhes.annualPrice) return null;
    const anual = paraNumero(detalhes.annualPrice);
    const doze = paraNumero(detalhes.price) * 12;
    return Math.round((1 - anual / doze) * 100);
};

// Controle de Acesso a Features (Quais planos têm quais chaves)
export const PLAN_ACCESS: Record<UserPlan, string[]> = {
    // 'br10' (Carteira Brasil TOP 10) é a vitrine do Free — único ranking aberto.
    'GUEST': ['terminal', 'wallet', 'br10', 'academy'],
    // 'dividends' (Proventos) é o diferencial do primeiro degrau pago.
    'ESSENTIAL': ['terminal', 'wallet', 'br10', 'academy', 'delayed_signals', 'dividends'],
    'PRO': ['terminal', 'wallet', 'br10', 'academy', 'delayed_signals', 'dividends', 'smart_contribution', 'radar', 'stocks', 'fiis', 'crypto', 'reports'],
    // ELITE = Pro + poder de IA (rebalanceamento, ativos globais, masterclass) +
    // 'ir': o relatório de apoio ao IR desceu do Black quando o Black saiu da venda.
    'ELITE': ['terminal', 'wallet', 'br10', 'academy', 'delayed_signals', 'dividends', 'smart_contribution', 'radar', 'stocks', 'fiis', 'crypto', 'reports', 'rebalance', 'global', 'ir'],
    // BLACK = Elite. Não sobrou nenhuma chave exclusiva: as que existiam
    // ('private', 'whatsapp', 'calls') não tinham entrega, SLA nem equipe por trás,
    // e o relatório de IR virou entrega do Elite.
    'BLACK': ['terminal', 'wallet', 'br10', 'academy', 'delayed_signals', 'dividends', 'smart_contribution', 'radar', 'stocks', 'fiis', 'crypto', 'reports', 'rebalance', 'global', 'ir']
};

// Limites Numéricos (9999 = Ilimitado) — ESPELHO de LIMITS_CONFIG em
// server/config/subscription.js, que é quem realmente barra a criação.
export const FEATURE_LIMITS: Record<string, Record<UserPlan, number>> = {
    'wallets': {
        'GUEST': 1,
        'ESSENTIAL': 3,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    },
    'goals': {
        'GUEST': 3,
        'ESSENTIAL': 9999,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    },
    'smart_contribution': {
        'GUEST': 0,
        'ESSENTIAL': 0, // Apenas Pro+
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    },
    'report': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 9999,
        'ELITE': 9999,
        'BLACK': 9999
    }
};
