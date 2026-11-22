/**
 * Scores ESTRUTURAIS (QUALITY / VALUATION / RISK, 0–100) por classe de ativo, em
 * etapas puras. Cada scorer devolve `{ quality, valuation, risk, audit }` com a
 * auditoria na mesma ordem e com o mesmo texto do `calculateStructuralScores`
 * monolítico. Quem escolhe o scorer (e resolve os insumos de QUALITY da ação) é
 * `calculateStructuralScores`, em scoringEngine.js.
 */
import { DEFAULT_NTNB_FALLBACK, FII_YIELD_TRAP_THRESHOLD } from '../../config/financialConstants.js';
import { observedPart, observedWeightedAverage } from '../../utils/metricObservation.js';
import { firstTier, netDebtToEbitda, scoreWithAudit } from './stockProfileRules.js';

const clamp = (x) => Math.min(100, Math.max(0, x));

/** Pontos da primeira faixa verdadeira (`[condição, pontos]`), ou 0 se nenhuma casar. */
const tierPoints = (tiers) => {
    const hit = tiers.find(([when]) => when);
    return hit ? hit[1] : 0;
};

/** Desvio do preço em relação à SMA200, ou `null` sem SMA200 positiva. */
const smaDeviation = (asset, m) => (m.sma200 > 0 ? (asset.price - m.sma200) / m.sma200 : null);

const baseAudit = () => ({
    QUALITY: [{ factor: 'Base de Qualidade', points: 0, type: 'base' }],
    VALUATION: [{ factor: 'Base de Valuation', points: 0, type: 'base' }],
    RISK: [],
});

/** Classes temáticas: uma linha de auditoria por eixo, com o score bruto como pontos. */
const themedResult = ({ q, qFactor, v, vFactor, r, rFactor }) => {
    const audit = baseAudit();
    audit.QUALITY.push({ factor: qFactor, points: q, type: 'bonus' });
    audit.VALUATION.push({ factor: vFactor, points: v, type: 'bonus' });
    audit.RISK.push({ factor: rFactor, points: r, type: 'base' });
    return { quality: clamp(q), valuation: clamp(v), risk: clamp(r), audit };
};

export const emptyStructuralScores = () => ({ quality: 0, valuation: 0, risk: 0, audit: baseAudit() });

// ── CLASSES TEMÁTICAS (ETF nacional temático e Exterior não-ação) ─────────────

// Ouro (GOLD11 ou ouro do Exterior): hedge — tendência + liquidez + volatilidade.
// No ETF nacional liquidez 0 é "não reportada" e não penaliza; no Exterior penaliza.
const goldStructural = (asset, m, aboveTrend, liquidityMustBeReported) => {
    const dev = smaDeviation(asset, m);
    const illiquid = liquidityMustBeReported ? m.avgLiquidity > 0 && m.avgLiquidity < 1000000 : m.avgLiquidity < 1000000;
    return themedResult({
        q: 60 + (aboveTrend ? 12 : 0) + (m.avgLiquidity > 20000000 ? 8 : 0),
        qFactor: 'Ouro: tendência e liquidez',
        v: 50 + (dev === null ? 0 : tierPoints([[dev < -0.1, 20], [dev > 0.3, -15]])),
        vFactor: 'Ouro: posição vs média histórica',
        r: 65 + tierPoints([[m.volatility > 0 && m.volatility < 20, 10], [m.volatility > 40, -15]]) + (illiquid ? -20 : 0),
        rFactor: 'Ouro: hedge de baixa correlação',
    });
};

const cryptoEtfStructural = (asset, m, aboveTrend) => {
    const dev = smaDeviation(asset, m);
    return themedResult({
        q: 45 + (m.avgLiquidity > 20000000 ? 10 : 0) + (aboveTrend ? 10 : 0),
        qFactor: 'ETF Cripto: liquidez e tendência',
        v: 50 + (dev === null ? 0 : tierPoints([[dev < -0.2, 25], [dev < 0, 12], [dev > 0.5, -20], [dev > 0.2, -10]])),
        vFactor: 'ETF Cripto: desvio da média histórica',
        r: 35
            + tierPoints([[m.volatility > 0 && m.volatility < 40, 15], [m.volatility > 100, -15], [m.volatility > 70, -8]])
            + tierPoints([[m.avgLiquidity > 20000000, 10], [m.avgLiquidity > 0 && m.avgLiquidity < 1000000, -15]]),
        rFactor: 'ETF Cripto: volatilidade e liquidez',
    });
};

const fixedIncomeEtfStructural = (m, aboveTrend) => themedResult({
    q: 60 + (m.avgLiquidity > 5000000 ? 10 : 0) + (m.dy >= 4 ? 8 : 0),
    qFactor: 'Renda Fixa: estabilidade e renda',
    v: 55 + (aboveTrend ? 10 : 0),
    vFactor: 'Renda Fixa: tendência de juros',
    r: 70
        + tierPoints([[m.volatility > 0 && m.volatility < 12, 15], [m.volatility > 25, -15]])
        + (m.avgLiquidity > 0 && m.avgLiquidity < 1000000 ? -15 : 0),
    rFactor: 'Renda Fixa: baixa volatilidade',
});

// Cesta genérica (ETF nacional não temático ou ETF do Exterior).
// avgLiquidity=0 = não reportada pela fonte (não baixa liquidez real) → sem penalidade.
const basketEtfStructural = (asset, m) => {
    const dev = smaDeviation(asset, m);
    const volatilityPoints = m.volatility > 0 ? tierPoints([[m.volatility < 18, 15], [m.volatility > 35, -20]]) : 0;
    return themedResult({
        q: 55 + tierPoints([[m.avgLiquidity > 50000000, 20], [m.avgLiquidity > 5000000, 10]]) + (m.dy >= 2 ? 10 : 0),
        qFactor: 'ETF: liquidez/AUM e renda',
        v: 50 + (dev === null ? 0 : tierPoints([[dev < -0.1, 20], [dev < 0, 10], [dev > 0.3, -15]])) + (m.dy >= 3 ? 10 : 0),
        vFactor: 'ETF: posição vs média e yield',
        r: 55 + tierPoints([[m.avgLiquidity > 20000000, 20], [m.avgLiquidity > 0 && m.avgLiquidity < 1000000, -20]]) + volatilityPoints,
        rFactor: 'ETF: liquidez e volatilidade',
    });
};

const reitStructural = (m, aboveTrend) => themedResult({
    q: 45 + tierPoints([[m.dy >= 4, 25], [m.dy >= 2.5, 12]]) + (m.debtToEquity > 0 && m.debtToEquity < 1.5 ? 10 : 0),
    qFactor: 'REIT: yield e alavancagem',
    v: 40 + tierPoints([[m.dy >= 5, 40], [m.dy >= 3.5, 25], [m.dy >= 2, 10]]) + (m.pvp > 0 && m.pvp < 1 ? 10 : 0),
    vFactor: 'REIT: dividend yield',
    r: 50
        + tierPoints([[m.avgLiquidity > 20000000, 20], [m.avgLiquidity < 1000000, -20]])
        + (m.debtToEquity > 2 ? -20 : 0)
        + (aboveTrend ? 10 : 0),
    rFactor: 'REIT: liquidez, dívida e tendência',
});

/**
 * Estrutural das classes temáticas, na ordem de precedência original: ETF nacional
 * de Ouro/Cripto/Renda Fixa, depois cesta (ETF nacional ou do Exterior), REIT e
 * Ouro do Exterior. `null` quando o ativo não é de nenhuma delas.
 */
export const themedStructuralScores = (asset, usSub, etfTheme, aboveTrend) => {
    const { type, metrics: m } = asset;
    const isBrEtf = type === 'ETF';
    const isUs = type === 'STOCK_US';
    if (isBrEtf && etfTheme === 'GOLD') return goldStructural(asset, m, aboveTrend, true);
    if (isBrEtf && etfTheme === 'CRYPTO') return cryptoEtfStructural(asset, m, aboveTrend);
    if (isBrEtf && etfTheme === 'FIXED_INCOME') return fixedIncomeEtfStructural(m, aboveTrend);
    if ((isUs && usSub === 'ETF') || isBrEtf) return basketEtfStructural(asset, m);
    if (isUs && usSub === 'REIT') return reitStructural(m, aboveTrend);
    if (isUs && usSub === 'GOLD') return goldStructural(asset, m, aboveTrend, false);
    return null;
};

// ── AÇÃO ──────────────────────────────────────────────────────────────────────

// Notas 0–100 equivalentes aos degraus originais de 25/15/0 pontos (×4). A composição
// é MÉDIA PONDERADA das observadas: com os quatro insumos presentes reproduz a soma
// aditiva antiga; métrica inaplicável ao arquétipo é AUSENTE (ver resolveStockQualityInputs).
const QUALITY_GRADES = Object.freeze({
    roe: value => (value > 15 ? 100 : value > 10 ? 60 : 0),
    netMargin: value => (value > 10 ? 100 : value > 5 ? 60 : 0),
    debtToEquity: value => (value < 1.0 ? 100 : value < 2.0 ? 60 : -40),
    revenueGrowth: value => (value > 10 ? 100 : value > 5 ? 40 : 0),
});

/**
 * Nota 0–100 do ROE RECORRENTE em rampa contínua. Ver
 * RECURRING_ROE_SCALE_BY_ARCHETYPE (config/stockCalibration.js) para por que
 * este insumo é rampa enquanto todos os outros são degrau.
 */
const gradeRecurringRoe = (value, { floor, cap }) => (
    Math.max(0, Math.min(100, ((value - floor) / (cap - floor)) * 100))
);

const recurringRoeLabel = (value, grade) => {
    const band = grade >= 75 ? 'Elevado'
        : grade >= 50 ? 'Saudável'
        : grade >= 25 ? 'Modesto'
        : 'Baixo';
    return `ROE Recorrente ${band} (${value.toFixed(1)}%)`;
};

const QUALITY_LABELS = Object.freeze({
    roe: { 100: 'ROE Elevado (>15%)', 60: 'ROE Saudável (>10%)', 0: 'ROE Modesto / Baixo' },
    netMargin: { 100: 'Margem Líquida Robusta (>10%)', 60: 'Margem Líquida Regular (>5%)', 0: 'Margem Líquida Estreita' },
    debtToEquity: { 100: 'Estrutura Capital Excelente (D/P < 1.0)', 60: 'Alavancagem Controlada (D/P < 2.0)', '-40': 'Alavancagem Elevada' },
    revenueGrowth: { 100: 'Crescimento de Receita Sólido (>10%)', 40: 'Crescimento de Receita Moderado', 0: 'Crescimento de Receita Fraco' },
});

const QUALITY_KEYS = ['roe', 'netMargin', 'debtToEquity', 'revenueGrowth'];

const qualityFactorOf = (component, qualityInputs, roeScale) => (component.metric === 'roe' && roeScale
    ? recurringRoeLabel(qualityInputs.roe, component.value)
    : QUALITY_LABELS[component.metric][String(component.value)] || component.metric);

const pointsType = (points) => (points > 0 ? 'bonus' : points < 0 ? 'penalty' : 'base');

// Contribuições arredondadas SOMAM o score: a auditoria reconcilia com o número exibido.
const stockQualityComponents = (qualityInputs, auditList) => {
    const roeScale = qualityInputs.recurringRoeScale;
    const gradeQuality = (key, value) => (
        key === 'roe' && roeScale ? gradeRecurringRoe(value, roeScale) : QUALITY_GRADES[key](value)
    );
    const qualityAverage = observedWeightedAverage(QUALITY_KEYS.map(key => observedPart(
        key,
        qualityInputs[key] === null ? null : gradeQuality(key, qualityInputs[key]),
        0.25,
    )));
    let qScore = 0;
    for (const component of qualityAverage.components) {
        const points = Math.round(component.value * component.effectiveWeight);
        qScore += points;
        auditList.push({ factor: qualityFactorOf(component, qualityInputs, roeScale), points, type: pointsType(points) });
    }
    for (const { key, why } of qualityInputs.absent) {
        auditList.push({ factor: `${key}: ${why} — peso redistribuído`, points: 0, type: 'base' });
    }
    if (qualityInputs.usedRecurringRoe) {
        auditList.push({
            factor: roeScale
                ? `ROE recorrente (IF.data/BCB) no lugar do ROE contábil — régua ${roeScale.floor}%–${roeScale.cap}%`
                : 'ROE recorrente (IF.data/BCB) no lugar do ROE contábil',
            points: 0,
            type: 'base',
        });
    }
    return qScore;
};

// Sustentabilidade de dividendos (payout).
const stockPayoutQuality = (m) => {
    const payout = m.payout || 0;
    return firstTier([
        [payout > 100, -30, () => `Payout Insustentável (${payout.toFixed(1)}%)`, 'penalty'],
        [payout > 40 && payout < 85, 15, () => `Payout Saudável (${payout.toFixed(1)}%)`, 'bonus'],
        [payout > 0 && payout < 20, -5, () => `Payout Muito Baixo (${payout.toFixed(1)}%)`, 'penalty'],
    ]);
};

const stockMultiplesValuation = (m) => [
    ...firstTier([
        [m.pl > 0 && m.pl < 10, 30, 'P/L Barato (<10)', 'bonus'],
        [m.pl > 0 && m.pl < 15, 15, 'P/L Justo (<15)', 'bonus'],
    ]),
    ...firstTier([
        [m.pvp > 0 && m.pvp < 1.5, 30, 'P/VP Barato (<1.5)', 'bonus'],
        [m.pvp > 0 && m.pvp < 2.5, 15, 'P/VP Justo (<2.5)', 'bonus'],
    ]),
    ...firstTier([[m.evEbitda > 0 && m.evEbitda < 8, 20, 'EV/EBITDA Atrativo (<8)', 'bonus']]),
    ...firstTier([[m.dy > 6, 20, 'Dividend Yield > 6%', 'bonus']]),
];

// Spread do earnings yield sobre o Tesouro: aplicado sobre o valuation já limitado a 0–100.
const applyTreasurySpread = (valuation, m, MACRO, auditList) => {
    if (!(m.pl > 0)) return valuation;
    const ntnb = MACRO?.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
    const spread = ((1 / m.pl) * 100) - ntnb;
    if (spread > 4) {
        auditList.push({ factor: `Spread vs Tesouro Excelente (${spread.toFixed(1)}%)`, points: 20, type: 'bonus' });
        return Math.min(100, valuation + 20);
    }
    if (spread > 0) {
        auditList.push({ factor: `Spread vs Tesouro Positivo (${spread.toFixed(1)}%)`, points: 10, type: 'bonus' });
        return Math.min(100, valuation + 10);
    }
    auditList.push({ factor: `Spread Negativo vs Tesouro (${spread.toFixed(1)}%)`, points: -20, type: 'penalty' });
    return Math.max(0, valuation - 20);
};

// Dívida: DL/EBITDA derivado quando calculável; senão Dívida/Patrimônio. Financeiro fica de fora.
const stockLeverageRisk = (m, isFinancial) => {
    if (isFinancial) return [];
    const dlEbitda = netDebtToEbitda(m);
    if (dlEbitda === null) {
        return firstTier([
            [m.debtToEquity > 3.0, -40, 'Dívida/Patrimônio Explosiva (>3.0)', 'penalty'],
            [m.debtToEquity > 1.5, -15, 'Dívida/Patrimônio Elevada (>1.5)', 'penalty'],
        ]);
    }
    return firstTier([
        [dlEbitda > 3.5, -40, () => `Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, 'penalty'],
        [dlEbitda > 2.5, -15, () => `Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, 'penalty'],
        [dlEbitda < 1.0 && dlEbitda > -1, 10, 'Caixa Robusto / Baixa Alavancagem', 'bonus'],
    ]);
};

const stockRiskEntries = (m, isFinancial) => [
    { points: 50, factor: 'Base de Risco', type: 'base' },
    ...firstTier([
        [m.marketCap > 10000000000, 20, 'Large Cap (Segurança)', 'bonus'],
        [m.marketCap < 500000000, -20, 'Micro Cap (Risco)', 'penalty'],
    ]),
    ...firstTier([
        [m.avgLiquidity > 5000000, 10, 'Liquidez Alta (>5M)', 'bonus'],
        [m.avgLiquidity < 100000, -20, 'Liquidez Crítica (<100k)', 'penalty'],
    ]),
    ...stockLeverageRisk(m, isFinancial),
];

/**
 * Estrutural de ação individual. `qualityInputs` = saída de resolveStockQualityInputs;
 * `isFinancial` = recorte de setor financeiro que dispensa a régua de dívida.
 */
export const stockStructuralScores = (asset, MACRO, qualityInputs, isFinancial) => {
    const m = asset.metrics;
    const audit = baseAudit();
    const qScore = stockQualityComponents(qualityInputs, audit.QUALITY);
    const quality = clamp(scoreWithAudit(qScore, audit.QUALITY, stockPayoutQuality(m)));
    const multiples = clamp(scoreWithAudit(0, audit.VALUATION, stockMultiplesValuation(m)));
    const valuation = applyTreasurySpread(multiples, m, MACRO, audit.VALUATION);
    const risk = clamp(scoreWithAudit(0, audit.RISK, stockRiskEntries(m, isFinancial)));
    return { quality, valuation, risk, audit };
};

// ── FII ───────────────────────────────────────────────────────────────────────

// Tijolo: vacância linear (-3 por ponto acima de 10%) e diversificação; Papel: liquidez.
const fiiPortfolioQuality = (m, isPapel) => {
    if (isPapel) {
        return firstTier([
            [m.avgLiquidity > 5000000, 30, 'Liquidez Alta (Papel)', 'bonus'],
            [m.avgLiquidity > 1000000, 15, 'Liquidez Saudável (Papel)', 'bonus'],
        ]);
    }
    return [
        ...firstTier([
            [m.vacancy > 10, -((m.vacancy - 10) * 3), () => `Vacância Elevada (${m.vacancy.toFixed(1)}%)`, 'penalty'],
            [m.vacancy < 5, 20, 'Vacância Baixa (<5%)', 'bonus'],
        ]),
        ...firstTier([
            [m.qtdImoveis > 10, 20, 'Multi-propriedade (>10 imóveis)', 'bonus'],
            [m.qtdImoveis > 5, 10, 'Boa diversificação (>5 imóveis)', 'bonus'],
            [m.qtdImoveis === 1, -30, 'Risco Mono-Ativo', 'penalty'],
        ]),
    ];
};

// Spread sobre a NTN-B: prêmio ideal > 2% (Tijolo) / > 3% (Papel, risco de crédito).
// DY acima do teto de yield-trap torna o spread não confiável (provável amortização).
const fiiValuationEntries = (m, spread, isPapel) => {
    const requiredSpread = isPapel ? 3.0 : 2.0;
    return [
        ...firstTier([
            [m.dy > FII_YIELD_TRAP_THRESHOLD, 20, () => `Spread Não Confiável (DY ${m.dy.toFixed(1)}% sugere amortização)`, 'bonus'],
            [spread >= requiredSpread + 2, 90, 'Spread Excelente (>4-5%)', 'bonus'],
            [spread >= requiredSpread, 70, 'Spread Saudável', 'bonus'],
            [spread >= 0, 40, 'Spread Positivo', 'bonus'],
            [true, 0, () => `Spread Negativo vs Tesouro (${spread.toFixed(1)}%)`, 'penalty'],
        ]),
        ...firstTier([
            [m.pvp < 0.90, 10, 'Deságio P/VP (<0.90)', 'bonus'],
            [m.pvp > 1.10, -20, 'Ágio Excessivo (>1.10)', 'penalty'],
        ]),
    ];
};

const fiiStructuralRisk = (m, isPapel) => [
    { points: 50, factor: 'Base Risco FII', type: 'base' },
    // Tiers granulares para criar variância real (antes quase todos travavam em 70).
    ...firstTier([
        [m.avgLiquidity > 10000000, 30, 'Liquidez Institucional (>10M)', 'bonus'],
        [m.avgLiquidity > 5000000, 25, 'Liquidez Alta (>5M)', 'bonus'],
        [m.avgLiquidity > 2000000, 20, 'Liquidez Boa (>2M)', 'bonus'],
        [m.avgLiquidity > 1000000, 10, 'Liquidez Mínima (>1M)', 'bonus'],
    ]),
    ...(isPapel
        ? firstTier([[m.pvp > 1.15, -40, 'Ágio em Papel (Risco Amortização)', 'penalty']])
        : [
            ...firstTier([[m.vacancy > 20, -40, 'Vacância Crítica (>20%)', 'penalty']]),
            ...firstTier([
                [m.qtdImoveis === 1, -50, 'Risco Binário (Mono-Ativo)', 'penalty'],
                [m.qtdImoveis < 3, -20, 'Baixa Diversificação', 'penalty'],
            ]),
        ]),
];

export const fiiStructuralScores = (asset, MACRO, isPapel) => {
    const m = asset.metrics;
    const ntnb = MACRO?.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
    const spread = m.dy - ntnb;
    const audit = baseAudit();
    const qualityEntries = [
        { points: 40, factor: 'Base Qualidade FII', type: 'base' },
        ...fiiPortfolioQuality(m, isPapel),
        // Bônus por Yield Real (spread sobre inflação/NTN-B)
        ...firstTier([[spread > 2, 20, 'Yield Real > 2%', 'bonus']]),
    ];
    const quality = clamp(scoreWithAudit(0, audit.QUALITY, qualityEntries));
    const valuation = clamp(scoreWithAudit(0, audit.VALUATION, fiiValuationEntries(m, spread, isPapel)));
    const risk = clamp(scoreWithAudit(0, audit.RISK, fiiStructuralRisk(m, isPapel)));
    return { quality, valuation, risk, audit };
};

// ── CRIPTO (sem linhas de auditoria além das bases) ──────────────────────────

const BLUE_CHIP_CRYPTO = ['BTC', 'ETH'];

// Dominância, liquidez e tendência de longo prazo (SMA200) como proxy de adoção.
const cryptoQuality = (asset, m, isBlueChip) => 40
    + (isBlueChip ? 40 : tierPoints([[m.marketCap > 20000000000, 20], [m.marketCap > 5000000000, 10]]))
    + (m.avgLiquidity > 1000000000 ? 10 : 0)
    + (m.sma200 && asset.price > m.sma200 ? 10 : 0);

// Desvio da SMA200 como proxy de "desconto" ou "esticado".
const cryptoValuation = (asset, m, isBlueChip) => {
    const deviation = m.sma200 && asset.price > 0 ? (asset.price - m.sma200) / m.sma200 : null;
    const deviationPoints = deviation === null ? 0
        : tierPoints([[deviation < -0.20, 30], [deviation < 0, 15], [deviation > 0.50, -20], [deviation > 0.20, -10]]);
    return 50 + (isBlueChip ? 10 : 0) + deviationPoints;
};

// Inversamente proporcional à volatilidade, tamanho e volume/market cap (VMC).
const cryptoRisk = (m) => {
    const vmc = m.marketCap > 0 ? (m.avgLiquidity / m.marketCap) : 0;
    const volatilityPoints = m.volatility
        ? tierPoints([[m.volatility > 100, -30], [m.volatility > 70, -15], [m.volatility < 40, 15]])
        : 0;
    return 50
        + tierPoints([[m.marketCap > 50000000000, 20], [m.marketCap < 1000000000, -30]])
        + tierPoints([[vmc > 0.02 && vmc < 0.15, 15], [vmc > 0.5, -20], [vmc < 0.005, -30]])
        + tierPoints([[m.avgLiquidity > 1000000000, 10], [m.avgLiquidity < 50000000, -20]])
        + volatilityPoints;
};

export const cryptoStructuralScores = (asset) => {
    const m = asset.metrics;
    const isBlueChip = BLUE_CHIP_CRYPTO.includes(asset.ticker);
    return {
        quality: clamp(cryptoQuality(asset, m, isBlueChip)),
        valuation: clamp(cryptoValuation(asset, m, isBlueChip)),
        risk: clamp(cryptoRisk(m)),
        audit: baseAudit(),
    };
};
