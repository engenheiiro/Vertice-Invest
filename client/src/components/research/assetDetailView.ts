/**
 * Derivações puras do dossiê de ativo (AssetDetailModal): formatação dos
 * indicadores, semáforo de cada métrica, nota/sinal pelo score e o recorte da
 * auditoria pelo perfil do ativo. Sem React — o componente só desenha.
 */
import { BUY_THRESHOLD, type AuditEntry, type RankingItem } from '../../services/research';
import { formatCompact, type Currency } from '../../utils/format';

type MetricStatus = 'good' | 'bad' | 'neutral' | 'warning' | 'info';

export interface DetailRowData {
    label: string;
    value: string;
    status: MetricStatus;
}

type Metrics = RankingItem['metrics'];
type Num = number | undefined | null;

// ── Formatação ──────────────────────────────────────────────────────────────

export const formatCurrency = (val: Num, currency: Currency = 'BRL') => {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return formatCompact(val, currency);
};

const formatMoneyShort = (val: Num, currency: 'BRL' | 'USD' = 'BRL') => {
    if (!val && val !== 0) return '-';
    const symbol = currency === 'USD' ? '$' : 'R$';
    if (Math.abs(val) >= 1_000_000_000) return `${symbol} ${(val / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(val) >= 1_000_000) return `${symbol} ${(val / 1_000_000).toFixed(1)}M`;
    return `${symbol} ${val.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

// LTM: zero significa dado não disponível (engenharia reversa falhou), exibe '-'.
const formatLtm = (val: Num) => (!val ? '-' : formatMoneyShort(val));

const formatPercent = (val: Num) => (val === undefined || val === null ? '-' : `${val.toFixed(2)}%`);

const formatNumber = (val: Num) =>
    (val === undefined || val === null ? '-' : val.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

/** Valor ausente OU zero vira 'N/A'; o resto passa pelo formatador. */
const naOr = (val: Num, fmt: (v: number) => string) => (val ? fmt(val) : 'N/A');

const usd2 = (v: number) => `$${v.toFixed(2)}`;

/** `v && v > limit` — zero e ausente nunca passam do limite. */
const isAbove = (v: Num, limit: number) => Boolean(v && v > limit);

const flagAbove = (v: Num, limit: number, status: MetricStatus): MetricStatus => (isAbove(v, limit) ? status : 'neutral');

// ── Semáforo das métricas ───────────────────────────────────────────────────

type MetricKey = 'ROE' | 'NET_MARGIN' | 'DEBT_EQUITY' | 'P_VP' | 'DY' | 'VACANCY' | 'CAP_RATE' | 'FFO_YIELD' | 'EV_EBITDA';

/** Acima de `hi` → `hiStatus`; abaixo de `lo` → `loStatus`; entre os dois → `midStatus`. */
const band = (hi: number, hiStatus: MetricStatus, lo: number, loStatus: MetricStatus, midStatus: MetricStatus = 'neutral') =>
    (v: number): MetricStatus => {
        if (v > hi) return hiStatus;
        return v < lo ? loStatus : midStatus;
    };

/** Faixa barata (0 < v < cheap) → good; acima de `expensive` → warning. */
const cheapBand = (cheap: number, expensive: number) => (v: number): MetricStatus => {
    if (v > 0 && v < cheap) return 'good';
    return v > expensive ? 'warning' : 'neutral';
};

const METRIC_RULES: Record<MetricKey, (v: number) => MetricStatus> = {
    ROE: band(15, 'good', 5, 'bad'),
    NET_MARGIN: band(10, 'good', 0, 'bad'),
    // Dívida/PL acima de 10 veio em escala de % (150 = 1,5×).
    DEBT_EQUITY: (v) => {
        const ratio = v > 10 ? v / 100 : v;
        if (ratio < 1.0) return 'good';
        return ratio > 2.0 ? 'bad' : 'warning';
    },
    P_VP: cheapBand(1.15, 1.3),
    DY: band(8, 'good', 4, 'neutral', 'info'),
    VACANCY: band(15, 'bad', 5, 'good', 'warning'),
    CAP_RATE: band(8, 'good', 6, 'warning'),
    FFO_YIELD: band(8, 'good', 6, 'warning'),
    EV_EBITDA: cheapBand(8, 15),
};

const statusOf = (key: MetricKey, value: Num): MetricStatus =>
    (value === undefined || value === null ? 'neutral' : METRIC_RULES[key](value));

const STATUS_COLOR: Record<MetricStatus, string> = {
    good: 'text-emerald-400',
    bad: 'text-red-500 font-black',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
    neutral: 'text-white',
};

/** Cor do valor numa linha de indicador; traço (sem dado) é sempre apagado. */
export const detailRowColor = (value: string, status: MetricStatus) => (value === '-' ? 'text-slate-500' : STATUS_COLOR[status]);

// ── Quadro de indicadores por classe ────────────────────────────────────────

const row = (label: string, value: string, status: MetricStatus): DetailRowData => ({ label, value, status });

const fiiRows = (m: Metrics): DetailRowData[] => [
    row('Dividend Yield (12m)', formatPercent(m.dy), statusOf('DY', m.dy)),
    row('P/VP', formatNumber(m.pvp), statusOf('P_VP', m.pvp)),
    row('Vacância Física', formatPercent(m.vacancy), statusOf('VACANCY', m.vacancy)),
    row('Cap Rate Impl.', formatPercent(m.capRate), statusOf('CAP_RATE', m.capRate)),
    row('FFO Yield', formatPercent(m.ffoYield), statusOf('FFO_YIELD', m.ffoYield)),
    row('Beta', naOr(m.beta, formatNumber), flagAbove(m.beta, 1.2, 'warning')),
    row('Volatilidade', naOr(m.volatility, formatPercent), 'neutral'),
    row('Liquidez Diária', formatMoneyShort(m.avgLiquidity), 'neutral'),
];

/** P/E americano: até 25 é bom, acima de 40 é caro (zero/ausente = neutro). */
const usPeStatus = (pl: Num): MetricStatus => {
    if (!pl) return 'neutral';
    if (pl < 25) return 'good';
    return pl > 40 ? 'warning' : 'neutral';
};

const usRows = (m: Metrics): DetailRowData[] => [
    row('P/E (P/L)', naOr(m.pl, formatNumber), usPeStatus(m.pl)),
    row('P/VP (P/B)', naOr(m.pvp, formatNumber), statusOf('P_VP', m.pvp)),
    row('ROE', formatPercent(m.roe), statusOf('ROE', m.roe)),
    row('Profit Margin', formatPercent(m.netMargin), statusOf('NET_MARGIN', m.netMargin)),
    row('Revenue Growth', naOr(m.revenueGrowth, formatPercent), flagAbove(m.revenueGrowth, 5, 'good')),
    row('Dividend Yield', formatPercent(m.dy), statusOf('DY', m.dy)),
    row('Beta (vs S&P)', naOr(m.beta, formatNumber), flagAbove(m.beta, 1.5, 'warning')),
    row('Market Cap', formatMoneyShort(m.marketCap, 'USD'), 'info'),
];

const cryptoRows = (asset: RankingItem): DetailRowData[] => {
    const m = asset.metrics;
    return [
        row('Market Cap', formatMoneyShort(m.marketCap || m.mktCap, 'USD'), 'info'),
        row('Preço Atual', formatCurrency(asset.currentPrice, 'USD'), 'neutral'),
        row('Liquidez Est.', formatMoneyShort(m.avgLiquidity, 'USD'), 'neutral'),
        row('SMA 200', naOr(m.sma200, (v) => formatCurrency(v, 'USD')), m.sma200 && asset.currentPrice > m.sma200 ? 'good' : 'bad'),
        row('Volatilidade (a.a.)', naOr(m.volatility, formatPercent), isAbove(m.volatility, 100) ? 'bad' : 'neutral'),
        row('Score Estrutural', asset.score.toString(), asset.score >= BUY_THRESHOLD ? 'good' : 'warning'),
    ];
};

const stockRows = (m: Metrics): DetailRowData[] => [
    row('P/L', formatNumber(m.pl), 'neutral'),
    row('P/VP', formatNumber(m.pvp), statusOf('P_VP', m.pvp)),
    row('ROE', formatPercent(m.roe), statusOf('ROE', m.roe)),
    row('Margem Líquida', formatPercent(m.netMargin), statusOf('NET_MARGIN', m.netMargin)),
    row('Dívida Líq/PL', formatNumber(m.debtToEquity), statusOf('DEBT_EQUITY', m.debtToEquity)),
    row('EV/EBITDA', formatNumber(m.evEbitda), statusOf('EV_EBITDA', m.evEbitda)),
    row('Beta', naOr(m.beta, formatNumber), flagAbove(m.beta, 1.2, 'warning')),
    row('Volatilidade', naOr(m.volatility, formatPercent), 'neutral'),
];

const assetType = (asset: RankingItem) => asset.type || 'STOCK';

/** Linhas do "Quadro de Indicadores" — FII, Exterior, Cripto; o resto (ação, ETF) usa o de ação. */
export function buildMetricRows(asset: RankingItem): DetailRowData[] {
    const type = assetType(asset);
    if (type === 'FII') return fiiRows(asset.metrics);
    if (type === 'STOCK_US') return usRows(asset.metrics);
    if (type === 'CRYPTO') return cryptoRows(asset);
    return stockRows(asset.metrics);
}

interface FinancialSection {
    title: string;
    rows: DetailRowData[];
}

const usFinancials = (m: Metrics): FinancialSection => ({
    title: 'Financials (USD)',
    rows: [
        row('Market Cap', formatMoneyShort(m.marketCap, 'USD'), 'info'),
        row('Debt/Equity', naOr(m.debtToEquity, formatNumber), flagAbove(m.debtToEquity, 2, 'warning')),
        row('EPS (LPA)', naOr(m.lpa, usd2), 'neutral'),
        row('Book Value', naOr(m.vpa, usd2), 'neutral'),
        row('Earnings Growth', naOr(m.earningsGrowth, formatPercent), flagAbove(m.earningsGrowth, 10, 'good')),
        row('Volume Médio', formatMoneyShort(m.avgLiquidity, 'USD'), 'neutral'),
    ],
});

const ltmFinancials = (m: Metrics): FinancialSection => ({
    title: 'Financials (LTM)',
    rows: [
        row('Valor de Mercado', formatLtm(m.marketCap), 'info'),
        row('Dívida Líquida', formatLtm(m.netDebt), flagAbove(m.netDebt, m.marketCap || 0, 'warning')),
        row('Receita Líquida', formatLtm(m.netRevenue), 'neutral'),
        row('Lucro Líquido', formatLtm(m.netIncome), isAbove(m.netIncome, 0) ? 'good' : 'bad'),
        row('Patrimônio Líquido', formatLtm(m.patrimLiq), 'neutral'),
        row('Ativos Totais', formatLtm(m.totalAssets), 'neutral'),
    ],
});

/** Bloco de demonstrativos: só ações (LTM, em R$) e Exterior (USD). */
export function buildFinancialSection(asset: RankingItem): FinancialSection | null {
    const type = assetType(asset);
    if (type === 'STOCK_US') return usFinancials(asset.metrics);
    return type === 'STOCK' ? ltmFinancials(asset.metrics) : null;
}

// ── Sidebar: preço, upside, yield, eixos ────────────────────────────────────

/** Cripto e Exterior são cotados em dólar; o resto em reais. */
export const priceCurrency = (type: string | undefined): Currency => (type === 'CRYPTO' || type === 'STOCK_US' ? 'USD' : 'BRL');

export const computeUpside = (currentPrice: number, targetPrice: number) =>
    (currentPrice > 0 ? ((targetPrice / currentPrice) - 1) * 100 : 0);

export const upsideLabel = (upside: number) => `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%`;

// Verde ≥ 6%, Amarelo > 0%, Cinza = 0% (ou ausente).
export const yieldColor = (dy: Num) => {
    if (!dy || dy <= 0) return 'text-slate-500';
    return dy >= 6 ? 'text-emerald-400' : 'text-yellow-400';
};

export const yieldLabel = (dy: Num) => `${dy ? dy.toFixed(1) : 0}%`;

/** Eixos estruturais; sem cálculo, os três ficam no meio (50). */
export const structuralScores = (m: Metrics) => m.structural || { quality: 50, valuation: 50, risk: 50 };

// ── Nota, sinal e perfil ────────────────────────────────────────────────────

const GRADE_STEPS: Array<[number, string]> = [[95, 'A+'], [90, 'A'], [80, 'B+'], [BUY_THRESHOLD, 'B'], [60, 'C']];

export const scoreGrade = (score: number) => GRADE_STEPS.find(([min]) => score >= min)?.[1] ?? 'F';

const GRADE_BORDER_STEPS: Array<[number, string]> = [
    [90, 'border-emerald-500 text-emerald-500 bg-emerald-500/10'],
    [80, 'border-blue-500 text-blue-500 bg-blue-500/10'],
    [BUY_THRESHOLD, 'border-slate-400 text-slate-400 bg-slate-400/10'],
];

export const scoreGradeClass = (score: number) =>
    GRADE_BORDER_STEPS.find(([min]) => score >= min)?.[1] ?? 'border-red-500 text-red-500 bg-red-500/10';

/**
 * Frase do boletim. Corte de compra é o BUY_THRESHOLD (score ≥ 70 ⇔ COMPRAR):
 * um 65–69 sai como AGUARDAR e não pode ler "recomendado" no boletim.
 */
export const scoreVerdict = (score: number) => {
    if (score >= 80) return 'Ativo classe A com fundamentos excepcionais e valuation atrativo.';
    if (score >= BUY_THRESHOLD) return 'Ativo com fundamentos sólidos, recomendado para diversificação.';
    return 'Ativo apresenta riscos ou valuation esticado, requer cautela.';
};

interface ActionView {
    label: string;
    textClass: string;
    barClass: string;
}

const ACTION_WAIT: ActionView = { label: 'AGUARDAR', textClass: 'text-yellow-500', barClass: 'bg-slate-500' };
const ACTION_VIEWS: Record<string, ActionView> = {
    BUY: { label: 'OPORTUNIDADE DE ENTRADA', textClass: 'text-emerald-500', barClass: 'bg-emerald-500' },
    SELL: { label: 'VENDA', textClass: 'text-red-500', barClass: 'bg-slate-500' },
};

export const actionView = (action: string): ActionView => ACTION_VIEWS[action] ?? ACTION_WAIT;

/** "Para o perfil …" — sem perfil, cai em moderado. */
export const profileSignalLabel = (riskProfile: string | undefined) => {
    if (riskProfile === 'DEFENSIVE') return 'defensivo';
    return riskProfile === 'BOLD' ? 'arrojado' : 'moderado';
};

// ── Auditoria ───────────────────────────────────────────────────────────────

const UNIVERSAL_CATEGORIES = ['Qualidade', 'Valuation', 'Risco', 'Dados e Confiança', 'Confiança'];
const PROFILE_CATEGORY: Record<string, string> = {
    DEFENSIVE: 'Perfil Defensivo',
    MODERATE: 'Perfil Moderado',
    BOLD: 'Perfil Arrojado',
};

/**
 * Regra #3: o front mostra só as categorias universais e a do perfil do ativo;
 * linha de zero ponto não é ganho nem perda e sai.
 */
export function filterAuditForProfile(auditLog: AuditEntry[] | undefined, riskProfile: string | undefined): AuditEntry[] {
    if (!auditLog) return [];
    const target = PROFILE_CATEGORY[riskProfile || ''];
    return auditLog.filter((log) => log.points !== 0 && (UNIVERSAL_CATEGORIES.includes(log.category) || log.category === target));
}

const MAX_AUDIT_ITEMS = 12;

/** Ganhos e perdas, cada lado com no máximo 12 linhas, na ordem do log. */
export const splitAudit = (entries: AuditEntry[]) => ({
    gains: entries.filter((l) => l.points > 0).slice(0, MAX_AUDIT_ITEMS),
    losses: entries.filter((l) => l.points < 0).slice(0, MAX_AUDIT_ITEMS),
});
