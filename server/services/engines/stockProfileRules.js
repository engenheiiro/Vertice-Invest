/**
 * Regras do score por PERFIL de ação (STOCK/STOCK_US), em etapas puras.
 *
 * Cada etapa devolve uma lista de lançamentos `{ profile, points, factor, type }`
 * na mesma ordem em que o scorer monolítico os fazia; `applyEntries` soma os
 * pontos ao perfil e grava a linha de auditoria. Os tetos (empresa sem lucro,
 * alavancagem crítica) dependem do score acumulado e por isso rodam por último,
 * sobre o placar já aplicado. Comportamento idêntico ao de `scoreStockProfiles`
 * antes da decomposição (guarda: tests/scoring_parity.spec.js).
 */
import {
    DEFAULT_SELIC_FALLBACK,
    CYCLICAL_PEAK_PL_FLOOR,
    CYCLICAL_PEAK_DEF_DISCOUNT,
    CYCLICAL_PEAK_MOD_DISCOUNT,
    CYCLICAL_TREND_MULTIPLIER,
    RATE_SENSITIVE_SELIC_HIGH,
    CYCLICAL_RATE_DEF_DISCOUNT,
    CYCLICAL_RATE_MOD_DISCOUNT,
    LEVERAGE_CRITICAL_MOD_DISCOUNT,
    LEVERAGE_CRITICAL_BOLD_DISCOUNT,
    LEVERAGE_ELEVATED_MOD_DISCOUNT,
    LEVERAGE_ELEVATED_BOLD_DISCOUNT,
    LEVERAGE_CRITICAL_BOLD_CAP,
    LEVERAGE_CRITICAL_MOD_CAP,
    GOVERNANCE_STATE_DEF_DISCOUNT,
    GOVERNANCE_STATE_MOD_DISCOUNT,
} from '../../config/financialConstants.js';
import { isCyclicalSector, isStateControlled } from '../../config/sectorTaxonomy.js';

const DEF = 'DEFENSIVE';
const MOD = 'MODERATE';
const BOLD = 'BOLD';

/**
 * Cascata if / else-if: a primeira faixa verdadeira vira um lançamento; nenhuma,
 * lista vazia. Faixa = `[condição, pontos, texto, tipo]`. O texto pode ser função
 * para só ser formatado quando a faixa casa (ex.: `toFixed` em campo que pode faltar).
 */
export const firstTier = (tiers) => {
    const hit = tiers.find(([when]) => when);
    if (!hit) return [];
    const [, points, factor, type] = hit;
    return [{ points, factor: typeof factor === 'function' ? factor() : factor, type }];
};

/** Soma os pontos de uma lista de lançamentos a `start`, gravando cada um em `auditList`. */
export const scoreWithAudit = (start, auditList, entries) => entries.reduce((score, { points, factor, type }) => {
    auditList.push({ factor, points, type });
    return score + points;
}, start);

/**
 * DL/EBITDA derivado: EV = valor de mercado + dívida líquida; EBITDA = EV ÷ (EV/EBITDA).
 * `null` quando não há EV/EBITDA positivo ou EV positivo (a razão não pode ser calculada).
 */
export const netDebtToEbitda = (m) => {
    const ev = (m.marketCap || 0) + (m.netDebt || 0);
    if (!(m.evEbitda > 0 && ev > 0)) return null;
    const ebitda = ev / m.evEbitda;
    return m.netDebt / ebitda;
};

const at = (profile, entries) => entries.map(e => ({ profile, ...e }));
const one = (profile, points, factor, type) => [{ profile, points, factor, type }];
const sameFactor = (factor, type, pointsByProfile) => Object.entries(pointsByProfile)
    .map(([profile, points]) => ({ profile, points, factor, type }));

// ── DEFENSIVO ────────────────────────────────────────────────────────────────
// Base reduzida 60→40: bônus progressivos diferenciam ações medianas de elite.

const defensiveSizeIncomeTiers = (m) => at(DEF, [
    ...firstTier([
        [m.marketCap > 10000000000, 10, 'Large Cap (>10B)', 'bonus'],
        [m.marketCap > 2000000000, 4, 'Mid Cap (>2B)', 'bonus'],
    ]),
    // DY tiers: escala proporcional ao prêmio real entregue
    ...firstTier([
        [m.dy >= 10.0, 22, 'Dividend Yield Excepcional (≥10%)', 'bonus'],
        [m.dy >= 8.0, 16, 'Dividend Yield Alto (≥8%)', 'bonus'],
        [m.dy >= 6.0, 10, 'Dividend Yield > 6%', 'bonus'],
        [m.dy >= 4.0, 5, 'Dividend Yield Moderado (≥4%)', 'bonus'],
    ]),
    ...firstTier([
        [m.roe >= 20, 15, 'ROE Excelente (≥20%)', 'bonus'],
        [m.roe >= 15, 10, 'ROE Robusto (≥15%)', 'bonus'],
        [m.roe >= 12, 5, 'ROE Saudável (≥12%)', 'bonus'],
    ]),
]);

// Upside com peso REDUZIDO no Defensivo (Fase 2 / achado A1): Graham/Bazin acham
// "caras" as compounders de alta qualidade; máximo +8 e o tier marginal (>10%) não pontua.
// Beta ausente chega como 0 — exigir > 0 evita bônus de "ultra defensivo" sem série de preços.
const defensiveValueRiskTiers = (m, upside) => {
    const stockVol = m.volatility || 20;
    return at(DEF, [
        ...firstTier([
            [upside >= 0.30, 8, 'Upside Forte (>30%)', 'bonus'],
            [upside >= 0.20, 5, 'Upside Moderado (>20%)', 'bonus'],
            [upside >= 0.15, 3, 'Upside Positivo (>15%)', 'bonus'],
        ]),
        ...firstTier([
            [m.pvp > 3.0, -10, 'P/VP Muito Esticado (>3.0)', 'penalty'],
            [m.pvp > 2.0, -5, 'P/VP Elevado (>2.0)', 'penalty'],
        ]),
        ...firstTier([
            [m.beta > 0 && m.beta < 0.70, 5, 'Beta Defensivo (<0.7)', 'bonus'],
            [m.beta >= 1.5, -15, 'Beta Muito Alto (≥1.5)', 'penalty'],
            [m.beta > 1.2, -8, 'Beta Alto (>1.2)', 'penalty'],
        ]),
        // Volatilidade anual: ativo defensivo não deve oscilar 30%+ ao ano
        ...firstTier([
            [stockVol > 40, -20, 'Volatilidade Muito Alta (>40%)', 'penalty'],
            [stockVol > 30, -10, 'Volatilidade Elevada (>30%)', 'penalty'],
        ]),
    ]);
};

// Payout acima de 100%: DY inflado por distribuição além do lucro — risco real de corte.
const defensivePayoutTier = (m) => {
    const known = !m._missing?.payout;
    return at(DEF, firstTier([
        [known && m.payout > 150, -30, () => `Payout Insustentável (${m.payout.toFixed(1)}%)`, 'penalty'],
        [known && m.payout > 100, -20, () => `Payout Acima do Lucro (${m.payout.toFixed(1)}%)`, 'penalty'],
        [known && m.payout >= 30 && m.payout <= 85, 5, () => `Payout Saudável (${m.payout.toFixed(1)}%)`, 'bonus'],
    ]));
};

// Alavancagem: dívida crítica não é defensiva, mesmo com bons dividendos.
const defensiveLeverageTier = (m, isFinancialForLeverage) => {
    if (isFinancialForLeverage) return [];
    const dlEbitda = netDebtToEbitda(m);
    if (dlEbitda === null) return [];
    return at(DEF, firstTier([
        [dlEbitda > 3.5, -15, () => `Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, 'penalty'],
        [dlEbitda > 2.5, -8, () => `Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, 'penalty'],
    ]));
};

// (Fase 3 / achado B-A2) Consistência / track record: dormente até a série de
// fundamentos acumular; premia CONTINUIDADE, não o instante atual.
const defensiveTrackRecord = (m) => {
    const tr = m.trackRecord;
    if (!tr) return [];
    const dividendEntry = m.dy > 0 && tr.dividendConsistency >= 0.8
        ? [{ points: 3, factor: `Pagador Consistente de Dividendos (${Math.round(tr.dividendConsistency * 100)}% dos períodos)`, type: 'bonus' }]
        : [];
    return at(DEF, [
        ...firstTier([
            [tr.roeConsistency >= 0.8, 4,
                () => `Rentabilidade Consistente (ROE sólido em ${Math.round(tr.roeConsistency * 100)}% dos períodos)`, 'bonus'],
            [tr.roeConsistency >= 0.6, 2, 'Rentabilidade Majoritariamente Consistente (track record)', 'bonus'],
        ]),
        ...dividendEntry,
    ]);
};

const defensiveEntries = (m, upside, isDefensiveEligible, flags) => {
    if (!isDefensiveEligible) return one(DEF, 30, 'Ineligível para Carteira Defensiva', 'base');
    return [
        ...one(DEF, 40, 'Score Base (Setor Defensivo)', 'base'),
        ...defensiveSizeIncomeTiers(m),
        ...defensiveValueRiskTiers(m, upside),
        ...defensivePayoutTier(m),
        ...defensiveLeverageTier(m, flags.financialDefensiveLeverage),
        ...defensiveTrackRecord(m),
    ];
};

// ── MODERADO ─────────────────────────────────────────────────────────────────
// Base reduzida 60→40. Bônus progressivos em crescimento, ROE e upside.

const moderateGrowthTiers = (m, growth, upside) => at(MOD, [
    ...firstTier([
        [growth > 30, 22, 'Crescimento Receita Excepcional (>30%)', 'bonus'],
        [growth > 20, 16, 'Crescimento Receita Alto (>20%)', 'bonus'],
        [growth > 10, 10, 'Crescimento Receita > 10%', 'bonus'],
        [growth > 5, 4, 'Crescimento Receita Moderado (>5%)', 'bonus'],
    ]),
    ...firstTier([
        [m.roe > 20, 15, 'ROE Excelente (>20%)', 'bonus'],
        [m.roe > 15, 10, 'ROE Robusto (>15%)', 'bonus'],
        [m.roe > 12, 7, 'ROE Saudável (>12%)', 'bonus'],
        [m.roe > 10, 3, 'ROE Positivo (>10%)', 'bonus'],
    ]),
    ...firstTier([
        [upside > 0.40, 20, 'Upside Agressivo (>40%)', 'bonus'],
        [upside > 0.30, 15, 'Upside Alto (>30%)', 'bonus'],
        [upside > 0.20, 10, 'Upside > 20%', 'bonus'],
        [upside > 0.10, 5, 'Upside Positivo (>10%)', 'bonus'],
    ]),
]);

// Bancos e holdings: margem contábil incomparável — não penalizar.
// ROE < Selic com buffer de 0.5% para evitar penalizar casos borderline.
const moderateProfitabilityPenalties = (m, MACRO, isFinancialSec) => {
    const hasAnomalousMargin = m.netMargin > 100 || (isFinancialSec && m.netMargin === 0);
    const marginEntry = !hasAnomalousMargin && !m._missing?.netMargin && m.netMargin < 5
        ? one(MOD, -15, 'Margem Líquida Baixa (<5%)', 'penalty')
        : [];
    const selic = MACRO.SELIC || DEFAULT_SELIC_FALLBACK;
    if (!(!isFinancialSec && !m._missing?.roe && m.roe > 0 && m.roe < (selic - 0.5))) return marginEntry;
    const roePenalty = m.roe < selic / 2 ? 20 : 10;
    return [
        ...marginEntry,
        ...one(MOD, -roePenalty, `ROE Abaixo da Selic (${m.roe.toFixed(1)}% < ${selic.toFixed(1)}%)`, 'penalty'),
    ];
};

// Payout > 100% (risco de sustentabilidade) e crescimento de receita SUSTENTADO (Fase 3).
const moderatePayoutAndTrack = (m) => [
    ...(!m._missing?.payout && m.payout > 100
        ? one(MOD, -10, `Payout Insustentável (${m.payout.toFixed(1)}%)`, 'penalty')
        : []),
    ...(m.trackRecord && m.trackRecord.revenuePositive >= 0.8
        ? one(MOD, 3, `Crescimento de Receita Sustentado (${Math.round(m.trackRecord.revenuePositive * 100)}% dos períodos)`, 'bonus')
        : []),
];

const moderateEntries = (m, growth, upside, MACRO, flags) => {
    if (!(m.marketCap > 2000000000)) return one(MOD, 25, 'Score Base (Small Cap)', 'base');
    return [
        ...one(MOD, 40, 'Score Base (Mid/Large Cap)', 'base'),
        ...moderateGrowthTiers(m, growth, upside),
        ...moderateProfitabilityPenalties(m, MACRO, flags.financialGrowth),
        ...moderatePayoutAndTrack(m),
    ];
};

// ── ARROJADO ─────────────────────────────────────────────────────────────────
// Base reduzida 50→35. PEG só com crescimento efetivo > 10% E PEG positivo: P/L
// ausente (0) ou negativo dava PEG <= 0 e caía no "Excelente" para empresa sem lucro.

const boldPegTier = (m, growth) => {
    const peg = growth > 0 ? m.pl / growth : 0;
    if (!(growth > 10 && peg > 0)) return [];
    return firstTier([
        [peg < 0.5, 30, 'PEG Excepcional (<0.5)', 'bonus'],
        [peg < 1.0, 22, 'PEG Excelente (<1.0)', 'bonus'],
        [peg < 1.5, 12, 'PEG Saudável (<1.5)', 'bonus'],
        [peg < 2.0, 5, 'PEG Razoável (<2.0)', 'bonus'],
    ]);
};

const boldEntries = (m, growth, upside) => {
    const volatility = m.volatility || 30;
    return at(BOLD, [
        { points: 35, factor: 'Base Arrojada', type: 'base' },
        ...boldPegTier(m, growth),
        // Revenue growth tiers (acumulativo ao PEG)
        ...firstTier([
            [growth > 40, 25, 'Hyper Growth Extremo (>40%)', 'bonus'],
            [growth > 25, 15, 'Hyper Growth (>25%)', 'bonus'],
            [growth > 15, 8, 'Crescimento Sólido (>15%)', 'bonus'],
        ]),
        ...firstTier([
            [upside > 0.80, 30, 'Upside Extremo (>80%)', 'bonus'],
            [upside > 0.50, 20, 'Upside Agressivo (>50%)', 'bonus'],
            [upside > 0.30, 10, 'Upside Relevante (>30%)', 'bonus'],
            [upside > 0.20, 5, 'Upside Moderado (>20%)', 'bonus'],
        ]),
        ...firstTier([
            [volatility > 60, -20, 'Volatilidade Extrema (>60%)', 'penalty'],
            [volatility > 45, -10, 'Volatilidade Alta (>45%)', 'penalty'],
        ]),
        // Payout > 100%: risco real independente do perfil de risco do investidor.
        ...(!m._missing?.payout && m.payout > 100
            ? [{ points: -20, factor: `Payout Insustentável (${m.payout.toFixed(1)}%)`, type: 'penalty' }]
            : []),
    ]);
};

// ── AJUSTES COMUNS A TODOS OS PERFIS ─────────────────────────────────────────

const hasMeaningfulFairPrice = (valuationData) => valuationData.grahamPrice > 0 || valuationData.bazinPrice > 0;

// Sobrevalorização: só quando há preço justo significativo e o preço passa dele em >10%.
const overvaluationPenalty = (upside, valuationData) => {
    if (!(hasMeaningfulFairPrice(valuationData) && upside < -0.10)) return [];
    const pct = (Math.abs(upside) * 100).toFixed(0);
    const severe = upside < -0.25;
    const boldModPenalty = severe ? 40 : 25;
    const defPenalty = severe ? 20 : 10;
    return sameFactor(`Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, 'penalty',
        { [BOLD]: -boldModPenalty, [MOD]: -boldModPenalty, [DEF]: -defPenalty });
};

// (Fase 2 / achado K) Growth caro SEM âncora de valor: o múltiplo absoluto extremo vira
// penalidade graduada, mutuamente exclusiva com a sobrevalorização acima.
const expensiveMultipleWithoutAnchor = (m, valuationData) => {
    if (!(!hasMeaningfulFairPrice(valuationData) && m.pl > 0 && !m._missing?.pl)) return [];
    const band = m.pl >= 80 ? { def: 20, mod: 15, bold: 8, label: '≥80' }
        : m.pl >= 50 ? { def: 10, mod: 8, bold: 4, label: '≥50' }
        : null;
    if (!band) return [];
    return sameFactor(`Múltiplo Caro sem Âncora de Valor (P/L ${band.label})`, 'penalty',
        { [DEF]: -band.def, [MOD]: -band.mod, [BOLD]: -band.bold });
};

// Tendência de baixa (SMA200): faca caindo não é barganha. Arrojado leva 0.7× do sinal
// base; numa cíclica o downtrend é amplificado só em Defensivo/Moderado. SMA200 ausente
// fica registrada como guarda de momentum inativa.
const downtrendPenalty = (asset, m, isCyclical) => {
    if (!(m.sma200 > 0 && asset.price > 0)) {
        return sameFactor('Tendência (SMA200) indisponível — guarda de momentum inativa', 'info', { [DEF]: 0, [MOD]: 0, [BOLD]: 0 });
    }
    const devSMA = (asset.price - m.sma200) / m.sma200;
    const basePenalty = devSMA < -0.25 ? 20 : devSMA < -0.15 ? 12 : devSMA < -0.08 ? 6 : 0;
    if (basePenalty === 0) return [];
    const boldTrend = Math.round(basePenalty * 0.7);
    const trendPenalty = isCyclical ? Math.round(basePenalty * CYCLICAL_TREND_MULTIPLIER) : basePenalty;
    const pctBelow = (Math.abs(devSMA) * 100).toFixed(0);
    return [
        ...sameFactor(`Tendência de Baixa (preço ${pctBelow}% abaixo da SMA200)`, 'penalty', { [DEF]: -trendPenalty, [MOD]: -trendPenalty }),
        ...one(BOLD, -boldTrend, `Tendência de Baixa (preço ${pctBelow}% abaixo da SMA200)`, 'penalty'),
    ];
};

// Setor cíclico: (a) pico de ciclo — P/L baixo + margem/ROE altos + preço em queda;
// (b) Selic alta contraindo capex. Poupa o Arrojado.
const cyclicalDiscounts = (asset, m, MACRO, isCyclical) => {
    if (!isCyclical) return [];
    const belowSMA = m.sma200 > 0 && asset.price > 0 && asset.price < m.sma200;
    const peakEarnings = m.pl > 0 && m.pl < CYCLICAL_PEAK_PL_FLOOR && (m.netMargin > 12 || m.roe > 18);
    const peak = peakEarnings && belowSMA
        ? sameFactor(`Pico de Ciclo (P/L ${m.pl.toFixed(1)} baixo + margem alta em queda)`, 'penalty',
            { [DEF]: -CYCLICAL_PEAK_DEF_DISCOUNT, [MOD]: -CYCLICAL_PEAK_MOD_DISCOUNT })
        : [];
    const selic = MACRO.SELIC || DEFAULT_SELIC_FALLBACK;
    if (!(selic >= RATE_SENSITIVE_SELIC_HIGH)) return peak;
    return [
        ...peak,
        ...sameFactor(`Setor Cíclico em Ciclo Desfavorável (Selic ${selic.toFixed(2)}%)`, 'penalty',
            { [DEF]: -CYCLICAL_RATE_DEF_DISCOUNT, [MOD]: -CYCLICAL_RATE_MOD_DISCOUNT }),
    ];
};

// Governança: estatal tem dividendo/alocação discricionários pelo controlador político.
const stateControlDiscount = (ticker) => (isStateControlled(ticker)
    ? sameFactor('Controle Estatal (dividendo/gestão discricionários)', 'penalty',
        { [DEF]: -GOVERNANCE_STATE_DEF_DISCOUNT, [MOD]: -GOVERNANCE_STATE_MOD_DISCOUNT })
    : []);

// Alavancagem em MODERATE/BOLD: risco de SOLVÊNCIA desconta até aposta especulativa
// (caso MTRE3). Financeiro fica de fora (dívida é insumo do negócio).
const leverageDiscount = (m, isFinancialForLeverage) => {
    const none = { entries: [], critical: false };
    if (isFinancialForLeverage) return none;
    const dlEbitda = netDebtToEbitda(m);
    if (dlEbitda === null) return none;
    if (dlEbitda > 3.5) {
        return {
            critical: true,
            entries: sameFactor(`Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, 'penalty',
                { [MOD]: -LEVERAGE_CRITICAL_MOD_DISCOUNT, [BOLD]: -LEVERAGE_CRITICAL_BOLD_DISCOUNT }),
        };
    }
    if (dlEbitda > 2.5) {
        return {
            critical: false,
            entries: sameFactor(`Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, 'penalty',
                { [MOD]: -LEVERAGE_ELEVATED_MOD_DISCOUNT, [BOLD]: -LEVERAGE_ELEVATED_BOLD_DISCOUNT }),
        };
    }
    return none;
};

// ── TETOS (dependem do placar acumulado) ─────────────────────────────────────

const applyEntries = (scores, audit, entries) => {
    for (const { profile, points, factor, type } of entries) {
        scores[profile] += points;
        audit[profile].push({ factor, points, type });
    }
};

const capAt = (scores, audit, profile, cap, factor) => {
    if (!(scores[profile] > cap)) return;
    audit[profile].push({ factor, points: cap - scores[profile], type: 'penalty' });
    scores[profile] = cap;
};

// Empresa sem lucro é APOSTA: segue elegível, mas com teto (biotechs sem margem, AURE3).
// Gatilho: margem ≤ 0 conhecida, P/L < 0 ou ROE < 0 conhecido.
const isUnprofitable = (m) => (!m._missing?.netMargin && m.netMargin <= 0)
    || m.pl < 0
    || (!m._missing?.roe && m.roe < 0);

const applyProfitAndSolvencyCaps = (asset, m, criticalLeverage, scores, audit) => {
    const isEquity = asset.type === 'STOCK_US' || asset.type === 'STOCK';
    if (isEquity && isUnprofitable(m)) {
        const factor = 'Teto Especulativo (empresa sem lucro)';
        capAt(scores, audit, BOLD, 82, factor);
        capAt(scores, audit, MOD, 72, factor);
        capAt(scores, audit, DEF, 55, factor);
    }
    // Risco de solvência limita a convicção MÁXIMA (MTRE3), só em MODERATE/BOLD.
    if (isEquity && criticalLeverage) {
        const factor = 'Teto por Alavancagem Crítica (DL/EBITDA > 3.5x)';
        capAt(scores, audit, BOLD, LEVERAGE_CRITICAL_BOLD_CAP, factor);
        capAt(scores, audit, MOD, LEVERAGE_CRITICAL_MOD_CAP, factor);
    }
};

/**
 * Scores brutos dos três perfis de uma ação, populando `audit`.
 * `flags`: recortes de setor financeiro já resolvidos pelo chamador
 * (`financialGrowth`, `financialDefensiveLeverage`, `financialLeverage`).
 */
export const scoreStockProfileRules = (asset, valuationData, MACRO, isDefensiveEligible, flags, audit) => {
    const m = asset.metrics;
    const upside = asset.price > 0 ? (valuationData.fairPrice / asset.price) - 1 : 0;
    // Financeiro pode ter crescimento de receita artificial (base-year/reestruturação): teto de 30%.
    const growth = (flags.financialGrowth && m.revenueGrowth > 30) ? 30 : m.revenueGrowth;
    const isCyclical = isCyclicalSector(asset.sector);
    const leverage = leverageDiscount(m, flags.financialLeverage);
    const scores = { [DEF]: 0, [MOD]: 0, [BOLD]: 0 };
    applyEntries(scores, audit, [
        ...defensiveEntries(m, upside, isDefensiveEligible, flags),
        ...moderateEntries(m, growth, upside, MACRO, flags),
        ...boldEntries(m, growth, upside),
        ...overvaluationPenalty(upside, valuationData),
        ...expensiveMultipleWithoutAnchor(m, valuationData),
        ...downtrendPenalty(asset, m, isCyclical),
        ...cyclicalDiscounts(asset, m, MACRO, isCyclical),
        ...stateControlDiscount(asset.ticker),
        ...leverage.entries,
    ]);
    applyProfitAndSolvencyCaps(asset, m, leverage.critical, scores, audit);
    return { defScore: scores[DEF], modScore: scores[MOD], boldScore: scores[BOLD] };
};
