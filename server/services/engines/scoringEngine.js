
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
    let grahamPrice = 0;
    let bazinPrice = 0;

    if (type === 'STOCK' || type === 'STOCK_US') {
        // Graham
        if (m.pl > 0 && m.pvp > 0) {
            const lpa = price / m.pl;
            const vpa = price / m.pvp;
            grahamPrice = Math.sqrt(22.5 * lpa * vpa);
        }

        // Bazin
        if (m.dy > 0) {
            const adjustedDy = Math.min(m.dy, 10) / 100; // Cap no DY para evitar distorções de dividendos não recorrentes
            const dividendPerShare = price * adjustedDy;
            bazinPrice = dividendPerShare / 0.06; 
        }

        if (grahamPrice > 0 && bazinPrice > 0) {
            fairPrice = (grahamPrice * 0.5) + (bazinPrice * 0.5);
            method = "Híbrido";
        } else if (grahamPrice > 0) {
            fairPrice = grahamPrice;
            method = "Graham";
        } else if (bazinPrice > 0) {
            fairPrice = bazinPrice;
            method = "Bazin";
        }
        
        if (fairPrice > price * 2.5) fairPrice = price * 2.5; 

    } else if (type === 'FII') {
        const vp = m.vpCota || price;
        if (m.sector?.includes('Papel')) {
            fairPrice = vp; 
            method = "VP (Papel)";
        } else {
            const ntnb = MACRO.NTNB_LONG || 6.0;
            const yieldPremium = Math.max(0, m.dy - ntnb);
            const valuationPremium = yieldPremium * 1.5; 
            fairPrice = vp * (1 + (valuationPremium / 100));
            method = "VP Ajustado (Spread NTNB)";
        }
        // FIIs geralmente usam VP ou fluxo de caixa, Bazin/Graham não se aplicam diretamente da mesma forma,
        // mas podemos preencher Bazin com a lógica de dividendos para referência.
        if (m.dy > 0) {
             const dividendPerShare = price * (m.dy / 100);
             bazinPrice = dividendPerShare / 0.06;
        }
    }

    return { 
        fairPrice: safeVal(fairPrice), 
        method,
        grahamPrice: safeVal(grahamPrice),
        bazinPrice: safeVal(bazinPrice)
    };
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

        if (isEligibleForDefensive(asset, context)) {
            defScore = 60;
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
                if (m.dy < (RISK_FREE + 2)) defScore -= 5;
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

const calculateStructuralScores = (m, type) => {
    let quality = 50;
    let valuation = 50;
    let risk = 50;

    if (type === 'STOCK') {
        // QUALIDADE (Max 100)
        let qScore = 40;
        if (m.roe > 15) qScore += 15;
        else if (m.roe > 10) qScore += 10;
        
        if (m.netMargin > 15) qScore += 15;
        else if (m.netMargin > 8) qScore += 10;
        
        if (m.marketCap > 10000000000) qScore += 15;
        else if (m.marketCap > 2000000000) qScore += 10;
        
        if (m.debtToEquity < 1.0) qScore += 15;
        
        quality = Math.min(100, qScore);

        // VALUATION (Max 100)
        let vScore = 40;
        if (m.pl > 0 && m.pl < 8) vScore += 20;
        else if (m.pl < 15) vScore += 10;
        
        if (m.pvp > 0 && m.pvp < 1.0) vScore += 20;
        else if (m.pvp < 1.5) vScore += 10;
        
        if (m.dy > 6) vScore += 20;
        
        valuation = Math.min(100, vScore);

        // RISCO (Inverso - Quanto maior a nota, MAIS SEGURO)
        let rScore = 40;
        if (m.avgLiquidity > 50000000) rScore += 20;
        else if (m.avgLiquidity > 5000000) rScore += 10;
        
        if (m.currentRatio > 1.5) rScore += 10;
        if (m.debtToEquity > 3) rScore -= 20; // Dívida alta penaliza segurança
        else if (m.debtToEquity < 0.5) rScore += 20;
        
        // Estabilidade de Margens (Simulado)
        if (m.netMargin > 5) rScore += 10;

        risk = Math.min(100, Math.max(10, rScore));
    }
    else if (type === 'FII') {
        // QUALIDADE
        let qScore = 40;
        if (m.qtdImoveis > 10) qScore += 20;
        else if (m.qtdImoveis > 5) qScore += 10;
        
        if (m.vacancy < 5) qScore += 20;
        else if (m.vacancy < 10) qScore += 5;
        else qScore -= 10;
        
        if (m.marketCap > 2000000000) qScore += 20;
        
        quality = Math.min(100, Math.max(10, qScore));

        // VALUATION
        let vScore = 40;
        // P/VP Ideal é próximo de 1.0
        if (m.pvp >= 0.90 && m.pvp <= 1.05) vScore += 30;
        else if (m.pvp >= 0.80 && m.pvp <= 1.10) vScore += 15;
        
        // Yield alto ajuda valuation
        if (m.dy > 10) vScore += 20;
        else if (m.dy > 8) vScore += 10;
        
        valuation = Math.min(100, vScore);

        // RISCO (Segurança)
        let rScore = 40;
        if (m.avgLiquidity > 5000000) rScore += 20;
        // P/VP muito baixo em FIIs de papel é risco de calote
        if (m.sector?.includes('Papel') && m.pvp < 0.85) rScore -= 20;
        
        // Diversificação geográfica (não temos esse dado, usamos qtd imoveis como proxy)
        if (m.qtdImoveis > 5) rScore += 10;
        
        // Vacância alta é risco
        if (m.vacancy > 15) rScore -= 20;
        else if (m.vacancy < 2) rScore += 10;

        risk = Math.min(100, Math.max(10, rScore));
    }

    return { quality, valuation, risk };
};

const generateDynamicTheses = (m, type, ticker, context) => {
    const { MACRO } = context;
    const bull = [];
    const bear = [];
    
    // Análise Automatizada
    if (m.dy > MACRO.SELIC) bull.push(`Yield (${m.dy.toFixed(1)}%) superior à Selic (${MACRO.SELIC}%).`);
    if (m.pvp < 0.8 && m.dy > 0) bull.push(`Desconto patrimonial excessivo (P/VP ${m.pvp.toFixed(2)}).`);
    if (m.roe > 20) bull.push(`Rentabilidade sobre PL excepcional (ROE ${m.roe.toFixed(1)}%).`);
    if (m.revenueGrowth > 15) bull.push("Crescimento acelerado de receita (CAGR 5a > 15%).");
    
    if (m.debtToEquity > 4 && type === 'STOCK' && m.sector !== 'Bancos') bear.push("Alavancagem financeira elevada.");
    if (m.avgLiquidity < 500000) bear.push("Liquidez reduzida pode dificultar saída.");
    if (m.pl > 30) bear.push("Múltiplos esticados (P/L > 30).");
    if (m.vacancy > 15 && type === 'FII') bear.push(`Vacância física alta (${m.vacancy.toFixed(1)}%).`);

    return { bull, bear };
};

export const scoringEngine = {
    processAsset(asset, context) {
        if (asset.price <= 1.00) return null;
        if (asset.metrics.avgLiquidity < 100000) return null;
        if (asset.dbFlags && asset.dbFlags.isBlacklisted) return null; 
        if (asset.metrics.pl < -20 && asset.type === 'STOCK') return null;

        const { fairPrice, grahamPrice, bazinPrice } = calculateIntrinsicValue(asset.metrics, asset.type, asset.price, context);
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
            // Importante: Passando Graham e Bazin para o objeto final
            metrics: { ...asset.metrics, structural, grahamPrice, bazinPrice }, 
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
