// Bloco "MÉTRICAS" de um item do relatório TXT do ranking.
import {
    fmt, fmtBRL, fmtPct, fmtMarketCap, fmtLiquidity, fmtLiquidityUSD, fmtUSD, fmtMarketCapUSD,
} from './formatters.js';

const FINANCIAL_SECTOR_MARKERS = ['Banco', 'Segur', 'Financeiro', 'Holding', 'Financial', 'Insurance'];
const NOT_APPLICABLE_FINANCIAL = 'N/A (financeiro)';

const isFinancialSector = (sector) => FINANCIAL_SECTOR_MARKERS.some(marker => !!sector?.includes(marker));

// Para STOCK_US, campos não coletados são zerados no DB; exibir N/D em vez de 0.00
const buildFormatters = (type) => {
    const isUS = type === 'STOCK_US';
    const isUsZero = (val) => isUS && (val === 0 || val === null || val === undefined);
    return {
        price: isUS ? fmtUSD : fmtBRL,
        cap: isUS ? fmtMarketCapUSD : fmtMarketCap,
        liquidity: (isUS || type === 'CRYPTO') ? fmtLiquidityUSD : fmtLiquidity,
        usZero: (val, decimals = 2) => (isUsZero(val) ? 'N/D' : fmt(val, decimals)),
        usZeroPct: (val) => (isUsZero(val) ? 'N/D' : fmtPct(val)),
    };
};

const valuationAndMarketText = (m, f) => {
    let out = '';
    out += `  ── Valuation ─────────────────────────────────────────\n`;
    out += `  Preço Justo:       ${f.price(m.fairPrice)}   Método: ${m.method || 'N/D'}\n`;
    out += `  Preço Graham:      ${f.price(m.grahamPrice)}   Preço Bazin:  ${f.price(m.bazinPrice)}\n`;
    out += `  PEG Ratio:         ${fmt(m.pegRatio, 2)}\n`;

    out += `\n  ── Indicadores de Mercado ────────────────────────────\n`;
    out += `  Market Cap:        ${f.cap(m.marketCap)}\n`;
    out += `  Liquidez Média:    ${f.liquidity(m.avgLiquidity)}\n`;
    out += `  Volatilidade:      ${fmtPct(m.volatility)}   Beta: ${fmt(m.beta, 2)}\n`;
    out += `  SMA200:            ${f.price(m.sma200)}   EMA50: ${f.price(m.ema50)}\n`;
    return out;
};

const stockText = (m, f, financial) => {
    const evEbitda = financial ? NOT_APPLICABLE_FINANCIAL : f.usZero(m.evEbitda);
    const netMargin = financial ? NOT_APPLICABLE_FINANCIAL : fmtPct(m.netMargin);
    const ebitMargin = financial ? NOT_APPLICABLE_FINANCIAL : fmtPct(m.ebitMargin);
    let out = '';
    out += `\n  ── Múltiplos Fundamentais ────────────────────────────\n`;
    out += `  P/L:               ${fmt(m.pl, 2)}   P/VP:         ${f.usZero(m.pvp)}\n`;
    out += `  EV/EBITDA:         ${evEbitda}   EV/EBIT:      ${fmt(m.evEbit, 2)}\n`;
    out += `  PSR:               ${fmt(m.psr, 2)}   P/EBIT:       ${fmt(m.pEbit, 2)}\n`;
    out += `  P/Ativos:          ${fmt(m.pAtivos, 2)}   P/Cap.Giro:   ${fmt(m.pCapGiro, 2)}\n`;
    out += `  P/Ativ.Circ.Liq:   ${fmt(m.pAtivCircLiq, 2)}   Earnings Yield: ${fmtPct(m.earningsYield)}\n`;

    out += `\n  ── Rentabilidade e Eficiência ────────────────────────\n`;
    out += `  ROE:               ${fmtPct(m.roe)}   ROIC:         ${f.usZeroPct(m.roic)}\n`;
    out += `  Margem Líquida:    ${netMargin}   Margem EBIT:  ${ebitMargin}\n`;
    out += `  Crescimento 5a:    ${fmtPct(m.revenueGrowth)}\n`;

    out += `\n  ── Endividamento e Saúde Financeira ──────────────────\n`;
    out += `  Dívida/PL:         ${fmt(m.debtToEquity, 2)}   Corrente:     ${fmt(m.currentRatio, 2)}\n`;
    out += `  Patrimônio Líq.:   ${f.cap(m.patrimLiq)}   Dív. Líquida: ${f.cap(m.netDebt)}\n`;
    out += `  Receita Líquida:   ${f.cap(m.netRevenue)}   Lucro Líq.:   ${f.cap(m.netIncome)}\n`;
    out += `  Total Ativos:      ${f.cap(m.totalAssets)}\n`;

    out += `\n  ── Dividendos ────────────────────────────────────────\n`;
    out += `  Dividend Yield:    ${fmtPct(m.dy)}   Payout:       ${fmtPct(m.payout)}\n`;
    return out;
};

const fiiText = (m) => {
    let out = '';
    out += `\n  ── Indicadores de FII ────────────────────────────────\n`;
    out += `  P/VP:              ${fmt(m.pvp, 2)}   Dividend Yield: ${fmtPct(m.dy)}\n`;
    out += `  Vacância:          ${fmtPct(m.vacancy)}   Cap Rate:     ${fmtPct(m.capRate)}\n`;
    out += `  Qtd. Imóveis:      ${fmt(m.qtdImoveis, 0)}   FFO Yield:    ${fmtPct(m.ffoYield)}\n`;
    out += `  VPA por Cota:      ${fmtBRL(m.vpCota)}   FFO/Cota:     ${fmtBRL(m.ffoCota)}\n`;
    out += `  Preço/m²:          ${fmtBRL(m.priceM2)}   Renda/m²:     ${fmtBRL(m.rentM2)}\n`;
    out += `  Market Cap:        ${fmtMarketCap(m.marketCap)}\n`;
    return out;
};

// Bloco próprio da cripto: em dólar, como a "Liquidez Média" acima.
const cryptoText = (m) => {
    let out = '';
    out += `\n  ── Indicadores Cripto ────────────────────────────────\n`;
    out += `  Market Cap:        ${fmtMarketCapUSD(m.marketCap)}\n`;
    out += `  Volatilidade:      ${fmtPct(m.volatility)}   Beta: ${fmt(m.beta, 2)}\n`;
    out += `  Liquidez:          ${fmtLiquidityUSD(m.avgLiquidity)}\n`;
    return out;
};

const typeSpecificText = (m, type, f, financial) => {
    let out = '';
    if (type === 'STOCK' || type === 'STOCK_US') out += stockText(m, f, financial);
    if (type === 'FII') out += fiiText(m);
    if (type === 'CRYPTO') out += cryptoText(m);
    return out;
};

const structuralText = (structural) => {
    if (!structural) return '';
    let out = '';
    out += `\n  ── Scores Estruturais (0–100) ────────────────────────\n`;
    out += `  Qualidade:         ${fmt(structural.quality, 0)}/100\n`;
    out += `  Valuation:         ${fmt(structural.valuation, 0)}/100\n`;
    out += `  Risco:             ${fmt(structural.risk, 0)}/100\n`;
    return out;
};

const missingFieldsText = (missingMap) => {
    if (!missingMap || Object.keys(missingMap).length === 0) return '';
    const missing = Object.entries(missingMap).filter(([, v]) => v).map(([k]) => k);
    return missing.length > 0 ? `  ⚠ Campos Ausentes: ${missing.join(', ')}\n` : '';
};

const dataWarningsText = (m) => {
    let out = '';
    if (m._staleDays !== null && m._staleDays !== undefined) {
        out += `\n  ⚠ Defasagem dos Dados Fundamentais: ${m._staleDays} dias\n`;
    }
    return out + missingFieldsText(m._missing);
};

export const formatMetrics = (m, type, sector) => {
    if (!m) return '  (sem métricas)\n';
    const financial = isFinancialSector(sector);
    const f = buildFormatters(type);
    return valuationAndMarketText(m, f)
        + typeSpecificText(m, type, f, financial)
        + structuralText(m.structural)
        + dataWarningsText(m);
};
