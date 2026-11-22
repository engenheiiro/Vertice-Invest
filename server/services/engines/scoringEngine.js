
import {
    DEFAULT_NTNB_FALLBACK,
    BAZIN_MIN_YIELD,
    BAZIN_NTNB_PREMIUM,
} from '../../config/financialConstants.js';
import { isCyclicalSector } from '../../config/sectorTaxonomy.js';
import {
    classifyStockArchetype,
    getScoringNotApplicableMetrics,
    isFinancialArchetype,
    isStructuralQualityMetricApplicable,
    resolveRoeReading,
} from '../../config/stockCalibration.js';
import { asObservedNumber } from '../../utils/metricObservation.js';
import { scoreFiiProfileRules } from './fiiProfileRules.js';
import { scoreStockProfileRules } from './stockProfileRules.js';
import {
    cryptoStructuralScores,
    emptyStructuralScores,
    fiiStructuralScores,
    stockStructuralScores,
    themedStructuralScores,
} from './structuralScoreRules.js';

const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

// Helper: resolve isPapel a partir de fiiSubType (explícito) ou setor (fallback por substring).
// Rótulos de FII de Papel na base: "Papel", "Recebíveis" (CRI/CRA). Hints específicos
// para não gerar falso-positivo com setores de tijolo (ex.: "Shoppings", "Logística").
const PAPEL_SECTOR_HINTS = ['papel', 'recebív', 'recebiv'];
const resolvePapel = (fiiSubType, sector) => {
    if (fiiSubType) return fiiSubType === 'PAPEL';
    if (!sector) return false;
    const s = sector.toLowerCase();
    return PAPEL_SECTOR_HINTS.some(h => s.includes(h));
};

// (H) Classificação setorial centralizada — antes havia ~5 cópias divergentes de
// "é setor financeiro?" espalhadas (algumas com Holding, outras com Financials/Insurance).
// FIN_CORE é o núcleo idêntico a TODOS os sites; cada chamada declara seus extras de forma
// explícita, então a divergência legada fica visível e editável num só lugar — SEM mudar
// pontuação (cada site reproduz exatamente o conjunto de keywords que já usava).
const FIN_CORE = ['Banco', 'Segur', 'Financeiro'];
const isFinancialSector = (sector, extra = []) => {
    if (!sector) return false;
    return [...FIN_CORE, ...extra].some(k => sector.includes(k));
};

// (H) Setores considerados "seguros" para o gate Defensivo (BR). Mantido como lista única
// de substrings (NÃO migrado para getMacroSector: Telecom→TECNOLOGIA / Alimentos→CONSUMO
// arrastariam setores não-defensivos inteiros para "seguro", mudando a semântica).
const DEFENSIVE_SAFE_SECTORS_BR = ['Banco', 'Segur', 'Elétric', 'Eletric', 'Saneamento', 'Água', 'Telecom', 'Energia', 'Transmissão', 'Financeiro', 'Alimentos', 'Saúde', 'Gás', 'Holding', 'Bebidas'];
// Setores defensivos do Exterior (GICS, em inglês) para o gate Defensivo de STOCK_US.
const DEFENSIVE_SAFE_SECTORS_US = ['Consumer Staples', 'Utilities', 'Healthcare', 'Financials'];

// Sub-tipo efetivo de um ativo do Exterior (STOCK_US). Fora do Exterior → null.
// Ausente cai em STOCK (mesmo balde padrão da classificação).
const usSubOf = (asset) => (asset && asset.type === 'STOCK_US') ? (asset.usSubType || 'STOCK') : null;
// Exterior que NÃO é ação individual (ETF/REIT/Ouro): não tem fundamentos de empresa.
const isUsNonStock = (sub) => sub === 'ETF' || sub === 'REIT' || sub === 'GOLD';

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

const calculateConfidenceScore = (m, type, usSubType = null, ratesStale = false) => {
    let confidence = 100;
    const audit = [];
    const isFII = type === 'FII';
    // ETF/REIT/Ouro do Exterior não têm métricas de EMPRESA (ROE, margem, crescimento).
    // Cobrá-las da confiança capava injustamente o score em 70/85. Trata como o FII:
    // confiança só sobre dados aplicáveis (liquidez, recência).
    // ETF nacional (type 'ETF') e CRYPTO também não têm fundamentos de empresa → mesmo
    // tratamento (antes a cripto era cobrada por revenueGrowth/ROE inexistentes por
    // natureza, e compensava com isenção total do teto — dois erros se anulando).
    const noCompanyMetrics = (type === 'STOCK_US' && isUsNonStock(usSubType)) || type === 'ETF' || type === 'CRYPTO';

    // Métricas de EMPRESA (crescimento de receita, ROE, margem líquida) só fazem sentido
    // para ações. Em FIIs elas são estruturalmente inaplicáveis — não são "dados ausentes".
    // Cobrá-las da confiança travava TODO bom FII em confidence 60 → maxScoreAllowed 85,
    // comprimindo dezenas de FIIs no mesmo teto. Para FII a confiança vem de dados APLICÁVEIS
    // (patrimônio/valor de mercado, liquidez, recência).
    if (!isFII && !noCompanyMetrics) {
        // Usa _missing para distinguir dado ausente de dado genuinamente ruim
        if (m._missing?.revenueGrowth) {
            confidence -= 25;
            audit.push({ factor: 'Dados de Crescimento Ausentes', points: -25, type: 'penalty', category: 'Confiança' });
        }
        if (m._missing?.roe || m._missing?.netMargin) {
            confidence -= 15;
            audit.push({ factor: 'Dados de Rentabilidade Ausentes', points: -15, type: 'penalty', category: 'Confiança' });
        }
    } else if (isFII && m._missing?.marketCap) {
        // FII sem patrimônio/valor de mercado: dado-base ausente → confiança reduzida.
        confidence -= 15;
        audit.push({ factor: 'Patrimônio/Valor de Mercado Ausente', points: -15, type: 'penalty', category: 'Confiança' });
    }
    if (m.avgLiquidity < 1000000) {
        confidence -= 30;
        audit.push({ factor: 'Liquidez Abaixo do Ideal (<1M/dia)', points: -30, type: 'penalty', category: 'Confiança' });
    }

    // (I) Macro defasado: quando a cadeia de taxas (BCB→BrasilAPI→IBGE) caiu e o sistema
    // opera com SELIC/NTN-B de fallback, os bônus dependentes de juros (spread de FII,
    // ROE-vs-Selic, earnings-yield) são calculados sobre uma taxa possivelmente incorreta.
    // Desconta confiança e avisa — só para BR (STOCK/FII), que usam essas taxas. É uniforme,
    // então preserva a ordenação dentro da classe; mexe apenas no limiar BUY/WAIT marginal.
    if (ratesStale && (type === 'STOCK' || type === 'FII')) {
        confidence -= 10;
        audit.push({ factor: 'Indicadores Macro Defasados (taxas em fallback)', points: -10, type: 'penalty', category: 'Confiança' });
    }

    // Penalidade de staleness: dados desatualizados reduzem a confiança da análise
    if (m._staleDays !== null && m._staleDays !== undefined) {
        if (m._staleDays > 180) {
            confidence -= 30;
            audit.push({ factor: `Dados Fundamentais Desatualizados (${m._staleDays} dias)`, points: -30, type: 'penalty', category: 'Confiança' });
        } else if (m._staleDays > 90) {
            confidence -= 15;
            audit.push({ factor: `Dados Fundamentais Desatualizados (${m._staleDays} dias)`, points: -15, type: 'penalty', category: 'Confiança' });
        }
    } else {
        // Data de atualização nunca registrada — penalidade leve
        confidence -= 5;
        audit.push({ factor: 'Data de Atualização dos Fundamentais Desconhecida', points: -5, type: 'penalty', category: 'Confiança' });
    }

    return { confidence, audit };
};

// --- NOVO: IDENTIFICADOR DE DIVIDEND ARISTOCRAT ---
const isDividendAristocrat = (m, type) => {
    if (type !== 'STOCK') return false;
    // Critérios Proxy: Crescimento de Receita + ROE Alto + Yield Decente + Payout Saudável
    return (m.revenueGrowth > 5 && m.roe > 12 && m.dy > 4.0 && m.netMargin > 8 && m.payout > 20 && m.payout < 90);
};

const isEligibleForDefensive = (asset, _context) => {
    const m = asset.metrics;
    if (m.avgLiquidity < 200000) return false;
    if (asset.type === 'STOCK') {
        if (m.marketCap < 1000000000) return false;
        // Beta muito alto (≥1.5) indica ativo pró-cíclico incompatível com perfil defensivo.
        // O scoring já penaliza -15 pts para beta ≥1.5, mas o gate evita que ativos com
        // muitos bônus de DY/ROE compensem essa fraqueza estrutural e entrem no DEFENSIVE.
        // Beta AUSENTE reprova (fail-closed). O marketDataService grava `beta: 0` quando não
        // há série para calcular e marca `_missing.beta` — mas o gate só olhava `beta >= 1.5`,
        // então 0 passava como se fosse um beta baixíssimo e o ativo sem medição de risco
        // entrava no perfil Defensivo. Beta negativo REAL continua aceito.
        if (m._missing?.beta || !Number.isFinite(m.beta)) return false;
        if (m.beta >= 1.5) return false;
        const sector = asset.sector || '';
        // Setor cíclico (INDUSTRIAL/COMMODITIES) NUNCA é elegível ao perfil Defensivo:
        // DY/P/L baratos numa cíclica em queda são lucro de PICO de ciclo (value-trap),
        // não segurança. Barra na origem — antes de qualquer bônus de DY/ROE (caso SHUL4).
        // Continua elegível a MODERATE/BOLD via scoreStockProfiles.
        if (isCyclicalSector(sector)) return false;
        const isSafeSector = DEFENSIVE_SAFE_SECTORS_BR.some(keyword => sector.includes(keyword));
        if (!isSafeSector) {
            // P/L precisa ser POSITIVO: `m.pl > 10` sozinho aceitava P/L 0 (ausente) e P/L
            // negativo (prejuízo) como "barato", abrindo a rota DY≥6% para empresa sem lucro.
            if (m.dy < 6.0 || !(m.pl > 0 && m.pl <= 10)) return false;
        }
        // ROE ausente reprova no Defensivo (fail-closed): antes a regra era pulada quando
        // `_missing.roe`, e a falta de coleta virava passe livre para o perfil mais
        // conservador. Margem/payout ausentes seguem tolerados (não são o eixo do gate).
        if (m._missing?.roe || !Number.isFinite(m.roe) || m.roe < 5) return false;
        if (!m._missing?.netMargin && m.netMargin < 3) return false;
        // Payout insustentável (>200%) é incompatível com perfil defensivo — dividendo vem do capital.
        if (!m._missing?.payout && m.payout > 200) return false;
        const isFinancial = isFinancialSector(sector);
        if (m.debtToEquity > 4.0 && !isFinancial) return false;
    } else if (asset.type === 'FII') {
        if (m.marketCap < 500000000) return false; 
        if (m.dy > 18.0) return false; 
        if (m.vacancy > 12) return false; // Reduzido de 15 para 12 para ser mais defensivo
        // FII de Papel não tem imóveis (qtdImoveis=0): a guarda de mono-ativo só vale para tijolo.
        // Usa resolvePapel (fiiSubType explícito OU hints 'papel'/'recebív') em vez de substring crua
        // 'Papel' — senão um FII de papel rotulado "Recebíveis"/"CRI" seria vetado indevidamente.
        const isPapelFII = resolvePapel(asset.fiiSubType, asset.sector);
        if (!isPapelFII && m.qtdImoveis < 2) return false; // Mono-ativos de tijolo são vetados do perfil Defensivo
        if (m.avgLiquidity < 1000000) return false; 
    } else if (asset.type === 'STOCK_US') {
        // US stocks: exige market cap mínimo de $10B USD e setor defensivo (Consumer Staples, Utilities, Healthcare, Financials)
        if (m.marketCap < 10_000_000_000) return false;
        // Mesma regra fail-closed do STOCK BR: beta ausente (gravado como 0) não é beta baixo.
        if (m._missing?.beta || !Number.isFinite(m.beta)) return false;
        if (m.beta >= 1.8) return false;
        // ROE ausente reprova o Defensivo (fail-closed), como no STOCK BR.
        if (m._missing?.roe || !Number.isFinite(m.roe) || m.roe < 5) return false;
        const sector = asset.sector || '';
        const isSafeUSSector = DEFENSIVE_SAFE_SECTORS_US.some(s => sector.includes(s));
        if (!isSafeUSSector) {
            // Fora dos setores defensivos: exige DY razoável ou P/E moderado
            if (m.dy < 1.5 && (m.pl === 0 || m.pl > 30)) return false;
        }
    } else if (asset.type === 'CRYPTO') {
        // Para ser defensivo em crypto, tem que ser gigante e muito líquido (Buy & Hold)
        if (!['BTC', 'ETH'].includes(asset.ticker) && m.marketCap < 50000000000) return false;
        if (m.avgLiquidity < 500000000) return false;
    }
    return true;
};

const calculateIntrinsicValue = (m, type, price, context, usSubType = null) => {
    const { MACRO } = context;
    let fairPrice = price;
    let method = "Mercado";
    let grahamPrice = 0;
    let bazinPrice = 0;
    let pegRatio = null;

    // Exterior não-ação (ETF/REIT/Ouro): não cabe Graham/Bazin de empresa.
    const usSub = type === 'STOCK_US' ? (usSubType || 'STOCK') : null;
    // ETF nacional (classe própria): referência é o mercado, sem valor intrínseco de empresa.
    if (type === 'ETF') {
        return { fairPrice: safeVal(price), method: 'Mercado', grahamPrice: 0, bazinPrice: 0, pegRatio: null };
    }
    if (type === 'STOCK_US' && usSub === 'REIT') {
        // REIT é veículo de renda: preço justo por Bazin (dividendo / yield-alvo 6%).
        if (m.dy > 0) {
            const dividendPerShare = price * (Math.min(m.dy, 14) / 100);
            bazinPrice = dividendPerShare / 0.06;
        }
        fairPrice = bazinPrice > 0 ? Math.min(bazinPrice, price * 2.5) : price;
        method = bazinPrice > 0 ? 'Bazin (REIT)' : 'Mercado';
        return { fairPrice: safeVal(fairPrice), method, grahamPrice: 0, bazinPrice: safeVal(bazinPrice), pegRatio: null };
    }
    if (type === 'STOCK_US' && (usSub === 'ETF' || usSub === 'GOLD')) {
        // Cesta/commodity: sem valor intrínseco de empresa — referência é o mercado.
        return { fairPrice: safeVal(price), method: 'Mercado', grahamPrice: 0, bazinPrice: 0, pegRatio: null };
    }

    if (type === 'STOCK' || type === 'STOCK_US') {
        if (m.pl > 0 && m.pl < 80 && m.pvp > 0) {
            const lpa = price / m.pl;
            const vpa = price / m.pvp;
            grahamPrice = Math.sqrt(22.5 * lpa * vpa);
        }
        // Yield-alvo Bazin ancorado no macro — só para ação BR: max(6% clássico,
        // NTN-B + prêmio). O 6% fixo inflava o preço justo de dividendeiras com
        // Selic ~14%. STOCK_US mantém 6%: NTN-B é taxa real BR e não é âncora
        // válida para ativos em dólar (ambiente de juros US ~4-5%).
        const bazinYieldPct = type === 'STOCK'
            ? Math.max(BAZIN_MIN_YIELD, (MACRO.NTNB_LONG || DEFAULT_NTNB_FALLBACK) + BAZIN_NTNB_PREMIUM)
            : 6;
        if (m.dy > 0) {
            const adjustedDy = Math.min(m.dy, 14) / 100;
            const dividendPerShare = price * adjustedDy;
            bazinPrice = dividendPerShare / (bazinYieldPct / 100);
        }
        if (m.pl > 0 && m.revenueGrowth > 0) {
            pegRatio = m.pl / m.revenueGrowth;
        }
        if (grahamPrice > 0 && bazinPrice > 0) {
            fairPrice = (grahamPrice * 0.4) + (bazinPrice * 0.6);
            method = `Híbrido (Bazin ${bazinYieldPct.toFixed(1)}% + Graham)`;
        } else if (grahamPrice > 0) {
            fairPrice = grahamPrice;
            method = "Graham";
        } else if (bazinPrice > 0) {
            fairPrice = bazinPrice;
            method = `Bazin (${bazinYieldPct.toFixed(1)}%)`;
        }
        // PEG reverso para STOCK_US: aplica método Lynch quando Graham e Bazin não produzem
        // preço justo e o ativo está barato em relação ao crescimento (PEG < 1.0)
        if (type === 'STOCK_US' && grahamPrice === 0 && bazinPrice === 0 && m.pl > 0 && m.pl < 80 && m.revenueGrowth > 10) {
            const lpa = price / m.pl;
            const cappedGrowth = Math.min(m.revenueGrowth, 40);
            const pegReversoPrice = lpa * cappedGrowth; // Lynch: fair P/E = taxa de crescimento
            if (pegReversoPrice > price) { // somente se o ativo está subavaliado (PEG < 1)
                fairPrice = pegReversoPrice;
                method = 'PEG Reverso';
            }
        }
        if (fairPrice > price * 2.5) fairPrice = price * 2.5;
    } else if (type === 'FII') {
        // vpCota agora persiste no MarketAsset; o fallback por P/VP (mesma fórmula:
        // price/pvp) continua valendo para documentos gravados antes disso e para FIIs
        // cuja fonte não publica o valor patrimonial. Sem ele o VP colapsava para o
        // próprio preço e o prêmio/deságio patrimonial sumia do preço justo (upside ~0).
        const vp = m.vpCota || (m.pvp > 0 ? price / m.pvp : price);
        // Usa fiiSubType (explícito) ou sector como fallback — corrige bug anterior onde
        // m.sector não existia em metrics e isPapel nunca era detectado
        const isPapelFII = resolvePapel(m.fiiSubType, m.sector);
        if (isPapelFII) {
            fairPrice = vp;
            method = "VP (Papel)";
        } else {
            const ntnb = MACRO.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
            const yieldPremium = Math.max(0, m.dy - ntnb);
            fairPrice = vp * (1 + (yieldPremium / 100));
            method = "VP Ajustado";
        }
    } else if (type === 'CRYPTO') {
        fairPrice = price;
        method = "Mercado";
    }
    return { fairPrice: safeVal(fairPrice), method, grahamPrice: safeVal(grahamPrice), bazinPrice: safeVal(bazinPrice), pegRatio: pegRatio !== null ? safeVal(pegRatio) : null };
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

// (M1) Scoring por perfil de cripto. Lógica idêntica à versão monolítica anterior.
const scoreCryptoProfiles = (asset, audit) => {
    const m = asset.metrics;
    let defScore = 0, modScore = 0, boldScore = 0;
    {
        const isBlueChip = ['BTC', 'ETH'].includes(asset.ticker);
        const isTop10 = m.marketCap > 20000000000;
        const isMidCap = m.marketCap > 2000000000 && m.marketCap <= 20000000000;
        // Perfil "primário" da faixa (recebe a base 90/95) — destino das notas de variância.
        const primary = isBlueChip ? 'DEFENSIVE' : isTop10 ? 'MODERATE' : 'BOLD';

        // Bases recalibradas (jul/2026): as antigas 90/95 faziam 16/16 criptos cruzarem
        // o BUY (≥70) com TRX empatando com BTC em 100 — sem diferenciação nenhuma.
        // Agora a base deixa o ativo ABAIXO do threshold; só liquidez + volatilidade
        // baixa + tendência (bônus reais) levam ao BUY. Small cap nasce abaixo de mid
        // cap (o antigo 95 "assimetria" invertia a lógica de risco).
        if (isBlueChip) {
            defScore = 75; audit.DEFENSIVE.push({ factor: 'Crypto Blue Chip', points: 75, type: 'base' });
        } else if (isTop10) {
            modScore = 62; audit.MODERATE.push({ factor: 'Crypto Large Cap', points: 62, type: 'base' });
        } else if (isMidCap) {
            boldScore = 55; audit.BOLD.push({ factor: 'Crypto Mid Cap', points: 55, type: 'base' });
        } else {
            boldScore = 50; audit.BOLD.push({ factor: 'Crypto Small Cap', points: 50, type: 'base' });
        }

        if (m.avgLiquidity < 50000000) {
            defScore -= 30; modScore -= 20; boldScore -= 10;
            audit.BOLD.push({ factor: 'Baixa Liquidez Crypto', points: -10, type: 'penalty' });
        } else if (m.avgLiquidity > 1000000000) {
            defScore += 10; modScore += 10;
            audit.MODERATE.push({ factor: 'Alta Liquidez Institucional', points: 10, type: 'bonus' });
        }

        // ── (Fase 2 / achado E) VARIÂNCIA DE QUALIDADE NO SCORE QUE ORDENA ──────────
        // Antes a cripto pontuava só por faixa de marketCap + liquidez: dezenas de ativos
        // empatavam em 90 e cruzavam o BUY (≥70) sem diferenciação real. Volatilidade e
        // desvio da SMA200 — já usados no score ESTRUTURAL — passam a ajustar também o
        // score de PERFIL (que ordena). Bandas de volatilidade espelham o RISK estrutural
        // de cripto (40/70/100) para consistência. Notas vão ao perfil primário da faixa.
        const cVol = m.volatility || 0;
        if (cVol > 0) {
            if (cVol < 40) {
                defScore += 6; modScore += 6; boldScore += 6;
                audit[primary].push({ factor: 'Volatilidade Baixa (<40%)', points: 6, type: 'bonus' });
            } else if (cVol > 100) {
                defScore -= 12; modScore -= 10; boldScore -= 8;
                audit[primary].push({ factor: 'Volatilidade Extrema (>100%)', points: -8, type: 'penalty' });
            } else if (cVol > 70) {
                defScore -= 6; modScore -= 5; boldScore -= 4;
                audit[primary].push({ factor: 'Volatilidade Elevada (>70%)', points: -4, type: 'penalty' });
            }
        }
        if (m.sma200 > 0 && asset.price > 0) {
            const devSma = (asset.price - m.sma200) / m.sma200;
            if (devSma >= 0) {
                defScore += 4; modScore += 4; boldScore += 4;
                audit[primary].push({ factor: 'Acima da Tendência (Preço ≥ SMA200)', points: 4, type: 'bonus' });
            } else if (devSma < -0.30) {
                defScore -= 8; modScore -= 6; boldScore -= 5;
                audit[primary].push({ factor: 'Forte Queda (Preço >30% abaixo da SMA200)', points: -5, type: 'penalty' });
            } else if (devSma < -0.10) {
                defScore -= 4; modScore -= 3; boldScore -= 2;
                audit[primary].push({ factor: 'Abaixo da Tendência (Preço < SMA200)', points: -2, type: 'penalty' });
            }
        }

        // ── (Fase 2 / achado E2) TRAVA BRANDA NO BOLD DE SMALL CAP ──────────────────
        // Uma small cap (não blue chip / não top-10 / não mid) de baixa liquidez OU
        // volatilidade extrema é APOSTA, não convicção: limita o BOLD a 80 — ainda
        // elegível a COMPRAR, sem cravar nota máxima. Análogo ao teto especulativo de
        // ação sem lucro (SPEC_BOLD_CAP). Com a base recalibrada para 50 raramente
        // dispara, mas segue como cinto de segurança contra stacking de bônus.
        const isSmallCap = !isBlueChip && !isTop10 && !isMidCap;
        if (isSmallCap && (m.avgLiquidity < 50000000 || cVol > 100)) {
            const CRYPTO_SPEC_CAP = 80;
            if (boldScore > CRYPTO_SPEC_CAP) {
                audit.BOLD.push({ factor: 'Teto Especulativo Cripto (small cap arriscada)', points: CRYPTO_SPEC_CAP - boldScore, type: 'penalty' });
                boldScore = CRYPTO_SPEC_CAP;
            }
        }
    }
    return { defScore, modScore, boldScore };
};

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

// (M1) Orquestrador: confiança, dispatch por tipo (helpers acima) e clamp final.
const calculateProfileScores = (asset, valuationData, context) => {
    const m = asset.metrics;
    const type = asset.type;

    const usSub = usSubOf(asset);
    // Exterior ação individual (STOCK ou sub-tipo STOCK) usa o caminho de ação.
    const isPlainStock = type === 'STOCK' || (type === 'STOCK_US' && (!usSub || usSub === 'STOCK'));

    let defScore = 0, modScore = 0, boldScore = 0;
    const audit = { DEFENSIVE: [], MODERATE: [], BOLD: [], CONFIDENCE: [] };
    const ratesStale = !!context?.MACRO?.RATES_STALE;
    const { confidence, audit: confAudit } = calculateConfidenceScore(m, type, asset.usSubType, ratesStale);
    audit.CONFIDENCE = confAudit;

    // Tema do ETF nacional (Cripto/Ouro/Renda Fixa têm scorer próprio; demais = cesta).
    const etfTheme = brEtfThemeOf(asset);

    if (isPlainStock) {
        ({ defScore, modScore, boldScore } = scoreStockProfiles(asset, valuationData, context, audit));
    } else if (type === 'ETF' && etfTheme === 'GOLD') {
        // ETF de ouro BR (GOLD11): mesmo hedge/reserva de valor do ouro US.
        ({ defScore, modScore, boldScore } = scoreCommodityProfiles(asset, audit));
    } else if (type === 'ETF' && etfTheme === 'CRYPTO') {
        ({ defScore, modScore, boldScore } = scoreCryptoEtfProfiles(asset, audit));
    } else if (type === 'ETF' && etfTheme === 'FIXED_INCOME') {
        ({ defScore, modScore, boldScore } = scoreFixedIncomeEtfProfiles(asset, audit));
    } else if ((type === 'STOCK_US' && usSub === 'ETF') || type === 'ETF') {
        ({ defScore, modScore, boldScore } = scoreEtfProfiles(asset, audit));
    } else if (type === 'STOCK_US' && usSub === 'REIT') {
        ({ defScore, modScore, boldScore } = scoreReitProfiles(asset, audit));
    } else if (type === 'STOCK_US' && usSub === 'GOLD') {
        ({ defScore, modScore, boldScore } = scoreCommodityProfiles(asset, audit));
    } else if (type === 'FII') {
        ({ defScore, modScore, boldScore } = scoreFiiProfiles(asset, context, audit));
    } else if (type === 'CRYPTO') {
        ({ defScore, modScore, boldScore } = scoreCryptoProfiles(asset, audit));
    }

    // Aplica penalidades de confiança diretamente nos scores de perfil (apenas STOCK/STOCK_US)
    // para que o audit log "Dados e Confiança" reflita deduções reais (não cosmético).
    // FIIs: a confiança já é calculada só sobre dados aplicáveis (ver calculateConfidenceScore);
    // o teto graduado (maxScoreAllowed) basta — não se subtrai duas vezes.
    // CRYPTO: usa suas próprias penalidades de liquidez dentro do bloco acima.
    // Só ação individual sofre a dedução direta (ETF/REIT/Ouro seguem o modelo do
    // FII: confiança já restrita a dados aplicáveis; o teto graduado basta).
    if (isPlainStock && confidence < 100) {
        const confPenalty = 100 - confidence;
        defScore -= confPenalty;
        modScore -= confPenalty;
        boldScore -= confPenalty;
    }

    // Dividend Aristocrat bonus aplicado ANTES do clamp de confiança (maxScoreAllowed).
    // Aplicar depois do clamp violaria o teto de 70 para ativos com dados incompletos,
    // podendo gerar sinal BUY indevido em ativos que deveriam ficar em WAIT.
    const isAristocrat = isDividendAristocrat(m, type);
    if (isAristocrat) {
        defScore += 10;
        modScore += 5;
        audit.DEFENSIVE.push({ factor: 'Dividend Aristocrat Bonus', points: 10, type: 'bonus' });
        audit.MODERATE.push({ factor: 'Dividend Aristocrat Bonus', points: 5, type: 'bonus' });
    }

    // Bônus de qualidade US (escopado a ações STOCK_US; NÃO afeta o BR `STOCK`).
    // O "Dividend Aristocrat" só vale p/ STOCK BR; nomes defensivos US de qualidade
    // (bom yield + rentabilidade + margem) ficavam presos em 58–67 sem reconhecimento.
    if (type === 'STOCK_US' && isPlainStock && m.dy > 3 && m.roe > 12 && m.netMargin > 10) {
        defScore += 8;
        modScore += 4;
        audit.DEFENSIVE.push({ factor: 'Qualidade US (yield + ROE + margem)', points: 8, type: 'bonus' });
        audit.MODERATE.push({ factor: 'Qualidade US', points: 4, type: 'bonus' });
    }

    // Cap graduado: salto binário 59→70/60→100 substituído por escada para evitar que
    // um dado a menos reduza o teto de 100 para 70 abruptamente. CRYPTO também é capada
    // (a confiança dela já é calculada só sobre dados aplicáveis — liquidez/recência —,
    // então a antiga isenção total deixou de ter razão de existir).
    const maxScoreAllowed = confidence >= 80 ? 100
        : confidence >= 60 ? 85
        : 70;

    // Clamp final por perfil. Quando o TETO de confiança (maxScoreAllowed) de fato
    // reduz o score, registra a dedução no audit do perfil correspondente para que a
    // Auditoria Completa reconcilie com o score exibido (antes o teto era invisível).
    const clampProfile = (raw, profileKey) => {
        const floored = Math.max(10, raw);
        const capped = Math.min(maxScoreAllowed, floored);
        // Só registra quando o teto é REALMENTE por confiança (< 100). O teto de 100 é
        // a normalização padrão e não é uma dedução de confiança — não vira fator de audit.
        if (maxScoreAllowed < 100 && capped < floored) {
            audit[profileKey].push({
                factor: `Teto por Confiança de Dados (máx. ${maxScoreAllowed})`,
                points: capped - floored,
                type: 'penalty'
            });
        }
        return capped;
    };
    const finalScores = {
        DEFENSIVE: clampProfile(defScore, 'DEFENSIVE'),
        MODERATE: clampProfile(modScore, 'MODERATE'),
        BOLD: clampProfile(boldScore, 'BOLD')
    };

    return { scores: finalScores, audit, isAristocrat, confidence };
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

const generateDynamicTheses = (m, type, ticker, context, valuationData, currentPrice, sector, fiiSubType) => {
    const { MACRO } = context;
    const bull = [];
    const bear = [];
    if (m.dy > MACRO.SELIC) bull.push(`Yield (${m.dy.toFixed(1)}%) supera a Selic.`);
    if (m.pvp < 0.85 && m.pvp > 0) bull.push(`Desconto patrimonial (P/VP ${m.pvp.toFixed(2)}).`);
    if (!m._missing?.roe && m.roe > 18) bull.push(`Rentabilidade alta (ROE ${m.roe.toFixed(1)}%).`);

    if (type === 'FII') {
        const ntnb = context.MACRO?.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
        const spread = m.dy - ntnb;
        const isPapel = resolvePapel(fiiSubType, sector);
        
        if (spread > 2.5) bull.push(`Alto prêmio de risco: Spread de ${spread.toFixed(1)}% sobre NTN-B.`);
        else if (spread < 0.5) bear.push(`Prêmio de risco pífio (${spread.toFixed(1)}%) sobre o Tesouro.`);

        if (m.vacancy > 12) bear.push(`Vacância elevada (${m.vacancy.toFixed(1)}%): Risco de fluxo de caixa.`);
        else if (m.vacancy < 3 && !isPapel) bull.push("Ocupação quase plena (Vacância < 3%).");

        if (m.qtdImoveis === 1) bear.push("Risco Mono-Ativo: Dependência total de um único imóvel.");
        if (m.beta < 0.7) bull.push(`Baixa volatilidade (Beta ${m.beta.toFixed(2)}): Perfil defensivo.`);
        else if (m.beta > 1.1) bear.push(`Volatilidade alta para o setor (Beta ${m.beta.toFixed(2)}).`);

        if (isPapel && m.pvp > 1.05) bear.push("Ágio em FII de Papel: Risco de amortização negativa.");
    }

    if (m.debtToEquity > 4 && type === 'STOCK') bear.push("Alavancagem alta.");
    if (m.avgLiquidity < 500000 && type !== 'CRYPTO') bear.push("Baixa liquidez.");
    
    if (type === 'CRYPTO') {
        if (['BTC', 'ETH'].includes(ticker)) bull.push("Blue Chip do mercado cripto (Reserva de Valor / Infraestrutura).");
        if (m.marketCap > 20000000000) bull.push("Alta capitalização de mercado (Large Cap), maior resiliência.");
        else if (m.marketCap < 2000000000) bull.push("Baixa capitalização (Small Cap), alta assimetria de retorno.");
        
        if (m.avgLiquidity > 1000000000) bull.push("Altíssima liquidez, facilitando entrada/saída institucional.");
        else if (m.avgLiquidity < 50000000) bear.push("Baixa liquidez, risco de slippage e manipulação.");

        const vmc = m.marketCap > 0 ? (m.avgLiquidity / m.marketCap) : 0;
        if (vmc > 0.02 && vmc < 0.15) bull.push(`Volume/MarketCap saudável (${(vmc*100).toFixed(1)}%), indicando adoção orgânica.`);
        else if (vmc > 0.5) bear.push(`Volume/MarketCap excessivo (${(vmc*100).toFixed(1)}%), possível especulação ou wash trading.`);
        else if (vmc < 0.005) bear.push(`Volume/MarketCap muito baixo (${(vmc*100).toFixed(1)}%), indicando desinteresse do mercado.`);

        if (m.marketCap < 100000000) bear.push("Micro Cap (< $100M): Risco extremo de volatilidade e falha do projeto.");
        
        if (m.sma200) {
            if (currentPrice > m.sma200) bull.push("Tendência de alta de longo prazo (Preço > SMA200).");
            else bear.push("Tendência de baixa de longo prazo (Preço < SMA200).");
        }
        
        if (m.volatility) {
            if (m.volatility > 100) bear.push(`Volatilidade extrema (${m.volatility.toFixed(1)}% a.a.).`);
            else if (m.volatility < 50) bull.push(`Volatilidade controlada para o setor (${m.volatility.toFixed(1)}% a.a.).`);
        }
    }
    
    return { bull, bear };
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
        const thesisData = generateDynamicTheses(scored.metrics, scored.type, scored.ticker, context, valuationData, scored.price, scored.sector, scored.fiiSubType);
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
