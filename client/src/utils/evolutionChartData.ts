import type { HistoryPoint, WalletKPIs } from '../contexts/WalletContext';

// Transformação PURA e testável dos snapshots patrimoniais em pontos de gráfico.
// Antes essa lógica vivia enterrada num useMemo em EvolutionChart.tsx (sem testes).
// Convenção de data: LOCAL (browser), idêntica à original (getDate/getMonth), para
// não regredir o bucketing de quem está no fuso do Brasil.

export type ChartGranularity = 'DAILY' | 'MONTHLY';
export type ChartWindow = '7D' | '30D' | '90D' | '6M' | '12M' | 'ALL';

export interface EvolutionChartPoint {
    label: string;        // 'dd/mm' (diário) | 'mm/aa' (mensal)
    fullDate: string;     // 'dd/mm/aaaa' — usado no tooltip
    sortDate: Date;
    baseBar: number;      // min(equity, invested)  → segmento "Valor Aplicado"
    profitBar: number;    // max(0, equity - invested) → segmento "Resultado"
    lossBar: number;      // max(0, invested - equity) → capa vermelha (queda até o custo)
    realInvested: number;
    realEquity: number;
    realProfit: number;
    periodVariation: number;         // variação de mercado do período em R$ (desconta aportes)
    periodVariationPercent: number | null; // % sobre o patrimônio do ponto anterior
    // Rótulo do ponto CONTRA o qual a variação foi medida ('30/06', 'jun/2026').
    // null quando não há ponto anterior — aí a "variação" é o resultado acumulado.
    previousLabel: string | null;
    // O ponto LIVE do modo DIÁRIO mede a variação do DIA (mesma régua do card
    // "Variação Hoje"), não a distância até o snapshot de ontem. Ver withVariation.
    isDayVariation?: boolean;
    isLive?: boolean;
    // Somente para renderização: âncora que estende uma série unitária.
    isVisualAnchor?: boolean;
}

type KpiSubset = Pick<WalletKPIs, 'totalEquity' | 'totalInvested' | 'totalResult'>
    & Partial<Pick<WalletKPIs, 'dayVariation' | 'dayVariationPercent'>>;

interface BuildParams {
    history: HistoryPoint[];
    kpis: KpiSubset;
    granularity: ChartGranularity;
    window: ChartWindow;
    now?: Date; // injetável para testes determinísticos
}

const WINDOW_DAYS: Record<string, number> = { '7D': 7, '30D': 30, '90D': 90 };

const startOfDay = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const localDayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const localMonthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

const dayLabel = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
// Nome abreviado (não numérico) para não confundir com rótulo de dia (dd/mm) na
// janela Diária — "07/26" lido rápido pode parecer dia/mês. Array fixo (não
// Intl month:'short') porque a saída do ICU varia entre Node/browser (com ou
// sem ponto: "jul." vs "jul") e alguns runtimes de teste usam ICU reduzido.
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (d: Date) => `${MONTH_ABBR[d.getMonth()]}/${d.getFullYear()}`;
const fullLabel = (d: Date) => d.toLocaleDateString('pt-BR');

// Segmentos empilhados: base = patrimônio "seguro"; profit = ganho (verde, sobe);
// loss = queda até o custo (vermelho, capa por cima). profit e loss são mutuamente
// exclusivos — um é sempre 0. Barra total = max(equity, invested).
const makeBars = (equity: number, invested: number) => ({
    baseBar: Math.min(equity, invested),
    profitBar: Math.max(0, equity - invested),
    lossBar: Math.max(0, invested - equity),
});

type RawPoint = Omit<EvolutionChartPoint, 'periodVariation' | 'periodVariationPercent' | 'previousLabel' | 'isDayVariation'>;

export function buildEvolutionChartData(params: BuildParams): EvolutionChartPoint[] {
    const { history, kpis, granularity, window } = params;
    const now = params.now ?? new Date();

    // Hoje é SEMPRE representado pelo ponto LIVE (kpis); remove um eventual
    // snapshot do próprio dia para não duplicar.
    const todayKey = localDayKey(now);
    const cleanHistory = (history || []).filter(
        (h) => localDayKey(new Date(h.date)) !== todayKey
    );
    const sortedHistory = [...cleanHistory].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const points =
        granularity === 'DAILY'
            ? buildDaily(sortedHistory, kpis, window, now)
            : buildMonthly(sortedHistory, kpis, window, now);

    // No modo DIÁRIO o ponto LIVE É o dia de hoje, então a variação dele tem de ser
    // a MESMA do card "Variação Hoje" — as duas coisas aparecem juntas na tela e
    // divergir ali é o que fazia o usuário achar que um dos dois estava errado.
    //
    // As réguas eram diferentes: o card parte do FECHAMENTO de ontem, e o ponto
    // anterior do gráfico é o snapshot das 23:59. Entre um e outro cabe o pregão
    // americano, a cripto (que negocia 24h) e o câmbio — e a diferença chegou a
    // R$ 14,86 numa carteira de R$ 21 mil. Quem manda no "hoje" é o KPI.
    //
    // No modo MENSAL isso NÃO se aplica: lá o ponto LIVE representa o mês corrente
    // inteiro, e a comparação certa continua sendo contra o mês anterior.
    const dayOverride = granularity === 'DAILY' && kpis.dayVariation !== undefined
        ? { value: kpis.dayVariation, percent: kpis.dayVariationPercent ?? null }
        : null;

    // O rótulo do ponto de comparação segue a granularidade: dia contra dia,
    // mês contra mês.
    return withVariation(points, sortedHistory, granularity === 'DAILY' ? dayLabel : monthLabel, dayOverride);
}

/**
 * Uma categoria única é centralizada pelo Recharts e não forma um segmento.
 * Para renderização, duplicamos o ponto como âncora invisível à esquerda; o dado
 * real/LIVE permanece no fim. Séries normais voltam pela mesma referência.
 */
export function buildEvolutionRenderData(points: EvolutionChartPoint[]): EvolutionChartPoint[] {
    if (points.length !== 1) return points;

    const livePoint = points[0];
    return [
        {
            ...livePoint,
            label: '',
            fullDate: '',
            isLive: false,
            isVisualAnchor: true,
        },
        livePoint,
    ];
}

function buildDaily(
    sortedHistory: HistoryPoint[],
    kpis: KpiSubset,
    window: ChartWindow,
    now: Date
): RawPoint[] {
    const windowDays = WINDOW_DAYS[window] ?? 30;
    const today = startOfDay(now);
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - (windowDays - 1));

    // Indexa último snapshot conhecido por dia.
    const dayMap = new Map<string, { equity: number; invested: number }>();
    sortedHistory.forEach((point) => {
        dayMap.set(localDayKey(new Date(point.date)), {
            equity: point.totalEquity || 0,
            invested: point.totalInvested || 0,
        });
    });

    // Semente: último snapshot em ou antes do início da janela (forward-fill inicial).
    let lastEquity = 0;
    let lastInvested = 0;
    const seed = sortedHistory.filter((h) => startOfDay(new Date(h.date)) <= windowStart).pop();
    if (seed) {
        lastEquity = seed.totalEquity || 0;
        lastInvested = seed.totalInvested || 0;
    }

    const points: RawPoint[] = [];
    const cursor = new Date(windowStart);
    while (cursor < today) {
        const existing = dayMap.get(localDayKey(cursor));
        if (existing) {
            lastEquity = existing.equity;
            lastInvested = existing.invested;
        }
        // Dias antes do 1º snapshot (sem dados) são omitidos.
        if (lastEquity > 0 || lastInvested > 0) {
            const profit = lastEquity - lastInvested;
            points.push({
                label: dayLabel(cursor),
                fullDate: fullLabel(cursor),
                sortDate: new Date(cursor),
                ...makeBars(lastEquity, lastInvested),
                realInvested: lastInvested,
                realEquity: lastEquity,
                realProfit: profit,
            });
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    appendLive(points, kpis, now, dayLabel);
    return points;
}

function buildMonthly(
    sortedHistory: HistoryPoint[],
    kpis: KpiSubset,
    window: ChartWindow,
    now: Date
): RawPoint[] {
    const rawDates = sortedHistory.map((h) => new Date(h.date).getTime());
    const minDate = rawDates.length > 0 ? new Date(Math.min(...rawDates)) : new Date(now);
    minDate.setDate(1);
    minDate.setHours(0, 0, 0, 0);

    // Valor de FIM de mês por chave ano-mês (último snapshot do mês vence).
    const historyMap = new Map<string, { invested: number; equity: number }>();
    sortedHistory.forEach((point) => {
        historyMap.set(localMonthKey(new Date(point.date)), {
            invested: point.totalInvested || 0,
            equity: point.totalEquity || 0,
        });
    });

    const points: RawPoint[] = [];
    const cursor = new Date(minDate);
    let lastInvested = 0;
    let lastEquity = 0;

    while (cursor <= now) {
        // Mês atual é adicionado como LIVE no final.
        if (cursor.getMonth() === now.getMonth() && cursor.getFullYear() === now.getFullYear()) {
            cursor.setMonth(cursor.getMonth() + 1);
            continue;
        }

        const existing = historyMap.get(localMonthKey(cursor));
        if (existing) {
            lastInvested = existing.invested;
            lastEquity = existing.equity;
        }

        if (lastEquity > 0 || lastInvested > 0) {
            const profit = lastEquity - lastInvested;
            points.push({
                label: monthLabel(cursor),
                fullDate: fullLabel(cursor),
                sortDate: new Date(cursor),
                ...makeBars(lastEquity, lastInvested),
                realInvested: lastInvested,
                realEquity: lastEquity,
                realProfit: profit,
            });
        }

        cursor.setMonth(cursor.getMonth() + 1);
    }

    appendLive(points, kpis, now, monthLabel);

    if (window === '6M') return points.slice(-6);
    if (window === '12M') return points.slice(-12);
    return points; // ALL
}

function appendLive(
    points: RawPoint[],
    kpis: KpiSubset,
    now: Date,
    labelFn: (d: Date) => string
) {
    if (kpis.totalEquity > 0) {
        points.push({
            label: labelFn(now),
            fullDate: fullLabel(now),
            sortDate: new Date(now),
            ...makeBars(kpis.totalEquity, kpis.totalInvested),
            realInvested: kpis.totalInvested,
            realEquity: kpis.totalEquity,
            realProfit: kpis.totalResult,
            isLive: true,
        });
    }
}

// Variação de mercado do período = ΔEquity − ΔInvested vs. ponto anterior.
// Para o 1º ponto visível, busca o snapshot global imediatamente anterior.
function withVariation(
    points: RawPoint[],
    sortedHistory: HistoryPoint[],
    labelFn: (d: Date) => string,
    dayOverride: { value: number; percent: number | null } | null = null
): EvolutionChartPoint[] {
    return points.map((item, index) => {
        // Ponto de HOJE no modo diário: a variação é a do dia, vinda do KPI.
        if (item.isLive && dayOverride) {
            return {
                ...item,
                periodVariation: dayOverride.value,
                periodVariationPercent: dayOverride.percent,
                previousLabel: null,
                isDayVariation: true,
            };
        }

        let prevEquity = 0;
        let prevInvested = 0;
        let previousLabel: string | null = null;

        if (index > 0) {
            prevEquity = points[index - 1].realEquity;
            prevInvested = points[index - 1].realInvested;
            previousLabel = points[index - 1].label;
        } else {
            const prevSnapshot = sortedHistory
                .filter((h) => new Date(h.date) < item.sortDate)
                .pop();
            if (prevSnapshot) {
                prevEquity = prevSnapshot.totalEquity || 0;
                prevInvested = prevSnapshot.totalInvested || 0;
                // Snapshot ANTERIOR à janela visível: nomeia a data real dele, que
                // pode estar dias atrás se houve buraco no histórico.
                previousLabel = labelFn(new Date(prevSnapshot.date));
            }
        }

        const equityDiff = item.realEquity - prevEquity;
        const investedDiff = item.realInvested - prevInvested;
        let periodVariation = equityDiff - investedDiff;
        // Ruído sub-centavo (divergência de ponto flutuante entre o snapshot GRAVADO
        // e o recálculo LIVE, que passa por safeMult) não é variação real. Arredonda
        // para zero para não pintar de vermelho um "-R$ 0,00" num dia sem movimento —
        // ex.: ponto live de fim de semana, onde renda fixa não rende nada.
        if (Math.abs(periodVariation) < 0.005) periodVariation = 0;
        const periodVariationPercent = prevEquity > 0
            ? (periodVariation === 0 ? 0 : (periodVariation / prevEquity) * 100)
            : null;

        return { ...item, periodVariation, periodVariationPercent, previousLabel };
    });
}

// Resumo da janela visível para o cabeçalho: variação de MERCADO (desconta
// aportes/resgates) entre o 1º e o último ponto, e o % sobre o patrimônio inicial.
export function summarizeEvolutionWindow(
    points: EvolutionChartPoint[]
): { variationValue: number; variationPercent: number | null } {
    if (points.length < 2) return { variationValue: 0, variationPercent: null };

    const first = points[0];
    const last = points[points.length - 1];

    const variationValue =
        last.realEquity - first.realEquity - (last.realInvested - first.realInvested);
    const variationPercent =
        first.realEquity > 0 ? (variationValue / first.realEquity) * 100 : null;

    return { variationValue, variationPercent };
}
