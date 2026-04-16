
const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

const calculateConfidenceScore = (m) => {
    let confidence = 100;
    if (!m.revenueGrowth || m.revenueGrowth === 0) confidence -= 25;
    if (!m.roe || !m.netMargin) confidence -= 15;
    if (m.avgLiquidity < 1000000) confidence -= 30;
    return confidence;
};

// --- NOVO: IDENTIFICADOR DE DIVIDEND ARISTOCRAT ---
const isDividendAristocrat = (m, type) => {
    if (type !== 'STOCK') return false;
    // Critérios Proxy: Crescimento de Receita + ROE Alto + Yield Decente + Payout Saudável
    return (m.revenueGrowth > 5 && m.roe > 12 && m.dy > 4.0 && m.netMargin > 8 && m.payout > 20 && m.payout < 90);
};

const passStressTest = (m, profile) => {
    const beta = m.beta || 1.0; 
    const estimatedDrawdown = beta * -30;
    if (profile === 'DEFENSIVE') {
        if (estimatedDrawdown < -35) return false; 
    }
    return true;
};

const isEligibleForDefensive = (asset, context) => {
    const m = asset.metrics;
    if (m.avgLiquidity < 200000) return false; 
    if (asset.type === 'STOCK') {
        if (m.marketCap < 1000000000) return false; 
        const safeSectorsKeywords = ['Banco', 'Segur', 'Elétric', 'Eletric', 'Saneamento', 'Água', 'Telecom', 'Energia', 'Transmissão', 'Financeiro', 'Alimentos', 'Saúde', 'Gás', 'Holding', 'Bebidas'];
        const sector = asset.sector || '';
        const isSafeSector = safeSectorsKeywords.some(keyword => sector.includes(keyword));
        if (!isSafeSector) {
            if (m.dy < 6.0 || m.pl > 10) return false;
        }
        if (m.roe < 5) return false; 
        if (m.netMargin < 3) return false; 
        const isFinancial = sector.includes('Banco') || sector.includes('Segur') || sector.includes('Financeiro');
        if (m.debtToEquity > 4.0 && !isFinancial) return false; 
    } else if (asset.type === 'FII') {
        if (m.marketCap < 500000000) return false; 
        if (m.dy > 18.0) return false; 
        if (m.vacancy > 12) return false; // Reduzido de 15 para 12 para ser mais defensivo
        if (!asset.sector.includes('Papel') && m.qtdImoveis < 2) return false; // Mono-ativos são vetados do perfil Defensivo
        if (m.avgLiquidity < 1000000) return false; 
    } else if (asset.type === 'CRYPTO') {
        // Para ser defensivo em crypto, tem que ser gigante e muito líquido (Buy & Hold)
        if (!['BTC', 'ETH'].includes(asset.ticker) && m.marketCap < 50000000000) return false; 
        if (m.avgLiquidity < 500000000) return false;
    }
    return true;
};

const calculateIntrinsicValue = (m, type, price, context) => {
    const { MACRO } = context;
    let fairPrice = price;
    let method = "Mercado";
    let grahamPrice = 0;
    let bazinPrice = 0;
    let pegRatio = 0; 

    if (type === 'STOCK' || type === 'STOCK_US') {
        if (m.pl > 0 && m.pl < 80 && m.pvp > 0) {
            const lpa = price / m.pl;
            const vpa = price / m.pvp;
            grahamPrice = Math.sqrt(22.5 * lpa * vpa);
        }
        if (m.dy > 0) {
            const adjustedDy = Math.min(m.dy, 14) / 100; 
            const dividendPerShare = price * adjustedDy;
            bazinPrice = dividendPerShare / 0.06; 
        }
        if (m.pl > 0 && m.revenueGrowth > 0) {
            pegRatio = m.pl / m.revenueGrowth;
        }
        if (grahamPrice > 0 && bazinPrice > 0) {
            fairPrice = (grahamPrice * 0.4) + (bazinPrice * 0.6); 
            method = "Híbrido (Bazin+Graham)";
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
            const valuationPremium = yieldPremium * 1.0; 
            fairPrice = vp * (1 + (valuationPremium / 100));
            method = "VP Ajustado";
        }
    } else if (type === 'CRYPTO') {
        fairPrice = price;
        method = "Mercado";
    }
    return { fairPrice: safeVal(fairPrice), method, grahamPrice: safeVal(grahamPrice), bazinPrice: safeVal(bazinPrice), pegRatio: safeVal(pegRatio) };
};

const calculateProfileScores = (asset, valuationData, context) => {
    const { MACRO } = context;
    const m = asset.metrics;
    const type = asset.type;
    const { fairPrice, pegRatio } = valuationData;
    
    const upside = asset.price > 0 ? (fairPrice / asset.price) - 1 : 0;
    const NTNB = MACRO.NTNB_LONG || 6.30;
    
    let defScore = 0, modScore = 0, boldScore = 0;
    const audit = { DEFENSIVE: [], MODERATE: [], BOLD: [] };
    const confidence = calculateConfidenceScore(m);

    if (type === 'STOCK' || type === 'STOCK_US') {
        const isDefensiveEligible = isEligibleForDefensive(asset, context);
        if (isDefensiveEligible) {
            defScore = 60; 
            audit.DEFENSIVE.push({ factor: 'Elegibilidade Defensiva', points: 60, type: 'base' });
            if (m.marketCap > 10000000000) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Large Cap (>10B)', points: 10, type: 'bonus' }); }
            if (m.dy > 6.0) { defScore += 15; audit.DEFENSIVE.push({ factor: 'Dividend Yield > 6%', points: 15, type: 'bonus' }); }
            if (m.roe > 15) { defScore += 5; audit.DEFENSIVE.push({ factor: 'ROE > 15%', points: 5, type: 'bonus' }); }
            if (upside > 0.15) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Upside > 15%', points: 10, type: 'bonus' }); }
            if (m.pvp > 3.0) { defScore -= 10; audit.DEFENSIVE.push({ factor: 'P/VP Esticado (>3.0)', points: -10, type: 'penalty' }); }
            if (m.beta > 1.2) { defScore -= 5; audit.DEFENSIVE.push({ factor: 'Beta Alto (>1.2)', points: -5, type: 'penalty' }); }
        } else {
            defScore = 30; 
            audit.DEFENSIVE.push({ factor: 'Ineligível para Perfil Defensivo', points: 30, type: 'base' });
        }

        if (m.marketCap > 2000000000) { 
            modScore = 60;
            audit.MODERATE.push({ factor: 'Mid/Large Cap (>2B)', points: 60, type: 'base' });
            if (m.revenueGrowth > 10) { modScore += 15; audit.MODERATE.push({ factor: 'Crescimento Receita > 10%', points: 15, type: 'bonus' }); }
            if (m.roe > 12) { modScore += 10; audit.MODERATE.push({ factor: 'ROE > 12%', points: 10, type: 'bonus' }); }
            if (upside > 0.20) { modScore += 15; audit.MODERATE.push({ factor: 'Upside > 20%', points: 15, type: 'bonus' }); }
            if (m.netMargin < 5) { modScore -= 15; audit.MODERATE.push({ factor: 'Margem Líquida Baixa (<5%)', points: -15, type: 'penalty' }); }
        } else {
            modScore = 40;
            audit.MODERATE.push({ factor: 'Small Cap (<2B)', points: 40, type: 'base' });
        }

        boldScore = 50;
        audit.BOLD.push({ factor: 'Base Arrojada', points: 50, type: 'base' });
        if (m.revenueGrowth > 15) {
            if (pegRatio > 0 && pegRatio < 1.0) { boldScore += 30; audit.BOLD.push({ factor: 'PEG Ratio Excelente (<1.0)', points: 30, type: 'bonus' }); }
            else if (pegRatio < 1.5) { boldScore += 15; audit.BOLD.push({ factor: 'PEG Ratio Saudável (<1.5)', points: 15, type: 'bonus' }); }
            if (m.revenueGrowth > 25) { boldScore += 10; audit.BOLD.push({ factor: 'Hyper Growth (>25%)', points: 10, type: 'bonus' }); }
        }
        if (upside > 0.50) { boldScore += 20; audit.BOLD.push({ factor: 'Upside Agressivo (>50%)', points: 20, type: 'bonus' }); }
        if ((m.volatility || 30) > 60) { boldScore -= 20; audit.BOLD.push({ factor: 'Volatilidade Extrema (>60%)', points: -20, type: 'penalty' }); }

    } else if (type === 'FII') {
        const isTier1 = asset.dbFlags?.isTier1 || false;
        const isPapel = asset.sector === 'Papel';

        if (isEligibleForDefensive(asset, context)) {
            defScore = 65;
            audit.DEFENSIVE.push({ factor: 'Elegibilidade Defensiva FII', points: 65, type: 'base' });
            if (m.dy > NTNB + 1.5) { defScore += 15; audit.DEFENSIVE.push({ factor: 'Yield > NTN-B + 1.5%', points: 15, type: 'bonus' }); }
            
            if (isPapel) {
                if (m.pvp >= 0.95 && m.pvp <= 1.05) { defScore += 15; audit.DEFENSIVE.push({ factor: 'P/VP Equilibrado (Papel)', points: 15, type: 'bonus' }); }
            } else {
                if (m.pvp >= 0.80 && m.pvp <= 1.05) { defScore += 15; audit.DEFENSIVE.push({ factor: 'P/VP Saudável (Tijolo)', points: 15, type: 'bonus' }); }
            }
            
            if (isTier1) { defScore += 10; audit.DEFENSIVE.push({ factor: 'Fundo Tier 1 (Elite)', points: 10, type: 'bonus' }); }
            if (m.beta < 0.7) { defScore += 15; audit.DEFENSIVE.push({ factor: 'Beta Defensivo (<0.7)', points: 15, type: 'bonus' }); }
            else if (m.beta > 0.9) { defScore -= 15; audit.DEFENSIVE.push({ factor: 'Beta Elevado (>0.9)', points: -15, type: 'penalty' }); }
        } else {
            defScore = 40;
            audit.DEFENSIVE.push({ factor: 'Ineligível para Perfil Defensivo FII', points: 40, type: 'base' });
        }
        
        modScore = 60;
        audit.MODERATE.push({ factor: 'Base Moderada FII', points: 60, type: 'base' });
        if (m.dy > NTNB + 3) { modScore += 15; audit.MODERATE.push({ factor: 'Yield > NTN-B + 3%', points: 15, type: 'bonus' }); }
        
        if (isPapel) {
            if (m.pvp < 0.95) { modScore += 10; audit.MODERATE.push({ factor: 'Deságio em Papel (Oportunidade)', points: 10, type: 'bonus' }); }
        } else {
            if (m.capRate > (NTNB + 1)) { modScore += 10; audit.MODERATE.push({ factor: 'Cap Rate > NTN-B + 1%', points: 10, type: 'bonus' }); }
            if (m.pvp < 0.90) { modScore += 10; audit.MODERATE.push({ factor: 'Deságio em Tijolo (>10%)', points: 10, type: 'bonus' }); }
        }

        boldScore = 50;
        audit.BOLD.push({ factor: 'Base Arrojada FII', points: 50, type: 'base' });
        if (m.dy >= (NTNB + 5)) { boldScore += 30; audit.BOLD.push({ factor: 'Yield Agressivo (>NTN-B + 5%)', points: 30, type: 'bonus' }); }
        
        if (isPapel) {
            if (m.pvp < 0.90) { boldScore += 20; audit.BOLD.push({ factor: 'Deságio Acentuado em Papel', points: 20, type: 'bonus' }); }
        } else {
            if (m.pvp < 0.80) { boldScore += 20; audit.BOLD.push({ factor: 'Deságio Acentuado em Tijolo', points: 20, type: 'bonus' }); }
        }
    } else if (type === 'CRYPTO') {
        const isBlueChip = ['BTC', 'ETH'].includes(asset.ticker);
        const isTop10 = m.marketCap > 20000000000;
        const isMidCap = m.marketCap > 2000000000 && m.marketCap <= 20000000000;

        if (isBlueChip) {
            defScore = 90; audit.DEFENSIVE.push({ factor: 'Crypto Blue Chip', points: 90, type: 'base' });
        } else if (isTop10) {
            modScore = 90; audit.MODERATE.push({ factor: 'Crypto Large Cap', points: 90, type: 'base' });
        } else if (isMidCap) {
            boldScore = 90; audit.BOLD.push({ factor: 'Crypto Mid Cap', points: 90, type: 'base' });
        } else {
            boldScore = 95; audit.BOLD.push({ factor: 'Crypto Small Cap (Assimetria)', points: 95, type: 'base' });
        }
        
        if (m.avgLiquidity < 50000000) {
            defScore -= 30; modScore -= 20; boldScore -= 10;
            audit.BOLD.push({ factor: 'Baixa Liquidez Crypto', points: -10, type: 'penalty' });
        } else if (m.avgLiquidity > 1000000000) {
            defScore += 10; modScore += 10;
            audit.MODERATE.push({ factor: 'Alta Liquidez Institucional', points: 10, type: 'bonus' });
        }
    }

    const maxScoreAllowed = (type === 'CRYPTO' || confidence >= 60) ? 100 : 70;
    const finalScores = { 
        DEFENSIVE: Math.min(maxScoreAllowed, Math.max(10, defScore)), 
        MODERATE: Math.min(maxScoreAllowed, Math.max(10, modScore)), 
        BOLD: Math.min(maxScoreAllowed, Math.max(10, boldScore)) 
    };

    return { scores: finalScores, audit };
};

const calculateStructuralScores = (asset, context) => {
    const m = asset.metrics;
    const type = asset.type;
    const ticker = asset.ticker;
    const isPapel = asset.sector === 'Papel';

    let quality = 50;
    let valuation = 50;
    let risk = 50;
    const audit = { QUALITY: [], VALUATION: [], RISK: [] };

    if (type === 'STOCK' || type === 'STOCK_US') {
        // --- QUALITY SCORE ---
        let qScore = 0;
        if (m.roe > 15) { qScore += 25; audit.QUALITY.push({ factor: 'ROE > 15%', points: 25, type: 'bonus' }); }
        else if (m.roe > 10) { qScore += 15; audit.QUALITY.push({ factor: 'ROE > 10%', points: 15, type: 'bonus' }); }
        
        if (m.netMargin > 10) { qScore += 25; audit.QUALITY.push({ factor: 'Margem Líquida > 10%', points: 25, type: 'bonus' }); }
        else if (m.netMargin > 5) { qScore += 15; audit.QUALITY.push({ factor: 'Margem Líquida > 5%', points: 15, type: 'bonus' }); }

        if (m.debtToEquity < 1.0) { qScore += 25; audit.QUALITY.push({ factor: 'Dívida/Patrimônio < 1.0', points: 25, type: 'bonus' }); }
        else if (m.debtToEquity < 2.0) { qScore += 15; audit.QUALITY.push({ factor: 'Dívida/Patrimônio < 2.0', points: 15, type: 'bonus' }); }

        if (m.revenueGrowth > 10) { qScore += 25; audit.QUALITY.push({ factor: 'Crescimento Receita > 10%', points: 25, type: 'bonus' }); }
        else if (m.revenueGrowth > 5) { qScore += 10; audit.QUALITY.push({ factor: 'Crescimento Receita > 5%', points: 10, type: 'bonus' }); }

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
        const ntnb = context.MACRO?.NTNB_LONG || 6.30;
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
        const isFinancial = asset.sector?.includes('Banco') || asset.sector?.includes('Segur') || asset.sector?.includes('Financeiro');
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
        const ntnb = context.MACRO?.NTNB_LONG || 6.30;
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
        
        if (spread >= requiredSpread + 2) { vScore += 90; audit.VALUATION.push({ factor: 'Spread Excelente (>4-5%)', points: 90, type: 'bonus' }); }
        else if (spread >= requiredSpread) { vScore += 70; audit.VALUATION.push({ factor: 'Spread Saudável', points: 70, type: 'bonus' }); }
        else if (spread >= 0) { vScore += 40; audit.VALUATION.push({ factor: 'Spread Positivo', points: 40, type: 'bonus' }); }
        else { vScore += 10; audit.VALUATION.push({ factor: 'Spread Negativo vs Tesouro', points: 10, type: 'penalty' }); }

        // Ajuste por P/VP
        if (m.pvp < 0.90) { vScore += 10; audit.VALUATION.push({ factor: 'Deságio P/VP (<0.90)', points: 10, type: 'bonus' }); }
        else if (m.pvp > 1.10) { vScore -= 20; audit.VALUATION.push({ factor: 'Ágio Excessivo (>1.10)', points: -20, type: 'penalty' }); }

        valuation = Math.min(100, Math.max(0, vScore));

        // --- RISK FII ---
        let rScore = 50; audit.RISK.push({ factor: 'Base Risco FII', points: 50, type: 'base' });
        if (m.avgLiquidity > 2000000) { rScore += 20; audit.RISK.push({ factor: 'Liquidez Alta (>2M)', points: 20, type: 'bonus' }); }
        
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

const generateDynamicTheses = (m, type, ticker, context, valuationData, currentPrice, sector) => {
    const { MACRO } = context;
    const bull = [];
    const bear = [];
    if (m.dy > MACRO.SELIC) bull.push(`Yield (${m.dy.toFixed(1)}%) supera a Selic.`);
    if (m.pvp < 0.85 && m.pvp > 0) bull.push(`Desconto patrimonial (P/VP ${m.pvp.toFixed(2)}).`);
    if (m.roe > 18) bull.push(`Rentabilidade alta (ROE ${m.roe.toFixed(1)}%).`);
    
    if (type === 'FII') {
        const ntnb = context.MACRO?.NTNB_LONG || 6.30;
        const spread = m.dy - ntnb;
        const isPapel = sector === 'Papel';
        
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
        if (asset.metrics.avgLiquidity < 200000 && asset.type !== 'CRYPTO') return { _discarded: true, reason: "Liquidez Insuficiente", details: `${asset.metrics.avgLiquidity} (Mínimo: 200k)` };
        if (asset.dbFlags && asset.dbFlags.isBlacklisted) return { _discarded: true, reason: "Blacklist Manual", details: "Banido pelo Admin" }; 

        const valuationData = calculateIntrinsicValue(asset.metrics, asset.type, asset.price, context);
        const profileResult = calculateProfileScores(asset, valuationData, context);
        const structuralResult = calculateStructuralScores(asset, context);
        const thesisData = generateDynamicTheses(asset.metrics, asset.type, asset.ticker, context, valuationData, asset.price, asset.sector);
        const aristocrat = isDividendAristocrat(asset.metrics, asset.type);

        if (aristocrat) {
            profileResult.scores.DEFENSIVE = Math.min(100, profileResult.scores.DEFENSIVE + 10);
            profileResult.scores.MODERATE = Math.min(100, profileResult.scores.MODERATE + 5);
            profileResult.audit.DEFENSIVE.push({ factor: 'Dividend Aristocrat Bonus', points: 10, type: 'bonus' });
            profileResult.audit.MODERATE.push({ factor: 'Dividend Aristocrat Bonus', points: 5, type: 'bonus' });
            thesisData.bull.unshift("Dividend Aristocrat: Crescimento consistente e dividendos saudáveis.");
        }

        // Consolidação do Audit Log Completo
        const auditLog = [
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
            isDividendAristocrat: aristocrat
        };
    }
};
