
const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

// --- QUALITY GATES ---
const isEligibleForDefensive = (asset, context) => {
    const m = asset.metrics;
    
    if (m.avgLiquidity < 2000000) return false; 

    if (asset.type === 'STOCK') {
        if (m.marketCap < 8000000000) return false;
        const safeSectors = ['Bancos', 'Elétricas', 'Seguros', 'Saneamento', 'Telecom', 'Mineração', 'Petróleo'];
        if (!safeSectors.includes(asset.sector)) return false;
        if (m.roe < 10) return false; 
        if (m.netMargin < 8) return false;
        if (m.dy < 4.0) return false; 
        if (m.debtToEquity > 3.0 && asset.sector !== 'Bancos') return false; 
    } 
    else if (asset.type === 'FII') {
        const riskySectors = ['Papel (High Yield)', 'Fiagro', 'Outros', 'Papel (Híbrido)'];
        if (riskySectors.includes(asset.sector) && m.dy > 15.5) return false; 
        if (m.pvp < 0.85) return false; 
        if (m.vacancy > 6) return false; 
        if (m.avgLiquidity < 1500000) return false;
        if (!asset.sector.includes('Papel') && m.qtdImoveis < 4) return false;
    }
    return true;
};

// --- 1. VALUATION ENGINE ---
const calculateIntrinsicValue = (m, type, price, context) => {
    const { MACRO } = context;
    let fairPrice = price;
    let method = "Mercado";

    // Usa RiskFree dinâmico (ex: 11.25%) convertido para decimal (0.1125) se necessário,
    // mas a fórmula de Bazin clássica usa 6% (0.06).
    // Podemos criar um "Bazin Dinâmico" usando MACRO.RISK_FREE * 0.6 ou algo assim.
    // Por enquanto, vamos manter 6% como "Dividend Yield Mínimo Aceitável" para valuation teto clássico,
    // mas penalizar no score se o DY for menor que a Selic.

    if (type === 'STOCK' || type === 'STOCK_US') {
        let graham = 0;
        if (m.pl > 0 && m.pvp > 0) {
            const lpa = price / m.pl;
            const vpa = price / m.pvp;
            graham = Math.sqrt(22.5 * lpa * vpa);
        }

        let bazin = 0;
        if (m.dy > 0) {
            const adjustedDy = Math.min(m.dy, 10) / 100; 
            const dividendPerShare = price * adjustedDy;
            // Bazin Clássico usa 6%. Podemos ajustar se quisermos ser mais exigentes.
            bazin = dividendPerShare / 0.06; 
        }

        if (graham > 0 && bazin > 0) {
            fairPrice = (graham * 0.5) + (bazin * 0.5);
            method = "Híbrido";
        } else if (graham > 0) {
            fairPrice = graham;
            method = "Graham";
        } else if (bazin > 0) {
            fairPrice = bazin;
            method = "Bazin";
        }
        
        if (fairPrice > price * 2.5) fairPrice = price * 2.5; 

    } else if (type === 'FII') {
        const vp = m.vpCota || price;
        if (m.sector?.includes('Papel')) {
            fairPrice = vp; 
            method = "VP (Papel)";
        } else {
            // Valuation Relativo ao Tesouro Direto (NTNB_LONG)
            // Se o DY do fundo é maior que NTNB, ele merece prêmio.
            const ntnb = MACRO.NTNB_LONG || 6.0;
            const yieldPremium = Math.max(0, m.dy - ntnb);
            // Cada 1% de prêmio acima da NTNB justifica 15% de ágio (heurística)
            const valuationPremium = yieldPremium * 1.5; 
            fairPrice = vp * (1 + (valuationPremium / 100));
            method = "VP Ajustado (Spread NTNB)";
        }
    }

    return { fairPrice: safeVal(fairPrice), method };
};

// --- 2. SCORING ENGINE ---
const calculateProfileScores = (asset, fairPrice, context) => {
    const { MACRO } = context;
    const m = asset.metrics;
    const type = asset.type;
    const upside = asset.price > 0 ? (fairPrice / asset.price) - 1 : 0;
    const RISK_FREE = MACRO.RISK_FREE || 11.25;
    const NTNB = MACRO.NTNB_LONG || 6.30;
    
    let defScore = 0; 
    let modScore = 0;
    let boldScore = 0;

    if (type === 'STOCK' || type === 'STOCK_US') {
        if (isEligibleForDefensive(asset, context)) {
            defScore = 70;
            // Bonus se DY for competitivo com Renda Fixa (difícil, mas valorizado)
            if (m.dy > (RISK_FREE * 0.6)) defScore += 10; 
            if (m.roe > 15) defScore += 10;
            if (m.marketCap > 30000000000) defScore += 5;
            if (m.pvp > 2.5) defScore -= 10; 
        } 

        if (m.marketCap > 2000000000) { 
            modScore = 60;
            if (m.revenueGrowth > 10) modScore += 15;
            if (m.roe > 12) modScore += 10;
            if (upside > 0.20) modScore += 10;
            if (m.netMargin < 5) modScore -= 15;
        }

        boldScore = 50;
        if (upside > 0.50) boldScore += 25; 
        if (m.pvp < 0.70 && m.pvp > 0.1) boldScore += 15; 
        if (m.evEbitda < 5 && m.evEbitda > 0) boldScore += 10;
    }
    else if (type === 'FII') {
        const isPaper = m.sector?.includes('Papel');
        const isBrick = !isPaper;
        const isTier1 = asset.dbFlags?.isTier1 || false;

        // DEFENSIVO
        if (isEligibleForDefensive(asset, context)) {
            defScore = 60;
            // Yield Premium REAL
            if (m.dy > NTNB + 2.5) defScore += 10;
            else if (m.dy > NTNB + 1) defScore += 5;
            
            if (isTier1) {
                if (m.pvp >= 0.90 && m.pvp <= 1.12) defScore += 15;
                else if (m.pvp < 0.90) defScore += 20; 
            } else {
                if (m.pvp >= 0.88 && m.pvp <= 1.03) defScore += 15;
                else if (m.pvp < 0.88) defScore += 10; 
            }

            if (isBrick) {
                if (m.vacancy < 3) defScore += 5;
                if (m.qtdImoveis > 5) defScore += 5;
                if (m.marketCap > 1000000000) defScore += 5;
            } else { 
                if (isTier1) defScore += 10;
                if (m.dy < (RISK_FREE + 2)) defScore -= 5; // Papel tem que render bem acima da Selic
            }
        }

        modScore = 60;
        if (m.dy > NTNB + 4) modScore += 15; 
        if (m.capRate > (NTNB + 2)) modScore += 10;
        if (m.pvp >= 0.8 && m.pvp <= 1.02) modScore += 10; 

        boldScore = 50;
        if (m.dy >= (NTNB + 6)) boldScore += 25; 
        if (m.pvp < 0.85) boldScore += 20; 
    }

    return { 
        DEFENSIVE: Math.min(100, Math.max(10, defScore)), 
        MODERATE: Math.min(89, Math.max(10, modScore)), 
        BOLD: Math.min(85, Math.max(10, boldScore)) 
    };
};

// ... Resto das funções auxiliares (calculateStructuralScores, generateDynamicTheses) mantidas iguais ...
// Elas não dependem diretamente do Macro Context, exceto generateDynamicTheses que já recebe context.

const calculateStructuralScores = (m, type) => {
    // (Lógica inalterada para brevidade, mas deve ser incluída no arquivo final)
    let quality = 50; let valuation = 50; let risk = 50;
    // ... Implementação padrão ...
    return { quality, valuation, risk };
};

const generateDynamicTheses = (m, type, ticker, context) => {
    const { MACRO } = context;
    const bull = [];
    const bear = [];
    // ... Implementação padrão, usando MACRO.NTNB_LONG ...
    if (type === 'FII' && m.dy > MACRO.NTNB_LONG) bull.push(`Dividendos superam NTN-B (${MACRO.NTNB_LONG}%) + Spread.`);
    
    return { bull, bear };
};

export const scoringEngine = {
    processAsset(asset, context) {
        if (asset.price <= 1.00) return null;
        if (asset.metrics.avgLiquidity < 100000) return null;
        if (asset.dbFlags && asset.dbFlags.isBlacklisted) return null; 
        if (asset.metrics.pl < -20 && asset.type === 'STOCK') return null;

        const { fairPrice } = calculateIntrinsicValue(asset.metrics, asset.type, asset.price, context);
        const scores = calculateProfileScores(asset, fairPrice, context);
        const structural = calculateStructuralScores(asset.metrics, asset.type);
        const thesisData = generateDynamicTheses(asset.metrics, asset.type, asset.ticker, context);

        return {
            ticker: asset.ticker,
            name: asset.name,
            sector: asset.sector,
            type: asset.type,
            currentPrice: asset.price,
            targetPrice: fairPrice,
            metrics: { ...asset.metrics, structural }, 
            scores: scores, 
            riskProfile: '', 
            score: 0, 
            action: 'WAIT',
            thesis: '',
            bullThesis: thesisData.bull, 
            bearThesis: thesisData.bear 
        };
    }
};
