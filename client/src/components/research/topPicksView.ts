import type { RankingItem } from '../../services/research';

/**
 * Regras puras do TopPicksCard (Top 10 da Pesquisa): filtro por perfil e origem,
 * ordenação soberana, resumo, meta da carteira ideal e rebalanceamento por
 * linha, setores para as rosquinhas. Sem JSX — o componente só desenha.
 */

export type RiskFilter = 'DEFENSIVE' | 'MODERATE' | 'BOLD';

// Sub-filtro da aba "ETFs": separa o universo nacional (B3) do internacional (US).
// Sem "Todos" — a aba sempre mostra um mercado por vez (default Internacional).
export type EtfOriginFilter = 'BR' | 'US';

export type RankedPick = RankingItem & { visualPosition: number };

export const RISK_LABELS: Record<RiskFilter, string> = {
    'DEFENSIVE': 'Defensiva',
    'MODERATE': 'Moderado',
    'BOLD': 'Arrojado'
};

export const ETF_ORIGIN_LABELS: Record<EtfOriginFilter, string> = {
    'BR': 'Nacional',
    'US': 'Internacional',
};

// Chips Ações/REITs do Exterior (rankings independentes selecionados via callback).
export const EXTERIOR_VIEWS: Array<{ key: 'STOCK' | 'REIT'; label: string }> = [
    { key: 'STOCK', label: 'Ações' },
    { key: 'REIT', label: 'REITs' },
];

export const COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#D4AF37',
    '#EF4444', '#84CC16', '#14B8A6', '#F97316', '#A855F7', '#0EA5E9'
];

// Composite estrutural (Regra #2): desempate quando dois ativos têm o mesmo score.
const structuralComposite = (item: RankingItem): number => {
    const s = item.metrics?.structural;
    return s ? (s.quality + s.valuation + s.risk) / 3 : 0;
};

/**
 * Ordenação soberana da lista (Regra #2): score desc, desempate pelo composite
 * estrutural. Devolve CÓPIA — nunca reordena o array recebido (que é o do cache
 * do React Query). Antes era `.sort((a,b) => b.score - a.score)` in-place e sem
 * desempate: empates ficavam na ordem que o cache tivesse no momento.
 */
export const sortPicksByScore = <T extends RankingItem>(items: T[]): T[] => (
    [...items].sort((a, b) => (b.score - a.score) || (structuralComposite(b) - structuralComposite(a)))
);

export type PositionDelta =
    | { kind: 'new' }
    | { kind: 'up' | 'down'; steps: number }
    | { kind: 'same' }
    | null;

/**
 * Delta de posição (Regra #4) comparando a posição GLOBAL de hoje com a do último
 * ranking publicado. Não usa `visualPosition` (que é a posição dentro do filtro
 * de perfil) — as duas réguas não são comparáveis. `undefined` = documento antigo
 * sem o campo: não desenha nada, em vez de chamar todo mundo de "novo".
 */
export const getPositionDelta = (position: number | undefined, previousPosition: number | null | undefined): PositionDelta => {
    if (previousPosition === undefined || !Number.isFinite(position)) return null;
    if (previousPosition === null) return { kind: 'new' };
    const diff = previousPosition - (position as number);
    if (diff > 0) return { kind: 'up', steps: diff };
    if (diff < 0) return { kind: 'down', steps: -diff };
    return { kind: 'same' };
};

/** Nacional = type 'ETF' (B3); internacional = o resto (STOCK_US/usSubType ETF). */
const inEtfOrigin = (p: RankingItem, origin: EtfOriginFilter) => (p.type === 'ETF') === (origin === 'BR');

/**
 * Top 10 visível: perfil → origem do ETF → ordenação soberana, com a posição
 * DENTRO do filtro (`visualPosition`). Cópia antes de ordenar: `picks` é o
 * array do cache do React Query, e o `.sort()` in-place reordenava o cache por
 * baixo de todos os outros leitores.
 */
export const filterPicks = (picks: RankingItem[], riskFilter: RiskFilter, isEtf: boolean, etfOrigin: EtfOriginFilter): RankedPick[] => {
    let filtered = picks.filter(p => p.riskProfile === riskFilter);
    if (isEtf) filtered = filtered.filter(p => inEtfOrigin(p, etfOrigin));
    return sortPicksByScore(filtered)
        .slice(0, 10)
        .map((item, idx) => ({ ...item, visualPosition: idx + 1 }));
};

/**
 * O botão Aporte reflete o universo visível: na aba ETFs, se a origem atual
 * (Nacional/Internacional) não tem nenhum COMPRAR, o botão não aparece — evita
 * abrir o modal já vazio. Independe do perfil de risco (o modal cobre os três).
 */
export const hasBuyInScope = (picks: RankingItem[], isEtf: boolean, etfOrigin: EtfOriginFilter): boolean =>
    (isEtf ? picks.filter(p => inEtfOrigin(p, etfOrigin)) : picks).some(p => p.action === 'BUY');

export const pickStats = (picks: RankingItem[]) => {
    if (!picks.length) return { avgScore: 0, avgDy: 0 as number | string, count: 0 };
    const totalScore = picks.reduce((acc, curr) => acc + curr.score, 0);
    const totalDy = picks.reduce((acc, curr) => acc + (curr.metrics.dy || 0), 0);
    return {
        avgScore: Math.round(totalScore / picks.length),
        avgDy: (totalDy / picks.length).toFixed(2) as number | string,
        count: picks.length
    };
};

/** Market cap médio em US$ bilhões (aba Cripto); "-" sem ativos. */
export const cryptoAvgCapText = (picks: RankingItem[]): string => (picks.length > 0
    ? `$${(picks.reduce((acc, curr) => acc + (curr.metrics.marketCap || 0), 0) / picks.length / 1e9).toFixed(1)}B`
    : '-');

export const scoreTextColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400';
    if (score >= 75) return 'text-green-400';
    if (score >= 60) return 'text-blue-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-red-500';
};

export const yieldColor = (dy: number) => {
    if (!dy || dy <= 0) return 'text-slate-500';
    if (dy > 6) return 'text-emerald-400';
    return 'text-yellow-400';
};

export const rankStyle = (pos: number) => {
    if (pos === 1) return 'bg-gold/20 text-gold border-gold/50 shadow-[0_0_10px_rgba(212,175,55,0.2)]';
    if (pos === 2) return 'bg-slate-300/20 text-slate-300 border-slate-400/50';
    if (pos === 3) return 'bg-amber-700/20 text-amber-600 border-amber-700/50';
    return 'bg-slate-900 text-slate-600 border-slate-800';
};

interface HeldAsset { ticker: string; quantity: number; totalValue: number }

export interface PickPosition {
    isBuyPick: boolean;
    held: HeldAsset | null;
    userAllocPercent: number;
    idealPercent: number;
    idealValue: number;
    rebalanceDelta: number;
}

/**
 * Posição do usuário frente à carteira IDEAL, que só tem COMPRAR: a meta de um
 * COMPRAR é 1/nº de COMPRAR; AGUARDAR tem meta 0% e nenhuma sugestão de
 * rebalanceamento (o modelo não recomenda entrada agora).
 */
export const pickPosition = (pick: RankingItem, assets: HeldAsset[], totalEquity: number, buyCount: number): PickPosition => {
    const isBuyPick = pick.action === 'BUY';
    const userAsset = assets.find(a => a.ticker === pick.ticker);
    const held = userAsset && userAsset.quantity > 0 ? userAsset : null;
    const userAllocPercent = held && totalEquity > 0 ? (held.totalValue / totalEquity) * 100 : 0;
    const idealPercent = isBuyPick && buyCount > 0 ? (100 / buyCount) : 0;
    const idealValue = totalEquity * (idealPercent / 100);
    const currentValue = held ? held.totalValue : 0;
    return { isBuyPick, held, userAllocPercent, idealPercent, idealValue, rebalanceDelta: currentValue - idealValue };
};

export interface SectorSlice { name: string; percent: number }

/** Classes da carteira que a rosquinha "Minha Alocação" considera em cada aba. */
const walletTypesFor = (assetClass: string): string[] => {
    if (assetClass === 'BRASIL_10') return ['STOCK', 'FII'];
    if (assetClass === 'STOCK_US') return ['STOCK_US'];
    return [assetClass];
};

/** Setores da carteira por VALOR, maior primeiro; `null` sem ativo da classe. */
export const walletSectorSlices = (
    assets: Array<{ type: string; sector?: string; totalValue?: number }>, assetClass: string,
): SectorSlice[] | null => {
    const allowedTypes = walletTypesFor(assetClass);
    const filteredAssets = assets.filter(a => allowedTypes.includes(a.type));
    if (filteredAssets.length === 0) return null;
    const counts: Record<string, number> = {};
    let totalValue = 0;
    filteredAssets.forEach(a => {
        const sector = a.sector || 'Outros';
        const val = a.totalValue || 0;
        counts[sector] = (counts[sector] || 0) + val;
        totalValue += val;
    });
    return Object.entries(counts)
        .map(([name, value]) => ({ name, value, percent: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
        .sort((a, b) => b.value - a.value);
};

/** Setores da carteira ideal por CONTAGEM de ativos, maior primeiro. */
export const pickSectorSlices = (picks: RankingItem[]): SectorSlice[] => {
    const counts: Record<string, number> = {};
    picks.forEach(p => {
        const s = p.sector || 'Outros';
        counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
        .map(([name, count]) => ({ name, count, percent: (count / picks.length) * 100 }))
        .sort((a, b) => b.count - a.count);
};

/** Traço e deslocamento de cada fatia da rosquinha SVG (circunferência 100). */
export const donutDash = (slices: SectorSlice[], i: number) => {
    let cumulativePercent = 0;
    for (let j = 0; j < i; j++) cumulativePercent += slices[j].percent;
    return { dash: `${slices[i].percent} ${100 - slices[i].percent}`, offset: 100 - cumulativePercent + 25 };
};
