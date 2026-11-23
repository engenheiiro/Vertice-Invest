// (M1) Scoring por perfil de cripto. Saiu do scoringEngine sem mudar número, texto
// nem ordem de auditoria; cada etapa mexe nos três scores como a versão monolítica.

const CRYPTO_SPEC_CAP = 80;

// Bases recalibradas (jul/2026): as antigas 90/95 faziam 16/16 criptos cruzarem
// o BUY (≥70) com TRX empatando com BTC em 100 — sem diferenciação nenhuma.
// Agora a base deixa o ativo ABAIXO do threshold; só liquidez + volatilidade
// baixa + tendência (bônus reais) levam ao BUY. Small cap nasce abaixo de mid
// cap (o antigo 95 "assimetria" invertia a lógica de risco).
const applyCapTierBase = (tier, s, audit) => {
    if (tier.isBlueChip) {
        s.defScore = 75; audit.DEFENSIVE.push({ factor: 'Crypto Blue Chip', points: 75, type: 'base' });
    } else if (tier.isTop10) {
        s.modScore = 62; audit.MODERATE.push({ factor: 'Crypto Large Cap', points: 62, type: 'base' });
    } else if (tier.isMidCap) {
        s.boldScore = 55; audit.BOLD.push({ factor: 'Crypto Mid Cap', points: 55, type: 'base' });
    } else {
        s.boldScore = 50; audit.BOLD.push({ factor: 'Crypto Small Cap', points: 50, type: 'base' });
    }
};

const applyLiquidity = (m, s, audit) => {
    if (m.avgLiquidity < 50000000) {
        s.defScore -= 30; s.modScore -= 20; s.boldScore -= 10;
        audit.BOLD.push({ factor: 'Baixa Liquidez Crypto', points: -10, type: 'penalty' });
    } else if (m.avgLiquidity > 1000000000) {
        s.defScore += 10; s.modScore += 10;
        audit.MODERATE.push({ factor: 'Alta Liquidez Institucional', points: 10, type: 'bonus' });
    }
};

// ── (Fase 2 / achado E) VARIÂNCIA DE QUALIDADE NO SCORE QUE ORDENA ──────────
// Antes a cripto pontuava só por faixa de marketCap + liquidez: dezenas de ativos
// empatavam em 90 e cruzavam o BUY (≥70) sem diferenciação real. Volatilidade e
// desvio da SMA200 — já usados no score ESTRUTURAL — passam a ajustar também o
// score de PERFIL (que ordena). Bandas de volatilidade espelham o RISK estrutural
// de cripto (40/70/100) para consistência. Notas vão ao perfil primário da faixa.
const applyVolatility = (cVol, s, notes) => {
    if (!(cVol > 0)) return;
    if (cVol < 40) {
        s.defScore += 6; s.modScore += 6; s.boldScore += 6;
        notes.push({ factor: 'Volatilidade Baixa (<40%)', points: 6, type: 'bonus' });
    } else if (cVol > 100) {
        s.defScore -= 12; s.modScore -= 10; s.boldScore -= 8;
        notes.push({ factor: 'Volatilidade Extrema (>100%)', points: -8, type: 'penalty' });
    } else if (cVol > 70) {
        s.defScore -= 6; s.modScore -= 5; s.boldScore -= 4;
        notes.push({ factor: 'Volatilidade Elevada (>70%)', points: -4, type: 'penalty' });
    }
};

const applyTrend = (m, price, s, notes) => {
    if (!(m.sma200 > 0 && price > 0)) return;
    const devSma = (price - m.sma200) / m.sma200;
    if (devSma >= 0) {
        s.defScore += 4; s.modScore += 4; s.boldScore += 4;
        notes.push({ factor: 'Acima da Tendência (Preço ≥ SMA200)', points: 4, type: 'bonus' });
    } else if (devSma < -0.30) {
        s.defScore -= 8; s.modScore -= 6; s.boldScore -= 5;
        notes.push({ factor: 'Forte Queda (Preço >30% abaixo da SMA200)', points: -5, type: 'penalty' });
    } else if (devSma < -0.10) {
        s.defScore -= 4; s.modScore -= 3; s.boldScore -= 2;
        notes.push({ factor: 'Abaixo da Tendência (Preço < SMA200)', points: -2, type: 'penalty' });
    }
};

// ── (Fase 2 / achado E2) TRAVA BRANDA NO BOLD DE SMALL CAP ──────────────────
// Uma small cap (não blue chip / não top-10 / não mid) de baixa liquidez OU
// volatilidade extrema é APOSTA, não convicção: limita o BOLD a 80 — ainda
// elegível a COMPRAR, sem cravar nota máxima. Análogo ao teto especulativo de
// ação sem lucro (SPEC_BOLD_CAP). Com a base recalibrada para 50 raramente
// dispara, mas segue como cinto de segurança contra stacking de bônus.
const applySmallCapCap = (tier, m, cVol, s, audit) => {
    const isSmallCap = !tier.isBlueChip && !tier.isTop10 && !tier.isMidCap;
    if (!(isSmallCap && (m.avgLiquidity < 50000000 || cVol > 100))) return;
    if (s.boldScore > CRYPTO_SPEC_CAP) {
        audit.BOLD.push({ factor: 'Teto Especulativo Cripto (small cap arriscada)', points: CRYPTO_SPEC_CAP - s.boldScore, type: 'penalty' });
        s.boldScore = CRYPTO_SPEC_CAP;
    }
};

export const scoreCryptoProfiles = (asset, audit) => {
    const m = asset.metrics;
    const s = { defScore: 0, modScore: 0, boldScore: 0 };
    const tier = {
        isBlueChip: ['BTC', 'ETH'].includes(asset.ticker),
        isTop10: m.marketCap > 20000000000,
        isMidCap: m.marketCap > 2000000000 && m.marketCap <= 20000000000,
    };
    // Perfil "primário" da faixa (recebe a base 90/95) — destino das notas de variância.
    const primary = tier.isBlueChip ? 'DEFENSIVE' : tier.isTop10 ? 'MODERATE' : 'BOLD';
    const cVol = m.volatility || 0;

    applyCapTierBase(tier, s, audit);
    applyLiquidity(m, s, audit);
    applyVolatility(cVol, s, audit[primary]);
    applyTrend(m, asset.price, s, audit[primary]);
    applySmallCapCap(tier, m, cVol, s, audit);
    return { defScore: s.defScore, modScore: s.modScore, boldScore: s.boldScore };
};
