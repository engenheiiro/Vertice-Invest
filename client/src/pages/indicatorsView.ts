/**
 * Regras puras do Painel de Indicadores: formatação dos cards, avisos de
 * confiabilidade e filtro/ordenação dos títulos do Tesouro. A tela só desenha.
 */

export type SortKey = 'title' | 'type' | 'rate' | 'unitPrice' | 'minInvestment' | 'maturityDate';
export type FilterType = 'ALL' | 'IPCA' | 'PREFIXADO' | 'SELIC' | 'OUTROS';
export interface SortConfig { key: SortKey; direction: 'asc' | 'desc' }

export interface TreasuryBond {
    _id: string;
    title: string;
    type: string;
    index: string;
    rate: number;
    unitPrice: number;
    minInvestment: number;
    maturityDate: string;
}

interface MacroPoint { value?: number; change?: number }

export interface MacroView {
    selic?: MacroPoint;
    cdi?: MacroPoint;
    ipca?: MacroPoint;
    ibov?: MacroPoint;
    usd?: MacroPoint;
    spx?: MacroPoint;
    btc?: MacroPoint;
    bonds?: TreasuryBond[];
    lastUpdated?: string;
    ratesSources?: { selic?: string; ipca?: string };
}

/** Filtros que viram botão no cabeçalho do Tesouro ('OUTROS' não tem botão). */
export const TREASURY_FILTERS: FilterType[] = ['ALL', 'IPCA', 'PREFIXADO', 'SELIC'];

const MAIN_FAMILIES = ['IPCA', 'PREFIXADO', 'SELIC'];
const ONE_HOUR_MS = 60 * 60 * 1000;

/** Mesma coluna ascendente inverte; qualquer outro clique começa ascendente. */
export const nextSort = (current: SortConfig, key: SortKey): SortConfig => ({
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
});

const matchesFilter = (bond: TreasuryBond, filter: FilterType) => {
    if (filter === 'ALL') return true;
    if (filter === 'OUTROS') return !MAIN_FAMILIES.includes(bond.type);
    return bond.type === filter;
};

export const filterAndSortBonds = (bonds: TreasuryBond[] | undefined, filter: FilterType, sort: SortConfig): TreasuryBond[] => {
    if (!bonds) return [];
    const sign = sort.direction === 'asc' ? 1 : -1;
    return bonds.filter((b) => matchesFilter(b, filter)).sort((a, b) => {
        const va = a[sort.key];
        const vb = b[sort.key];
        if (va < vb) return -sign;
        if (va > vb) return sign;
        return 0;
    });
};

/** Valor em reais; zero/ausente vira "-". */
export const fmtCurrency = (val: number) => (val ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-');

/** PU e mínimo do título: só valor positivo é preço; o resto é "—", nunca R$ 0. */
export const fmtBondPrice = (val: number) => (val > 0 ? fmtCurrency(val) : '—');

export const fmtBondRate = (bond: Pick<TreasuryBond, 'index' | 'rate'>) =>
    `${bond.index === 'PRE' ? '' : bond.index + ' + '}${bond.rate.toFixed(2)}%`;

export const fmtLastUpdated = (lastUpdated: string) => new Date(lastUpdated).toLocaleString('pt-BR');

/**
 * Guardas de confiabilidade. ratesSources informa a fonte de cada taxa
 * ('BCB' | 'Brapi' | 'IBGE' | 'fallback'); só marcamos como suspeita a métrica
 * que realmente caiu no fallback. CDI é derivado da SELIC. isPanelStale =
 * painel sem atualização há mais de 1h (cron de macro pode estar parado).
 */
export const deriveFreshness = (data: MacroView | null, nowMs: number) => {
    const ratesSources = data?.ratesSources || {};
    const selicStale = ratesSources.selic === 'fallback';
    const ipcaStale = ratesSources.ipca === 'fallback';
    const staleMetrics: string[] = [];
    if (selicStale) staleMetrics.push('SELIC', 'CDI');
    if (ipcaStale) staleMetrics.push('IPCA');
    const lastUpdatedMs = data?.lastUpdated ? new Date(data.lastUpdated).getTime() : null;
    const isPanelStale = lastUpdatedMs ? nowMs - lastUpdatedMs > ONE_HOUR_MS : false;
    return { selicStale, ipcaStale, staleMetrics, isPanelStale };
};

/** Texto do valor do card; ausente vira o placeholder de cada formato. */
export const fmtCardValue = (value: number | undefined, isCurrency: boolean, currencyPrefix: string) => {
    if (isCurrency) {
        return `${currencyPrefix} ${value?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) || '0,00'}`;
    }
    return value?.toLocaleString('pt-BR') || '0.00';
};

/** Direção da variação: só desenha seta quando há alta ou queda de fato. */
export const changeTrend = (change: number | undefined): { direction: 'up' | 'down'; color: string } | null => {
    if (change === undefined) return null;
    if (change > 0) return { direction: 'up', color: 'text-emerald-500' };
    if (change < 0) return { direction: 'down', color: 'text-red-500' };
    return null;
};

export const getBondTypeStyle = (type: string) => {
    switch (type) {
        case 'IPCA': return 'bg-purple-900/30 text-purple-400 border border-purple-900/50';
        case 'SELIC': return 'bg-blue-900/30 text-blue-400 border border-blue-900/50';
        case 'PREFIXADO': return 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50';
        case 'RENDAMAIS': return 'bg-amber-900/30 text-amber-400 border border-amber-900/50';
        case 'EDUCA': return 'bg-pink-900/30 text-pink-400 border border-pink-900/50';
        default: return 'bg-slate-800 text-slate-400';
    }
};
