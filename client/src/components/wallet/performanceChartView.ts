/**
 * Regras puras do gráfico de Performance Comparativa da Carteira: ordenação,
 * reconciliação com os KPIs, recorte de período, séries em R$, ticks, selo
 * "Superando o Mercado", cores por tema e formatadores dos eixos/tooltip.
 */
import type { WalletKPIs } from '../../contexts/WalletContext';
import { formatCurrency as fmtCurrency, PRIVACY_MASK_SHORT } from '../../utils/format';

export interface PerformancePoint {
    date: string;
    wallet: number;
    walletRoi: number;
    equity?: number;
    invested?: number;
    cdi: number;
    ibov: number;
    ipca?: number;
    // Valores cashflow-aware (R$) calculados no backend.
    cdiValue?: number;
    ipcaValue?: number;
    ibovValue?: number;
}

export type TimeRange = '1M' | '12M' | 'YTD' | 'ALL';
export type ViewMode = 'pct' | 'brl';

/** Ponto na visão em R$: as séries ganham as chaves `*BRL`. */
export type DisplayPoint = PerformancePoint & { walletBRL?: number; cdiBRL?: number; ipcaBRL?: number; ibovBRL?: number };

// Datas da API são chaves de calendário (YYYY-MM-DD), não instantes UTC.
// new Date('2026-08-01') representa 31/07 à noite no fuso de São Paulo e faz
// o ponto do primeiro dia do mês desaparecer do filtro "Mês".
const parsePerformanceDate = (date: string): Date => {
    const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (calendarDate) {
        const [, year, month, day] = calendarDate;
        return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(date);
};

/** Ordena o histórico da API por data de calendário (no próprio array); resposta sem lista vira []. */
export const sortPerformanceHistory = (res: { history?: unknown } | null | undefined): PerformancePoint[] => {
    const history = res?.history;
    if (!Array.isArray(history)) return [];
    return (history as PerformancePoint[])
        .sort((a, b) => parsePerformanceDate(a.date).getTime() - parsePerformanceDate(b.date).getTime());
};

// O último ponto representa "agora". O ponto live do backend pode divergir
// do patrimônio/TWRR autoritativos (calculado por outro caminho). Ancoramos
// o fim da série nos KPIs da carteira para o gráfico SEMPRE bater com os
// cards de Patrimônio Líquido e Rentabilidade Real.
export const reconcileWithKpis = (
    data: PerformancePoint[], kpis: WalletKPIs | null | undefined, isDemoMode: boolean,
): PerformancePoint[] => {
    if (isDemoMode || data.length === 0 || !kpis || kpis.totalEquity <= 0) return data;
    const out = data.slice();
    const i = out.length - 1;
    out[i] = {
        ...out[i],
        equity: kpis.totalEquity,
        wallet: kpis.weightedRentability,
        walletRoi: typeof kpis.totalResultPercent === 'number' ? kpis.totalResultPercent : out[i].walletRoi,
    };
    return out;
};

const rangeCutoff = (timeRange: TimeRange): Date => {
    const now = new Date();
    const cutoffDate = new Date();
    if (timeRange === '1M') {
        cutoffDate.setDate(1);
        cutoffDate.setHours(0, 0, 0, 0);
    } else if (timeRange === '12M') {
        cutoffDate.setFullYear(now.getFullYear() - 1);
    } else if (timeRange === 'YTD') {
        cutoffDate.setMonth(0, 1);
        cutoffDate.setHours(0, 0, 0, 0);
    }
    return cutoffDate;
};

export const filterByRange = (base: PerformancePoint[], timeRange: TimeRange): PerformancePoint[] => {
    if (!base || base.length === 0) return [];
    if (timeRange === 'ALL') return base;

    const cutoffDate = rangeCutoff(timeRange);
    const firstPointInRange = base.findIndex(point => parsePerformanceDate(point.date) >= cutoffDate);

    // Mantém o último ponto anterior como base da curva. No primeiro dia do
    // mês a série frequentemente tem apenas o ponto live; sem a base, o
    // Recharts não tem um segmento para desenhar e o gráfico fica em branco.
    if (firstPointInRange > 0) return base.slice(firstPointInRange - 1);
    if (firstPointInRange === -1) return base.slice(-2);
    return base;
};

// "Minha Carteira" usa o patrimônio REAL (p.equity) — bate com o KPI no
// último ponto. Benchmarks usam os valores cashflow-aware do backend
// (cdiValue/ipcaValue/ibovValue): mesmo capital + aportes, crescido pelo índice.
export const toDisplayData = (filteredData: PerformancePoint[], viewMode: ViewMode): DisplayPoint[] => {
    if (viewMode === 'pct') return filteredData;
    return filteredData.map(p => ({
        ...p,
        walletBRL: p.equity ?? 0,
        cdiBRL:    p.cdiValue ?? 0,
        ipcaBRL:   p.ipcaValue ?? 0,
        ibovBRL:   p.ibovValue ?? 0,
    }));
};

const monthlyTicks = (filteredData: PerformancePoint[]): string[] => {
    const ticks: string[] = [];
    const seenMonths = new Set();
    filteredData.forEach(point => {
        const d = parsePerformanceDate(point.date);
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
        if (!seenMonths.has(key)) {
            ticks.push(point.date);
            seenMonths.add(key);
        }
    });
    return ticks;
};

export const buildXAxisTicks = (filteredData: PerformancePoint[], timeRange: TimeRange): string[] => {
    if (filteredData.length === 0) return [];
    if (timeRange !== '1M') return monthlyTicks(filteredData);
    const ticks: string[] = [];
    filteredData.forEach((point, index) => {
        if (index % 2 === 0 || index === filteredData.length - 1) {
            ticks.push(point.date);
        }
    });
    return ticks;
};

export const tickIntervalFor = (timeRange: TimeRange): 0 | 'preserveStartEnd' =>
    (timeRange === '1M' || timeRange === '12M' || timeRange === 'YTD') ? 0 : 'preserveStartEnd';

const beatsInPct = (lastPoint: PerformancePoint | undefined, showIbov: boolean) => {
    const currentWalletValue = lastPoint?.wallet ?? 0;
    return lastPoint && currentWalletValue > lastPoint.cdi && (!showIbov || currentWalletValue > (lastPoint.ibov || 0));
};

// Na visão em R$ as chaves *BRL sempre existem (`?? 0` em toDisplayData); o
// `?? NaN` só satisfaz o tipo e, como undefined, nunca vence a comparação.
const beatsInBrl = (lastDisplay: DisplayPoint | undefined, showIbov: boolean) =>
    lastDisplay && (lastDisplay.walletBRL ?? NaN) > (lastDisplay.cdiBRL ?? NaN)
        && (!showIbov || (lastDisplay.walletBRL ?? NaN) > (lastDisplay.ibovBRL ?? NaN));

/** Selo "Superando o Mercado": a carteira passa o CDI (e o Ibovespa, quando visível) no último ponto. */
export const isWalletWinning = (
    filteredData: PerformancePoint[], displayData: DisplayPoint[], viewMode: ViewMode, showIbov: boolean,
): boolean => Boolean(viewMode === 'pct'
    ? beatsInPct(filteredData[filteredData.length - 1], showIbov)
    : beatsInBrl(displayData[displayData.length - 1], showIbov));

/** Chaves e nomes das séries no Recharts para cada visão. */
export const seriesKeys = (viewMode: ViewMode) => (viewMode === 'brl'
    ? { ipca: 'ipcaBRL', ibov: 'ibovBRL', cdi: 'cdiBRL', wallet: 'walletBRL', walletName: 'walletBRL' }
    : { ipca: 'ipca', ibov: 'ibov', cdi: 'cdi', wallet: 'wallet', walletName: 'walletVal' });

// Tooltip: no escuro usa a superfície ELEVATED do tema novo (#202631) + borda
// slate-700 — mesma "casa" do tooltip do EvolutionChart (bg-elevated).
// Ibovespa é neutro (cinza) em ambos os temas, mas o tom precisa inverter:
// slate-600 no claro / slate-300 no escuro garante contraste nos dois.
// Grade/cursor/rótulos seguem a convenção do EvolutionChart; o cursor no escuro
// é slate-700 (#334155) e os rótulos, o cinza-frio do mockup (#6A7480).
const LIGHT_PALETTE = {
    tooltip: { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '12px', zIndex: 100, color: '#0f172a' },
    ibovStroke: '#475569', gridStroke: '#eef1f5', cursorStroke: '#cbd5e1', axisTick: '#64748b',
};
const DARK_PALETTE = {
    tooltip: { backgroundColor: '#202631', borderColor: '#334155', borderRadius: '8px', fontSize: '12px', zIndex: 100 },
    ibovStroke: '#cbd5e1', gridStroke: '#232B36', cursorStroke: '#334155', axisTick: '#6A7480',
};
export type ChartPalette = typeof LIGHT_PALETTE | typeof DARK_PALETTE;
export const chartPalette = (theme: string): ChartPalette => (theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE);

const LABEL_MAP: Record<string, string> = {
    walletVal: 'Minha Carteira',
    cdi:       'CDI',
    ipca:      'Meta real · IPCA + 6% a.a.',
    ibov:      'Ibovespa',
    walletBRL: 'Minha Carteira',
    cdiBRL:    'CDI',
    ipcaBRL:   'Meta real · IPCA + 6% a.a.',
    ibovBRL:   'Ibovespa',
};

export const formatXTick = (val: string, timeRange: TimeRange): string => {
    try {
        const d = parsePerformanceDate(val);
        if (isNaN(d.getTime())) return val;
        if (timeRange === '1M') {
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
        }
        const m = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        const y = d.toLocaleDateString('pt-BR', { year: '2-digit' });
        return `${m}/${y}`;
    } catch { return val; }
};

export const formatYTick = (val: number, viewMode: ViewMode, isPrivacyMode: boolean): string => {
    if (viewMode !== 'brl') return `${val.toFixed(0)}%`;
    return isPrivacyMode ? PRIVACY_MASK_SHORT : `R$${(val / 1000).toFixed(0)}k`;
};

export const formatTooltipValue = (value: number, name: string, viewMode: ViewMode, isPrivacyMode: boolean): [string, string] => {
    const label = LABEL_MAP[name] ?? name;
    if (viewMode === 'brl') {
        return [fmtCurrency(value, 'BRL', { privacy: isPrivacyMode }), label];
    }
    return [`${value.toFixed(2)}%`, label];
};

export const formatTooltipLabel = (label: string): string => parsePerformanceDate(label).toLocaleDateString('pt-BR');
