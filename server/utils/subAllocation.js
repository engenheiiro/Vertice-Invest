/**
 * Ramificação (sub-metas) das classes FIXED_INCOME, STOCK_US e ETF — funções PURAS,
 * sem Mongo/Express. Espelha a mesma taxonomia do front (client/src/utils/allocation.ts):
 *
 *   Renda Fixa (FIXED_INCOME) → IPCA | POS (Selic/CDI) | PRE (prefixado/legado)
 *   Exterior   (STOCK_US)     → STOCK | REIT | DOLLAR
 *   ETFs       (ETF)          → BR (nacionais) | US (internacionais, inclui ouro lastreado)
 *
 * ETFs são CLASSE própria: nacionais têm type 'ETF'; internacionais são holdings de
 * type 'STOCK_US' com usSubType 'ETF'/'GOLD' — estes saem do balde Exterior e contam
 * na classe ETF (ver resolveAllocClass).
 *
 * Usado pelo Rebalanceamento IA para quebrar o gap de uma classe por sub-tipo.
 */
import { safeFloat, safeCurrency } from './mathUtils.js';

export const FI_SUB_KEYS = ['IPCA', 'POS', 'PRE'];
export const US_SUB_KEYS = ['STOCK', 'REIT', 'DOLLAR'];
export const ETF_SUB_KEYS = ['BR', 'US'];

export const SUB_LABELS = {
    FIXED_INCOME: { IPCA: 'IPCA', POS: 'Pós-fixado', PRE: 'Prefixado' },
    STOCK_US: { STOCK: 'Stocks', REIT: 'REITs', DOLLAR: 'Dólar' },
    ETF: { BR: 'Nacional', US: 'Internacional' },
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

/** Sub-tipo de um holding de Exterior; null/ausente cai no balde padrão STOCK. */
export const usSubKeyOf = (usSubType) =>
    US_SUB_KEYS.includes(usSubType) ? usSubType : 'STOCK';

/**
 * Sub-tipo ETF (BR/US) de um holding, ou null se não é ETF. ETF nacional = type 'ETF';
 * ETF internacional = type 'STOCK_US' com usSubType ETF/GOLD (ouro entra como ETF lastreado).
 */
export const etfSubKeyOf = (asset) => {
    if (!asset) return null;
    if (asset.type === 'ETF') return 'BR';
    if (asset.type === 'STOCK_US' && (asset.usSubType === 'ETF' || asset.usSubType === 'GOLD')) return 'US';
    return null;
};

/**
 * Classe de alocação efetiva do holding na Carteira Ideal. ETFs internacionais
 * (STOCK_US + usSubType ETF/GOLD) são reclassificados de Exterior para a classe ETF.
 */
export const resolveAllocClass = (asset) => (etfSubKeyOf(asset) ? 'ETF' : asset?.type);

/** true se a classe tem ao menos uma sub-meta > 0 (ramificação ativa). */
export const hasSubMetas = (subMap) =>
    !!subMap && Object.values(subMap).some((v) => safeFloat(v) > 0);

/** Valor (R$) por sub-tipo dos holdings de uma classe ramificável. */
export const currentValueBySub = (holdings, classType) => {
    const keys = classType === 'FIXED_INCOME' ? FI_SUB_KEYS : classType === 'ETF' ? ETF_SUB_KEYS : US_SUB_KEYS;
    const out = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const h of holdings || []) {
        if (resolveAllocClass(h) !== classType) continue;
        const key = classType === 'FIXED_INCOME' ? fixedIncomeSubKey(h.fixedIncomeIndex)
            : classType === 'ETF' ? etfSubKeyOf(h)
            : usSubKeyOf(h.usSubType);
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
    ETF_SUB_KEYS,
    SUB_LABELS,
    fixedIncomeSubKey,
    usSubKeyOf,
    etfSubKeyOf,
    resolveAllocClass,
    hasSubMetas,
    currentValueBySub,
    splitNeedBySubMeta,
    subGaps,
};
