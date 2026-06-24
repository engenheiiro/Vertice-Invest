/**
 * Ramificação (sub-metas) das classes FIXED_INCOME e STOCK_US — funções PURAS,
 * sem Mongo/Express. Espelha a mesma taxonomia do front (client/src/utils/allocation.ts):
 *
 *   Renda Fixa (FIXED_INCOME) → IPCA | POS (Selic/CDI) | PRE (prefixado/legado)
 *   Exterior   (STOCK_US)     → STOCK | REIT | ETF (inclui ouro lastreado) | DOLLAR
 *
 * ETF é classe própria APENAS para os fundos NACIONAIS (type 'ETF', BRL) — tratada em
 * bloco (sem sub-metas). ETFs INTERNACIONAIS são holdings de type 'STOCK_US' com
 * usSubType 'ETF'/'GOLD' e contam no balde Exterior, no sub-tipo ETF (ver usSubKeyOf).
 *
 * Usado pelo Rebalanceamento IA para quebrar o gap de uma classe por sub-tipo.
 */
import { safeFloat, safeCurrency } from './mathUtils.js';

export const FI_SUB_KEYS = ['IPCA', 'POS', 'PRE'];
export const US_SUB_KEYS = ['STOCK', 'REIT', 'ETF', 'DOLLAR'];

export const SUB_LABELS = {
    FIXED_INCOME: { IPCA: 'IPCA', POS: 'Pós-fixado', PRE: 'Prefixado' },
    STOCK_US: { STOCK: 'Stocks', REIT: 'REITs', ETF: 'ETFs', DOLLAR: 'Dólar' },
};

/** Sub-tipo de um holding de Renda Fixa a partir do índice contratado. */
export const fixedIncomeSubKey = (index) => {
    switch (index) {
        case 'IPCA': return 'IPCA';
        case 'SELIC':
        case 'CDI': return 'POS';
        case 'PRE': return 'PRE';
        default: return 'PRE'; // legado / sem índice → prefixado
    }
};

/**
 * Sub-tipo de um holding de Exterior; ouro lastreado (GOLD) conta como ETF do Exterior;
 * null/ausente cai no balde padrão STOCK.
 */
export const usSubKeyOf = (usSubType) => {
    if (usSubType === 'GOLD') return 'ETF';
    return US_SUB_KEYS.includes(usSubType) ? usSubType : 'STOCK';
};

/** true se a classe tem ao menos uma sub-meta > 0 (ramificação ativa). */
export const hasSubMetas = (subMap) =>
    !!subMap && Object.values(subMap).some((v) => safeFloat(v) > 0);

/** Valor (R$) por sub-tipo dos holdings de uma classe ramificável (FIXED_INCOME | STOCK_US). */
export const currentValueBySub = (holdings, classType) => {
    const keys = classType === 'FIXED_INCOME' ? FI_SUB_KEYS : US_SUB_KEYS;
    const out = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const h of holdings || []) {
        if (h.type !== classType) continue;
        const key = classType === 'FIXED_INCOME' ? fixedIncomeSubKey(h.fixedIncomeIndex) : usSubKeyOf(h.usSubType);
        out[key] = safeCurrency((out[key] || 0) + safeFloat(h.valueBr));
    }
    return out;
};

/**
 * Rateia o aporte de uma classe (`need`, R$) entre os sub-tipos proporcionalmente
 * às sub-metas. Devolve apenas os sub-tipos com meta > 0 e valor > 0.
 * Conserva o total: Σ amount ≈ need (sub-metas somam ~100% dentro da classe).
 */
export const splitNeedBySubMeta = (need, subMetas, keys) => {
    const metaSum = keys.reduce((s, k) => s + safeFloat(subMetas?.[k]), 0);
    if (!(need > 0) || metaSum <= 0) return [];
    return keys
        .map((sub) => ({ sub, amount: safeCurrency(need * (safeFloat(subMetas[sub]) / metaSum)) }))
        .filter((x) => x.amount > 0);
};

/**
 * Gap (R$, apenas positivo) de cada sub-tipo dado o valor-alvo da classe.
 * Usado para enviesar candidatos de compra de STOCK_US pelo sub-tipo mais defasado.
 */
export const subGaps = (classIdealValue, currentBySub, subMetas, keys) => {
    const out = {};
    for (const k of keys) {
        const ideal = safeCurrency(classIdealValue * (safeFloat(subMetas?.[k]) / 100));
        const gap = ideal - safeFloat(currentBySub?.[k]);
        out[k] = gap > 0 ? safeCurrency(gap) : 0;
    }
    return out;
};

export default {
    FI_SUB_KEYS,
    US_SUB_KEYS,
    SUB_LABELS,
    fixedIncomeSubKey,
    usSubKeyOf,
    hasSubMetas,
    currentValueBySub,
    splitNeedBySubMeta,
    subGaps,
};
