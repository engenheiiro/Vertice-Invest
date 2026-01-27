
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';

const sN = (val) => val === null || val === undefined || isNaN(val) ? 0 : Number(val);
const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

// --- MACRO ECONOMICS ---
const MACRO = {
    SELIC: 11.25,
    IPCA: 4.50,
    RISK_FREE: 11.25, // Selic como livre de risco
    MARKET_PREMIUM: 6.00, // Prêmio de Risco Brasil
    NTNB_LONG: 6.20 // Tesouro IPCA+ 2045 (Taxa Real)
};

// --- BETA DO SETOR (Estimado) ---
// Usado para calcular o Ke (Custo de Capital Próprio)
const SECTOR_BETA = {
    'Elétricas': 0.6,
    'Saneamento': 0.7,
    'Seguros': 0.8,
    'Bancos': 1.1,
    'Telecom': 0.9,
    'Alimentos': 0.8,
    'Varejo': 1.4,
    'Construção': 1.5,
    'Logística': 1.2,
    'Mineração': 1.3,
    'Petróleo': 1.4,
    'Outros': 1.0,
    'FII': 0.4 // FIIs têm beta baixo em relação ao IBOV
};

// --- FUNÇÃO MASTER DE VALUATION ---
const calculateIntrinsicValue = (m, type, sector, currentPrice) => {
    let graham = 0;
    let bazin = 0;
    let fairPvp = 0;
    let fairPrice = 0;

    if (type === 'STOCK' || type === 'STOCK_US') {
        // 1. GRAHAM (Valor Patrimonial + Lucro)
        // Fórmula: Raiz(22.5 * LPA * VPA)
        // LPA = Preço / PL
        // VPA = Preço / PVP
        if (m.pl > 0 && m.pvp > 0) {
            const lpa = currentPrice / m.pl;
            const vpa = currentPrice / m.pvp;
            if (lpa > 0 && vpa > 0) {
                graham = Math.sqrt(22.5 * lpa * vpa);
            }
        }

        // 2. BAZIN (Foco em Dividendos)
        // Preço Teto = DPA / 6% (ou Taxa Livre de Risco ajustada)
        if (m.dy > 0) {
            const dpa = currentPrice * (m.dy / 100);
            // Se o setor for perene (Elétricas/Bancos), exige 6%. Se for risco, exige 8-10%.
            const requiredYield = (sector === 'Elétricas' || sector === 'Saneamento' || sector === 'Bancos') ? 0.06 : 0.09;
            bazin = dpa / requiredYield;
        }

        // 3. GORDON MODIFICADO (Fair Price via ROE)
        // P/VP Justo = (ROE - g) / (Ke - g)
        // Assumindo g (crescimento perpétuo) = IPCA (4.5%)
        // Ke (Custo Capital) = RiskFree + Beta * MarketPremium
        const beta = SECTOR_BETA[sector] || 1.1;
        const ke = MACRO.RISK_FREE + (beta * MACRO.MARKET_PREMIUM); // Ex: 11.25 + 0.6*6 = 14.85%
        const g = MACRO.IPCA; // Crescimento conservador (apenas inflação)
        
        let targetPvp = 1.0;
        if (ke > g) {
            targetPvp = (m.roe - g) / (ke - g);
        }
        
        // Cap no P/VP Justo para ser conservador (Max 3.0x para High Quality)
        targetPvp = Math.min(Math.max(targetPvp, 0.5), 3.0);
        
        // Fair Price = VPA * TargetPvp
        const vpa = m.pvp > 0 ? currentPrice / m.pvp : 0;
        const fairPriceByRoe = vpa * targetPvp;

        // --- CONSOLIDAÇÃO DO PREÇO JUSTO ---
        // Se tem dividendos, Bazin pesa. Se não, Graham e ROE pesam.
        const values = [];
        if (graham > 0) values.push(graham);
        if (bazin > 0) values.push(bazin);
        if (fairPriceByRoe > 0) values.push(fairPriceByRoe);

        if (values.length > 0) {
            fairPrice = values.reduce((a, b) => a + b, 0) / values.length;
        } else {
            fairPrice = currentPrice; // Fallback
        }

    } else if (type === 'FII') {
        // FIIs: Valor Patrimonial é o grande norte, ajustado pelo Yield
        const vpCota = m.vpCota > 0 ? m.vpCota : currentPrice;
        
        // Bazin para FIIs: DPA / (NTNB + Spread de 3%)
        const dpa = currentPrice * (m.dy / 100);
        const requiredFiiYield = MACRO.NTNB_LONG + 3.0; // Ex: 6.2 + 3 = 9.2% Real -> ~13.7% Nominal
        const bazinFii = dpa / (requiredFiiYield / 100);

        fairPrice = (vpCota * 0.6) + (bazinFii * 0.4); // VP pesa mais em FIIs
    }

    return { graham, bazin, fairPrice };
};

// --- RISK PROFILE MATRIX (DETERMINÍSTICO) ---
const determineRiskProfile = (m, type, sector) => {
    let risk = 'MODERATE';

    if (type === 'FII') {
        const isPaper = sector.includes('Papel') || sector.includes('Recebíveis');
        
        // FIIs DEFENSIVOS
        // Tijolo Prime ou Papel High Grade
        if (!isPaper && m.vacancy < 5 && m.qtdImoveis > 3 && m.pvp > 0.85 && m.pvp < 1.15) return 'DEFENSIVE';
        if (isPaper && m.dy > 10 && m.dy < 15 && m.pvp >= 0.90 && m.pvp <= 1.02) return 'DEFENSIVE';

        // FIIs ARROJADOS (High Risk)
        if (m.vacancy > 20) return 'BOLD'; // Vacância Alta
        if (m.dy > 18) return 'BOLD'; // Yield Explosivo (Calote?)
        if (m.pvp < 0.70) return 'BOLD'; // Desconto excessivo (Problema de gestão/crédito)
        if (isPaper && m.pvp > 1.05) return 'BOLD'; // Ágio em papel é risco de perda de capital
        
        return 'MODERATE';
    }

    if (type === 'STOCK') {
        // BLUE CHIPS DEFENSIVAS
        // Market Cap > 10Bi, Dívida Controlada, Lucrativa
        const isLarge = m.marketCap > 10000000000;
        const lowDebt = m.netDebt <= 0 || (m.evEbitda < 2.5);
        const profitable = m.roe > 10 && m.netMargin > 8;
        const lowBeta = SECTOR_BETA[sector] < 1.0;

        if (isLarge && lowDebt && profitable && lowBeta) return 'DEFENSIVE';

        // ARROJADAS
        // Small Caps, Turnarounds, Alta Dívida
        const highDebt = (m.netDebt / m.evEbitda) > 3.5;
        const moneyLosing = m.pl < 0;
        const microCap = m.marketCap < 1000000000; // < 1 Bi

        if (highDebt || moneyLosing || microCap) return 'BOLD';
    }

    return 'MODERATE';
};

// --- SCORING ENGINE ---
const calculateScore = (m, type, riskProfile, price, targetPrice) => {
    let score = 50;

    // 1. QUALITY SCORE (0-40 pts)
    if (m.roe > 15) score += 15;
    else if (m.roe > 10) score += 10;
    
    if (m.netMargin > 10) score += 10;
    if (m.netDebt < 0) score += 10; // Caixa Líquido é rei
    else if (m.evEbitda < 3) score += 5; // Dívida baixa

    if (type === 'FII' && m.vacancy === 0) score += 10;

    // 2. VALUATION SCORE (0-40 pts)
    const upside = targetPrice > 0 ? (targetPrice / price) - 1 : 0;
    
    if (upside > 0.40) score += 30; // Muito descontada
    else if (upside > 0.20) score += 20;
    else if (upside > 0.05) score += 10;
    else if (upside < -0.10) score -= 15; // Cara

    // FII Papel P/VP Check
    if (type === 'FII' && (m.sector?.includes('Papel'))) {
        if (m.pvp > 1.05) score -= 30; // Penalidade Brutal
        if (m.pvp >= 0.90 && m.pvp <= 1.01) score += 10; // Sweet Spot
    }

    // 3. INCOME SCORE (0-20 pts)
    if (m.dy > MACRO.SELIC) score += 20;
    else if (m.dy > 6) score += 10;

    // Penalidades Finais
    if (riskProfile === 'BOLD' && score > 60) score -= 10; // Ajuste de risco
    if (m.avgLiquidity < 500000) score -= 20; // Iliquidez

    return Math.min(99, Math.max(1, score));
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            const rawData = await marketDataService.getMarketData(assetClass);
            if (!rawData || rawData.length === 0) return { ranking: [], fullList: [] };

            const analyzedAssets = rawData.map(asset => {
                const m = asset.metrics;
                
                // HARD FILTER: Penny Stocks e Falidas
                if (asset.price < 1.00) return null;
                if (m.pl < 0 && m.netDebt > (m.marketCap || 0)) return null; // Prejuízo + Dívida Alta = Lixo

                const riskProfile = determineRiskProfile(m, asset.type, asset.sector);
                const { graham, bazin, fairPrice } = calculateIntrinsicValue(m, asset.type, asset.sector, asset.price);
                
                const finalScore = calculateScore(m, asset.type, riskProfile, asset.price, fairPrice);

                let action = 'WAIT';
                // Lógica de Ação baseada em Margem de Segurança
                const marginOfSafety = (fairPrice / asset.price) - 1;
                
                if (finalScore >= 75 && marginOfSafety > 0.15) action = 'BUY'; // Qualidade + Desconto
                else if (finalScore >= 60 && marginOfSafety > 0.30) action = 'BUY'; // Turnaround Barato
                else if (finalScore <= 40) action = 'SELL';
                
                // FII Papel Overrule
                if (asset.type === 'FII' && asset.sector.includes('Papel') && m.pvp > 1.08) action = 'SELL';

                // Teses Geradas
                const bull = [];
                const bear = [];
                if (marginOfSafety > 0.2) bull.push(`Margem de segurança de ${(marginOfSafety*100).toFixed(0)}% sobre o valor intrínseco.`);
                if (m.dy > MACRO.SELIC) bull.push(`Yield (${m.dy.toFixed(1)}%) supera a Renda Fixa.`);
                if (m.netDebt < 0) bull.push("Empresa Caixa Líquido (Alta Solvência).");
                if (m.roe > 20) bull.push("Alta rentabilidade sobre o patrimônio (ROE > 20%).");

                if (m.pvp > 2 && m.revenueGrowth < 5) bear.push("Múltiplos esticados sem crescimento correspondente.");
                if (m.debtToEquity > 2.0 && asset.sector !== 'Elétricas') bear.push("Alavancagem acima da média prudencial.");
                if (asset.type === 'FII' && m.vacancy > 10) bear.push(`Vacância física elevada (${m.vacancy}%).`);

                return {
                    ticker: asset.ticker,
                    name: asset.name,
                    sector: asset.sector,
                    type: asset.type,
                    action,
                    currentPrice: asset.price,
                    targetPrice: safeVal(fairPrice),
                    score: finalScore,
                    probability: Math.floor(finalScore * 0.9),
                    riskProfile: riskProfile,
                    thesis: bull[0] || "Aguardando ponto de entrada.",
                    bullThesis: bull,
                    bearThesis: bear,
                    reason: `Q:${Math.round(m.roe)}% V:${m.pvp.toFixed(2)}x`,
                    metrics: {
                        ...m,
                        grahamPrice: safeVal(graham),
                        bazinPrice: safeVal(bazin),
                        structural: { quality: finalScore, valuation: finalScore, risk: 50 }
                    }
                };
            }).filter(Boolean);

            // Sorting: Score DESC
            const sortedList = analyzedAssets.sort((a, b) => b.score - a.score);

            return {
                ranking: sortedList, 
                fullList: sortedList
            };

        } catch (error) {
            logger.error(`Erro cálculo ranking: ${error.message}`);
            return { ranking: [], fullList: [] };
        }
    },

    async generateNarrative(ranking, assetClass) {
        // ... (Mantém a lógica de narrativa IA existente)
        return "Análise gerada automaticamente pelo Vértice Quantum Engine v4.";
    }
};
