/**
 * Ramificação (sub-metas) das classes STOCK, FIXED_INCOME e STOCK_US — funções PURAS,
 * sem Mongo/Express. Espelha a mesma taxonomia do front (client/src/utils/allocation.ts):
 *
 *   Ações BR   (STOCK)        → STOCK (ações individuais) | ETF (fundos nacionais em R$)
 *   Renda Fixa (FIXED_INCOME) → IPCA | POS (Selic/CDI) | PRE (prefixado/legado)
 *   Exterior   (STOCK_US)     → STOCK | REIT | ETF (inclui ouro lastreado) | DOLLAR
 *
 * ETF NACIONAL (type 'ETF', BRL) deixou de ser classe de topo da Carteira Ideal:
 * conta DENTRO de Ações BR, no sub-tipo ETF (ver stockSubKeyOf e foldEtfIntoStock).
 * ETFs INTERNACIONAIS são holdings de type 'STOCK_US' com usSubType 'ETF'/'GOLD' e
 * contam no balde Exterior, no sub-tipo ETF (ver usSubKeyOf).
 *
 * Usado pelo Rebalanceamento IA para quebrar o gap de uma classe por sub-tipo.
 */
import { safeFloat, safeCurrency } from './mathUtils.js';

export const STOCK_SUB_KEYS = ['STOCK', 'ETF'];
export const FI_SUB_KEYS = ['IPCA', 'POS', 'PRE'];
export const US_SUB_KEYS = ['STOCK', 'REIT', 'ETF', 'DOLLAR'];

export const SUB_LABELS = {
    STOCK: { STOCK: 'Ações', ETF: 'ETFs' },
    FIXED_INCOME: { IPCA: 'IPCA', POS: 'Pós-fixado', PRE: 'Prefixado' },
    STOCK_US: { STOCK: 'Stocks', REIT: 'REITs', ETF: 'ETFs', DOLLAR: 'Dólar' },
};

/**
 * Sub-tipo de um holding de Renda Fixa. Índice explícito manda (IPCA / Selic-CDI /
 * PRE). Sem índice (legado / CDB %CDI manual) espelha a convenção do accrual
 * (fixedIncomeDailyFactor): `fixedIncomeRate > 50` = % do CDI → pós-fixado; `≤ 50` =
 * prefixado a.a. Assim o rótulo bate com o rendimento (um "100% do CDI" é POS, não
 * PRE). Rate ausente cai em 100 (%CDI), igual ao accrual.
 */
export const fixedIncomeSubKey = (index, rate) => {
    switch (index) {
        case 'IPCA': return 'IPCA';
        case 'SELIC':
        case 'CDI': return 'POS';
        case 'PRE': return 'PRE';
        default: {
            const rawRate = (Number(rate) || 0) > 0 ? Number(rate) : 100;
            return rawRate > 50 ? 'POS' : 'PRE';
        }
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

/**
 * Sub-tipo de um holding de Ações BR: type 'ETF' (fundo nacional) → ETF; qualquer
 * outra coisa (ação individual) → STOCK.
 */
export const stockSubKeyOf = (type) => (type === 'ETF' ? 'ETF' : 'STOCK');

/** true se a classe tem ao menos uma sub-meta > 0 (ramificação ativa). */
export const hasSubMetas = (subMap) =>
    !!subMap && Object.values(subMap).some((v) => safeFloat(v) > 0);

// Especificação de cada classe ramificável: chaves do sub-tipo, matcher do holding e
// derivação do sub-tipo. STOCK aceita ações (type STOCK) + ETFs nacionais (type ETF),
// usando o TIPO CRU (`rawType`) — no rebalance o `type` do holding já vem foldado p/ STOCK.
const rawTypeOf = (h) => h?.rawType ?? h?.type;
const CLASS_SPEC = {
    STOCK: {
        keys: STOCK_SUB_KEYS,
        match: (h) => rawTypeOf(h) === 'STOCK' || rawTypeOf(h) === 'ETF',
        keyOf: (h) => stockSubKeyOf(rawTypeOf(h)),
    },
    FIXED_INCOME: {
        keys: FI_SUB_KEYS,
        match: (h) => h.type === 'FIXED_INCOME',
        keyOf: (h) => fixedIncomeSubKey(h.fixedIncomeIndex, h.fixedIncomeRate),
    },
    STOCK_US: {
        keys: US_SUB_KEYS,
        match: (h) => h.type === 'STOCK_US',
        keyOf: (h) => usSubKeyOf(h.usSubType),
    },
};

/** Valor (R$) por sub-tipo dos holdings de uma classe ramificável (STOCK | FIXED_INCOME | STOCK_US). */
export const currentValueBySub = (holdings, classType) => {
    const spec = CLASS_SPEC[classType] || CLASS_SPEC.STOCK_US;
    const out = Object.fromEntries(spec.keys.map((k) => [k, 0]));
    for (const h of holdings || []) {
        if (!spec.match(h)) continue;
        const key = spec.keyOf(h);
        out[key] = safeCurrency((out[key] || 0) + safeFloat(h.valueBr));
    }
    return out;
};

/**
 * Normaliza metas legadas: a classe ETF (nacional) foi absorvida por Ações BR (STOCK).
 * Se ainda houver um alvo de topo `ETF > 0` e Ações BR NÃO tiver sub-metas, foldamos o
 * alvo de ETF para dentro de STOCK (soma os percentuais) e o convertemos em sub-meta ETF
 * de Ações BR. Idempotente: com sub-metas de STOCK já definidas, não mexe (o front já
 * persistiu no formato novo). Devolve novos objetos — não muta a entrada.
 */
export const foldEtfIntoStock = (targetAllocation = {}, targetSubAllocation = {}) => {
    const ta = { ...(targetAllocation || {}) };
    const tsa = { ...(targetSubAllocation || {}) };
    const etf = safeFloat(ta.ETF);
    const stock = safeFloat(ta.STOCK);
    if (etf > 0 && !hasSubMetas(tsa.STOCK)) {
        const combined = safeCurrency(stock + etf);
        ta.STOCK = combined;
        ta.ETF = 0;
        tsa.STOCK = combined > 0
            ? { STOCK: safeCurrency((stock / combined) * 100), ETF: safeCurrency((etf / combined) * 100) }
            : { STOCK: 0, ETF: 0 };
    }
    return { targetAllocation: ta, targetSubAllocation: tsa };
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
    STOCK_SUB_KEYS,
    FI_SUB_KEYS,
    US_SUB_KEYS,
    SUB_LABELS,
    fixedIncomeSubKey,
    usSubKeyOf,
    stockSubKeyOf,
    hasSubMetas,
    currentValueBySub,
    splitNeedBySubMeta,
    subGaps,
    foldEtfIntoStock,
};
