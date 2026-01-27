
// --- CONFIGURAÇÃO MACRO ---
const MACRO = {
    SELIC: 11.25,
    IPCA: 4.50,
    RISK_FREE: 11.25, 
    NTNB_LONG: 6.30 
};

// --- LISTA NEGRA (HARDCODED SAFETY) ---
const BLACKLIST = [
    'AMER3', 'OIBR3', 'LIGT3', 'RCSL3', 'PCAR3', 'RSID3', 'AZEV4', 'TCNO4', 'DASA3', 'SEQL3'
];

// --- TIER 1 FIIs (Gestão Premium + Liquidez) - Tolerância a Ágio ---
const FII_TIER_1 = [
    'HGLG11', 'KNRI11', 'BTLG11', 'ALZR11', 'HGBS11', 'XPML11', 'VISC11', 
    'PVBI11', 'HGRU11', 'TRXF11', 'KNCR11', 'HGCR11', 'KNSC11', 'CPTS11', 'BTHF11'
];

const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

// --- QUALITY GATES (REGRAS DE ELEGIBILIDADE) ---
const isEligibleForDefensive = (asset) => {
    const m = asset.metrics;
    
    // Filtro de Liquidez Básica para todos os Defensivos
    if (m.avgLiquidity < 2000000) return false; 

    if (asset.type === 'STOCK') {
        // Regra 1: Tamanho (Market Cap) - Aumentado para 8 Bi
        if (m.marketCap < 8000000000) return false;
        
        // Regra 2: Setores Permitidos (Safety)
        const safeSectors = ['Bancos', 'Elétricas', 'Seguros', 'Saneamento', 'Telecom', 'Mineração', 'Petróleo'];
        if (!safeSectors.includes(asset.sector)) return false;

        // Regra 3: Lucratividade e Estabilidade
        if (m.roe < 10) return false; 
        if (m.netMargin < 8) return false;
        
        // Regra 4: Yield Mínimo e Consistente
        if (m.dy < 4.0) return false; // PRIO3 cai aqui

        // Regra 5: Dívida Controlada
        if (m.debtToEquity > 3.0 && asset.sector !== 'Bancos') return false; 
    } 
    else if (asset.type === 'FII') {
        const riskySectors = ['Papel (High Yield)', 'Fiagro', 'Outros', 'Papel (Híbrido)'];
        
        // FIIs Defensivos não podem ser High Yield arriscados ou ter P/VP de ativos distressed
        // Tolerância de DY aumentada levemente para não excluir fundos bons em momentos de stress, mas HY (>15.5) é barrado
        if (riskySectors.includes(asset.sector) && m.dy > 15.5) return false; 
        
        if (m.pvp < 0.85) return false; // Desconto excessivo = Risco de Calote (HCTR11, DEVA11)
        
        if (m.vacancy > 6) return false; 
        if (m.avgLiquidity < 1500000) return false;
        
        // FIIs de Tijolo precisam ter diversificação mínima
        if (!asset.sector.includes('Papel') && m.qtdImoveis < 4) return false;
    }
    return true;
};

// --- 1. VALUATION ENGINE ---
const calculateIntrinsicValue = (m, type, price) => {
    let fairPrice = price;
    let method = "Mercado";

    if (type === 'STOCK' || type === 'STOCK_US') {
        let graham = 0;
        if (m.pl > 0 && m.pvp > 0) {
            const lpa = price / m.pl;
            const vpa = price / m.pvp;
            graham = Math.sqrt(22.5 * lpa * vpa);
        }

        let bazin = 0;
        if (m.dy > 0) {
            // Teto de DY para não distorcer cíclicas (Max 10% considerado no cálculo)
            const adjustedDy = Math.min(m.dy, 10) / 100; 
            const dividendPerShare = price * adjustedDy;
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
        
        // Kill Switch: Limita upside absurdo de Small Caps (Ex: ETER3)
        if (fairPrice > price * 2.5) {
            fairPrice = price * 2.5; 
        }

    } else if (type === 'FII') {
        const vp = m.vpCota || price;
        if (m.sector?.includes('Papel') || m.sector?.includes('Recebíveis')) {
            fairPrice = vp; 
            method = "VP (Papel)";
        } else {
            const yieldPremium = Math.max(0, m.dy - MACRO.NTNB_LONG);
            const valuationPremium = yieldPremium * 1.5; 
            fairPrice = vp * (1 + (valuationPremium / 100));
            method = "VP Ajustado";
        }
    }

    return { fairPrice: safeVal(fairPrice), method };
};

// --- 2. SCORING ENGINE (FORTRESS v7.0) ---
const calculateProfileScores = (asset, fairPrice) => {
    const m = asset.metrics;
    const type = asset.type;
    const upside = asset.price > 0 ? (fairPrice / asset.price) - 1 : 0;
    
    let defScore = 0; 
    let modScore = 0;
    let boldScore = 0;

    // --- LÓGICA AÇÕES ---
    if (type === 'STOCK' || type === 'STOCK_US') {
        // ================= DEFENSIVO (Safety Premium) =================
        if (isEligibleForDefensive(asset)) {
            defScore = 70; // Base Alta para Defensivos
            
            if (m.dy > 6) defScore += 10;
            if (m.roe > 15) defScore += 10;
            if (m.marketCap > 30000000000) defScore += 5; // Blue Chip Titan
            
            // Penalidades Leves
            if (m.pvp > 2.5) defScore -= 10; 
        } 

        // ================= MODERADO =================
        if (m.marketCap > 2000000000) { 
            modScore = 60;
            if (m.revenueGrowth > 10) modScore += 15;
            if (m.roe > 12) modScore += 10;
            if (upside > 0.20) modScore += 10;
            if (m.netMargin < 5) modScore -= 15;
        }

        // ================= ARROJADO (Risk Discount) =================
        boldScore = 50;
        if (upside > 0.50) boldScore += 25; 
        if (m.pvp < 0.70 && m.pvp > 0.1) boldScore += 15; 
        if (m.evEbitda < 5 && m.evEbitda > 0) boldScore += 10;
    }
    
    // --- LÓGICA FIIs (REFINADA v7.0 - TIER 1 & CAPS) ---
    else if (type === 'FII') {
        const isPaper = m.sector?.includes('Papel');
        const isBrick = !isPaper;
        const isTier1 = FII_TIER_1.includes(asset.ticker);
        const isDev = m.sector?.includes('Desenvolvimento') || ['TGAR11', 'MFII11', 'RBED11'].includes(asset.ticker);
        const isHighYield = ['DEVA11', 'HCTR11', 'VSLH11', 'TORD11', 'RPR11', 'HABT11'].includes(asset.ticker) || (isPaper && m.dy > 15.5);

        // ================= DEFENSIVO =================
        if (isEligibleForDefensive(asset)) {
            defScore = 60; // Base inicial para forçar pontuação por mérito

            // 1. Yield Real vs NTN-B (Max 15 pts)
            // Se paga NTNB + 2.5% (aprox 8.8% real ou 13-14% nominal) é excelente
            if (m.dy > MACRO.NTNB_LONG + 2.5) defScore += 10;
            else if (m.dy > MACRO.NTNB_LONG + 1) defScore += 5;
            
            // 2. Valuation com Tolerância Tier 1 (Max 15 pts)
            if (isTier1) {
                // Tier 1: Aceita P/VP 0.90 até 1.12 como "Preço Justo/Premium" sem penalidade
                if (m.pvp >= 0.90 && m.pvp <= 1.12) defScore += 15;
                // Desconto em Tier 1 é Bônus Extra (Oportunidade Rara)
                else if (m.pvp < 0.90) defScore += 20; 
            } else {
                // FIIs Normais: Rigor no P/VP (Desconto ou Paridade)
                if (m.pvp >= 0.88 && m.pvp <= 1.03) defScore += 15;
                else if (m.pvp < 0.88) defScore += 10; 
            }

            // 3. Qualidade & Segurança (Max 15 pts)
            if (isBrick) {
                if (m.vacancy < 3) defScore += 5;
                if (m.qtdImoveis > 5) defScore += 5;
                if (m.marketCap > 1000000000) defScore += 5; // Bilionários
            } else { // Paper
                if (isTier1) defScore += 10; // High Grade Premium (Kinea/CSHG)
                if (m.dy < 14.5) defScore += 5; // Yield não explosivo = Risco menor
            }

            // 4. Tie-Breakers (Desempate de Gigantes - Liquidez)
            if (m.avgLiquidity > 4000000) defScore += 3;
            if (m.avgLiquidity > 8000000) defScore += 2; // Acumula +5 total para ultra-líquidos
            if (m.marketCap > 3000000000) defScore += 3; // +3 Bi ganha boost

            // Penalidades
            if (!isTier1 && m.pvp > 1.06) defScore -= 10; // Caro sem ser Premium
            if (m.vacancy > 8) defScore -= 10;
        }

        // ================= MODERADO =================
        modScore = 60;
        if (m.dy > 11 && m.dy < 15.5) modScore += 15; 
        if (m.capRate > 8.5) modScore += 10;
        if (m.pvp >= 0.8 && m.pvp <= 1.02) modScore += 10; 
        if (isDev) modScore += 10; // Desenvolvimento cabe bem no Moderado

        // ================= ARROJADO =================
        boldScore = 50;
        if (m.dy >= 15) boldScore += 25; 
        if (m.pvp < 0.85) boldScore += 20; 
        if (isHighYield) boldScore += 15; // High Yield é Arrojado por natureza

        // --- TETOS DE SCORE (HARD CAPS) ---
        // Lógica de Hierarquia para Buy & Hold
        let defCap = 98;
        if (isTier1) defCap = 100; // Só Tier 1 pode bater 99/100
        if (isDev) defCap = 90;    // Desenvolvimento tem risco de obra/crédito, max 90
        if (isHighYield) defCap = 85; // High Yield tem risco de calote, max 85

        defScore = Math.min(defCap, defScore);
    }

    // --- APLICAÇÃO GERAL DOS LIMITES ---
    return { 
        DEFENSIVE: Math.min(100, Math.max(10, defScore)), 
        MODERATE: Math.min(89, Math.max(10, modScore)), 
        BOLD: Math.min(85, Math.max(10, boldScore)) 
    };
};

// --- 3. HELPER: CÁLCULO DE SCORES ESTRUTURAIS (BARRAS LATERAIS) ---
const calculateStructuralScores = (m, type) => {
    let quality = 50;
    let valuation = 50;
    let risk = 50; // Maior = Mais Seguro (Menor Risco)

    if (type === 'STOCK' || type === 'STOCK_US') {
        // --- QUALITY ---
        let qScore = 0;
        if (m.roe > 20) qScore += 30; else if (m.roe > 12) qScore += 20; else if (m.roe > 5) qScore += 10;
        if (m.netMargin > 15) qScore += 25; else if (m.netMargin > 8) qScore += 15;
        if (m.revenueGrowth > 10) qScore += 20; else if (m.revenueGrowth > 0) qScore += 10;
        if (m.marketCap > 10000000000) qScore += 25; else if (m.marketCap > 2000000000) qScore += 10;
        quality = Math.min(100, qScore);

        // --- VALUATION ---
        let vScore = 50;
        if (m.pl > 0 && m.pl < 7) vScore += 20;
        if (m.pl > 15) vScore -= 15;
        if (m.pvp > 0 && m.pvp < 0.9) vScore += 20;
        if (m.pvp > 2.0) vScore -= 15;
        if (m.evEbitda > 0 && m.evEbitda < 6) vScore += 10;
        valuation = Math.min(100, Math.max(0, vScore));

        // --- RISK (SAFETY) ---
        let rScore = 50;
        if (m.debtToEquity < 0.8) rScore += 20; else if (m.debtToEquity > 2.0) rScore -= 20;
        if (m.currentRatio > 1.5) rScore += 15;
        if (m.avgLiquidity > 10000000) rScore += 15;
        risk = Math.min(100, Math.max(0, rScore));

    } else if (type === 'FII') {
        // --- QUALITY ---
        let qScore = 40;
        if (m.vacancy < 3) qScore += 25; else if (m.vacancy < 8) qScore += 10;
        if (m.qtdImoveis > 8) qScore += 20; else if (m.qtdImoveis > 3) qScore += 10;
        if (m.avgLiquidity > 4000000) qScore += 15;
        quality = Math.min(100, qScore);

        // --- VALUATION ---
        let vScore = 50;
        if (m.pvp < 0.98 && m.pvp > 0.85) vScore += 25; // Sweet spot
        if (m.pvp > 1.08) vScore -= 15;
        if (m.dy > 10) vScore += 15;
        valuation = Math.min(100, Math.max(0, vScore));

        // --- RISK ---
        let rScore = 50;
        if (m.vacancy > 15) rScore -= 30;
        if (m.vacancy < 3) rScore += 15;
        if (m.avgLiquidity > 5000000) rScore += 15;
        if (m.qtdImoveis === 1) rScore -= 20; // Risco Monoativo
        risk = Math.min(100, Math.max(0, rScore));
    } else if (type === 'CRYPTO') {
        // Mock rápido para Cripto
        quality = m.marketCap > 100000000000 ? 90 : 60;
        valuation = 50; // Difícil mensurar
        risk = m.marketCap > 100000000000 ? 70 : 30;
    }

    return { quality, valuation, risk };
};

// --- 4. HELPER: GERADOR DE TESE DINÂMICA (RULE-BASED) ---
const generateDynamicTheses = (m, type, ticker) => {
    const bull = [];
    const bear = [];

    if (type === 'STOCK' || type === 'STOCK_US') {
        // --- BULL THESIS ---
        if (m.dy > 10) bull.push("Geradora de caixa robusta com dividendos de dois dígitos.");
        else if (m.dy > 6) bull.push("Pagadora consistente de proventos acima da média de mercado.");
        
        if (m.pvp < 0.8 && m.pvp > 0) bull.push("Desconto patrimonial severo sugere assimetria de valor.");
        if (m.pl > 0 && m.pl < 6) bull.push("Múltiplo de lucros extremamente atrativo (P/L < 6x).");
        
        if (m.roe > 20) bull.push("Rentabilidade sobre o capital (ROE) de excelência.");
        if (m.netMargin > 15) bull.push("Alta eficiência operacional com margens líquidas sólidas.");
        
        if (m.debtToEquity < 0.5) bull.push("Balanço blindado com baixíssima alavancagem financeira.");
        if (m.revenueGrowth > 15) bull.push("Empresa em ciclo de expansão acelerada de receitas.");
        if (m.avgLiquidity > 50000000) bull.push("Alta liquidez favorece entrada de grandes investidores.");

        // --- BEAR THESIS ---
        if (m.pl > 30) bear.push("Precificação exige crescimento perfeito para justificar múltiplos.");
        if (m.pvp > 5) bear.push("Valuation esticado em relação ao patrimônio líquido.");
        
        if (m.debtToEquity > 3.0) bear.push("Alto endividamento traz riscos em cenário de juros elevados.");
        if (m.netMargin < 3 && m.netMargin > 0) bear.push("Margens apertadas indicam forte concorrência ou ineficiência.");
        if (m.roe < 5 && m.roe > 0) bear.push("Destruição de valor para o acionista (ROE < Custo de Capital).");
        
        if (m.avgLiquidity < 1000000) bear.push("Baixa liquidez pode dificultar a saída de posições.");

    } else if (type === 'FII') {
        // --- BULL THESIS ---
        if (m.dy > 12) bull.push("Yield corrente estelar, superando com folga a renda fixa.");
        else if (m.dy > MACRO.NTNB_LONG) bull.push("Retorno de dividendos acima do tesouro IPCA+ (Spread positivo).");
        
        if (m.pvp > 0.85 && m.pvp < 0.95) bull.push("Ponto de entrada atrativo com desconto sobre valor justo.");
        
        if (m.vacancy < 3) bull.push("Ocupação física próxima da totalidade (Ativos Premium).");
        if (m.qtdImoveis > 10) bull.push("Portfólio pulverizado dilui riscos de vacância pontual.");
        
        if (m.avgLiquidity > 3000000) bull.push("Liquidez de nível institucional.");
        if (m.capRate > 9) bull.push("Rentabilidade imobiliária real (Cap Rate) atrativa.");

        // --- BEAR THESIS ---
        if (m.vacancy > 15) bear.push("Alta vacância física pressiona custos de condomínio e receitas.");
        if (m.pvp > 1.15) bear.push("Ágio elevado retira margem de segurança do investidor.");
        
        if (m.qtdImoveis === 1) bear.push("Risco monoativo: Dependência total de um único imóvel.");
        if (m.dy < 6) bear.push("Yield corrente perde para o CDI líquido.");
        
        if (m.avgLiquidity < 500000) bear.push("Baixíssima liquidez traz riscos de spread na negociação.");
    }

    // Fallbacks para garantir que a UI não quebre
    if (bull.length === 0) bull.push("Ativo com fundamentos estáveis para manutenção de carteira.");
    if (bear.length === 0) bear.push("Monitorar volatilidade de mercado e cenário macroeconômico.");

    // Retorna apenas os 4 melhores pontos de cada para não poluir a UI
    return { bull: bull.slice(0, 4), bear: bear.slice(0, 4) };
};

export const scoringEngine = {
    /**
     * Processa um ativo bruto, aplicando Valuation, Scoring e Geração de Teses.
     */
    processAsset(asset) {
        // Filtros de Integridade Básica (Pré-Scoring)
        if (asset.price <= 1.00) return null; // Penny Stock Risco Extremo
        if (asset.metrics.avgLiquidity < 100000) return null; // Sem liquidez
        if (BLACKLIST.includes(asset.ticker.toUpperCase())) return null; // Lista Negra
        if (asset.metrics.pl < -20 && asset.type === 'STOCK') return null; // Prejuízo Crônico

        const { fairPrice } = calculateIntrinsicValue(asset.metrics, asset.type, asset.price);
        const scores = calculateProfileScores(asset, fairPrice);
        
        // Cálculos Estruturais & Tese Dinâmica
        const structural = calculateStructuralScores(asset.metrics, asset.type);
        const thesisData = generateDynamicTheses(asset.metrics, asset.type, asset.ticker);

        return {
            ticker: asset.ticker,
            name: asset.name,
            sector: asset.sector,
            type: asset.type,
            currentPrice: asset.price,
            targetPrice: fairPrice,
            metrics: { ...asset.metrics, structural }, // Injeta métricas estruturais
            scores: scores, 
            riskProfile: '', // Será preenchido no Draft
            score: 0, // Será preenchido no Draft
            action: 'WAIT',
            thesis: '',
            bullThesis: thesisData.bull, // Injeta Tese Bull
            bearThesis: thesisData.bear  // Injeta Tese Bear
        };
    }
};
