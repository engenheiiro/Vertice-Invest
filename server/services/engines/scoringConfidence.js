// Confiança de dados do scorer legado e o teto graduado que ela impõe aos scores
// de perfil. Saiu do scoringEngine sem mudar número, texto nem ordem de auditoria.

// Exterior que NÃO é ação individual (ETF/REIT/Ouro): não tem fundamentos de empresa.
const isUsNonStock = (sub) => sub === 'ETF' || sub === 'REIT' || sub === 'GOLD';

// ETF/REIT/Ouro do Exterior não têm métricas de EMPRESA (ROE, margem, crescimento).
// Cobrá-las da confiança capava injustamente o score em 70/85. Trata como o FII:
// confiança só sobre dados aplicáveis (liquidez, recência).
// ETF nacional (type 'ETF') e CRYPTO também não têm fundamentos de empresa → mesmo
// tratamento (antes a cripto era cobrada por revenueGrowth/ROE inexistentes por
// natureza, e compensava com isenção total do teto — dois erros se anulando).
const hasNoCompanyMetrics = (type, usSubType) => (type === 'STOCK_US' && isUsNonStock(usSubType)) || type === 'ETF' || type === 'CRYPTO';

// Métricas de EMPRESA (crescimento de receita, ROE, margem líquida) só fazem sentido
// para ações. Em FIIs elas são estruturalmente inaplicáveis — não são "dados ausentes".
// Cobrá-las da confiança travava TODO bom FII em confidence 60 → maxScoreAllowed 85,
// comprimindo dezenas de FIIs no mesmo teto. Para FII a confiança vem de dados APLICÁVEIS
// (patrimônio/valor de mercado, liquidez, recência).
const penalizeMissingBaseData = (m, type, usSubType, penalize) => {
    const isFII = type === 'FII';
    if (!isFII && !hasNoCompanyMetrics(type, usSubType)) {
        // Usa _missing para distinguir dado ausente de dado genuinamente ruim
        if (m._missing?.revenueGrowth) penalize(25, 'Dados de Crescimento Ausentes');
        if (m._missing?.roe || m._missing?.netMargin) penalize(15, 'Dados de Rentabilidade Ausentes');
    } else if (isFII && m._missing?.marketCap) {
        // FII sem patrimônio/valor de mercado: dado-base ausente → confiança reduzida.
        penalize(15, 'Patrimônio/Valor de Mercado Ausente');
    }
};

// Penalidade de staleness: dados desatualizados reduzem a confiança da análise
const penalizeStaleness = (m, penalize) => {
    if (m._staleDays === null || m._staleDays === undefined) {
        // Data de atualização nunca registrada — penalidade leve
        penalize(5, 'Data de Atualização dos Fundamentais Desconhecida');
        return;
    }
    if (m._staleDays > 180) penalize(30, `Dados Fundamentais Desatualizados (${m._staleDays} dias)`);
    else if (m._staleDays > 90) penalize(15, `Dados Fundamentais Desatualizados (${m._staleDays} dias)`);
};

export const calculateConfidenceScore = (m, type, usSubType = null, ratesStale = false) => {
    let confidence = 100;
    const audit = [];
    const penalize = (points, factor) => {
        confidence -= points;
        audit.push({ factor, points: -points, type: 'penalty', category: 'Confiança' });
    };

    penalizeMissingBaseData(m, type, usSubType, penalize);
    if (m.avgLiquidity < 1000000) penalize(30, 'Liquidez Abaixo do Ideal (<1M/dia)');

    // (I) Macro defasado: quando a cadeia de taxas (BCB→BrasilAPI→IBGE) caiu e o sistema
    // opera com SELIC/NTN-B de fallback, os bônus dependentes de juros (spread de FII,
    // ROE-vs-Selic, earnings-yield) são calculados sobre uma taxa possivelmente incorreta.
    // Desconta confiança e avisa — só para BR (STOCK/FII), que usam essas taxas. É uniforme,
    // então preserva a ordenação dentro da classe; mexe apenas no limiar BUY/WAIT marginal.
    if (ratesStale && (type === 'STOCK' || type === 'FII')) penalize(10, 'Indicadores Macro Defasados (taxas em fallback)');

    penalizeStaleness(m, penalize);
    return { confidence, audit };
};

// Cap graduado: salto binário 59→70/60→100 substituído por escada para evitar que
// um dado a menos reduza o teto de 100 para 70 abruptamente. CRYPTO também é capada
// (a confiança dela já é calculada só sobre dados aplicáveis — liquidez/recência —,
// então a antiga isenção total deixou de ter razão de existir).
const maxScoreAllowedFor = (confidence) => {
    if (confidence >= 80) return 100;
    return confidence >= 60 ? 85 : 70;
};

/**
 * Clamp final por perfil (piso 10, teto pela confiança). Quando o TETO de confiança
 * de fato reduz o score, registra a dedução no audit do perfil correspondente para
 * que a Auditoria Completa reconcilie com o score exibido. O teto de 100 é a
 * normalização padrão e não é uma dedução de confiança — não vira fator de audit.
 */
export const clampProfileScores = ({ defScore, modScore, boldScore }, confidence, audit) => {
    const maxScoreAllowed = maxScoreAllowedFor(confidence);
    const clampProfile = (raw, profileKey) => {
        const floored = Math.max(10, raw);
        const capped = Math.min(maxScoreAllowed, floored);
        if (maxScoreAllowed < 100 && capped < floored) {
            audit[profileKey].push({
                factor: `Teto por Confiança de Dados (máx. ${maxScoreAllowed})`,
                points: capped - floored,
                type: 'penalty'
            });
        }
        return capped;
    };
    return {
        DEFENSIVE: clampProfile(defScore, 'DEFENSIVE'),
        MODERATE: clampProfile(modScore, 'MODERATE'),
        BOLD: clampProfile(boldScore, 'BOLD')
    };
};
