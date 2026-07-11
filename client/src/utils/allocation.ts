import type { Asset, AssetType, FixedIncomeSubKey, UsSubKey } from '../contexts/WalletContext';

// ---------------------------------------------------------------------------
// C1 — Reserva separada (base de alocação consistente).
//
// Um ativo é RESERVA quando `isReserve === true`. Ativos de reserva saem da base
// de alocação (denominador dos percentuais) e são exibidos no balde
// "Caixa / Reserva", independentemente do `type` (CASH ou uma Renda Fixa que o
// usuário marcou como reserva). Renda Fixa NÃO-reserva volta a ser investimento:
// entra no donut e no grupo "Renda Fixa".
//
// Fallback p/ posições ainda não migradas (sem o campo): CASH é reserva por
// natureza, o resto é investimento — preserva o comportamento antigo até a
// migração `isReserve` rodar em produção.
// ---------------------------------------------------------------------------

/** true se o ativo deve ser tratado como Reserva (fora da base de alocação). */
export const isReserveAsset = (a: Pick<Asset, 'isReserve' | 'type'>): boolean =>
    a.isReserve ?? (a.type === 'CASH');

/**
 * Balde de exibição/alocação de um ativo: reserva (qualquer tipo) → 'CASH';
 * senão, a própria classe. Usado para agrupar a lista e o donut de forma
 * coerente com a base de alocação.
 */
export const allocationBucket = (a: Pick<Asset, 'isReserve' | 'type'>): AssetType =>
    isReserveAsset(a) ? 'CASH' : (a.type as AssetType);

/** Soma (R$) de todos os ativos de Reserva — o que sai da base de alocação. */
export const sumReserveValue = (assets: Asset[]): number =>
    (assets || []).reduce((acc, a) => acc + (isReserveAsset(a) ? (Number(a.totalValue) || 0) : 0), 0);

// ---------------------------------------------------------------------------
// Cálculo PURO da sub-alocação REAL (ramificação) da carteira.
//
// Agrupa os holdings dentro de cada classe ramificável e devolve a participação
// percentual de cada sub-tipo DENTRO da classe (0–100), além do total em R$ da
// classe (para a UI saber se há posição). Espelha as sub-metas (targetSubAllocation)
// para a comparação "real vs ideal".
//
//   Renda Fixa (FIXED_INCOME) → IPCA | POS (Selic/CDI) | PRE (prefixado/legado)
//   Exterior   (STOCK_US)     → STOCK | REIT | ETF (inclui ouro lastreado) | DOLLAR
//
// ETF é classe própria APENAS para os fundos NACIONAIS (type 'ETF'), tratada em bloco.
// ETFs INTERNACIONAIS (type STOCK_US + usSubType ETF/GOLD) contam no Exterior, sub-tipo ETF.
//
// Usa asset.totalValue (já em BRL, vindo do backend), igual ao AllocationChart.
// ---------------------------------------------------------------------------

export interface ClassSubReal<K extends string> {
    value: Record<K, number>; // R$ por sub-tipo
    total: number;            // R$ total da classe
    pct: Record<K, number>;   // % dentro da classe (0–100); 0 quando a classe está vazia
}

export interface SubAllocationReal {
    FIXED_INCOME: ClassSubReal<FixedIncomeSubKey>;
    STOCK_US: ClassSubReal<UsSubKey>;
}

const FI_KEYS: FixedIncomeSubKey[] = ['IPCA', 'POS', 'PRE'];
const US_KEYS: UsSubKey[] = ['STOCK', 'REIT', 'ETF', 'DOLLAR'];

/**
 * Sub-tipo de um holding de Renda Fixa. Índice explícito manda (IPCA / Selic-CDI /
 * PRE). Sem índice (legado / CDB %CDI manual) espelha EXATAMENTE a convenção do
 * accrual (fixedIncomeDailyFactor): `fixedIncomeRate > 50` = % do CDI → pós-fixado;
 * `≤ 50` = prefixado a.a. Assim o rótulo bate com o rendimento — um "100% do CDI"
 * não aparece mais como Prefixado. Rate ausente cai em 100 (%CDI), igual ao accrual.
 */
export const fixedIncomeSubKey = (asset: Pick<Asset, 'fixedIncomeIndex' | 'fixedIncomeRate'>): FixedIncomeSubKey => {
    switch (asset.fixedIncomeIndex) {
        case 'IPCA': return 'IPCA';
        case 'SELIC':
        case 'CDI': return 'POS';
        case 'PRE': return 'PRE';
        default: {
            const rawRate = (Number(asset.fixedIncomeRate) || 0) > 0 ? Number(asset.fixedIncomeRate) : 100;
            return rawRate > 50 ? 'POS' : 'PRE';
        }
    }
};

/**
 * Sub-tipo de um holding de Exterior; ouro lastreado (GOLD) conta como ETF do Exterior;
 * null/ausente cai no balde padrão STOCK.
 */
export const usSubKeyOf = (asset: Pick<Asset, 'usSubType'>): UsSubKey => {
    if (asset.usSubType === 'GOLD') return 'ETF';
    return (asset.usSubType && US_KEYS.includes(asset.usSubType as UsSubKey)) ? (asset.usSubType as UsSubKey) : 'STOCK';
};

const toPct = <K extends string>(value: Record<K, number>, keys: K[], total: number): Record<K, number> => {
    const out = {} as Record<K, number>;
    keys.forEach((k) => { out[k] = total > 0 ? (value[k] / total) * 100 : 0; });
    return out;
};

export function computeSubAllocationReal(assets: Asset[]): SubAllocationReal {
    const fiValue = { IPCA: 0, POS: 0, PRE: 0 } as Record<FixedIncomeSubKey, number>;
    const usValue = { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 } as Record<UsSubKey, number>;

    (assets || []).forEach((a) => {
        const v = Number(a.totalValue) || 0;
        if (v <= 0) return;
        // C1: RF/ativo marcado como Reserva não é investimento — fora da ramificação.
        if (isReserveAsset(a)) return;
        if (a.type === 'FIXED_INCOME') {
            fiValue[fixedIncomeSubKey(a)] += v;
        } else if (a.type === 'STOCK_US') {
            // Inclui ETFs internacionais e ouro lastreado (usSubKeyOf → 'ETF').
            usValue[usSubKeyOf(a)] += v;
        }
    });

    const fiTotal = FI_KEYS.reduce((s, k) => s + fiValue[k], 0);
    const usTotal = US_KEYS.reduce((s, k) => s + usValue[k], 0);

    return {
        FIXED_INCOME: { value: fiValue, total: fiTotal, pct: toPct(fiValue, FI_KEYS, fiTotal) },
        STOCK_US: { value: usValue, total: usTotal, pct: toPct(usValue, US_KEYS, usTotal) },
    };
}

/** true se a classe tem ao menos uma sub-meta > 0 (ramificação ativa). */
export const hasSubTargets = (sub: Record<string, number> | undefined): boolean =>
    !!sub && Object.values(sub).some((v) => (Number(v) || 0) > 0);

/** Rótulos das sub-metas, reusados por Aporte/Rebalance/AllocationChart. */
export const SUB_LABELS: {
    FIXED_INCOME: Record<FixedIncomeSubKey, string>;
    STOCK_US: Record<UsSubKey, string>;
} = {
    FIXED_INCOME: { IPCA: 'IPCA', POS: 'Pós-fixado', PRE: 'Prefixado' },
    STOCK_US: { STOCK: 'Stocks', REIT: 'REITs', ETF: 'ETFs', DOLLAR: 'Dólar' },
};

/**
 * Distribui um aporte de classe (`classAmount`) entre as sub-metas, um nível
 * abaixo da mesma lógica de "gap" do aporte por classe: prioriza os sub-tipos
 * mais defasados em relação à meta; se nenhum estiver defasado, rateia pelas
 * próprias sub-metas. Função PURA — devolve R$ por sub-tipo (apenas > 0).
 */
export function splitContributionBySubMeta<K extends string>(
    classAmount: number,
    currentBySub: Record<K, number>,
    subMetas: Record<K, number>,
    keys: K[],
): Record<K, number> {
    const out = {} as Record<K, number>;
    keys.forEach((k) => { out[k] = 0; });
    if (!(classAmount > 0)) return out;

    const currentTotal = keys.reduce((s, k) => s + (Number(currentBySub[k]) || 0), 0);
    const projected = currentTotal + classAmount;

    const gaps = {} as Record<K, number>;
    let positiveGapSum = 0;
    keys.forEach((k) => {
        const meta = Number(subMetas[k]) || 0;
        const ideal = projected * (meta / 100);
        const gap = ideal - (Number(currentBySub[k]) || 0);
        gaps[k] = gap > 0 ? gap : 0;
        positiveGapSum += gaps[k];
    });

    if (positiveGapSum > 0) {
        keys.forEach((k) => { out[k] = classAmount * (gaps[k] / positiveGapSum); });
        return out;
    }

    // Sem defasagem (já no alvo ou acima): rateia pelas próprias sub-metas.
    const metaSum = keys.reduce((s, k) => s + (Number(subMetas[k]) || 0), 0);
    if (metaSum > 0) {
        keys.forEach((k) => { out[k] = classAmount * ((Number(subMetas[k]) || 0) / metaSum); });
    }
    return out;
}
