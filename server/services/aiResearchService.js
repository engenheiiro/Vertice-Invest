import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';

const MACRO = {
    RISK_FREE_BR: 0.1075, // Selic atual
    BRAZIL_RISK: 0.02,    // Risco país
    INFLATION_TARGET: 0.045
};

const sN = (val) => val === null || val === undefined ? 0 : Number(val);
const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return null;
    return Number(val.toFixed(2));
};

// --- ESTRUTURAL: CRIAÇÃO DE VALOR ---

const calculateROIC = (m) => {
    if (!m.netMargin || !m.totalAssets) return null;
    // Proxied ROIC: (Net Profit / Invested Capital)
    // IC = Equity + Debt - Cash
    const investedCapital = sN(m.mktCap) / sN(m.pvp) + sN(m.totalDebt) - sN(m.totalCash);
    const netProfit = (sN(m.netMargin) / 100) * (sN(m.mktCap) / sN(m.pl));
    return (netProfit / investedCapital) * 100;
};

const calculateQualityScore = (m, type, sector) => {
    let score = 50; 

    if (type === 'STOCK' || type === 'STOCK_US') {
        // Spread ROIC vs WACC (WACC BR ~14%)
        const roic = calculateROIC(m) || m.roe;
        const waccBenchmark = type === 'STOCK' ? 14 : 9;
        
        if (roic > waccBenchmark + 10) score += 30; // Excelente criador de valor
        else if (roic > waccBenchmark) score += 15;
        else if (roic < waccBenchmark) score -= 20;

        // Dívida Líquida / Patrimônio (Cuidado com alavancagem no Longo Prazo)
        const debtToEquity = (sN(m.totalDebt) - sN(m.totalCash)) / (sN(m.mktCap) / sN(m.pvp));
        if (debtToEquity < 0.5) score += 10;
        if (debtToEquity > 2.0) score -= 25;

        // Margem de Segurança Fundamentalista
        if (sN(m.netMargin) > 15) score += 10;
    } 
    else if (type === 'FII') {
        // FIIs: Estabilidade de Renda e Alavancagem
        const ltv = sN(m.totalDebt) / sN(m.totalAssets); // Alavancagem do Fundo
        if (ltv > 0.30) score -= 30; // FII muito alavancado é risco no BR
        else score += 10;

        if (sN(m.dy) > MACRO.RISK_FREE_BR * 100) score += 20;
        
        // Desconto Patrimonial Saudável (não muito baixo que indique quebra)
        if (sN(m.pvp) < 0.98 && sN(m.pvp) > 0.85) score += 20;
        else if (sN(m.pvp) < 0.70) score -= 20; // Sinal de problema nos ativos
    }
    else if (type === 'CRYPTO') {
        // Crypto: Adoção e Tokenomics
        if (sN(m.mktCap) > 10000000000) score += 20; // "Blue chips" crypto
        if (sN(m.avgLiquidity) > 100000000) score += 15;
        // Volatilidade punitiva para B&H
        if (sN(m.volatility) > 80) score -= 20;
    }

    return Math.min(100, Math.max(0, score));
};

const calculateValuationScore = (m, price, type) => {
    let score = 50;

    if (type === 'STOCK' || type === 'STOCK_US') {
        const grahamPrice = (sN(m.eps) > 0 && sN(m.bvps) > 0) ? Math.sqrt(22.5 * m.eps * m.bvps) : 0;
        if (grahamPrice > 0) {
            const upside = (grahamPrice / price) - 1;
            if (upside > 0.3) score += 30;
            else if (upside < 0) score -= 30;
        }
        
        // Bazin (Foco Dividendos)
        const bazinPrice = (sN(m.dy)/100 * price) / 0.06;
        if (price < bazinPrice) score += 10;
    }
    else if (type === 'FII') {
        const yieldTarget = (MACRO.RISK_FREE_BR * 100) + 2; // Selic + 2%
        if (sN(m.dy) > yieldTarget) score += 30;
        if (sN(m.pvp) > 1.1) score -= 40;
    }

    return Math.min(100, Math.max(0, score));
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            const rawData = await marketDataService.getMarketData(assetClass);
            if (!rawData || rawData.length === 0) return [];

            const analyzedAssets = rawData.map(asset => {
                const m = asset.metrics;
                const qScore = calculateQualityScore(m, asset.type, asset.sector);
                const vScore = calculateValuationScore(m, asset.price, asset.type);
                
                // Metodologia Buy & Hold: 60% Qualidade, 40% Preço
                let finalScore = (qScore * 0.60) + (vScore * 0.40);
                
                // Penalidade por baixa liquidez (Não queremos ficar presos em B&H)
                if (asset.type !== 'CRYPTO' && m.avgLiquidity < 500000) finalScore *= 0.7;

                finalScore = Math.floor(Math.min(99, Math.max(1, finalScore)));

                let action = 'WAIT';
                if (finalScore >= 80) action = 'BUY';
                else if (finalScore <= 40) action = 'SELL';

                return {
                    ticker: asset.ticker,
                    name: asset.name,
                    sector: asset.sector,
                    type: asset.type,
                    action,
                    currentPrice: asset.price,
                    targetPrice: safeVal((sN(m.eps) > 0 && sN(m.bvps) > 0) ? Math.sqrt(22.5 * m.eps * m.bvps) : asset.price * 1.2),
                    score: finalScore,
                    probability: Math.floor(finalScore * 0.8) + 10,
                    thesis: finalScore > 75 ? "Oportunidade Longo Prazo" : "Manutenção",
                    reason: `${asset.sector}: ROE ${sN(m.roe).toFixed(1)}% • DY ${sN(m.dy).toFixed(1)}% • Score Estrutural ${finalScore}`,
                    metrics: {
                        ...m,
                        structural: {
                            quality: qScore,
                            valuation: vScore,
                            risk: 100 - qScore 
                        }
                    }
                };
            }).filter(Boolean);

            return analyzedAssets.sort((a, b) => b.score - a.score);
        } catch (error) {
            logger.error(`Erro cálculo ranking: ${error.message}`);
            return [];
        }
    },

    async generateNarrative(ranking, assetClass) {
        if (!process.env.API_KEY || !ranking || ranking.length === 0) return "Relatório indisponível.";
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const top3 = ranking.slice(0, 3).map(a => `${a.ticker} (Score ${a.score})`).join('; ');
        
        const prompt = `Aja como Senior Portfolio Manager especialista em Buy & Hold. 
        Analise esta seleção de ${assetClass}: ${top3}. 
        Escreva um Morning Call focado em fundamentos e geração de valor de longo prazo. 
        Mencione o spread ROIC/WACC se for ações ou Yield Real se for FIIs. Seja conciso e profissional.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: { temperature: 0.3 }
            });
            return response.text;
        } catch (e) { return "Erro ao gerar narrativa via IA."; }
    }
};