
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';

const sN = (val) => val === null || val === undefined || isNaN(val) ? 0 : Number(val);
const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

const MACRO = {
    SELIC: 11.25,
    IPCA: 4.50,
    CDI: 11.15
};

const SECTOR_BETA = {
    'Energia (Transmissão)': 0.4, 'Saneamento Básico': 0.5, 'Seguradora': 0.6,
    'Bancos': 0.9, 'Energia (Geração)': 0.7, 'Telecomunicações': 0.6,
    'Alimentos Processados': 0.7, 'Varejo Alimentar': 0.6, 
    'Mineração': 1.1, 'Petróleo e Gás': 1.3, 'Siderurgia': 1.4,
    'Varejo Eletro': 1.8, 'E-commerce': 2.0, 'Construção Civil': 1.6, 
    'Tecnologia': 1.5, 'Companhia Aérea': 1.9, 'Educação': 1.4,
    'FII Galpão Logístico': 0.4, 'FII Shopping Center': 0.6, 
    'FII Papel (High Grade)': 0.2, 'FII Papel (High Yield)': 0.8,
    'FII Laje Corporativa': 0.7
};

const calculateRiskProfile = (m, type, sector) => {
    let riskPoints = 0; 
    
    const sec = sector ? sector.trim() : 'Outros';
    const impliedBeta = SECTOR_BETA[sec] || (type === 'FII' ? 0.5 : 1.0); 

    if (MACRO.SELIC > 10) {
        if (impliedBeta > 1.2) riskPoints += 15; 
        if (sec.includes('Seguradora') || sec.includes('Papel')) riskPoints -= 10; 
    }

    if (type === 'FII') {
        riskPoints = 20; 
        if (sec.includes('Papel') || sec.includes('Recebíveis')) {
            if (m.pvp < 0.80) riskPoints += 50; 
            if (m.pvp < 0.90) riskPoints += 20; 
            if (m.dy > (MACRO.CDI + 4)) riskPoints += 15; 
        }
        if (!sec.includes('Papel')) {
            if (sN(m.vacancy) > 15) riskPoints += 40; 
            else if (sN(m.vacancy) > 8) riskPoints += 15;
        }
        if (sN(m.qtdImoveis) === 1) riskPoints += 20;

    } else if (type === 'STOCK' || type === 'STOCK_US') {
        riskPoints = 40; 
        if (impliedBeta < 0.6) riskPoints -= 20; 
        if (impliedBeta > 1.3) riskPoints += 25; 

        const divLiqPL = sN(m.debtToEquity);
        if (divLiqPL > 2.5) riskPoints += 40; 
        else if (divLiqPL > 1.5) riskPoints += 20;
        else if (divLiqPL < 0.5) riskPoints -= 10;

        if (sN(m.netMargin) < 3) riskPoints += 30; 
        if (sN(m.netMargin) > 20) riskPoints -= 15; 
        
        if (m.pl <= 0) riskPoints += 50; 
    } else {
        riskPoints = 90;
    }

    const thresholdTrap = MACRO.SELIC + 8; 
    if (m.dy > thresholdTrap) riskPoints += 30;

    riskPoints = Math.min(100, Math.max(0, riskPoints));

    if (riskPoints <= 35) return 'DEFENSIVE'; 
    if (riskPoints <= 65) return 'MODERATE';
    return 'BOLD';
};

const getQualityScore = (m, type) => {
    let score = 50;

    if (type === 'STOCK' || type === 'STOCK_US') {
        // --- 1. RENTABILIDADE (ROIC & ROE) ---
        // A chave do Buy & Hold é o retorno sobre capital investido
        if (sN(m.roic) > 15) score += 20; 
        else if (sN(m.roic) > 10) score += 10;
        else if (sN(m.roic) < 5) score -= 10;

        if (sN(m.roe) > 20) score += 10;

        // --- 2. CRESCIMENTO (COMPOUNDERS) ---
        // Empresas que crescem receita acima da inflação ganham premium
        if (sN(m.revenueGrowth) > 10) score += 15;
        else if (sN(m.revenueGrowth) > 5) score += 5;
        else if (sN(m.revenueGrowth) < 0) score -= 15; // Empresa encolhendo é perigoso

        // --- 3. MARGEM (FOSSO ECONÔMICO) ---
        if (sN(m.netMargin) > 15) score += 10;
        
        // Liquidez (Filtro Anti-Mico)
        if (sN(m.avgLiquidity) > 5000000) score += 5;
        else score -= 20;
    } 
    else if (type === 'FII') {
        if (sN(m.vacancy) === 0) score += 20;
        if (sN(m.qtdImoveis) > 5) score += 15;
        if (sN(m.avgLiquidity) > 3000000) score += 10;
    }
    
    return Math.min(100, Math.max(0, score));
};

const getValuationScore = (m, price, type) => {
    let score = 50;

    if (type === 'STOCK' || type === 'STOCK_US') {
        // Graham Upside
        if (m.grahamPrice > 0 && price > 0) {
            const upside = (m.grahamPrice / price) - 1;
            if (upside > 0.4) score += 30;
            else if (upside > 0.15) score += 15;
            else if (upside < -0.1) score -= 15;
        }

        // Bazin Yield
        if (m.dy > 6) score += 20;
        else if (m.dy < 3) score -= 10;

        // EV/EBITDA (Melhor que P/L para comparar indústrias)
        if (m.evEbitda > 0 && m.evEbitda < 6) score += 15;
        if (m.evEbitda > 12) score -= 10;

        // P/L Aceitável
        if (m.pl > 0 && m.pl < 10) score += 10; 
        if (m.pl > 25) score -= 20;
    } 
    else if (type === 'FII') {
        const pvp = sN(m.pvp);
        if (pvp >= 0.85 && pvp <= 1.05) score += 40; 
        else if (pvp < 0.80) score -= 10; 
        else if (pvp > 1.10) score -= 20; 
        
        if (m.dy > MACRO.IPCA + 6) score += 15;
    }
    
    return Math.min(100, Math.max(0, score));
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            const rawData = await marketDataService.getMarketData(assetClass);
            if (!rawData || rawData.length === 0) return { ranking: [], fullList: [] };

            const analyzedAssets = rawData.map(asset => {
                const m = asset.metrics;
                
                const qScore = getQualityScore(m, asset.type);
                const vScore = getValuationScore(m, asset.price, asset.type);
                const riskProfile = calculateRiskProfile(m, asset.type, asset.sector);
                
                let rScore = 0; 
                if (riskProfile === 'DEFENSIVE') rScore = 100;
                if (riskProfile === 'MODERATE') rScore = 65;
                if (riskProfile === 'BOLD') rScore = 30;

                let finalScore = (qScore * 0.40) + (vScore * 0.25) + (rScore * 0.35);
                
                // FATALITIES
                if (m.dy > 25) finalScore = 20; 
                if (m.avgLiquidity < 200000) finalScore = 0; 
                if (asset.type === 'STOCK' && m.pl < 0) finalScore = 15; 

                finalScore = Math.round(Math.min(99, Math.max(1, finalScore)));

                let action = 'WAIT';
                if (finalScore >= 70) action = 'BUY'; 
                else if (finalScore <= 40) action = 'SELL';

                let targetPrice = 0;
                if (m.bazinPrice > 0 && m.grahamPrice > 0) {
                    targetPrice = Math.min(m.bazinPrice, m.grahamPrice);
                } else if (m.bazinPrice > 0) targetPrice = m.bazinPrice;
                else targetPrice = asset.price;

                return {
                    ticker: asset.ticker,
                    name: asset.name,
                    sector: asset.sector,
                    type: asset.type,
                    action,
                    currentPrice: asset.price,
                    targetPrice: safeVal(targetPrice),
                    score: finalScore,
                    probability: Math.floor(finalScore * 0.85) + 5,
                    thesis: `Perfil ${riskProfile}. Beta: ${SECTOR_BETA[asset.sector] || '-'}`,
                    riskProfile: riskProfile,
                    reason: `Q:${qScore} V:${vScore} R:${rScore}`,
                    metrics: {
                        ...m,
                        structural: { quality: qScore, valuation: vScore, risk: rScore }
                    }
                };
            }).filter(Boolean);

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
        if (!process.env.API_KEY) {
            logger.warn("Narrativa pulada: API_KEY não configurada.");
            return "Análise indisponível (Chave de API ausente).";
        }
        
        if (!ranking || ranking.length === 0) return "Dados insuficientes para análise.";

        const top5 = ranking.slice(0, 5).map(a => 
            `- ${a.ticker} (${a.sector}): Score ${a.score}, Ação ${a.action}, Perfil ${a.riskProfile}, Yield ${a.metrics.dy?.toFixed(1)}%`
        ).join('\n');

        const context = `
        Você é um Analista Chefe de Equity Research focado em Value Investing e Aposentadoria (Buy & Hold).
        Cenário Atual: Selic ${MACRO.SELIC}%, IPCA ${MACRO.IPCA}%.
        Classe de Ativo: ${assetClass}.
        
        Escreva um "Morning Call" curto e direto (máximo 2 parágrafos) em Markdown.
        
        Destaques analisados pelo algoritmo:
        ${top5}
        
        1. Comente brevemente sobre o melhor ativo da lista.
        2. Dê um aviso de risco geral baseado no cenário macro (Selic alta).
        3. Use tom profissional e sóbrio.
        `;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: context,
                config: { 
                    temperature: 0.4,
                    maxOutputTokens: 600
                }
            });
            return response.text || "Sem análise gerada.";
        } catch (e) { 
            logger.error(`Erro IA Narrativa: ${e.message}`);
            return "Análise automática indisponível no momento."; 
        }
    }
};
