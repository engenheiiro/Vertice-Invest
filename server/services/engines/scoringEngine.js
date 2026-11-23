import {
    classifyStockArchetype,
    getScoringNotApplicableMetrics,
    isFinancialArchetype,
    isStructuralQualityMetricApplicable,
    resolveRoeReading,
} from '../../config/stockCalibration.js';
import { asObservedNumber } from '../../utils/metricObservation.js';
import { scoreCryptoProfiles } from './cryptoProfileRules.js';
import { isEligibleForDefensive } from './defensiveGate.js';
import { scoreFiiProfileRules } from './fiiProfileRules.js';
import { calculateConfidenceScore, clampProfileScores } from './scoringConfidence.js';
import { generateDynamicTheses } from './scoringTheses.js';
import { calculateIntrinsicValue } from './scoringValuation.js';
import { isFinancialSector, resolvePapel } from './sectorRules.js';
import { scoreStockProfileRules } from './stockProfileRules.js';
import {
    cryptoStructuralScores,
    emptyStructuralScores,
    fiiStructuralScores,
    stockStructuralScores,
    themedStructuralScores,
} from './structuralScoreRules.js';

// Sub-tipo efetivo de um ativo do Exterior (STOCK_US). Fora do Exterior → null.
// Ausente cai em STOCK (mesmo balde padrão da classificação).
const usSubOf = (asset) => (asset && asset.type === 'STOCK_US') ? (asset.usSubType || 'STOCK') : null;

// Tema efetivo de um ETF NACIONAL (classe própria, type 'ETF'), derivado do `sector`
// curado em brEtfList.js. Cripto (HASH11/BITH11/…), Ouro (GOLD11) e Renda Fixa (FIXA11)
// NÃO são cestas de ações e ganham scorers próprios; qualquer outro tema (índice amplo,
// setorial, exterior) cai no modelo genérico de cesta diversificada.
const brEtfThemeOf = (asset) => {
    if (!asset || asset.type !== 'ETF') return null;
    const s = (asset.sector || '').toLowerCase();
    if (s.includes('cripto') || s.includes('crypto')) return 'CRYPTO';
    if (s.includes('ouro') || s.includes('gold')) return 'GOLD';
    if (s.includes('renda fixa')) return 'FIXED_INCOME';
    return null;
};


// --- NOVO: IDENTIFICADOR DE DIVIDEND ARISTOCRAT ---
const isDividendAristocrat = (m, type) => {
    if (type !== 'STOCK') return false;
    // Critérios Proxy: Crescimento de Receita + ROE Alto + Yield Decente + Payout Saudável
    return (m.revenueGrowth > 5 && m.roe > 12 && m.dy > 4.0 && m.netMargin > 8 && m.payout > 20 && m.payout < 90);
};


// (M1) Scoring por perfil de ação (STOCK/STOCK_US). Retorna os três scores brutos
// e popula `audit`. As regras moram em etapas puras (stockProfileRules.js); aqui só
// se resolvem o gate Defensivo e os três recortes de setor financeiro, que divergem
// de propósito (cada regra reproduz as palavras-chave que sempre usou).
const scoreStockProfiles = (asset, valuationData, context, audit) => {
    const { MACRO } = context;
    const flags = {
        financialGrowth: isFinancialSector(asset.sector, ['Holding', 'Financials', 'Financial']),
        financialDefensiveLeverage: isFinancialSector(asset.sector, ['Financials', 'Financial']),
        financialLeverage: isFinancialSector(asset.sector, ['Financial', 'Insurance', 'Holding']),
    };
    return scoreStockProfileRules(asset, valuationData, MACRO, isEligibleForDefensive(asset, context), flags, audit);
};

// (M1) Scoring por perfil de FII: regras em fiiProfileRules.js.
const scoreFiiProfiles = (asset, context, audit) => scoreFiiProfileRules(
    asset, context.MACRO, resolvePapel(asset.fiiSubType, asset.sector), isEligibleForDefensive(asset, context), audit,
);


// Exterior — ETF (cesta de índice/setorial). Sem fundamentos de empresa: pontua por
// liquidez/AUM, yield, tendência de longo prazo e volatilidade. Diversificação
// inerente da cesta favorece o perfil defensivo.
const scoreEtfProfiles = (asset, audit) => {
    const m = asset.metrics;
    const price = asset.price;
    const aboveTrend = m.sma200 > 0 && price > m.sma200;
    let defScore = 45, modScore = 50, boldScore = 45;
    audit.DEFENSIVE.push({ factor: 'Base ETF (cesta diversificada)', points: 45, type: 'base' });
    audit.MODERATE.push({ factor: 'Base ETF', points: 50, type: 'base' });
    audit.BOLD.push({ factor: 'Base ETF', points: 45, type: 'base' });

    if (m.avgLiquidity > 50000000) { defScore += 12; modScore += 10; boldScore += 6; audit.DEFENSIVE.push({ factor: 'Liquidez/AUM Alta (>50M)', points: 12, type: 'bonus' }); }
    else if (m.avgLiquidity > 5000000) { defScore += 6; modScore += 5; audit.DEFENSIVE.push({ factor: 'Liquidez Boa (>5M)', points: 6, type: 'bonus' }); }
    // avgLiquidity=0 em ETF-BR é tipicamente falha de fonte (Yahoo .SA), não baixa liquidez real.
    // Só penaliza quando o dado está PRESENTE (>0) e baixo; ausente (0) não desconta.
    else if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) { defScore -= 10; modScore -= 8; boldScore -= 6; audit.DEFENSIVE.push({ factor: 'Liquidez Baixa (<1M)', points: -10, type: 'penalty' }); }
    else if (m.avgLiquidity === 0) { audit.DEFENSIVE.push({ factor: 'Liquidez/AUM não reportada pela fonte (sem penalidade)', points: 0, type: 'info' }); }

    if (m.dy >= 3) { defScore += 12; modScore += 8; audit.DEFENSIVE.push({ factor: `ETF de Renda (DY ${m.dy.toFixed(1)}%)`, points: 12, type: 'bonus' }); }
    else if (m.dy >= 1.5) { defScore += 6; modScore += 4; audit.DEFENSIVE.push({ factor: `Yield Moderado (${m.dy.toFixed(1)}%)`, points: 6, type: 'bonus' }); }
    // dy=0 em ETF quase nunca significa "cesta sem renda": significa veículo de
    // ACUMULAÇÃO, que reinveste os proventos e devolve o mesmo retorno pela cota — é
    // a política do wrapper, não uma qualidade do ativo. Todo ETF da B3 hoje é assim
    // (ver config/brEtfList.js). Sem penalidade, mas a auditoria precisa DIZER isso:
    // sem esta linha o usuário vê o par de ETFs do mesmo índice separado por 12 pontos
    // e nada no relatório explica de onde veio a diferença.
    else if (!(m.dy > 0)) { audit.DEFENSIVE.push({ factor: 'ETF de acumulação: renda reinvestida na cota (yield não se aplica, sem penalidade)', points: 0, type: 'info' }); }

    if (aboveTrend) { defScore += 4; modScore += 10; boldScore += 12; audit.MODERATE.push({ factor: 'Tendência de Alta (Preço > SMA200)', points: 10, type: 'bonus' }); }
    else if (m.sma200 > 0) { modScore -= 6; boldScore -= 8; audit.MODERATE.push({ factor: 'Tendência de Baixa (Preço < SMA200)', points: -6, type: 'penalty' }); }

    if (m.volatility > 0) {
        if (m.volatility < 18) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Volatilidade Baixa (<18%)', points: 10, type: 'bonus' }); }
        else if (m.volatility > 35) { defScore -= 12; boldScore += 6; audit.DEFENSIVE.push({ factor: 'Volatilidade Alta (>35%)', points: -12, type: 'penalty' }); }
    }
    return { defScore, modScore, boldScore };
};

// Exterior — REIT (fundo imobiliário US). Veículo de renda: pontua por dividend yield,
// alavancagem, liquidez e tendência. Espelha a lógica do FII (yield + risco), sem
// exigir métricas de empresa.
const scoreReitProfiles = (asset, audit) => {
    const m = asset.metrics;
    const price = asset.price;
    const aboveTrend = m.sma200 > 0 && price > m.sma200;
    let defScore = 40, modScore = 45, boldScore = 40;
    audit.DEFENSIVE.push({ factor: 'Base REIT', points: 40, type: 'base' });
    audit.MODERATE.push({ factor: 'Base REIT', points: 45, type: 'base' });
    audit.BOLD.push({ factor: 'Base REIT', points: 40, type: 'base' });

    // Faixa de yield: o yield US é estruturalmente menor que o BR — um REIT sólido de
    // ~4% (vs 3,5% e 5%) merece reconhecimento intermediário (+18) em vez de cair no +15.
    if (m.dy >= 5) { defScore += 22; modScore += 22; boldScore += 18; audit.DEFENSIVE.push({ factor: `Yield Alto (${m.dy.toFixed(1)}%)`, points: 22, type: 'bonus' }); }
    else if (m.dy >= 4) { defScore += 18; modScore += 18; boldScore += 14; audit.DEFENSIVE.push({ factor: `Yield Forte (${m.dy.toFixed(1)}%)`, points: 18, type: 'bonus' }); }
    else if (m.dy >= 3.5) { defScore += 15; modScore += 15; boldScore += 10; audit.DEFENSIVE.push({ factor: `Yield Saudável (${m.dy.toFixed(1)}%)`, points: 15, type: 'bonus' }); }
    else if (m.dy >= 2) { defScore += 8; modScore += 8; audit.DEFENSIVE.push({ factor: `Yield Moderado (${m.dy.toFixed(1)}%)`, points: 8, type: 'bonus' }); }
    else { defScore -= 5; audit.DEFENSIVE.push({ factor: 'Yield Baixo para REIT', points: -5, type: 'penalty' }); }

    if (m.debtToEquity > 0) {
        if (m.debtToEquity > 2.0) { defScore -= 12; modScore -= 8; audit.DEFENSIVE.push({ factor: 'Alavancagem Alta (D/E > 2)', points: -12, type: 'penalty' }); }
        else if (m.debtToEquity < 1.0) { defScore += 6; audit.DEFENSIVE.push({ factor: 'Alavancagem Conservadora (D/E < 1)', points: 6, type: 'bonus' }); }
    }

    // Blue-chip REIT: liquidez profunda (>200M/dia) + alavancagem sob controle (D/E ≤ 1,5).
    if (m.avgLiquidity > 200000000 && m.debtToEquity > 0 && m.debtToEquity <= 1.5) {
        defScore += 4; modScore += 4; audit.DEFENSIVE.push({ factor: 'REIT Blue-chip (liquidez + alavancagem sob controle)', points: 4, type: 'bonus' });
    }

    if (m.avgLiquidity > 20000000) { defScore += 8; modScore += 6; audit.DEFENSIVE.push({ factor: 'Liquidez Alta (>20M)', points: 8, type: 'bonus' }); }
    else if (m.avgLiquidity < 1000000) { defScore -= 10; modScore -= 8; audit.DEFENSIVE.push({ factor: 'Liquidez Baixa (<1M)', points: -10, type: 'penalty' }); }

    if (aboveTrend) { modScore += 8; boldScore += 12; audit.MODERATE.push({ factor: 'Tendência de Alta (Preço > SMA200)', points: 8, type: 'bonus' }); }
    else if (m.sma200 > 0) { modScore -= 6; boldScore -= 6; audit.MODERATE.push({ factor: 'Tendência de Baixa (Preço < SMA200)', points: -6, type: 'penalty' }); }
    return { defScore, modScore, boldScore };
};

// Exterior — Ouro (ETF de ouro). Hedge / reserva de valor: estável, sem yield.
// Defensivo moderado-alto (proteção); arrojado baixo (sem prêmio de risco/crescimento).
// Momentum (preço vs SMA200) e liquidez do veículo ajustam os perfis de risco.
const scoreCommodityProfiles = (asset, audit) => {
    const m = asset.metrics;
    const price = asset.price;
    const aboveTrend = m.sma200 > 0 && price > m.sma200;
    let defScore = 60, modScore = 55, boldScore = 40;
    audit.DEFENSIVE.push({ factor: 'Ouro: hedge / reserva de valor', points: 60, type: 'base' });
    audit.MODERATE.push({ factor: 'Ouro: proteção de portfólio', points: 55, type: 'base' });
    audit.BOLD.push({ factor: 'Ouro: baixo prêmio de risco', points: 40, type: 'base' });

    if (aboveTrend) { defScore += 8; modScore += 12; boldScore += 12; audit.MODERATE.push({ factor: 'Momentum Positivo (Preço > SMA200)', points: 12, type: 'bonus' }); }
    else if (m.sma200 > 0) { modScore -= 6; boldScore -= 8; audit.MODERATE.push({ factor: 'Momentum Negativo (Preço < SMA200)', points: -6, type: 'penalty' }); }

    if (m.avgLiquidity > 20000000) { defScore += 6; modScore += 4; audit.DEFENSIVE.push({ factor: 'Liquidez Alta (>20M)', points: 6, type: 'bonus' }); }
    else if (m.avgLiquidity < 1000000) { defScore -= 10; modScore -= 8; boldScore -= 6; audit.DEFENSIVE.push({ factor: 'Liquidez Baixa (<1M)', points: -10, type: 'penalty' }); }

    if (m.volatility > 0 && m.volatility < 20) { defScore += 6; audit.DEFENSIVE.push({ factor: 'Volatilidade Controlada (<20%)', points: 6, type: 'bonus' }); }
    return { defScore, modScore, boldScore };
};

// ETF nacional de CRIPTO (HASH11/BITH11/…): veículo de tema único e alta volatilidade,
// sem yield e sem a diversificação de uma cesta de índice. Frame de risco de cripto
// (defensivo baixo, arrojado moderado) + teto especulativo no BOLD. NÃO reaproveita
// scoreCryptoProfiles — cujos limiares de marketCap/liquidez são em escala de MOEDA (USD)
// e disparariam errado sobre um ETF cotado em BRL, com marketCap do FUNDO ≈ 0.
const scoreCryptoEtfProfiles = (asset, audit) => {
    const m = asset.metrics;
    const price = asset.price;
    const aboveTrend = m.sma200 > 0 && price > m.sma200;
    let defScore = 25, modScore = 40, boldScore = 55;
    audit.DEFENSIVE.push({ factor: 'Base ETF Cripto (tema único, sem renda)', points: 25, type: 'base' });
    audit.MODERATE.push({ factor: 'Base ETF Cripto', points: 40, type: 'base' });
    audit.BOLD.push({ factor: 'Base ETF Cripto (exposição à classe)', points: 55, type: 'base' });

    // Momentum (preço vs SMA200): principal driver em cripto.
    if (aboveTrend) { defScore += 4; modScore += 10; boldScore += 14; audit.BOLD.push({ factor: 'Tendência de Alta (Preço > SMA200)', points: 14, type: 'bonus' }); }
    else if (m.sma200 > 0) { modScore -= 8; boldScore -= 10; audit.BOLD.push({ factor: 'Tendência de Baixa (Preço < SMA200)', points: -10, type: 'penalty' }); }

    // Volatilidade em escala de cripto (candles ~50–90%).
    if (m.volatility > 0) {
        if (m.volatility < 40) { defScore += 6; modScore += 6; boldScore += 4; audit.DEFENSIVE.push({ factor: 'Volatilidade Baixa p/ Cripto (<40%)', points: 6, type: 'bonus' }); }
        else if (m.volatility > 100) { defScore -= 12; modScore -= 10; boldScore -= 8; audit.BOLD.push({ factor: 'Volatilidade Extrema (>100%)', points: -8, type: 'penalty' }); }
        else if (m.volatility > 70) { defScore -= 6; modScore -= 5; boldScore -= 4; audit.BOLD.push({ factor: 'Volatilidade Elevada (>70%)', points: -4, type: 'penalty' }); }
    }

    // Liquidez do VEÍCULO em BRL (escala de ETF, não de moeda). avgLiquidity=0 = fonte
    // não reportou (tickers .SA) → sem penalidade; só desconta quando presente e baixo.
    if (m.avgLiquidity > 20000000) { modScore += 6; boldScore += 4; audit.MODERATE.push({ factor: 'Liquidez Alta (>20M)', points: 6, type: 'bonus' }); }
    else if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) { defScore -= 10; modScore -= 8; boldScore -= 6; audit.MODERATE.push({ factor: 'Liquidez Baixa (<1M)', points: -8, type: 'penalty' }); }

    // Teto especulativo no BOLD: cripto é aposta, não convicção máxima (análogo ao
    // CRYPTO_SPEC_CAP de scoreCryptoProfiles). Cinto de segurança contra stacking de bônus.
    const CRYPTO_ETF_BOLD_CAP = 80;
    if (boldScore > CRYPTO_ETF_BOLD_CAP) {
        audit.BOLD.push({ factor: 'Teto Especulativo Cripto (ETF de tema único)', points: CRYPTO_ETF_BOLD_CAP - boldScore, type: 'penalty' });
        boldScore = CRYPTO_ETF_BOLD_CAP;
    }
    return { defScore, modScore, boldScore };
};

// ETF nacional de RENDA FIXA (FIXA11/…): baixo risco, retorno modesto. Defensivo por
// natureza; arrojado baixo (sem prêmio de crescimento). Sensível a juros — preço acima
// da SMA200 sinaliza ambiente de juros em queda (favorável a prefixado).
const scoreFixedIncomeEtfProfiles = (asset, audit) => {
    const m = asset.metrics;
    const price = asset.price;
    const aboveTrend = m.sma200 > 0 && price > m.sma200;
    let defScore = 52, modScore = 45, boldScore = 30;
    audit.DEFENSIVE.push({ factor: 'Base ETF Renda Fixa (baixo risco)', points: 52, type: 'base' });
    audit.MODERATE.push({ factor: 'Base ETF Renda Fixa', points: 45, type: 'base' });
    audit.BOLD.push({ factor: 'Base ETF Renda Fixa (sem prêmio de crescimento)', points: 30, type: 'base' });

    // Renda distribuída (quando houver — muitos ETFs de RF são de acumulação, dy=0).
    if (m.dy >= 8) { defScore += 12; modScore += 8; audit.DEFENSIVE.push({ factor: `Renda Alta (DY ${m.dy.toFixed(1)}%)`, points: 12, type: 'bonus' }); }
    else if (m.dy >= 4) { defScore += 6; modScore += 4; audit.DEFENSIVE.push({ factor: `Renda Moderada (DY ${m.dy.toFixed(1)}%)`, points: 6, type: 'bonus' }); }

    // Estabilidade: baixa volatilidade é a própria tese do ativo.
    if (m.volatility > 0) {
        if (m.volatility < 12) { defScore += 10; modScore += 4; audit.DEFENSIVE.push({ factor: 'Volatilidade Baixa (<12%)', points: 10, type: 'bonus' }); }
        else if (m.volatility > 25) { defScore -= 8; audit.DEFENSIVE.push({ factor: 'Volatilidade Alta p/ Renda Fixa (>25%)', points: -8, type: 'penalty' }); }
    }

    // Sensibilidade a juros: preço acima da SMA200 = juros em queda (favorável).
    if (aboveTrend) { defScore += 4; modScore += 8; boldScore += 8; audit.MODERATE.push({ factor: 'Tendência de Alta (juros em queda)', points: 8, type: 'bonus' }); }
    else if (m.sma200 > 0) { modScore -= 4; boldScore -= 4; audit.MODERATE.push({ factor: 'Tendência de Baixa (juros em alta)', points: -4, type: 'penalty' }); }

    // Liquidez do veículo (avgLiquidity=0 = fonte não reportou → sem penalidade).
    if (m.avgLiquidity > 5000000) { defScore += 4; audit.DEFENSIVE.push({ factor: 'Liquidez Boa (>5M)', points: 4, type: 'bonus' }); }
    else if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) { defScore -= 8; modScore -= 6; audit.DEFENSIVE.push({ factor: 'Liquidez Baixa (<1M)', points: -8, type: 'penalty' }); }
    return { defScore, modScore, boldScore };
};

// Scorer de perfil por classe. Ação individual (STOCK ou Exterior sub-tipo STOCK)
// usa o caminho de ação; ETF nacional temático (Cripto/Ouro/Renda Fixa) tem scorer
// próprio e os demais temas caem na cesta; sub-tipo do Exterior desconhecido não pontua.
const PROFILE_SCORERS = {
    STOCK: (asset, valuationData, context, audit) => scoreStockProfiles(asset, valuationData, context, audit),
    COMMODITY: (asset, _valuationData, _context, audit) => scoreCommodityProfiles(asset, audit),
    CRYPTO_ETF: (asset, _valuationData, _context, audit) => scoreCryptoEtfProfiles(asset, audit),
    FIXED_INCOME_ETF: (asset, _valuationData, _context, audit) => scoreFixedIncomeEtfProfiles(asset, audit),
    ETF: (asset, _valuationData, _context, audit) => scoreEtfProfiles(asset, audit),
    REIT: (asset, _valuationData, _context, audit) => scoreReitProfiles(asset, audit),
    FII: (asset, _valuationData, context, audit) => scoreFiiProfiles(asset, context, audit),
    CRYPTO: (asset, _valuationData, _context, audit) => scoreCryptoProfiles(asset, audit),
};
const BR_ETF_SCORER = { GOLD: 'COMMODITY', CRYPTO: 'CRYPTO_ETF', FIXED_INCOME: 'FIXED_INCOME_ETF' };
const US_SCORER = { ETF: 'ETF', REIT: 'REIT', GOLD: 'COMMODITY' };

const profileScorerKeyOf = (asset, isPlainStock, usSub) => {
    if (isPlainStock) return 'STOCK';
    if (asset.type === 'ETF') return BR_ETF_SCORER[brEtfThemeOf(asset)] || 'ETF';
    if (asset.type === 'STOCK_US') return US_SCORER[usSub];
    return asset.type;
};

// Aplica penalidades de confiança diretamente nos scores de perfil (apenas ação
// individual) para que o audit log "Dados e Confiança" reflita deduções reais.
// FIIs/ETF/REIT/Ouro: a confiança já é calculada só sobre dados aplicáveis; o teto
// graduado basta — não se subtrai duas vezes. CRYPTO usa suas próprias penalidades.
const applyConfidencePenalty = (s, confidence) => {
    if (confidence >= 100) return;
    const confPenalty = 100 - confidence;
    s.defScore -= confPenalty;
    s.modScore -= confPenalty;
    s.boldScore -= confPenalty;
};

// Dividend Aristocrat bonus aplicado ANTES do clamp de confiança (maxScoreAllowed).
// Aplicar depois do clamp violaria o teto de 70 para ativos com dados incompletos,
// podendo gerar sinal BUY indevido em ativos que deveriam ficar em WAIT.
const applyAristocratBonus = (s, audit) => {
    s.defScore += 10;
    s.modScore += 5;
    audit.DEFENSIVE.push({ factor: 'Dividend Aristocrat Bonus', points: 10, type: 'bonus' });
    audit.MODERATE.push({ factor: 'Dividend Aristocrat Bonus', points: 5, type: 'bonus' });
};

// Bônus de qualidade US (escopado a ações STOCK_US; NÃO afeta o BR `STOCK`).
// O "Dividend Aristocrat" só vale p/ STOCK BR; nomes defensivos US de qualidade
// (bom yield + rentabilidade + margem) ficavam presos em 58–67 sem reconhecimento.
const applyUsQualityBonus = (m, s, audit) => {
    if (!(m.dy > 3 && m.roe > 12 && m.netMargin > 10)) return;
    s.defScore += 8;
    s.modScore += 4;
    audit.DEFENSIVE.push({ factor: 'Qualidade US (yield + ROE + margem)', points: 8, type: 'bonus' });
    audit.MODERATE.push({ factor: 'Qualidade US', points: 4, type: 'bonus' });
};

// (M1) Orquestrador: confiança, dispatch por tipo (helpers acima) e clamp final.
const calculateProfileScores = (asset, valuationData, context) => {
    const m = asset.metrics;
    const type = asset.type;
    const usSub = usSubOf(asset);
    const isPlainStock = type === 'STOCK' || (type === 'STOCK_US' && (!usSub || usSub === 'STOCK'));

    const audit = { DEFENSIVE: [], MODERATE: [], BOLD: [], CONFIDENCE: [] };
    const ratesStale = !!context?.MACRO?.RATES_STALE;
    const { confidence, audit: confAudit } = calculateConfidenceScore(m, type, asset.usSubType, ratesStale);
    audit.CONFIDENCE = confAudit;

    const scorer = PROFILE_SCORERS[profileScorerKeyOf(asset, isPlainStock, usSub)];
    const s = scorer ? scorer(asset, valuationData, context, audit) : { defScore: 0, modScore: 0, boldScore: 0 };

    if (isPlainStock) applyConfidencePenalty(s, confidence);
    const isAristocrat = isDividendAristocrat(m, type);
    if (isAristocrat) applyAristocratBonus(s, audit);
    if (type === 'STOCK_US' && isPlainStock) applyUsQualityBonus(m, s, audit);

    return { scores: clampProfileScores(s, confidence, audit), audit, isAristocrat, confidence };
};

// ---------------------------------------------------------------------------
// QUALIDADE ESTRUTURAL DE AÇÃO: métrica inaplicável = AUSENTE
// ---------------------------------------------------------------------------
// O bloco de QUALITY foi escrito com a régua de uma empresa industrial: ROE,
// margem líquida, dívida/patrimônio e crescimento de RECEITA. Três dos quatro
// não existem para um banco — e o código lia o campo vazio como medição:
//
//   `debtToEquity = 0`   -> "Estrutura de Capital Excelente" (+25) para TODO banco
//   `revenueGrowth`      -> 25 dos 100 pontos decididos por um número que, para
//                           banco, oscila com intermediação e marcação a mercado
//   `roe` (Fundamentus)  -> BBAS3 marcava 7,99% enquanto o ROE recorrente do
//                           IF.data/BCB (`roeTtm`, que o portão âncora e o eixo
//                           de durabilidade JÁ usam) dizia 13,54%
//
// O autor do bloco já tinha reconhecido o problema para UMA das quatro (ver o
// comentário da margem líquida abaixo, sobre ITSA4 e BBDC4). Isto estende o
// mesmo raciocínio às outras três, com STRUCTURAL_QUALITY_NOT_APPLICABLE
// (config/stockCalibration.js) como fonte única em vez de heurística de setor.
//
// A composição deixa de ser soma de pontos e passa a ser MÉDIA PONDERADA das
// observadas (utils/metricObservation.js). Para uma ação com os quatro dados
// presentes o resultado é IDÊNTICO ao anterior — pesos iguais de 0,25 sobre
// notas de 0–100 reproduzem exatamente a soma de 25/15/0 pontos. A diferença só
// aparece onde havia dado ausente sendo lido como medição, que é o defeito.
// As notas e rótulos de cada insumo moram em structuralScoreRules.js (QUALITY_GRADES).

/**
 * Resolve os quatro insumos de QUALITY distinguindo medição de campo em branco.
 * Cada saída é um número (observado) ou `null` (AUSENTE, peso redistribuído).
 */
const resolveStockQualityInputs = (asset, m) => {
    const archetype = classifyStockArchetype(asset);
    const notApplicable = key => !isStructuralQualityMetricApplicable(archetype, key);
    const financialArchetype = isFinancialArchetype(archetype);
    const absent = [];
    const mark = (key, why) => { absent.push({ key, why }); return null; };

    // QUAL ROE e por QUAL régua: a decisão é uma só para o sistema inteiro
    // (resolveRoeReading). O ROE do Fundamentus para banco vem deprimido por
    // tratamento contábil, então o arquétipo com fonte própria lê o recorrente do
    // IF.data/BCB — e junto vem a escala dele, que NÃO é a do contábil.
    const roeReading = resolveRoeReading(asset, archetype);
    const roe = roeReading.value;
    if (roe === null) mark('roe', 'não informado');

    // Margem: holdings (>100%) e financeiras (0%) são contabilmente incomparáveis
    // com indústria. Regra original preservada, agora somada à matriz por arquétipo.
    const financialBySector = isFinancialSector(asset.sector, ['Holding']);
    const rawNetMargin = asObservedNumber(m.netMargin);
    const netMargin = notApplicable('netMargin') ? mark('netMargin', `não aplicável ao arquétipo ${archetype}`)
        : m._missing?.netMargin ? mark('netMargin', 'não informada')
        : rawNetMargin === null ? mark('netMargin', 'não informada')
        : rawNetMargin > 100 ? mark('netMargin', 'acima de 100% (holding)')
        : ((financialBySector || financialArchetype) && rawNetMargin === 0)
            ? mark('netMargin', 'não publicada (setor financeiro)')
            : rawNetMargin;

    // Alavancagem: para indústria `0` é medição ("sem dívida"); para balanço
    // prudencial é campo em branco — e virava a nota MÁXIMA de estrutura de capital.
    const rawDebtToEquity = asObservedNumber(m.debtToEquity);
    const debtToEquity = notApplicable('debtToEquity') ? mark('debtToEquity', `não aplicável ao arquétipo ${archetype}`)
        : rawDebtToEquity === null ? mark('debtToEquity', 'não informada')
        : (financialArchetype && rawDebtToEquity === 0)
            ? mark('debtToEquity', 'não publicada (balanço prudencial)')
            : rawDebtToEquity;

    // Crescimento de RECEITA não tem significado para banco nem para holding: o
    // crescimento próprio desses arquétipos (earningsGrowth,
    // recurringEarningsGrowth) é medido pelos eixos setoriais, não aqui — trazê-lo
    // para cá duplicaria o mesmo fundamento dentro da durabilidade. Prêmio de
    // seguradora e receita de petroleira, ao contrário, são receita de verdade e
    // continuam pontuando.
    const rawRevenueGrowth = asObservedNumber(m.revenueGrowth);
    const revenueGrowth = notApplicable('revenueGrowth') ? mark('revenueGrowth', `não aplicável ao arquétipo ${archetype}`)
        : m._missing?.revenueGrowth ? mark('revenueGrowth', 'não informado')
        : rawRevenueGrowth;

    // A régua acompanha a FONTE: só vale a rampa do recorrente quando foi o
    // recorrente que entrou. Banco sem `roeTtm` cai no ROE contábil e é lido pela
    // escada industrial — medir um número contábil com a régua do recorrente o
    // rebaixaria por ausência de dado, o defeito que este módulo combate.
    const recurringRoeScale = roeReading.recurring ? roeReading.scale : null;

    return {
        archetype, roe, netMargin, debtToEquity, revenueGrowth, absent,
        usedRecurringRoe: roeReading.recurring,
        recurringRoeScale,
    };
};

// Escolhe o scorer estrutural pela classe (structuralScoreRules.js) e resolve aqui
// os insumos que dependem do arquétipo/setor da ação.
const calculateStructuralScores = (asset, context) => {
    const m = asset.metrics;
    const type = asset.type;
    const usSub = usSubOf(asset);
    const isPlainStock = type === 'STOCK' || (type === 'STOCK_US' && (!usSub || usSub === 'STOCK'));
    const isPapel = resolvePapel(asset.fiiSubType, asset.sector);
    const aboveTrend = m.sma200 > 0 && asset.price > m.sma200;

    // ETF nacional temático (Cripto/Ouro/Renda Fixa) precede o modelo genérico de cesta.
    const themed = themedStructuralScores(asset, usSub, brEtfThemeOf(asset), aboveTrend);
    if (themed) return themed;
    if (isPlainStock) {
        const isFinancial = isFinancialSector(asset.sector, ['Financial', 'Insurance', 'Holding']);
        return stockStructuralScores(asset, context.MACRO, resolveStockQualityInputs(asset, m), isFinancial);
    }
    if (type === 'FII') return fiiStructuralScores(asset, context.MACRO, isPapel);
    if (type === 'CRYPTO') return cryptoStructuralScores(asset);
    return emptyStructuralScores();
};


const STABLECOINS = ['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDD', 'USDE'];

/**
 * Marca como AUSENTES as métricas que o arquétipo do emissor não publica, ou
 * publica num padrão incomparável com o de uma indústria (`SCORING_NOT_APPLICABLE`).
 * `NaN` funciona como N/A nas fórmulas e `_missing = false` desliga a penalidade
 * de dado não coletado — o dado não falta, ele NÃO EXISTE. Nenhum fundamento é
 * inventado, e nenhum fundamento legítimo é apagado.
 *
 * Roda DENTRO do scorer, e não no chamador, porque enquanto morou no chamador o
 * mesmo ticker tirava notas diferentes conforme quem chamava: o Research semanal
 * preparava o ativo e o motor âncora não. Aqui os dois recebem o mesmo tratamento
 * por construção — não há caminho "cru" e caminho "preparado" para divergirem.
 *
 * A autoridade é `SCORING_NOT_APPLICABLE`, nunca `APPLICABILITY_BY_ARCHETYPE`:
 * aquela matriz descreve de que o EIXO SETORIAL é feito, e é uma pergunta outra.
 */
const applyArchetypeApplicability = (asset) => {
    const notApplicable = getScoringNotApplicableMetrics(classifyStockArchetype(asset));
    if (notApplicable.length === 0) return asset;

    const metrics = { ...asset.metrics, _missing: { ...(asset.metrics?._missing || {}) } };
    for (const metric of notApplicable) {
        if (Object.hasOwn(metrics, metric)) metrics[metric] = Number.NaN;
        metrics._missing[metric] = false;
    }
    return { ...asset, metrics };
};

/**
 * `NaN` é o marcador transitório de N/A aceito pelas fórmulas, mas não é um
 * número BSON válido e a saída do scorer é persistida. Converte apenas números
 * não finitos; zero e negativos legítimos permanecem intactos.
 */
const withoutTransientNaN = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(withoutTransientNaN);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, withoutTransientNaN(nested)]));
};

export const scoringEngine = {
    processAsset(asset, context) {
        // --- LOG DE DESCARTE (CRITÉRIOS DE CORTE) ---
        if (asset.type === 'CRYPTO' && STABLECOINS.includes(asset.ticker)) {
            return { _discarded: true, reason: "Stablecoin", details: "Ativos pareados não geram ganho de capital" };
        }
        if (asset.price <= 0.01 && asset.type !== 'CRYPTO') return { _discarded: true, reason: "Preço de Centavos", details: `< 0.01` };
        // FIIs precisam de liquidez maior que ações para execução real sem slippage.
        const liquidityFloor = asset.type === 'FII' ? 500000 : 200000;
        // ETF (classe nacional B3): as fontes de cotação frequentemente NÃO retornam
        // volume utilizável p/ tickers .SA, deixando avgLiquidity=0 mesmo em ETFs
        // líquidos (BOVA11 etc.). Descartar por liquidez excluiria todo o universo
        // nacional do ranking — o scoreEtfProfiles/confiança já tratam liquidez baixa
        // de forma graduada. CRYPTO e ETF ficam isentos deste corte.
        if (asset.metrics.avgLiquidity < liquidityFloor && asset.type !== 'CRYPTO' && asset.type !== 'ETF') return { _discarded: true, reason: "Liquidez Insuficiente", details: `${asset.metrics.avgLiquidity} (Mínimo: ${asset.type === 'FII' ? '500k' : '200k'})` };
        if (asset.dbFlags && asset.dbFlags.isBlacklisted) return { _discarded: true, reason: "Blacklist Manual", details: "Banido pelo Admin" }; 

        // Métrica que o arquétipo do emissor não publica é AUSENTE — e a régua é
        // aplicada AQUI DENTRO, não no chamador, para que motor âncora e Research
        // semanal não possam divergir sobre o mesmo ticker (ver a função).
        const scored = asset.type === 'STOCK' ? applyArchetypeApplicability(asset) : asset;

        const valuationData = calculateIntrinsicValue(scored.metrics, scored.type, scored.price, context, scored.usSubType);
        const profileResult = calculateProfileScores(scored, valuationData, context);
        const structuralResult = calculateStructuralScores(scored, context);
        const thesisData = generateDynamicTheses(scored, context);
        const aristocrat = profileResult.isAristocrat;

        if (aristocrat) {
            thesisData.bull.unshift("Dividend Aristocrat: Crescimento consistente e dividendos saudáveis.");
        }

        // Consolidação do Audit Log Completo
        const auditLog = [
            ...profileResult.audit.CONFIDENCE.map(a => ({ ...a, category: 'Dados e Confiança' })),
            ...profileResult.audit.DEFENSIVE.map(a => ({ ...a, category: 'Perfil Defensivo' })),
            ...profileResult.audit.MODERATE.map(a => ({ ...a, category: 'Perfil Moderado' })),
            ...profileResult.audit.BOLD.map(a => ({ ...a, category: 'Perfil Arrojado' })),
            ...structuralResult.audit.QUALITY.map(a => ({ ...a, category: 'Qualidade' })),
            ...structuralResult.audit.VALUATION.map(a => ({ ...a, category: 'Valuation' })),
            ...structuralResult.audit.RISK.map(a => ({ ...a, category: 'Risco' }))
        ];

        // NaN é marcador interno de N/A e a saída daqui é persistida.
        return withoutTransientNaN({
            ticker: scored.ticker,
            name: scored.name,
            sector: scored.sector,
            type: scored.type,
            allocationClass: scored.allocationClass || null,
            currency: scored.currency || null,
            usSubType: scored.usSubType || null,
            currentPrice: scored.price,
            targetPrice: valuationData.fairPrice,
            metrics: {
                ...scored.metrics,
                structural: { quality: structuralResult.quality, valuation: structuralResult.valuation, risk: structuralResult.risk },
                ...valuationData
            },
            scores: profileResult.scores, 
            auditLog: auditLog, // O NOVO CAMPO PARA O FRONT
            riskProfile: '', 
            score: 0, 
            action: 'WAIT',
            thesis: '',
            bullThesis: thesisData.bull,
            bearThesis: thesisData.bear,
            isDividendAristocrat: aristocrat,
            // Confiança de dados do scorer legado (a mesma que define maxScoreAllowed
            // acima). Sai daqui para a calibração de ações poder capar o score
            // publicado pela MENOR das duas confianças — a da calibração só enxerga
            // stale/ausência para arquétipo OPERATIONAL (ver aiResearchService).
            dataConfidence: profileResult.confidence,
            // Consumido pelo Brasil 10 (getTop5Defensive): sem este flag, ativos
            // reprovados no gate defensivo entravam na lista rotulados DEFENSIVE.
            isDefensiveEligible: isEligibleForDefensive(scored, context)
        });
    }
};
