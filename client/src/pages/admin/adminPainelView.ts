/**
 * Lógica derivada da aba "Painel" do Admin — sem JSX, testável.
 */

export interface QualityStats {
    assetsProcessed?: number;
    typosFixed?: number;
    blacklistedAssets?: number;
    snapshotStats?: { created?: number; errors?: number; empty?: number; exists?: number };
    timeSeriesAgeHours?: number | null;
    timeSeriesTracked?: number;
    timeSeriesOrphans?: number;
}

/** Um ponto da curva de backtest: retornos (%) da carteira e dos benchmarks. */
export interface AccuracyPoint {
    formattedDate?: string;
    lastRebalanceDate?: string | null;
    holdingsCount?: number;
    [key: string]: unknown;
}

interface MacroIndicator { value: number; change?: number }
export interface MacroData {
    selic?: MacroIndicator; cdi?: MacroIndicator; ipca?: MacroIndicator;
    ibov?: MacroIndicator; usd?: MacroIndicator; spx?: MacroIndicator;
    btc?: MacroIndicator; lastUpdated?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A LINHA DE BAIXO DO CARD DE SNAPSHOT.
 *
 * Ela lia `skipped` e chamava tudo de "anomalias ignoradas". `skipped` é o
 * total de carteiras NÃO fotografadas, e a maioria dos motivos é rotina: a
 * carteira está vazia (cadastrou e ainda não lançou ativo) ou o dia já tinha
 * sido fotografado. Uma única carteira vazia acendia o laranja toda noite,
 * para sempre — e cresceria um por assinante novo. Alarme que nunca apaga é
 * alarme que se aprende a ignorar, e aí o dia da anomalia de verdade passa
 * despercebido.
 *
 * `errors` é o número que merece cor: anomalia de TWRR (variação diária
 * absurda, snapshot abortado), guarda de reset de cota e exceção. O resto
 * vira frase neutra, que informa sem gritar.
 */
export const snapshotSummary = (stats: QualityStats | null) => {
    const snap = stats?.snapshotStats ?? {};
    const errors = snap.errors || 0;
    const empty = snap.empty || 0;
    const exists = snap.exists || 0;
    const alert = errors > 0;
    const parts: string[] = [];
    if (empty > 0) parts.push(plural(empty, 'carteira sem ativos', 'carteiras sem ativos'));
    if (exists > 0) parts.push(`${exists} já do dia`);
    let note = parts.length > 0 ? `Sem anomalias · ${parts.join(' · ')}` : 'Sem anomalias';
    if (alert) note = `${plural(errors, 'anomalia', 'anomalias')} — snapshot abortado`;
    if (!stats) note = '...';
    return { alert, note, created: snap.created || 0 };
};

const STALE_HOURS = 48;

/**
 * Card de séries temporais. A idade é a da coorte mantida; mostrar o tamanho
 * dela e o que ficou de fora deixa explícito o que o número cobre — a média
 * sobre a coleção inteira acendia o vermelho por documentos que ninguém atualiza.
 */
export const timeSeriesSummary = (stats: QualityStats | null) => {
    const age = stats?.timeSeriesAgeHours;
    const stale = typeof age === 'number' && age > STALE_HOURS;
    const tracked = stats?.timeSeriesTracked;
    const orphans = stats?.timeSeriesOrphans;
    return {
        stale,
        age: age ? age.toFixed(1) : 0,
        status: stats ? (stale ? 'ALERTA: Defasado' : 'Saudável') : '...',
        cohort: tracked ? { tracked, orphans: orphans ? ` · ${orphans} fora da coorte` : '' } : null,
    };
};

interface BenchmarkSeries { key: string; name: string; stroke: string; dash: string }
const BENCHMARKS: BenchmarkSeries[] = [
    { key: 'ibovReturn', name: 'IBOV', stroke: '#F97316', dash: '5 3' },
    { key: 'cdiReturn', name: 'CDI', stroke: '#10B981', dash: '3 3' },
    { key: 'ifixReturn', name: 'IFIX', stroke: '#A78BFA', dash: '5 3' },
    { key: 'spxReturn', name: 'S&P 500', stroke: '#06B6D4', dash: '5 3' },
    { key: 'btcReturn', name: 'BTC', stroke: '#F59E0B', dash: '5 3' },
];

/**
 * Cada benchmark aparece só quando a série tem dado (o backend zera as que a
 * classe não usa — ex.: cripto só traz BTC+CDI, ETF_US só SPX+CDI).
 */
export const visibleBenchmarks = (data: AccuracyPoint[]): BenchmarkSeries[] =>
    BENCHMARKS.filter((b) => data.some((d) => d[b.key] !== 0));

export const formatReturnTooltip = (value: number, name: string): [string, string] =>
    [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, name];

export const formatPointLabel = (label: unknown, point: AccuracyPoint | undefined): string => {
    const holdings = point?.holdingsCount ? ` · ${point.holdingsCount} ativos` : '';
    const reb = point?.lastRebalanceDate ? ` · rebal. ${new Date(point.lastRebalanceDate).toLocaleDateString('pt-BR')}` : '';
    return `📅 ${label}${holdings}${reb}`;
};

// Cotação ausente vira "—", nunca "R$ 0.000": zero na tela parece dado de verdade.
const macroOrDash = (value: unknown, format: (v: number) => string): string =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? format(value) : '—';

const points = (v: number) => Math.round(v).toLocaleString();

export interface MacroCardView { label: string; value: string; change?: number; sub: string; color?: string }

/** Os 7 cartões do ambiente macro, ou null quando o macro não é utilizável (sem Selic ou Ibov). */
export const buildMacroCards = (m: MacroData | null): MacroCardView[] | null => {
    if (!m || !m.selic || !m.ibov) return null;
    return [
        { label: 'Selic', value: `${m.selic.value}%`, sub: 'BCB Meta', color: 'text-yellow-400' },
        { label: 'CDI', value: `${m.cdi?.value?.toFixed(2)}%`, sub: 'Est. Cetip', color: 'text-yellow-400' },
        { label: 'IPCA', value: `${m.ipca?.value}%`, sub: '12 meses', color: 'text-red-400' },
        { label: 'Ibovespa', value: macroOrDash(m.ibov.value, points), change: m.ibov.change, sub: 'Pts' },
        { label: 'Dólar', value: macroOrDash(m.usd?.value, (v) => `R$ ${v.toFixed(3)}`), change: m.usd?.change, sub: 'PTAX' },
        { label: 'S&P 500', value: macroOrDash(m.spx?.value, points), change: m.spx?.change, sub: 'US Pts' },
        { label: 'Bitcoin', value: macroOrDash(m.btc?.value, (v) => `$${points(v)}`), change: m.btc?.change, sub: 'USD', color: 'text-purple-400' },
    ];
};
