/**
 * Regras do score por PERFIL de FII, em etapas puras.
 *
 * Cada etapa devolve os lançamentos `{ points, factor, type }` de um perfil na
 * mesma ordem em que o scorer monolítico os fazia; `scoreWithAudit` soma ao
 * perfil e grava a linha de auditoria. Comportamento idêntico ao de
 * `scoreFiiProfiles` antes da decomposição (guarda:
 * tests/fii_profile_characterization.spec.js).
 */
import { DEFAULT_NTNB_FALLBACK, FII_YIELD_TRAP_THRESHOLD } from '../../config/financialConstants.js';
import { firstTier, scoreWithAudit } from './stockProfileRules.js';

const pct = (n) => n.toFixed(1);

// ── DEFENSIVO ────────────────────────────────────────────────────────────────
// Base reduzida de 65→40: bônus progressivos evitam que FIIs medianos
// atinjam 100 trivialmente só por cumprir 3 critérios binários.

// Yield spread vs NTN-B: escala proporcional ao prêmio real entregue.
const defensiveYieldTier = (spread) => firstTier([
    [spread >= 5.0, 22, () => `Yield Excepcional (NTN-B +${pct(spread)}%)`, 'bonus'],
    [spread >= 3.0, 18, () => `Yield Alto (NTN-B +${pct(spread)}%)`, 'bonus'],
    [spread >= 1.5, 12, 'Yield > NTN-B + 1.5%', 'bonus'],
    [spread >= 0.5, 5, () => `Yield Moderado (NTN-B +${pct(spread)}%)`, 'bonus'],
    [spread < 0, -10, () => `Spread Negativo vs NTN-B (${pct(spread)}%)`, 'penalty'],
]);

// P/VP: bonifica zona próxima ao valor patrimonial; penaliza ágio excessivo.
const defensivePvpTier = (pvp, isPapel) => (isPapel
    ? firstTier([
        [pvp >= 0.95 && pvp <= 1.05, 15, 'P/VP Equilibrado (Papel)', 'bonus'],
        [pvp >= 0.88 && pvp < 0.95, 10, 'P/VP com Deságio Leve (Papel)', 'bonus'],
        [pvp > 1.05 && pvp <= 1.10, 5, 'P/VP com Ágio Leve (Papel)', 'bonus'],
        [pvp > 1.10, -5, 'P/VP com Ágio Elevado (Papel)', 'penalty'],
    ])
    : firstTier([
        [pvp >= 0.90 && pvp <= 1.05, 15, 'P/VP Saudável (Tijolo)', 'bonus'],
        [pvp >= 0.82 && pvp < 0.90, 10, 'P/VP com Deságio (Tijolo)', 'bonus'],
        [pvp > 1.05 && pvp <= 1.12, 5, 'P/VP com Ágio Moderado (Tijolo)', 'bonus'],
        [pvp > 1.12, -5, 'P/VP com Ágio Elevado (Tijolo)', 'penalty'],
    ]));

// Beta tiered — diferencia FIIs ultra-estáveis de apenas estáveis. Beta ausente
// chega como 0 — exigir > 0 evita bônus indevido sem série de preços. Tier 1 e
// liquidez (proxy de segurança patrimonial) completam o bloco de risco.
const defensiveRiskTiers = (m, isTier1) => [
    ...firstTier([
        [m.beta > 0 && m.beta < 0.40, 12, 'Beta Ultra Defensivo (<0.4)', 'bonus'],
        [m.beta > 0 && m.beta < 0.70, 7, 'Beta Defensivo (<0.7)', 'bonus'],
        [m.beta > 0.90, -15, 'Beta Elevado (>0.9)', 'penalty'],
    ]),
    ...(isTier1 ? [{ points: 8, factor: 'Fundo Tier 1 (Elite)', type: 'bonus' }] : []),
    ...firstTier([
        [m.avgLiquidity > 5000000, 6, 'Liquidez Alta (>5M)', 'bonus'],
        [m.avgLiquidity > 2000000, 3, 'Liquidez Boa (>2M)', 'bonus'],
    ]),
];

// Diversificação de imóveis (Tijolo) reduz risco de concentração. Distribuição
// CONSISTENTE ao longo do tempo (Fase 3 / achado B-A2) é o sinal mais relevante
// para um FII de renda em Buy & Hold: dormente até haver série de fundamentos.
const defensiveDurabilityTiers = (m, isPapel) => [
    ...(isPapel ? [] : firstTier([
        [m.qtdImoveis > 20, 6, 'Alta Diversificação (>20 imóveis)', 'bonus'],
        [m.qtdImoveis > 10, 3, 'Boa Diversificação (>10 imóveis)', 'bonus'],
    ])),
    ...firstTier([
        [m.trackRecord && m.trackRecord.dividendConsistency >= 0.8, 4,
            () => `Distribuição Consistente (${Math.round(m.trackRecord.dividendConsistency * 100)}% dos períodos)`, 'bonus'],
    ]),
];

const scoreDefensive = (m, f, isEligible, auditList) => {
    if (!isEligible) {
        return scoreWithAudit(0, auditList, [{ points: 25, factor: 'Ineligível para Carteira Defensiva FII', type: 'base' }]);
    }
    return scoreWithAudit(0, auditList, [
        { points: 40, factor: 'Score Base (FII Defensivo)', type: 'base' },
        ...defensiveYieldTier(f.yieldSpread),
        ...defensivePvpTier(m.pvp, f.isPapel),
        ...defensiveRiskTiers(m, f.isTier1),
        ...defensiveDurabilityTiers(m, f.isPapel),
    ]);
};

// ── MODERADO ─────────────────────────────────────────────────────────────────

const yieldTrapFactor = (dy) => `Yield Insustentável (${pct(dy)}% — provável amortização/evento não recorrente)`;

const moderateYieldTier = (m, f) => firstTier([
    [f.isYieldTrap, -15, () => yieldTrapFactor(m.dy), 'penalty'],
    [f.yieldSpread >= 5.0, 25, () => `Yield Excepcional (NTN-B +${pct(f.yieldSpread)}%)`, 'bonus'],
    [f.yieldSpread >= 3.0, 18, () => `Yield Alto (NTN-B +${pct(f.yieldSpread)}%)`, 'bonus'],
    [f.yieldSpread >= 1.5, 10, 'Yield > NTN-B + 1.5%', 'bonus'],
    [f.yieldSpread >= 0, 4, () => `Yield Positivo (NTN-B +${pct(f.yieldSpread)}%)`, 'bonus'],
    [true, -10, () => `Spread Negativo vs NTN-B (${pct(f.yieldSpread)}%)`, 'penalty'],
]);

const moderateDiscountTiers = (m, f) => (f.isPapel
    ? firstTier([
        [m.pvp < 0.90, 12, 'Deságio Expressivo em Papel (>10%)', 'bonus'],
        [m.pvp < 0.95, 7, 'Deságio em Papel (5–10%)', 'bonus'],
        [m.pvp < 1.00, 3, 'Deságio Leve em Papel', 'bonus'],
    ])
    : [
        ...firstTier([
            [m.capRate > (f.ntnb + 3), 10, 'Cap Rate Excelente (>NTN-B + 3%)', 'bonus'],
            [m.capRate > (f.ntnb + 1), 6, 'Cap Rate > NTN-B + 1%', 'bonus'],
            [m.capRate > f.ntnb, 3, 'Cap Rate > NTN-B', 'bonus'],
        ]),
        ...firstTier([
            [m.pvp < 0.80, 12, 'Deságio Expressivo em Tijolo (>20%)', 'bonus'],
            [m.pvp < 0.90, 7, 'Deságio em Tijolo (10–20%)', 'bonus'],
            [m.pvp < 0.95, 3, 'Deságio Leve em Tijolo', 'bonus'],
        ]),
    ]);

// Liquidez; e vacância, relevante para moderados que ainda aceitam algum risco.
const moderateRiskTiers = (m, isPapel) => [
    ...firstTier([
        [m.avgLiquidity > 5000000, 5, 'Liquidez Alta (>5M)', 'bonus'],
        [m.avgLiquidity > 2000000, 3, 'Liquidez Boa (>2M)', 'bonus'],
    ]),
    ...(isPapel ? [] : firstTier([
        [m.vacancy > 15, -8, () => `Vacância Alta (${pct(m.vacancy)}%)`, 'penalty'],
        [m.vacancy > 10, -4, () => `Vacância Moderada (${pct(m.vacancy)}%)`, 'penalty'],
    ])),
];

const scoreModerate = (m, f, auditList) => scoreWithAudit(0, auditList, [
    { points: 45, factor: 'Score Base (Perfil Moderado FII)', type: 'base' },
    ...moderateYieldTier(m, f),
    ...moderateDiscountTiers(m, f),
    ...moderateRiskTiers(m, f.isPapel),
]);

// ── ARROJADO ─────────────────────────────────────────────────────────────────

const boldYieldTier = (m, f) => firstTier([
    [f.isYieldTrap, -10, () => yieldTrapFactor(m.dy), 'penalty'],
    [f.yieldSpread >= 7.0, 35, () => `Yield Extremo (NTN-B +${pct(f.yieldSpread)}%)`, 'bonus'],
    [f.yieldSpread >= 5.0, 25, 'Yield Agressivo (>NTN-B + 5%)', 'bonus'],
    [f.yieldSpread >= 3.0, 15, () => `Yield Arrojado (NTN-B +${pct(f.yieldSpread)}%)`, 'bonus'],
    [f.yieldSpread >= 1.0, 7, () => `Yield Moderado (NTN-B +${pct(f.yieldSpread)}%)`, 'bonus'],
]);

// Deságio; e, no tijolo, cap rate agressivo (imóveis com alta rentabilidade operacional).
const boldDiscountTiers = (m, f) => (f.isPapel
    ? firstTier([
        [m.pvp < 0.85, 25, 'Deságio Acentuado em Papel (>15%)', 'bonus'],
        [m.pvp < 0.92, 15, 'Deságio Expressivo em Papel (8–15%)', 'bonus'],
        [m.pvp < 0.97, 8, 'Deságio em Papel (3–8%)', 'bonus'],
    ])
    : [
        ...firstTier([
            [m.pvp < 0.75, 25, 'Deságio Extremo em Tijolo (>25%)', 'bonus'],
            [m.pvp < 0.82, 18, 'Deságio Acentuado em Tijolo (18–25%)', 'bonus'],
            [m.pvp < 0.90, 10, 'Deságio em Tijolo (10–18%)', 'bonus'],
        ]),
        ...firstTier([
            [m.capRate > (f.ntnb + 5), 10, 'Cap Rate Excepcional (>NTN-B + 5%)', 'bonus'],
            [m.capRate > (f.ntnb + 3), 5, 'Cap Rate Alto (>NTN-B + 3%)', 'bonus'],
        ]),
    ]);

const scoreBold = (m, f, auditList) => scoreWithAudit(0, auditList, [
    { points: 35, factor: 'Base Arrojada FII', type: 'base' },
    ...boldYieldTier(m, f),
    ...boldDiscountTiers(m, f),
]);

/**
 * Score dos três perfis de um FII. `isPapel` vem do chamador (resolvePapel);
 * `isDefensiveEligible`, do gate isEligibleForDefensive.
 *
 * Anti yield-trap: DY 12m acima do teto é quase sempre amortização de capital /
 * RCA / evento não recorrente — não renda sustentável. Sem esta guarda, FIIs
 * estressados (ex.: DY 47%) ganhavam o bônus máximo de "Yield Extremo" e viravam
 * BUY. O DEFENSIVE já é protegido pelo gate dy>18 do isEligibleForDefensive.
 */
export const scoreFiiProfileRules = (asset, MACRO, isPapel, isDefensiveEligible, audit) => {
    const m = asset.metrics;
    const ntnb = MACRO.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
    const facts = {
        ntnb,
        isPapel,
        isTier1: asset.dbFlags?.isTier1 || false,
        yieldSpread: m.dy - ntnb,
        isYieldTrap: m.dy > FII_YIELD_TRAP_THRESHOLD,
    };
    return {
        defScore: scoreDefensive(m, facts, isDefensiveEligible, audit.DEFENSIVE),
        modScore: scoreModerate(m, facts, audit.MODERATE),
        boldScore: scoreBold(m, facts, audit.BOLD),
    };
};
