import type { Asset, AssetType, FixedIncomeSubKey, UsSubKey, EtfSubKey } from '../contexts/WalletContext';

// ---------------------------------------------------------------------------
// Cálculo PURO da sub-alocação REAL (ramificação) da carteira.
//
// Agrupa os holdings dentro de cada classe ramificável e devolve a participação
// percentual de cada sub-tipo DENTRO da classe (0–100), além do total em R$ da
// classe (para a UI saber se há posição). Espelha as sub-metas (targetSubAllocation)
// para a comparação "real vs ideal".
//
//   Renda Fixa (FIXED_INCOME) → IPCA | POS (Selic/CDI) | PRE (prefixado/legado)
//   Exterior   (STOCK_US)     → STOCK | REIT | DOLLAR
//   ETFs       (ETF)          → BR (nacionais) | US (internacionais, inclui ouro lastreado)
//
// ETFs internacionais (type STOCK_US + usSubType ETF/GOLD) saem do Exterior e contam
// na classe ETF — ver resolveAllocClass.
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
    ETF: ClassSubReal<EtfSubKey>;
}

const FI_KEYS: FixedIncomeSubKey[] = ['IPCA', 'POS', 'PRE'];
const US_KEYS: UsSubKey[] = ['STOCK', 'REIT', 'DOLLAR'];
const ETF_KEYS: EtfSubKey[] = ['BR', 'US'];

/** Sub-tipo de um holding de Renda Fixa a partir do índice contratado. */
export const fixedIncomeSubKey = (asset: Pick<Asset, 'fixedIncomeIndex'>): FixedIncomeSubKey => {
    switch (asset.fixedIncomeIndex) {
        case 'IPCA': return 'IPCA';
        case 'SELIC':
        case 'CDI': return 'POS';
        case 'PRE': return 'PRE';
        // Sem índice (legado): tratado como prefixado/taxa cheia.
        default: return 'PRE';
    }
};

/** Sub-tipo de um holding de Exterior; null/ausente cai no balde padrão STOCK. */
export const usSubKeyOf = (asset: Pick<Asset, 'usSubType'>): UsSubKey =>
    (asset.usSubType && US_KEYS.includes(asset.usSubType as UsSubKey)) ? (asset.usSubType as UsSubKey) : 'STOCK';

/**
 * Sub-tipo ETF (BR/US) de um holding, ou null se não é ETF. Nacional = type 'ETF';
 * internacional = type 'STOCK_US' com usSubType ETF/GOLD (ouro entra como ETF lastreado).
 */
export const etfSubKeyOf = (asset: Pick<Asset, 'type' | 'usSubType'>): EtfSubKey | null => {
    if (asset.type === 'ETF') return 'BR';
    if (asset.type === 'STOCK_US' && (asset.usSubType === 'ETF' || asset.usSubType === 'GOLD')) return 'US';
    return null;
};

/**
 * Classe de alocação efetiva do holding na Carteira Ideal. ETFs internacionais
 * (STOCK_US + usSubType ETF/GOLD) são reclassificados de Exterior para a classe ETF.
 */
export const resolveAllocClass = (asset: Pick<Asset, 'type' | 'usSubType'>): AssetType =>
    etfSubKeyOf(asset) ? 'ETF' : asset.type;

const toPct = <K extends string>(value: Record<K, number>, keys: K[], total: number): Record<K, number> => {
    const out = {} as Record<K, number>;
    keys.forEach((k) => { out[k] = total > 0 ? (value[k] / total) * 100 : 0; });
    return out;
};

export function computeSubAllocationReal(assets: Asset[]): SubAllocationReal {
    const fiValue = { IPCA: 0, POS: 0, PRE: 0 } as Record<FixedIncomeSubKey, number>;
    const usValue = { STOCK: 0, REIT: 0, DOLLAR: 0 } as Record<UsSubKey, number>;
    const etfValue = { BR: 0, US: 0 } as Record<EtfSubKey, number>;

    (assets || []).forEach((a) => {
        const v = Number(a.totalValue) || 0;
        if (v <= 0) return;
        const etfSub = etfSubKeyOf(a);
        if (etfSub) {
            // ETF nacional (type ETF) ou internacional (STOCK_US + usSubType ETF/GOLD).
            etfValue[etfSub] += v;
        } else if (a.type === 'FIXED_INCOME') {
            fiValue[fixedIncomeSubKey(a)] += v;
        } else if (a.type === 'STOCK_US') {
            usValue[usSubKeyOf(a)] += v;
        }
    });

    const fiTotal = FI_KEYS.reduce((s, k) => s + fiValue[k], 0);
    const usTotal = US_KEYS.reduce((s, k) => s + usValue[k], 0);
    const etfTotal = ETF_KEYS.reduce((s, k) => s + etfValue[k], 0);

    return {
        FIXED_INCOME: { value: fiValue, total: fiTotal, pct: toPct(fiValue, FI_KEYS, fiTotal) },
        STOCK_US: { value: usValue, total: usTotal, pct: toPct(usValue, US_KEYS, usTotal) },
        ETF: { value: etfValue, total: etfTotal, pct: toPct(etfValue, ETF_KEYS, etfTotal) },
    };
}

/** true se a classe tem ao menos uma sub-meta > 0 (ramificação ativa). */
export const hasSubTargets = (sub: Record<string, number> | undefined): boolean =>
    !!sub && Object.values(sub).some((v) => (Number(v) || 0) > 0);

/** Rótulos das sub-metas, reusados por Aporte/Rebalance/AllocationChart. */
export const SUB_LABELS: {
    FIXED_INCOME: Record<FixedIncomeSubKey, string>;
    STOCK_US: Record<UsSubKey, string>;
    ETF: Record<EtfSubKey, string>;
} = {
    FIXED_INCOME: { IPCA: 'IPCA', POS: 'Pós-fixado', PRE: 'Prefixado' },
    STOCK_US: { STOCK: 'Stocks', REIT: 'REITs', DOLLAR: 'Dólar' },
    ETF: { BR: 'Nacional', US: 'Internacional' },
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
