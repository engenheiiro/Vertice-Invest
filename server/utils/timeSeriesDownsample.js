export const DEFAULT_HISTORY_POINTS = 480;
export const DEFAULT_PERFORMANCE_POINTS = 600;
export const RECENT_DAILY_POINTS = 120;

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const brazilDayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const pointDayKey = (point) => {
    if (DAY_KEY_PATTERN.test(point?.dayKey || '')) return point.dayKey;
    if (typeof point?.date === 'string' && DAY_KEY_PATTERN.test(point.date)) return point.date;

    const date = new Date(point?.date);
    if (Number.isNaN(date.getTime())) return null;

    const parts = Object.fromEntries(
        brazilDayFormatter
            .formatToParts(date)
            .filter(({ type }) => type !== 'literal')
            .map(({ type, value }) => [type, value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
};

const pointMonthKey = (point) => pointDayKey(point)?.slice(0, 7) || null;

const sampleUniformly = (rows, budget) => {
    if (rows.length <= budget) return rows;
    if (budget === 1) return [rows[0]];
    const sampled = [];
    let lastIndex = -1;
    for (let i = 0; i < budget; i++) {
        const index = Math.round((i * (rows.length - 1)) / (budget - 1));
        if (index !== lastIndex) sampled.push(rows[index]);
        lastIndex = index;
    }
    return sampled;
};

/**
 * Reduz uma série já ordenada sem perder o primeiro ponto, o último ponto nem a
 * janela diária recente. A parte antiga é amostrada uniformemente; a saída
 * permanece cronológica e nunca excede maxPoints.
 */
export const downsampleTimeSeries = (
    series,
    { maxPoints = DEFAULT_HISTORY_POINTS, recentPoints = RECENT_DAILY_POINTS } = {},
) => {
    const rows = Array.isArray(series) ? series : [];
    const cap = Math.max(2, Math.trunc(Number(maxPoints)) || DEFAULT_HISTORY_POINTS);
    if (rows.length <= cap) return rows;

    const recentCount = Math.min(Math.max(1, Math.trunc(recentPoints)), cap - 1);
    const recentStart = rows.length - recentCount;
    const older = rows.slice(0, recentStart);
    const olderBudget = cap - recentCount;

    if (older.length <= olderBudget) return [...older, ...rows.slice(recentStart)];

    // O frontend calcula retornos mensais pelo último ponto disponível do mês.
    // Portanto, no trecho antigo, mês fechado é uma unidade semântica — escolher
    // um dia uniforme no meio do mês mudaria o número mostrado na tabela.
    const monthEnds = [];
    let validDates = true;
    for (const point of older) {
        const key = pointMonthKey(point);
        if (!key) {
            validDates = false;
            break;
        }
        if (monthEnds.at(-1)?.key === key) monthEnds[monthEnds.length - 1] = { key, point };
        else monthEnds.push({ key, point });
    }

    const historicalCandidates = validDates
        ? [older[0], ...monthEnds.map(({ point }) => point).filter((point) => point !== older[0])]
        : older;
    const sampled = sampleUniformly(historicalCandidates, olderBudget);
    return [...sampled, ...rows.slice(recentStart)];
};

export const boundedPointLimit = (value, fallback = DEFAULT_HISTORY_POINTS) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(60, Math.min(1000, parsed));
};

export const boundedPageLimit = (value, fallback = 100) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(1000, parsed));
};
