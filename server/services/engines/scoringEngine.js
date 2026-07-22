
import {
    DEFAULT_SELIC_FALLBACK,
    DEFAULT_NTNB_FALLBACK,
    BAZIN_MIN_YIELD,
    BAZIN_NTNB_PREMIUM,
    FII_YIELD_TRAP_THRESHOLD,
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

const isEligibleForDefensive = (asset, context) => {
    const m = asset.metrics;
    if (m.avgLiquidity < 200000) return false;
    if (asset.type === 'STOCK') {
        if (m.marketCap < 1000000000) return false;
        // Beta muito alto (≥1.5) indica ativo pró-cíclico incompatível com perfil defensivo.
        // O scoring já penaliza -15 pts para beta ≥1.5, mas o gate evita que ativos com
        // muitos bônus de DY/ROE compensem essa fraqueza estrutural e entrem no DEFENSIVE.
        if (m.beta >= 1.5) return false;
        const sector = asset.sector || '';
        // Setor cíclico (INDUSTRIAL/COMMODITIES) NUNCA é elegível ao perfil Defensivo:
        // DY/P/L baratos numa cíclica em queda são lucro de PICO de ciclo (value-trap),
        // não segurança. Barra na origem — antes de qualquer bônus de DY/ROE (caso SHUL4).
        // Continua elegível a MODERATE/BOLD via scoreStockProfiles.
        if (isCyclicalSector(sector)) return false;
        const isSafeSector = DEFENSIVE_SAFE_SECTORS_BR.some(keyword => sector.includes(keyword));
        if (!isSafeSector) {
            if (m.dy < 6.0 || m.pl > 10) return false;
        }
        // Só aplica rejeição se o dado estiver presente (não ausente) — evita punir por falta de coleta
        if (!m._missing?.roe && m.roe < 5) return false;
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
        if (m.beta >= 1.8) return false;
        if (!m._missing?.roe && m.roe < 5) return false;
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
        // vpCota é calculado no scraper mas não persiste no MarketAsset — sem o fallback
        // por P/VP (mesma fórmula: price/pvp), o VP colapsava para o próprio preço e o
        // prêmio/deságio patrimonial sumia do preço justo de FII (upside sempre ~0).
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
// e popula `audit`. Lógica idêntica à versão monolítica anterior.
const scoreStockProfiles = (asset, valuationData, context, audit) => {
    const { MACRO } = context;
    const m = asset.metrics;
    const upside = asset.price > 0 ? (valuationData.fairPrice / asset.price) - 1 : 0;
    let defScore = 0, modScore = 0, boldScore = 0;
    let criticalLeverage = false; // DL/EBITDA > 3.5x — dispara teto em MODERATE/BOLD abaixo
    {
        // Setor financeiro pode apresentar crescimento de receita artificialmente alto por
        // base-year ou reestruturações. Aplica teto de 30% para evitar PEG/Hyper Growth indevidos.
        const isFinancialSec = isFinancialSector(asset.sector, ['Holding', 'Financials', 'Financial']);
        const effectiveRevenueGrowth = (isFinancialSec && m.revenueGrowth > 30) ? 30 : m.revenueGrowth;

        // ── DEFENSIVO ────────────────────────────────────────────────────────────
        // Base reduzida 60→40: bônus progressivos diferenciam ações medianas de elite.
        // Mesmo raciocínio aplicado aos FIIs na rodada anterior.
        const isDefensiveEligible = isEligibleForDefensive(asset, context);
        if (isDefensiveEligible) {
            defScore = 40;
            audit.DEFENSIVE.push({ factor: 'Score Base (Setor Defensivo)', points: 40, type: 'base' });

            // Market cap tiers
            if (m.marketCap > 10000000000) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Large Cap (>10B)', points: 10, type: 'bonus' }); }
            else if (m.marketCap > 2000000000) { defScore += 4; audit.DEFENSIVE.push({ factor: 'Mid Cap (>2B)', points: 4, type: 'bonus' }); }

            // DY tiers: escala proporcional ao prêmio real entregue
            if (m.dy >= 10.0) { defScore += 22; audit.DEFENSIVE.push({ factor: 'Dividend Yield Excepcional (≥10%)', points: 22, type: 'bonus' }); }
            else if (m.dy >= 8.0) { defScore += 16; audit.DEFENSIVE.push({ factor: 'Dividend Yield Alto (≥8%)', points: 16, type: 'bonus' }); }
            else if (m.dy >= 6.0) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Dividend Yield > 6%', points: 10, type: 'bonus' }); }
            else if (m.dy >= 4.0) { defScore += 5; audit.DEFENSIVE.push({ factor: 'Dividend Yield Moderado (≥4%)', points: 5, type: 'bonus' }); }

            // ROE tiers
            if (m.roe >= 20) { defScore += 15; audit.DEFENSIVE.push({ factor: 'ROE Excelente (≥20%)', points: 15, type: 'bonus' }); }
            else if (m.roe >= 15) { defScore += 10; audit.DEFENSIVE.push({ factor: 'ROE Robusto (≥15%)', points: 10, type: 'bonus' }); }
            else if (m.roe >= 12) { defScore += 5; audit.DEFENSIVE.push({ factor: 'ROE Saudável (≥12%)', points: 5, type: 'bonus' }); }

            // Upside tiers — (Fase 2 / achado A1) peso REDUZIDO no DEFENSIVO.
            // O upside deriva de Graham/Bazin, que estruturalmente acham "caras" as
            // compounders de alta qualidade (alto ROE / alto P/VP) e "baratas" cíclicas no
            // topo do ciclo. Como pilar de um perfil Buy & Hold de décadas isso é
            // contraproducente: premiava barganha contábil em vez de durabilidade. O bônus
            // máximo cai de +15 → +8 e o tier marginal (>10%) deixa de pontuar (+3 → +0).
            // Ver ANALISE_RANKINGS_VERTICE_2026-06.txt §2.6 achado A e §2.7 Ações BR item 1.
            if (upside >= 0.30) { defScore += 8; audit.DEFENSIVE.push({ factor: 'Upside Forte (>30%)', points: 8, type: 'bonus' }); }
            else if (upside >= 0.20) { defScore += 5; audit.DEFENSIVE.push({ factor: 'Upside Moderado (>20%)', points: 5, type: 'bonus' }); }
            else if (upside >= 0.15) { defScore += 3; audit.DEFENSIVE.push({ factor: 'Upside Positivo (>15%)', points: 3, type: 'bonus' }); }

            // P/VP penalties: novo tier intermediário
            if (m.pvp > 3.0) { defScore -= 10; audit.DEFENSIVE.push({ factor: 'P/VP Muito Esticado (>3.0)', points: -10, type: 'penalty' }); }
            else if (m.pvp > 2.0) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'P/VP Elevado (>2.0)', points: -5, type: 'penalty' }); }

            // Beta tiers: bônus para ultra-defensivos, penalidade mais severa para voláteis.
            // Beta ausente chega como 0 — exigir > 0 evita dar bônus de "ultra defensivo"
            // a ativo sem série de preços suficiente para calcular beta.
            if (m.beta > 0 && m.beta < 0.70) { defScore += 5; audit.DEFENSIVE.push({ factor: 'Beta Defensivo (<0.7)', points: 5, type: 'bonus' }); }
            else if (m.beta >= 1.5) { defScore -= 15; audit.DEFENSIVE.push({ factor: 'Beta Muito Alto (≥1.5)', points: -15, type: 'penalty' }); }
            else if (m.beta > 1.2) { defScore -= 8; audit.DEFENSIVE.push({ factor: 'Beta Alto (>1.2)', points: -8, type: 'penalty' }); }

            // Volatilidade anual: ativo defensivo não deve oscilar 30%+ ao ano
            const stockVol = m.volatility || 20;
            if (stockVol > 40) { defScore -= 20; audit.DEFENSIVE.push({ factor: 'Volatilidade Muito Alta (>40%)', points: -20, type: 'penalty' }); }
            else if (stockVol > 30) { defScore -= 10; audit.DEFENSIVE.push({ factor: 'Volatilidade Elevada (>30%)', points: -10, type: 'penalty' }); }

            // Payout acima de 100%: DY inflado por distribuição além do lucro — risco real de corte
            if (!m._missing?.payout && m.payout > 150) { defScore -= 30; audit.DEFENSIVE.push({ factor: `Payout Insustentável (${m.payout.toFixed(1)}%)`, points: -30, type: 'penalty' }); }
            else if (!m._missing?.payout && m.payout > 100) { defScore -= 20; audit.DEFENSIVE.push({ factor: `Payout Acima do Lucro (${m.payout.toFixed(1)}%)`, points: -20, type: 'penalty' }); }
            else if (!m._missing?.payout && m.payout >= 30 && m.payout <= 85) { defScore += 5; audit.DEFENSIVE.push({ factor: `Payout Saudável (${m.payout.toFixed(1)}%)`, points: 5, type: 'bonus' }); }

            // Alavancagem: empresa com dívida crítica não é defensiva, mesmo com bons dividendos.
            // Reutiliza o mesmo cálculo derivado usado no structural Risk score.
            const isFinancialSectorForLev = isFinancialSector(asset.sector, ['Financials', 'Financial']);
            if (!isFinancialSectorForLev) {
                const ev = (m.marketCap || 0) + (m.netDebt || 0);
                if (m.evEbitda > 0 && ev > 0) {
                    const ebitda = ev / m.evEbitda;
                    const dlEbitda = m.netDebt / ebitda;
                    if (dlEbitda > 3.5) {
                        defScore -= 15;
                        audit.DEFENSIVE.push({ factor: `Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -15, type: 'penalty' });
                    } else if (dlEbitda > 2.5) {
                        defScore -= 8;
                        audit.DEFENSIVE.push({ factor: `Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -8, type: 'penalty' });
                    }
                }
            }

            // ── (Fase 3 / achado B-A2) CONSISTÊNCIA / TRACK RECORD ───────────────────
            // Só age quando há série temporal de fundamentos suficiente (m.trackRecord != null);
            // dormente até a coleta acumular (não há histórico retroativo). Premia CONTINUIDADE
            // — sustentou rentabilidade e pagou dividendo ao longo de períodos distintos — e não
            // o instante atual, que já é pontuado acima (evita o double-count que a Fase 2 corrigiu
            // no DY). Magnitude pequena e CALIBRÁVEL por backtest quando houver profundidade de
            // série (ANALISE_RANKINGS_VERTICE_2026-06.txt §2.7 Ações BR item 2; §2.10 Fase 3).
            const tr = m.trackRecord;
            if (tr) {
                if (tr.roeConsistency >= 0.8) {
                    defScore += 4;
                    audit.DEFENSIVE.push({ factor: `Rentabilidade Consistente (ROE sólido em ${Math.round(tr.roeConsistency * 100)}% dos períodos)`, points: 4, type: 'bonus' });
                } else if (tr.roeConsistency >= 0.6) {
                    defScore += 2;
                    audit.DEFENSIVE.push({ factor: 'Rentabilidade Majoritariamente Consistente (track record)', points: 2, type: 'bonus' });
                }
                if (m.dy > 0 && tr.dividendConsistency >= 0.8) {
                    defScore += 3;
                    audit.DEFENSIVE.push({ factor: `Pagador Consistente de Dividendos (${Math.round(tr.dividendConsistency * 100)}% dos períodos)`, points: 3, type: 'bonus' });
                }
            }
        } else {
            defScore = 30;
            audit.DEFENSIVE.push({ factor: 'Ineligível para Carteira Defensiva', points: 30, type: 'base' });
        }

        // ── MODERADO ──────────────────────────────────────────────────────────────
        // Base reduzida 60→40. Bônus progressivos em crescimento, ROE e upside.
        if (m.marketCap > 2000000000) {
            modScore = 40;
            audit.MODERATE.push({ factor: 'Score Base (Mid/Large Cap)', points: 40, type: 'base' });

            // Revenue growth tiers
            if (effectiveRevenueGrowth > 30) { modScore += 22; audit.MODERATE.push({ factor: 'Crescimento Receita Excepcional (>30%)', points: 22, type: 'bonus' }); }
            else if (effectiveRevenueGrowth > 20) { modScore += 16; audit.MODERATE.push({ factor: 'Crescimento Receita Alto (>20%)', points: 16, type: 'bonus' }); }
            else if (effectiveRevenueGrowth > 10) { modScore += 10; audit.MODERATE.push({ factor: 'Crescimento Receita > 10%', points: 10, type: 'bonus' }); }
            else if (effectiveRevenueGrowth > 5) { modScore += 4; audit.MODERATE.push({ factor: 'Crescimento Receita Moderado (>5%)', points: 4, type: 'bonus' }); }

            // ROE tiers
            if (m.roe > 20) { modScore += 15; audit.MODERATE.push({ factor: 'ROE Excelente (>20%)', points: 15, type: 'bonus' }); }
            else if (m.roe > 15) { modScore += 10; audit.MODERATE.push({ factor: 'ROE Robusto (>15%)', points: 10, type: 'bonus' }); }
            else if (m.roe > 12) { modScore += 7; audit.MODERATE.push({ factor: 'ROE Saudável (>12%)', points: 7, type: 'bonus' }); }
            else if (m.roe > 10) { modScore += 3; audit.MODERATE.push({ factor: 'ROE Positivo (>10%)', points: 3, type: 'bonus' }); }

            // Upside tiers
            if (upside > 0.40) { modScore += 20; audit.MODERATE.push({ factor: 'Upside Agressivo (>40%)', points: 20, type: 'bonus' }); }
            else if (upside > 0.30) { modScore += 15; audit.MODERATE.push({ factor: 'Upside Alto (>30%)', points: 15, type: 'bonus' }); }
            else if (upside > 0.20) { modScore += 10; audit.MODERATE.push({ factor: 'Upside > 20%', points: 10, type: 'bonus' }); }
            else if (upside > 0.10) { modScore += 5; audit.MODERATE.push({ factor: 'Upside Positivo (>10%)', points: 5, type: 'bonus' }); }

            // Bancos e holdings: margem contábil incomparável — não penalizar
            const hasAnomalousMargin = m.netMargin > 100 || (isFinancialSec && m.netMargin === 0);
            if (!hasAnomalousMargin && !m._missing?.netMargin && m.netMargin < 5) {
                modScore -= 15;
                audit.MODERATE.push({ factor: 'Margem Líquida Baixa (<5%)', points: -15, type: 'penalty' });
            }

            // ROE < Selic com buffer de 0.5% para evitar penalizar casos borderline
            const selic = MACRO.SELIC || DEFAULT_SELIC_FALLBACK;
            if (!isFinancialSec && !m._missing?.roe && m.roe > 0 && m.roe < (selic - 0.5)) {
                const roePenalty = m.roe < selic / 2 ? 20 : 10;
                modScore -= roePenalty;
                audit.MODERATE.push({ factor: `ROE Abaixo da Selic (${m.roe.toFixed(1)}% < ${selic.toFixed(1)}%)`, points: -roePenalty, type: 'penalty' });
            }

            // Payout acima de 100%: distribuição além do lucro é risco de sustentabilidade
            if (!m._missing?.payout && m.payout > 100) {
                modScore -= 10;
                audit.MODERATE.push({ factor: `Payout Insustentável (${m.payout.toFixed(1)}%)`, points: -10, type: 'penalty' });
            }

            // (Fase 3 / achado B-A2) Crescimento de receita SUSTENTADO ao longo do tempo
            // (não só o CAGR corrente). Dormente até haver série; magnitude calibrável.
            if (m.trackRecord && m.trackRecord.revenuePositive >= 0.8) {
                modScore += 3;
                audit.MODERATE.push({ factor: `Crescimento de Receita Sustentado (${Math.round(m.trackRecord.revenuePositive * 100)}% dos períodos)`, points: 3, type: 'bonus' });
            }
        } else {
            modScore = 25;
            audit.MODERATE.push({ factor: 'Score Base (Small Cap)', points: 25, type: 'base' });
        }

        // ── ARROJADO ──────────────────────────────────────────────────────────────
        // Base reduzida 50→35. Bônus tiered em PEG, crescimento e upside.
        // Sem PEG gate em >15% — gate reduzido para >10% para capturar mais oportunidades.
        boldScore = 35;
        audit.BOLD.push({ factor: 'Base Arrojada', points: 35, type: 'base' });
        const effectivePegForBold = effectiveRevenueGrowth > 0 ? m.pl / effectiveRevenueGrowth : 0;

        // PEG tiers: gate em >10% de crescimento efetivo
        if (effectiveRevenueGrowth > 10) {
            if (effectivePegForBold > 0 && effectivePegForBold < 0.5) { boldScore += 30; audit.BOLD.push({ factor: 'PEG Excepcional (<0.5)', points: 30, type: 'bonus' }); }
            else if (effectivePegForBold < 1.0) { boldScore += 22; audit.BOLD.push({ factor: 'PEG Excelente (<1.0)', points: 22, type: 'bonus' }); }
            else if (effectivePegForBold < 1.5) { boldScore += 12; audit.BOLD.push({ factor: 'PEG Saudável (<1.5)', points: 12, type: 'bonus' }); }
            else if (effectivePegForBold < 2.0) { boldScore += 5; audit.BOLD.push({ factor: 'PEG Razoável (<2.0)', points: 5, type: 'bonus' }); }
        }

        // Revenue growth tiers (acumulativo ao PEG)
        if (effectiveRevenueGrowth > 40) { boldScore += 25; audit.BOLD.push({ factor: 'Hyper Growth Extremo (>40%)', points: 25, type: 'bonus' }); }
        else if (effectiveRevenueGrowth > 25) { boldScore += 15; audit.BOLD.push({ factor: 'Hyper Growth (>25%)', points: 15, type: 'bonus' }); }
        else if (effectiveRevenueGrowth > 15) { boldScore += 8; audit.BOLD.push({ factor: 'Crescimento Sólido (>15%)', points: 8, type: 'bonus' }); }

        // Upside tiers
        if (upside > 0.80) { boldScore += 30; audit.BOLD.push({ factor: 'Upside Extremo (>80%)', points: 30, type: 'bonus' }); }
        else if (upside > 0.50) { boldScore += 20; audit.BOLD.push({ factor: 'Upside Agressivo (>50%)', points: 20, type: 'bonus' }); }
        else if (upside > 0.30) { boldScore += 10; audit.BOLD.push({ factor: 'Upside Relevante (>30%)', points: 10, type: 'bonus' }); }
        else if (upside > 0.20) { boldScore += 5; audit.BOLD.push({ factor: 'Upside Moderado (>20%)', points: 5, type: 'bonus' }); }

        // Volatility penalties: novo tier intermediário
        if ((m.volatility || 30) > 60) { boldScore -= 20; audit.BOLD.push({ factor: 'Volatilidade Extrema (>60%)', points: -20, type: 'penalty' }); }
        else if ((m.volatility || 30) > 45) { boldScore -= 10; audit.BOLD.push({ factor: 'Volatilidade Alta (>45%)', points: -10, type: 'penalty' }); }

        // Payout acima de 100%: mesma penalidade do perfil Defensivo — distribuição
        // além do lucro é risco real independente do perfil de risco do investidor
        if (!m._missing?.payout && m.payout > 100) {
            boldScore -= 20;
            audit.BOLD.push({ factor: `Payout Insustentável (${m.payout.toFixed(1)}%)`, points: -20, type: 'penalty' });
        }

        // ── PENALIDADE DE SOBREVALORIZAÇÃO (comum a todos os perfis) ──────────────
        const hasMeaningfulFairPrice = valuationData.grahamPrice > 0 || valuationData.bazinPrice > 0;
        if (hasMeaningfulFairPrice && upside < -0.10) {
            const pct = (Math.abs(upside) * 100).toFixed(0);
            let boldModPenalty, defPenalty;
            if (upside < -0.25) {
                boldModPenalty = 40;
                defPenalty = 20;
            } else {
                boldModPenalty = 25;
                defPenalty = 10;
            }
            boldScore -= boldModPenalty;
            modScore -= boldModPenalty;
            defScore -= defPenalty;
            audit.BOLD.push({ factor: `Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, points: -boldModPenalty, type: 'penalty' });
            audit.MODERATE.push({ factor: `Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, points: -boldModPenalty, type: 'penalty' });
            audit.DEFENSIVE.push({ factor: `Sobrevalorizado (preço ${pct}% acima do Preço Justo)`, points: -defPenalty, type: 'penalty' });
        }

        // ── (Fase 2 / achado K) SOBREPREÇO DE GROWTH CARO — sem âncora de valor ──────
        // Quando NÃO há preço justo significativo (sem LPA/VPA positivos para Graham e sem
        // dividendo para Bazin), o teto de preço sumia: uma ação de P/L extremo passava sem
        // qualquer penalidade de sobrepreço, restando só a guarda de SMA200 (achado K).
        // Aqui o múltiplo ABSOLUTO extremo vira penalidade graduada, mutuamente exclusiva
        // com a sobrevalorização acima (só dispara quando aquela não pôde agir). Direção
        // espelha a sobrevalorização — Defensivo/Moderado levam cheio; Arrojado tolera
        // growth. Limiar P/L≥80 é o citado no próprio achado K; só age com P/L presente.
        if (!hasMeaningfulFairPrice && m.pl > 0 && !m._missing?.pl) {
            let defK = 0, modK = 0, boldK = 0, band = '';
            if (m.pl >= 80) { defK = 20; modK = 15; boldK = 8; band = '≥80'; }
            else if (m.pl >= 50) { defK = 10; modK = 8; boldK = 4; band = '≥50'; }
            if (defK > 0) {
                defScore -= defK; modScore -= modK; boldScore -= boldK;
                audit.DEFENSIVE.push({ factor: `Múltiplo Caro sem Âncora de Valor (P/L ${band})`, points: -defK, type: 'penalty' });
                audit.MODERATE.push({ factor: `Múltiplo Caro sem Âncora de Valor (P/L ${band})`, points: -modK, type: 'penalty' });
                audit.BOLD.push({ factor: `Múltiplo Caro sem Âncora de Valor (P/L ${band})`, points: -boldK, type: 'penalty' });
            }
        }

        // ── PENALIDADE DE TENDÊNCIA DE BAIXA (momentum) ──────────────────────────
        // Ações muito baratas em queda ESTRUTURAL (preço bem abaixo da SMA200) eram
        // "value traps": o scoring premiava P/L e ROE e ignorava o downtrend, então a
        // carteira acumulava facas caindo (LAVV3/AZZA3/VULC3 caíram -20% a -40% sendo
        // re-selecionadas o tempo todo). Aqui o desvio negativo da SMA200 vira penalidade
        // graduada — sinal de momentum que faltava. Defensivo/Moderado levam cheio (não
        // devem segurar faca caindo); Arrojado tolera um pouco mais (apostas de reversão).
        const isCyclical = isCyclicalSector(asset.sector);
        if (m.sma200 > 0 && asset.price > 0) {
            const devSMA = (asset.price - m.sma200) / m.sma200;
            let trendPenalty = 0;
            if (devSMA < -0.25) trendPenalty = 20;       // >25% abaixo: downtrend severo
            else if (devSMA < -0.15) trendPenalty = 12;  // 15–25% abaixo
            else if (devSMA < -0.08) trendPenalty = 6;   // 8–15% abaixo
            if (trendPenalty > 0) {
                const pctBelow = (Math.abs(devSMA) * 100).toFixed(0);
                // Arrojado tolera mais (aposta de reversão) → 0.7× do sinal base.
                const boldTrend = Math.round(trendPenalty * 0.7);
                // Downtrend estrutural numa cíclica é sinal mais forte de reversão de ciclo
                // que numa não-cíclica — amplifica só Defensivo/Moderado, não o Arrojado.
                if (isCyclical) trendPenalty = Math.round(trendPenalty * CYCLICAL_TREND_MULTIPLIER);
                defScore -= trendPenalty;
                modScore -= trendPenalty;
                boldScore -= boldTrend;
                audit.DEFENSIVE.push({ factor: `Tendência de Baixa (preço ${pctBelow}% abaixo da SMA200)`, points: -trendPenalty, type: 'penalty' });
                audit.MODERATE.push({ factor: `Tendência de Baixa (preço ${pctBelow}% abaixo da SMA200)`, points: -trendPenalty, type: 'penalty' });
                audit.BOLD.push({ factor: `Tendência de Baixa (preço ${pctBelow}% abaixo da SMA200)`, points: -boldTrend, type: 'penalty' });
            }
        } else {
            // (G) SMA200 ausente (ativo novo, histórico curto ou falha do worker de séries):
            // a trava anti-value-trap não pôde agir. Registra para não degradar em silêncio —
            // exatamente onde o Defensivo mais depende dela.
            const note = { factor: 'Tendência (SMA200) indisponível — guarda de momentum inativa', points: 0, type: 'info' };
            audit.DEFENSIVE.push({ ...note });
            audit.MODERATE.push({ ...note });
            audit.BOLD.push({ ...note });
        }

        // ── SETOR CÍCLICO — desconto de pico de ciclo + sensibilidade a juros ────────
        // Cíclicas (INDUSTRIAL/COMMODITIES) já são barradas do gate Defensivo, mas ainda
        // pontuam em MODERATE/BOLD. Dois riscos que o snapshot pontual não captura:
        //   (a) PICO DE CICLO: P/L baixo + margem/ROE elevados + preço em downtrend é o
        //       padrão de lucro inflado rolando o topo — "barato" é ilusório (caso SHUL4).
        //   (b) JUROS ALTOS: SELIC elevada contrai capex industrial/agro — vento contra
        //       estrutural para a cíclica, independente do preço.
        // Poupam o Arrojado (aposta de reversão é legítima lá). Registram fator explícito.
        if (isCyclical) {
            const belowSMA = m.sma200 > 0 && asset.price > 0 && asset.price < m.sma200;
            const peakEarnings = m.pl > 0 && m.pl < CYCLICAL_PEAK_PL_FLOOR
                && (m.netMargin > 12 || m.roe > 18);
            if (peakEarnings && belowSMA) {
                defScore -= CYCLICAL_PEAK_DEF_DISCOUNT;
                modScore -= CYCLICAL_PEAK_MOD_DISCOUNT;
                audit.DEFENSIVE.push({ factor: `Pico de Ciclo (P/L ${m.pl.toFixed(1)} baixo + margem alta em queda)`, points: -CYCLICAL_PEAK_DEF_DISCOUNT, type: 'penalty' });
                audit.MODERATE.push({ factor: `Pico de Ciclo (P/L ${m.pl.toFixed(1)} baixo + margem alta em queda)`, points: -CYCLICAL_PEAK_MOD_DISCOUNT, type: 'penalty' });
            }
            const selic = MACRO.SELIC || DEFAULT_SELIC_FALLBACK;
            if (selic >= RATE_SENSITIVE_SELIC_HIGH) {
                defScore -= CYCLICAL_RATE_DEF_DISCOUNT;
                modScore -= CYCLICAL_RATE_MOD_DISCOUNT;
                audit.DEFENSIVE.push({ factor: `Setor Cíclico em Ciclo Desfavorável (Selic ${selic.toFixed(2)}%)`, points: -CYCLICAL_RATE_DEF_DISCOUNT, type: 'penalty' });
                audit.MODERATE.push({ factor: `Setor Cíclico em Ciclo Desfavorável (Selic ${selic.toFixed(2)}%)`, points: -CYCLICAL_RATE_MOD_DISCOUNT, type: 'penalty' });
            }
        }

        // ── GOVERNANÇA — controle estatal (eixo ortogonal ao setor) ──────────────────
        // Estatais (Petrobras, BB, Sanepar, Cemig, Copasa, Banrisul, BB Seguridade)
        // têm dividendo/alocação de capital DISCRICIONÁRIOS pelo controlador político.
        // O gate de setor seguro deixa banco/utility estatal entrar no Defensivo como
        // qualquer privada; aqui aplicamos o desconto que faltava para que a estatal
        // ranqueie ABAIXO de uma privada de fundamentos equivalentes — sem barrá-la
        // (estatal pode ser bom ativo). Poupa o BOLD (aposta não se importa com quem
        // controla). Lista curada em sectorTaxonomy (isStateControlled). US não casa.
        if (isStateControlled(asset.ticker)) {
            defScore -= GOVERNANCE_STATE_DEF_DISCOUNT;
            modScore -= GOVERNANCE_STATE_MOD_DISCOUNT;
            audit.DEFENSIVE.push({ factor: 'Controle Estatal (dividendo/gestão discricionários)', points: -GOVERNANCE_STATE_DEF_DISCOUNT, type: 'penalty' });
            audit.MODERATE.push({ factor: 'Controle Estatal (dividendo/gestão discricionários)', points: -GOVERNANCE_STATE_MOD_DISCOUNT, type: 'penalty' });
        }

        // ── ALAVANCAGEM CRÍTICA — desconto em MODERATE/BOLD ──────────────────────────
        // O desconto de DL/EBITDA elevado já existia, mas só dentro do bloco Defensivo
        // (e só quando o ativo já era ELEGÍVEL a ele) e no sub-score estrutural de Risco
        // — que é só tiebreaker/exibição, nunca input do score de MODERATE/BOLD. Uma ação
        // com alavancagem "Crítica" podia liderar o ranking geral em BOLD sem nenhum
        // desconto por dívida (caso MTRE3: DL/EBITDA 4.1x, #1 geral em BOLD score 99).
        // MODERATE/BOLD toleram volatilidade por natureza, mas risco de SOLVÊNCIA é
        // dimensão distinta — mesmo aposta especulativa deve descontar por risco de
        // default. Não soma ao -15/-8 já aplicado dentro do Defensivo elegível (evita
        // duplo desconto); setor financeiro fica de fora (dívida é insumo do negócio).
        const isFinancialSecForLev = isFinancialSector(asset.sector, ['Financial', 'Insurance', 'Holding']);
        if (!isFinancialSecForLev) {
            const evLev = (m.marketCap || 0) + (m.netDebt || 0);
            if (m.evEbitda > 0 && evLev > 0) {
                const ebitdaLev = evLev / m.evEbitda;
                const dlEbitdaLev = m.netDebt / ebitdaLev;
                if (dlEbitdaLev > 3.5) {
                    criticalLeverage = true;
                    modScore -= LEVERAGE_CRITICAL_MOD_DISCOUNT;
                    boldScore -= LEVERAGE_CRITICAL_BOLD_DISCOUNT;
                    audit.MODERATE.push({ factor: `Alavancagem Crítica (DL/EBITDA: ${dlEbitdaLev.toFixed(1)}x)`, points: -LEVERAGE_CRITICAL_MOD_DISCOUNT, type: 'penalty' });
                    audit.BOLD.push({ factor: `Alavancagem Crítica (DL/EBITDA: ${dlEbitdaLev.toFixed(1)}x)`, points: -LEVERAGE_CRITICAL_BOLD_DISCOUNT, type: 'penalty' });
                } else if (dlEbitdaLev > 2.5) {
                    modScore -= LEVERAGE_ELEVATED_MOD_DISCOUNT;
                    boldScore -= LEVERAGE_ELEVATED_BOLD_DISCOUNT;
                    audit.MODERATE.push({ factor: `Alavancagem Elevada (DL/EBITDA: ${dlEbitdaLev.toFixed(1)}x)`, points: -LEVERAGE_ELEVATED_MOD_DISCOUNT, type: 'penalty' });
                    audit.BOLD.push({ factor: `Alavancagem Elevada (DL/EBITDA: ${dlEbitdaLev.toFixed(1)}x)`, points: -LEVERAGE_ELEVATED_BOLD_DISCOUNT, type: 'penalty' });
                }
            }
        }
    }

    // ── TETO ESPECULATIVO — empresa sem lucro (BR e Exterior) ────────────────────
    // PEG/Hyper Growth/Upside cravavam 100 no Arrojado para teses SEM LUCRO (ex.: biotechs
    // TARS margem −9% / ARQT margem −0,6%): PEG e crescimento são sinais inválidos quando o
    // lucro é negativo, então elas encabeçavam o ranking acima de nomes lucrativos (TGTX
    // margem +66%, SMCI). Empresa sem lucro é APOSTA: segue elegível como COMPRAR no
    // Arrojado, mas com teto — não simula convicção máxima nem ofusca quem dá lucro.
    // Estendido ao BR `STOCK` (antes só US): ações com P/L negativo (ex.: AURE3 P/L −22)
    // chegavam a 82 BUY sem nenhum aviso. Gatilho: netMargin ≤ 0 conhecido, OU P/L < 0,
    // OU ROE < 0 conhecido (valores negativos são dado PRESENTE — _missing só marca 0/falsy).
    // Não toca ETF/REIT/Ouro/FII/CRYPTO (scorers próprios).
    const isUnprofitable = (!m._missing?.netMargin && m.netMargin <= 0)
        || m.pl < 0
        || (!m._missing?.roe && m.roe < 0);
    if ((asset.type === 'STOCK_US' || asset.type === 'STOCK') && isUnprofitable) {
        const SPEC_BOLD_CAP = 82, SPEC_MOD_CAP = 72, SPEC_DEF_CAP = 55;
        if (boldScore > SPEC_BOLD_CAP) {
            audit.BOLD.push({ factor: 'Teto Especulativo (empresa sem lucro)', points: SPEC_BOLD_CAP - boldScore, type: 'penalty' });
            boldScore = SPEC_BOLD_CAP;
        }
        if (modScore > SPEC_MOD_CAP) {
            audit.MODERATE.push({ factor: 'Teto Especulativo (empresa sem lucro)', points: SPEC_MOD_CAP - modScore, type: 'penalty' });
            modScore = SPEC_MOD_CAP;
        }
        if (defScore > SPEC_DEF_CAP) {
            audit.DEFENSIVE.push({ factor: 'Teto Especulativo (empresa sem lucro)', points: SPEC_DEF_CAP - defScore, type: 'penalty' });
            defScore = SPEC_DEF_CAP;
        }
    }

    // ── TETO POR ALAVANCAGEM CRÍTICA (BR + Exterior) ─────────────────────────────
    // O desconto graduado (-15 BOLD / -20 MODERATE) não neutraliza múltiplos extremos:
    // uma micro-cap com DL/EBITDA > 3.5x e PEG<0.5 / upside>80% ainda liderava o ranking
    // (MTRE3: 99→84 em BOLD, seguia #2 geral). Risco de SOLVÊNCIA deve limitar a convicção
    // MÁXIMA independentemente de quão baratos estejam os múltiplos — análogo ao teto
    // especulativo de empresa sem lucro. Só toca MODERATE/BOLD (o Defensivo já barra via
    // gate/penalidade); financeiro já foi excluído na marcação de criticalLeverage.
    if ((asset.type === 'STOCK_US' || asset.type === 'STOCK') && criticalLeverage) {
        if (boldScore > LEVERAGE_CRITICAL_BOLD_CAP) {
            audit.BOLD.push({ factor: 'Teto por Alavancagem Crítica (DL/EBITDA > 3.5x)', points: LEVERAGE_CRITICAL_BOLD_CAP - boldScore, type: 'penalty' });
            boldScore = LEVERAGE_CRITICAL_BOLD_CAP;
        }
        if (modScore > LEVERAGE_CRITICAL_MOD_CAP) {
            audit.MODERATE.push({ factor: 'Teto por Alavancagem Crítica (DL/EBITDA > 3.5x)', points: LEVERAGE_CRITICAL_MOD_CAP - modScore, type: 'penalty' });
            modScore = LEVERAGE_CRITICAL_MOD_CAP;
        }
    }

    return { defScore, modScore, boldScore };
};

// (M1) Scoring por perfil de FII. Lógica idêntica à versão monolítica anterior.
const scoreFiiProfiles = (asset, context, audit) => {
    const { MACRO } = context;
    const m = asset.metrics;
    const NTNB = MACRO.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
    let defScore = 0, modScore = 0, boldScore = 0;
    {
        const isTier1 = asset.dbFlags?.isTier1 || false;
        const isPapel = resolvePapel(asset.fiiSubType, asset.sector);
        const yieldSpread = m.dy - NTNB;
        // Anti yield-trap: DY 12m acima do teto é quase sempre amortização de capital /
        // RCA / evento não recorrente — não renda sustentável. Sem esta guarda, FIIs
        // estressados (ex.: DY 47%) ganhavam o bônus máximo de "Yield Extremo" e viravam
        // BUY. O DEFENSIVE já é protegido pelo gate dy>18 do isEligibleForDefensive.
        const isYieldTrap = m.dy > FII_YIELD_TRAP_THRESHOLD;

        // ── DEFENSIVO ────────────────────────────────────────────────────────
        // Base reduzida de 65→40: bônus progressivos evitam que FIIs medianos
        // atinjam 100 trivialmente só por cumprir 3 critérios binários.
        if (isEligibleForDefensive(asset, context)) {
            defScore = 40;
            audit.DEFENSIVE.push({ factor: 'Score Base (FII Defensivo)', points: 40, type: 'base' });

            // Yield spread vs NTN-B: escala proporcional ao prêmio real entregue
            if (yieldSpread >= 5.0) {
                defScore += 22; audit.DEFENSIVE.push({ factor: `Yield Excepcional (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 22, type: 'bonus' });
            } else if (yieldSpread >= 3.0) {
                defScore += 18; audit.DEFENSIVE.push({ factor: `Yield Alto (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 18, type: 'bonus' });
            } else if (yieldSpread >= 1.5) {
                defScore += 12; audit.DEFENSIVE.push({ factor: 'Yield > NTN-B + 1.5%', points: 12, type: 'bonus' });
            } else if (yieldSpread >= 0.5) {
                defScore += 5; audit.DEFENSIVE.push({ factor: `Yield Moderado (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 5, type: 'bonus' });
            } else if (yieldSpread < 0) {
                defScore -= 10; audit.DEFENSIVE.push({ factor: `Spread Negativo vs NTN-B (${yieldSpread.toFixed(1)}%)`, points: -10, type: 'penalty' });
            }

            // P/VP: bonifica zona próxima ao valor patrimonial; penaliza ágio excessivo
            if (isPapel) {
                if (m.pvp >= 0.95 && m.pvp <= 1.05) { defScore += 15; audit.DEFENSIVE.push({ factor: 'P/VP Equilibrado (Papel)', points: 15, type: 'bonus' }); }
                else if (m.pvp >= 0.88 && m.pvp < 0.95) { defScore += 10; audit.DEFENSIVE.push({ factor: 'P/VP com Deságio Leve (Papel)', points: 10, type: 'bonus' }); }
                else if (m.pvp > 1.05 && m.pvp <= 1.10) { defScore += 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Leve (Papel)', points: 5, type: 'bonus' }); }
                else if (m.pvp > 1.10) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Elevado (Papel)', points: -5, type: 'penalty' }); }
            } else {
                if (m.pvp >= 0.90 && m.pvp <= 1.05) { defScore += 15; audit.DEFENSIVE.push({ factor: 'P/VP Saudável (Tijolo)', points: 15, type: 'bonus' }); }
                else if (m.pvp >= 0.82 && m.pvp < 0.90) { defScore += 10; audit.DEFENSIVE.push({ factor: 'P/VP com Deságio (Tijolo)', points: 10, type: 'bonus' }); }
                else if (m.pvp > 1.05 && m.pvp <= 1.12) { defScore += 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Moderado (Tijolo)', points: 5, type: 'bonus' }); }
                else if (m.pvp > 1.12) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'P/VP com Ágio Elevado (Tijolo)', points: -5, type: 'penalty' }); }
            }

            // Beta: tiered — diferencia FIIs ultra-estáveis de apenas estáveis.
            // Beta ausente chega como 0 — exigir > 0 evita bônus indevido sem série de preços.
            if (m.beta > 0 && m.beta < 0.40) { defScore += 12; audit.DEFENSIVE.push({ factor: 'Beta Ultra Defensivo (<0.4)', points: 12, type: 'bonus' }); }
            else if (m.beta > 0 && m.beta < 0.70) { defScore += 7; audit.DEFENSIVE.push({ factor: 'Beta Defensivo (<0.7)', points: 7, type: 'bonus' }); }
            else if (m.beta > 0.90) { defScore -= 15; audit.DEFENSIVE.push({ factor: 'Beta Elevado (>0.9)', points: -15, type: 'penalty' }); }

            if (isTier1) { defScore += 8; audit.DEFENSIVE.push({ factor: 'Fundo Tier 1 (Elite)', points: 8, type: 'bonus' }); }

            // Liquidez como proxy de segurança patrimonial
            if (m.avgLiquidity > 5000000) { defScore += 6; audit.DEFENSIVE.push({ factor: 'Liquidez Alta (>5M)', points: 6, type: 'bonus' }); }
            else if (m.avgLiquidity > 2000000) { defScore += 3; audit.DEFENSIVE.push({ factor: 'Liquidez Boa (>2M)', points: 3, type: 'bonus' }); }

            // Diversificação de imóveis (Tijolo) — reduz risco concentração
            if (!isPapel) {
                if (m.qtdImoveis > 20) { defScore += 6; audit.DEFENSIVE.push({ factor: 'Alta Diversificação (>20 imóveis)', points: 6, type: 'bonus' }); }
                else if (m.qtdImoveis > 10) { defScore += 3; audit.DEFENSIVE.push({ factor: 'Boa Diversificação (>10 imóveis)', points: 3, type: 'bonus' }); }
            }

            // (Fase 3 / achado B-A2) Distribuição CONSISTENTE ao longo do tempo — o sinal
            // mais relevante para um FII de renda em Buy & Hold. Dormente até haver série
            // de fundamentos suficiente; magnitude pequena e calibrável.
            if (m.trackRecord && m.trackRecord.dividendConsistency >= 0.8) {
                defScore += 4;
                audit.DEFENSIVE.push({ factor: `Distribuição Consistente (${Math.round(m.trackRecord.dividendConsistency * 100)}% dos períodos)`, points: 4, type: 'bonus' });
            }
        } else {
            defScore = 25;
            audit.DEFENSIVE.push({ factor: 'Ineligível para Carteira Defensiva FII', points: 25, type: 'base' });
        }

        // ── MODERADO ─────────────────────────────────────────────────────────
        modScore = 45;
        audit.MODERATE.push({ factor: 'Score Base (Perfil Moderado FII)', points: 45, type: 'base' });

        if (isYieldTrap) {
            modScore -= 15; audit.MODERATE.push({ factor: `Yield Insustentável (${m.dy.toFixed(1)}% — provável amortização/evento não recorrente)`, points: -15, type: 'penalty' });
        } else if (yieldSpread >= 5.0) {
            modScore += 25; audit.MODERATE.push({ factor: `Yield Excepcional (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 25, type: 'bonus' });
        } else if (yieldSpread >= 3.0) {
            modScore += 18; audit.MODERATE.push({ factor: `Yield Alto (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 18, type: 'bonus' });
        } else if (yieldSpread >= 1.5) {
            modScore += 10; audit.MODERATE.push({ factor: 'Yield > NTN-B + 1.5%', points: 10, type: 'bonus' });
        } else if (yieldSpread >= 0) {
            modScore += 4; audit.MODERATE.push({ factor: `Yield Positivo (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 4, type: 'bonus' });
        } else {
            modScore -= 10; audit.MODERATE.push({ factor: `Spread Negativo vs NTN-B (${yieldSpread.toFixed(1)}%)`, points: -10, type: 'penalty' });
        }

        if (isPapel) {
            if (m.pvp < 0.90) { modScore += 12; audit.MODERATE.push({ factor: 'Deságio Expressivo em Papel (>10%)', points: 12, type: 'bonus' }); }
            else if (m.pvp < 0.95) { modScore += 7; audit.MODERATE.push({ factor: 'Deságio em Papel (5–10%)', points: 7, type: 'bonus' }); }
            else if (m.pvp < 1.00) { modScore += 3; audit.MODERATE.push({ factor: 'Deságio Leve em Papel', points: 3, type: 'bonus' }); }
        } else {
            if (m.capRate > (NTNB + 3)) { modScore += 10; audit.MODERATE.push({ factor: 'Cap Rate Excelente (>NTN-B + 3%)', points: 10, type: 'bonus' }); }
            else if (m.capRate > (NTNB + 1)) { modScore += 6; audit.MODERATE.push({ factor: 'Cap Rate > NTN-B + 1%', points: 6, type: 'bonus' }); }
            else if (m.capRate > NTNB) { modScore += 3; audit.MODERATE.push({ factor: 'Cap Rate > NTN-B', points: 3, type: 'bonus' }); }

            if (m.pvp < 0.80) { modScore += 12; audit.MODERATE.push({ factor: 'Deságio Expressivo em Tijolo (>20%)', points: 12, type: 'bonus' }); }
            else if (m.pvp < 0.90) { modScore += 7; audit.MODERATE.push({ factor: 'Deságio em Tijolo (10–20%)', points: 7, type: 'bonus' }); }
            else if (m.pvp < 0.95) { modScore += 3; audit.MODERATE.push({ factor: 'Deságio Leve em Tijolo', points: 3, type: 'bonus' }); }
        }

        if (m.avgLiquidity > 5000000) { modScore += 5; audit.MODERATE.push({ factor: 'Liquidez Alta (>5M)', points: 5, type: 'bonus' }); }
        else if (m.avgLiquidity > 2000000) { modScore += 3; audit.MODERATE.push({ factor: 'Liquidez Boa (>2M)', points: 3, type: 'bonus' }); }

        // Penalidade por vacância: relevante para moderados que ainda aceitam algum risco
        if (!isPapel) {
            if (m.vacancy > 15) { modScore -= 8; audit.MODERATE.push({ factor: `Vacância Alta (${m.vacancy.toFixed(1)}%)`, points: -8, type: 'penalty' }); }
            else if (m.vacancy > 10) { modScore -= 4; audit.MODERATE.push({ factor: `Vacância Moderada (${m.vacancy.toFixed(1)}%)`, points: -4, type: 'penalty' }); }
        }

        // ── ARROJADO ──────────────────────────────────────────────────────────
        boldScore = 35;
        audit.BOLD.push({ factor: 'Base Arrojada FII', points: 35, type: 'base' });

        if (isYieldTrap) {
            boldScore -= 10; audit.BOLD.push({ factor: `Yield Insustentável (${m.dy.toFixed(1)}% — provável amortização/evento não recorrente)`, points: -10, type: 'penalty' });
        } else if (yieldSpread >= 7.0) {
            boldScore += 35; audit.BOLD.push({ factor: `Yield Extremo (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 35, type: 'bonus' });
        } else if (yieldSpread >= 5.0) {
            boldScore += 25; audit.BOLD.push({ factor: 'Yield Agressivo (>NTN-B + 5%)', points: 25, type: 'bonus' });
        } else if (yieldSpread >= 3.0) {
            boldScore += 15; audit.BOLD.push({ factor: `Yield Arrojado (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 15, type: 'bonus' });
        } else if (yieldSpread >= 1.0) {
            boldScore += 7; audit.BOLD.push({ factor: `Yield Moderado (NTN-B +${yieldSpread.toFixed(1)}%)`, points: 7, type: 'bonus' });
        }

        if (isPapel) {
            if (m.pvp < 0.85) { boldScore += 25; audit.BOLD.push({ factor: 'Deságio Acentuado em Papel (>15%)', points: 25, type: 'bonus' }); }
            else if (m.pvp < 0.92) { boldScore += 15; audit.BOLD.push({ factor: 'Deságio Expressivo em Papel (8–15%)', points: 15, type: 'bonus' }); }
            else if (m.pvp < 0.97) { boldScore += 8; audit.BOLD.push({ factor: 'Deságio em Papel (3–8%)', points: 8, type: 'bonus' }); }
        } else {
            if (m.pvp < 0.75) { boldScore += 25; audit.BOLD.push({ factor: 'Deságio Extremo em Tijolo (>25%)', points: 25, type: 'bonus' }); }
            else if (m.pvp < 0.82) { boldScore += 18; audit.BOLD.push({ factor: 'Deságio Acentuado em Tijolo (18–25%)', points: 18, type: 'bonus' }); }
            else if (m.pvp < 0.90) { boldScore += 10; audit.BOLD.push({ factor: 'Deságio em Tijolo (10–18%)', points: 10, type: 'bonus' }); }
        }

        // Cap rate agressivo: imóveis com alta rentabilidade operacional
        if (!isPapel) {
            if (m.capRate > (NTNB + 5)) { boldScore += 10; audit.BOLD.push({ factor: 'Cap Rate Excepcional (>NTN-B + 5%)', points: 10, type: 'bonus' }); }
            else if (m.capRate > (NTNB + 3)) { boldScore += 5; audit.BOLD.push({ factor: 'Cap Rate Alto (>NTN-B + 3%)', points: 5, type: 'bonus' }); }
        }

    }
    return { defScore, modScore, boldScore };
};

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

    return { scores: finalScores, audit, isAristocrat };
};

const calculateStructuralScores = (asset, context) => {
    const m = asset.metrics;
    const type = asset.type;
    const ticker = asset.ticker;
    const usSub = usSubOf(asset);
    const isPlainStock = type === 'STOCK' || (type === 'STOCK_US' && (!usSub || usSub === 'STOCK'));
    const isPapel = resolvePapel(asset.fiiSubType, asset.sector);
    const clamp = (x) => Math.min(100, Math.max(0, x));
    const aboveTrend = m.sma200 > 0 && asset.price > m.sma200;
    const audit = { QUALITY: [], VALUATION: [], RISK: [] };
    let quality = 0; audit.QUALITY.push({ factor: 'Base de Qualidade', points: 0, type: 'base' });
    let valuation = 0; audit.VALUATION.push({ factor: 'Base de Valuation', points: 0, type: 'base' });
    let risk = 0;

    // ETF nacional temático (Cripto/Ouro/Renda Fixa): estrutural próprio, coerente com o
    // scorer de perfil correspondente. Precede o modelo genérico de cesta abaixo.
    const etfTheme = brEtfThemeOf(asset);
    if (type === 'ETF' && etfTheme === 'GOLD') {
        // Espelha o estrutural do ouro US (hedge): tendência + liquidez + volatilidade.
        let q = 60; if (aboveTrend) q += 12; if (m.avgLiquidity > 20000000) q += 8;
        quality = clamp(q); audit.QUALITY.push({ factor: 'Ouro: tendência e liquidez', points: q, type: 'bonus' });
        let v = 50; if (m.sma200 > 0) { const dev = (asset.price - m.sma200) / m.sma200; if (dev < -0.1) v += 20; else if (dev > 0.3) v -= 15; }
        valuation = clamp(v); audit.VALUATION.push({ factor: 'Ouro: posição vs média histórica', points: v, type: 'bonus' });
        let r = 65; if (m.volatility > 0 && m.volatility < 20) r += 10; else if (m.volatility > 40) r -= 15; if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) r -= 20;
        risk = clamp(r); audit.RISK.push({ factor: 'Ouro: hedge de baixa correlação', points: r, type: 'base' });
        return { quality, valuation, risk, audit };
    }
    if (type === 'ETF' && etfTheme === 'CRYPTO') {
        let q = 45; if (m.avgLiquidity > 20000000) q += 10; if (m.sma200 > 0 && asset.price > m.sma200) q += 10;
        quality = clamp(q); audit.QUALITY.push({ factor: 'ETF Cripto: liquidez e tendência', points: q, type: 'bonus' });
        let v = 50; if (m.sma200 > 0) { const dev = (asset.price - m.sma200) / m.sma200; if (dev < -0.2) v += 25; else if (dev < 0) v += 12; else if (dev > 0.5) v -= 20; else if (dev > 0.2) v -= 10; }
        valuation = clamp(v); audit.VALUATION.push({ factor: 'ETF Cripto: desvio da média histórica', points: v, type: 'bonus' });
        let r = 35; if (m.volatility > 0 && m.volatility < 40) r += 15; else if (m.volatility > 100) r -= 15; else if (m.volatility > 70) r -= 8; if (m.avgLiquidity > 20000000) r += 10; else if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) r -= 15;
        risk = clamp(r); audit.RISK.push({ factor: 'ETF Cripto: volatilidade e liquidez', points: r, type: 'base' });
        return { quality, valuation, risk, audit };
    }
    if (type === 'ETF' && etfTheme === 'FIXED_INCOME') {
        let q = 60; if (m.avgLiquidity > 5000000) q += 10; if (m.dy >= 4) q += 8;
        quality = clamp(q); audit.QUALITY.push({ factor: 'Renda Fixa: estabilidade e renda', points: q, type: 'bonus' });
        let v = 55; if (m.sma200 > 0 && asset.price > m.sma200) v += 10;
        valuation = clamp(v); audit.VALUATION.push({ factor: 'Renda Fixa: tendência de juros', points: v, type: 'bonus' });
        let r = 70; if (m.volatility > 0 && m.volatility < 12) r += 15; else if (m.volatility > 25) r -= 15; if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) r -= 15;
        risk = clamp(r); audit.RISK.push({ factor: 'Renda Fixa: baixa volatilidade', points: r, type: 'base' });
        return { quality, valuation, risk, audit };
    }

    if ((type === 'STOCK_US' && usSub === 'ETF') || type === 'ETF') {
        let q = 55; if (m.avgLiquidity > 50000000) q += 20; else if (m.avgLiquidity > 5000000) q += 10; if (m.dy >= 2) q += 10;
        quality = clamp(q); audit.QUALITY.push({ factor: 'ETF: liquidez/AUM e renda', points: q - 0, type: 'bonus' });
        let v = 50;
        if (m.sma200 > 0) { const dev = (asset.price - m.sma200) / m.sma200; if (dev < -0.1) v += 20; else if (dev < 0) v += 10; else if (dev > 0.3) v -= 15; }
        if (m.dy >= 3) v += 10;
        valuation = clamp(v); audit.VALUATION.push({ factor: 'ETF: posição vs média e yield', points: v, type: 'bonus' });
        // avgLiquidity=0 = não reportada pela fonte (não baixa liquidez real) → sem penalidade.
        let r = 55; if (m.avgLiquidity > 20000000) r += 20; else if (m.avgLiquidity > 0 && m.avgLiquidity < 1000000) r -= 20;
        if (m.volatility > 0) { if (m.volatility < 18) r += 15; else if (m.volatility > 35) r -= 20; }
        risk = clamp(r); audit.RISK.push({ factor: 'ETF: liquidez e volatilidade', points: r, type: 'base' });
        return { quality, valuation, risk, audit };
    }
    if (type === 'STOCK_US' && usSub === 'REIT') {
        let q = 45; if (m.dy >= 4) q += 25; else if (m.dy >= 2.5) q += 12; if (m.debtToEquity > 0 && m.debtToEquity < 1.5) q += 10;
        quality = clamp(q); audit.QUALITY.push({ factor: 'REIT: yield e alavancagem', points: q, type: 'bonus' });
        let v = 40; if (m.dy >= 5) v += 40; else if (m.dy >= 3.5) v += 25; else if (m.dy >= 2) v += 10; if (m.pvp > 0 && m.pvp < 1) v += 10;
        valuation = clamp(v); audit.VALUATION.push({ factor: 'REIT: dividend yield', points: v, type: 'bonus' });
        let r = 50; if (m.avgLiquidity > 20000000) r += 20; else if (m.avgLiquidity < 1000000) r -= 20; if (m.debtToEquity > 2) r -= 20; if (aboveTrend) r += 10;
        risk = clamp(r); audit.RISK.push({ factor: 'REIT: liquidez, dívida e tendência', points: r, type: 'base' });
        return { quality, valuation, risk, audit };
    }
    if (type === 'STOCK_US' && usSub === 'GOLD') {
        let q = 60; if (aboveTrend) q += 12; if (m.avgLiquidity > 20000000) q += 8;
        quality = clamp(q); audit.QUALITY.push({ factor: 'Ouro: tendência e liquidez', points: q, type: 'bonus' });
        let v = 50; if (m.sma200 > 0) { const dev = (asset.price - m.sma200) / m.sma200; if (dev < -0.1) v += 20; else if (dev > 0.3) v -= 15; }
        valuation = clamp(v); audit.VALUATION.push({ factor: 'Ouro: posição vs média histórica', points: v, type: 'bonus' });
        let r = 65; if (m.volatility > 0 && m.volatility < 20) r += 10; else if (m.volatility > 40) r -= 15; if (m.avgLiquidity < 1000000) r -= 20;
        risk = clamp(r); audit.RISK.push({ factor: 'Ouro: hedge de baixa correlação', points: r, type: 'base' });
        return { quality, valuation, risk, audit };
    }

    if (isPlainStock) {
        // --- QUALITY SCORE ---
        let qScore = 0;
        if (m.roe > 15) { qScore += 25; audit.QUALITY.push({ factor: 'ROE Elevado (>15%)', points: 25, type: 'bonus' }); }
        else if (m.roe > 10) { qScore += 15; audit.QUALITY.push({ factor: 'ROE Saudável (>10%)', points: 15, type: 'bonus' }); }
        else { audit.QUALITY.push({ factor: 'ROE Modesto / Baixo', points: 0, type: 'base' }); }
        
        // Holdings (>100%) e bancos (0%) têm margens contabilmente incomparáveis com empresas industriais.
        // Tratar como dado ausente evita bônus indevido para ITSA4 (200%) e penalidade falsa para BBDC4 (0%).
        const isFinancialForQuality = isFinancialSector(asset.sector, ['Holding']);
        const netMarginForScoring = (m.netMargin > 100 || (isFinancialForQuality && m.netMargin === 0)) ? null : m.netMargin;
        if (netMarginForScoring !== null) {
            if (netMarginForScoring > 10) { qScore += 25; audit.QUALITY.push({ factor: 'Margem Líquida Robusta (>10%)', points: 25, type: 'bonus' }); }
            else if (netMarginForScoring > 5) { qScore += 15; audit.QUALITY.push({ factor: 'Margem Líquida Regular (>5%)', points: 15, type: 'bonus' }); }
            else { audit.QUALITY.push({ factor: 'Margem Líquida Estreita', points: 0, type: 'base' }); }
        } else {
            audit.QUALITY.push({ factor: 'Margem N/A (Setor Financeiro/Holding)', points: 0, type: 'base' });
        }

        if (m.debtToEquity < 1.0) { qScore += 25; audit.QUALITY.push({ factor: 'Estrutura Capital Excelente (D/P < 1.0)', points: 25, type: 'bonus' }); }
        else if (m.debtToEquity < 2.0) { qScore += 15; audit.QUALITY.push({ factor: 'Alavancagem Controlada (D/P < 2.0)', points: 15, type: 'bonus' }); }
        else { audit.QUALITY.push({ factor: 'Alavancagem Elevada', points: -10, type: 'penalty' }); qScore -= 10; }

        if (m.revenueGrowth > 10) { qScore += 25; audit.QUALITY.push({ factor: 'Crescimento de Receita Sólido (>10%)', points: 25, type: 'bonus' }); }
        else if (m.revenueGrowth > 5) { qScore += 10; audit.QUALITY.push({ factor: 'Crescimento de Receita Moderado', points: 10, type: 'bonus' }); }

        // --- NOVO: SUSTENTABILIDADE DE DIVIDENDOS (PAYOUT) ---
        const payout = m.payout || 0;
        if (payout > 100) {
            qScore -= 30;
            audit.QUALITY.push({ factor: `Payout Insustentável (${payout.toFixed(1)}%)`, points: -30, type: 'penalty' });
        } else if (payout > 40 && payout < 85) {
            qScore += 15;
            audit.QUALITY.push({ factor: `Payout Saudável (${payout.toFixed(1)}%)`, points: 15, type: 'bonus' });
        } else if (payout > 0 && payout < 20) {
            qScore -= 5;
            audit.QUALITY.push({ factor: `Payout Muito Baixo (${payout.toFixed(1)}%)`, points: -5, type: 'penalty' });
        }

        quality = Math.min(100, Math.max(0, qScore));

        // --- VALUATION SCORE ---
        let vScore = 0;
        if (m.pl > 0 && m.pl < 10) { vScore += 30; audit.VALUATION.push({ factor: 'P/L Barato (<10)', points: 30, type: 'bonus' }); }
        else if (m.pl > 0 && m.pl < 15) { vScore += 15; audit.VALUATION.push({ factor: 'P/L Justo (<15)', points: 15, type: 'bonus' }); }

        if (m.pvp > 0 && m.pvp < 1.5) { vScore += 30; audit.VALUATION.push({ factor: 'P/VP Barato (<1.5)', points: 30, type: 'bonus' }); }
        else if (m.pvp > 0 && m.pvp < 2.5) { vScore += 15; audit.VALUATION.push({ factor: 'P/VP Justo (<2.5)', points: 15, type: 'bonus' }); }

        if (m.evEbitda > 0 && m.evEbitda < 8) { vScore += 20; audit.VALUATION.push({ factor: 'EV/EBITDA Atrativo (<8)', points: 20, type: 'bonus' }); }
        if (m.dy > 6) { vScore += 20; audit.VALUATION.push({ factor: 'Dividend Yield > 6%', points: 20, type: 'bonus' }); }

        valuation = Math.min(100, Math.max(0, vScore));

        // --- NOVO: SPREAD VS TESOURO (VALUATION PROFISSIONAL) ---
        const ntnb = context.MACRO?.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
        if (m.pl > 0) {
            const earningsYield = (1 / m.pl) * 100;
            const spread = earningsYield - ntnb;
            
            if (spread > 4) {
                valuation = Math.min(100, valuation + 20);
                audit.VALUATION.push({ factor: `Spread vs Tesouro Excelente (${spread.toFixed(1)}%)`, points: 20, type: 'bonus' });
            } else if (spread > 0) {
                valuation = Math.min(100, valuation + 10);
                audit.VALUATION.push({ factor: `Spread vs Tesouro Positivo (${spread.toFixed(1)}%)`, points: 10, type: 'bonus' });
            } else {
                valuation = Math.max(0, valuation - 20);
                audit.VALUATION.push({ factor: `Spread Negativo vs Tesouro (${spread.toFixed(1)}%)`, points: -20, type: 'penalty' });
            }
        }

        // --- RISK SCORE (Higher is Safer) ---
        let rScore = 50; audit.RISK.push({ factor: 'Base de Risco', points: 50, type: 'base' });
        if (m.marketCap > 10000000000) { rScore += 20; audit.RISK.push({ factor: 'Large Cap (Segurança)', points: 20, type: 'bonus' }); }
        else if (m.marketCap < 500000000) { rScore -= 20; audit.RISK.push({ factor: 'Micro Cap (Risco)', points: -20, type: 'penalty' }); }

        if (m.avgLiquidity > 5000000) { rScore += 10; audit.RISK.push({ factor: 'Liquidez Alta (>5M)', points: 10, type: 'bonus' }); }
        else if (m.avgLiquidity < 100000) { rScore -= 20; audit.RISK.push({ factor: 'Liquidez Crítica (<100k)', points: -20, type: 'penalty' }); }

        // --- REFINAMENTO: Penalidade por dívida alta (DL/EBITDA) ---
        const isFinancial = isFinancialSector(asset.sector, ['Financial', 'Insurance', 'Holding']);
        if (!isFinancial) {
            // Cálculo de EBITDA Derivado: EV = MarketCap + NetDebt. EV/EBITDA = EV / EBITDA => EBITDA = EV / (EV/EBITDA)
            const ev = (m.marketCap || 0) + (m.netDebt || 0);
            if (m.evEbitda > 0 && ev > 0) {
                const ebitda = ev / m.evEbitda;
                const dlEbitda = m.netDebt / ebitda;
                
                if (dlEbitda > 3.5) {
                    rScore -= 40;
                    audit.RISK.push({ factor: `Alavancagem Crítica (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -40, type: 'penalty' });
                } else if (dlEbitda > 2.5) {
                    rScore -= 15;
                    audit.RISK.push({ factor: `Alavancagem Elevada (DL/EBITDA: ${dlEbitda.toFixed(1)}x)`, points: -15, type: 'penalty' });
                } else if (dlEbitda < 1.0 && dlEbitda > -1) {
                    rScore += 10;
                    audit.RISK.push({ factor: 'Caixa Robusto / Baixa Alavancagem', points: 10, type: 'bonus' });
                }
            } else if (m.debtToEquity > 3.0) {
                rScore -= 40;
                audit.RISK.push({ factor: 'Dívida/Patrimônio Explosiva (>3.0)', points: -40, type: 'penalty' });
            } else if (m.debtToEquity > 1.5) {
                rScore -= 15;
                audit.RISK.push({ factor: 'Dívida/Patrimônio Elevada (>1.5)', points: -15, type: 'penalty' });
            }
        }

        risk = Math.min(100, Math.max(0, rScore));

    } else if (type === 'FII') {
        const ntnb = context.MACRO?.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
        const spread = m.dy - ntnb;

        // --- QUALITY FII ---
        let qScore = 40; audit.QUALITY.push({ factor: 'Base Qualidade FII', points: 40, type: 'base' });
        if (!isPapel) {
            // Penalidade de Vacância Linear: -3 pontos para cada 1% acima de 10%
            if (m.vacancy > 10) {
                const penalty = (m.vacancy - 10) * 3;
                qScore -= penalty;
                audit.QUALITY.push({ factor: `Vacância Elevada (${m.vacancy.toFixed(1)}%)`, points: -penalty, type: 'penalty' });
            } else if (m.vacancy < 5) {
                qScore += 20;
                audit.QUALITY.push({ factor: 'Vacância Baixa (<5%)', points: 20, type: 'bonus' });
            }
            
            if (m.qtdImoveis > 10) { qScore += 20; audit.QUALITY.push({ factor: 'Multi-propriedade (>10 imóveis)', points: 20, type: 'bonus' }); }
            else if (m.qtdImoveis > 5) { qScore += 10; audit.QUALITY.push({ factor: 'Boa diversificação (>5 imóveis)', points: 10, type: 'bonus' }); }
            else if (m.qtdImoveis === 1) { qScore -= 30; audit.QUALITY.push({ factor: 'Risco Mono-Ativo', points: -30, type: 'penalty' }); }
        } else {
            // Papel: Foco em Liquidez e Histórico (Proxy por Liquidez aqui)
            if (m.avgLiquidity > 5000000) { qScore += 30; audit.QUALITY.push({ factor: 'Liquidez Alta (Papel)', points: 30, type: 'bonus' }); }
            else if (m.avgLiquidity > 1000000) { qScore += 15; audit.QUALITY.push({ factor: 'Liquidez Saudável (Papel)', points: 15, type: 'bonus' }); }
        }
        
        // Bônus por Yield Real (Spread sobre inflação/NTNB)
        if (spread > 2) { qScore += 20; audit.QUALITY.push({ factor: 'Yield Real > 2%', points: 20, type: 'bonus' }); }
        
        quality = Math.min(100, Math.max(0, qScore));

        // --- VALUATION FII (Baseado em Spread vs NTN-B) ---
        let vScore = 0;
        
        // Lógica de Spread: O investidor exige prêmio sobre o Tesouro IPCA+
        // Prêmio ideal: > 2% para Tijolo, > 3% para Papel (Risco de Crédito)
        const requiredSpread = isPapel ? 3.0 : 2.0;

        // Anti yield-trap: DY acima do teto torna o spread não confiável (provável
        // amortização/evento) — não pode valer o bônus máximo de valuation.
        if (m.dy > FII_YIELD_TRAP_THRESHOLD) { vScore += 20; audit.VALUATION.push({ factor: `Spread Não Confiável (DY ${m.dy.toFixed(1)}% sugere amortização)`, points: 20, type: 'bonus' }); }
        else if (spread >= requiredSpread + 2) { vScore += 90; audit.VALUATION.push({ factor: 'Spread Excelente (>4-5%)', points: 90, type: 'bonus' }); }
        else if (spread >= requiredSpread) { vScore += 70; audit.VALUATION.push({ factor: 'Spread Saudável', points: 70, type: 'bonus' }); }
        else if (spread >= 0) { vScore += 40; audit.VALUATION.push({ factor: 'Spread Positivo', points: 40, type: 'bonus' }); }
        else { audit.VALUATION.push({ factor: `Spread Negativo vs Tesouro (${spread.toFixed(1)}%)`, points: 0, type: 'penalty' }); }

        // Ajuste por P/VP
        if (m.pvp < 0.90) { vScore += 10; audit.VALUATION.push({ factor: 'Deságio P/VP (<0.90)', points: 10, type: 'bonus' }); }
        else if (m.pvp > 1.10) { vScore -= 20; audit.VALUATION.push({ factor: 'Ágio Excessivo (>1.10)', points: -20, type: 'penalty' }); }

        valuation = Math.min(100, Math.max(0, vScore));

        // --- RISK FII ---
        let rScore = 50; audit.RISK.push({ factor: 'Base Risco FII', points: 50, type: 'base' });
        // Tiers granulares para criar variância real: antes quase todos travavam em 70 (base+liq>2M)
        if (m.avgLiquidity > 10000000) { rScore += 30; audit.RISK.push({ factor: 'Liquidez Institucional (>10M)', points: 30, type: 'bonus' }); }
        else if (m.avgLiquidity > 5000000) { rScore += 25; audit.RISK.push({ factor: 'Liquidez Alta (>5M)', points: 25, type: 'bonus' }); }
        else if (m.avgLiquidity > 2000000) { rScore += 20; audit.RISK.push({ factor: 'Liquidez Boa (>2M)', points: 20, type: 'bonus' }); }
        else if (m.avgLiquidity > 1000000) { rScore += 10; audit.RISK.push({ factor: 'Liquidez Mínima (>1M)', points: 10, type: 'bonus' }); }
        
        if (!isPapel) {
            if (m.vacancy > 20) { rScore -= 40; audit.RISK.push({ factor: 'Vacância Crítica (>20%)', points: -40, type: 'penalty' }); }
            if (m.qtdImoveis === 1) {
                rScore -= 50; audit.RISK.push({ factor: 'Risco Binário (Mono-Ativo)', points: -50, type: 'penalty' });
            } else if (m.qtdImoveis < 3) {
                rScore -= 20; audit.RISK.push({ factor: 'Baixa Diversificação', points: -20, type: 'penalty' });
            }
        } else {
            if (m.pvp > 1.15) { rScore -= 40; audit.RISK.push({ factor: 'Ágio em Papel (Risco Amortização)', points: -40, type: 'penalty' }); }
        }
        risk = Math.min(100, Math.max(0, rScore));

    } else if (type === 'CRYPTO') {
        // Quality: Baseado em dominância, liquidez e tendência de longo prazo (SMA200)
        let qScore = 40;
        if (['BTC', 'ETH'].includes(ticker)) qScore += 40;
        else if (m.marketCap > 20000000000) qScore += 20;
        else if (m.marketCap > 5000000000) qScore += 10;
        
        if (m.avgLiquidity > 1000000000) qScore += 10;
        
        // Tendência de longo prazo como proxy de qualidade/adoção
        if (m.sma200 && asset.price > m.sma200) qScore += 10;
        
        quality = Math.min(100, Math.max(0, qScore));

        // Valuation: Difícil em crypto. Usaremos desvio da SMA200 e EMA50 como proxy de "desconto" ou "esticado"
        let vScore = 50;
        if (['BTC', 'ETH'].includes(ticker)) vScore += 10; // Prêmio de segurança
        
        if (m.sma200 && asset.price > 0) {
            const deviationFromSMA = (asset.price - m.sma200) / m.sma200;
            if (deviationFromSMA < -0.20) vScore += 30; // Muito descontado em relação à média histórica
            else if (deviationFromSMA < 0) vScore += 15; // Levemente descontado
            else if (deviationFromSMA > 0.50) vScore -= 20; // Muito esticado (sobrecomprado)
            else if (deviationFromSMA > 0.20) vScore -= 10; // Esticado
        }
        valuation = Math.min(100, Math.max(0, vScore));

        // Risk: Inversamente proporcional à volatilidade, beta, tamanho e VMC
        let rScore = 50;
        if (m.marketCap > 50000000000) rScore += 20; 
        else if (m.marketCap < 1000000000) rScore -= 30; 
        
        const vmc = m.marketCap > 0 ? (m.avgLiquidity / m.marketCap) : 0;
        if (vmc > 0.02 && vmc < 0.15) rScore += 15; // VMC Saudável
        else if (vmc > 0.5) rScore -= 20; // Especulação
        else if (vmc < 0.005) rScore -= 30; // Sem liquidez

        if (m.avgLiquidity > 1000000000) rScore += 10;
        else if (m.avgLiquidity < 50000000) rScore -= 20;
        
        // Penaliza alta volatilidade
        if (m.volatility) {
            if (m.volatility > 100) rScore -= 30; // Volatilidade extrema anualizada
            else if (m.volatility > 70) rScore -= 15;
            else if (m.volatility < 40) rScore += 15; // Baixa volatilidade para crypto
        }
        
        risk = Math.min(100, Math.max(0, rScore));
    }

    return { quality, valuation, risk, audit };
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

        const valuationData = calculateIntrinsicValue(asset.metrics, asset.type, asset.price, context, asset.usSubType);
        const profileResult = calculateProfileScores(asset, valuationData, context);
        const structuralResult = calculateStructuralScores(asset, context);
        const thesisData = generateDynamicTheses(asset.metrics, asset.type, asset.ticker, context, valuationData, asset.price, asset.sector, asset.fiiSubType);
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

        return {
            ticker: asset.ticker,
            name: asset.name,
            sector: asset.sector,
            type: asset.type,
            usSubType: asset.usSubType || null,
            currentPrice: asset.price,
            targetPrice: valuationData.fairPrice,
            metrics: { 
                ...asset.metrics, 
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
            // Consumido pelo Brasil 10 (getTop5Defensive): sem este flag, ativos
            // reprovados no gate defensivo entravam na lista rotulados DEFENSIVE.
            isDefensiveEligible: isEligibleForDefensive(asset, context)
        };
    }
};
