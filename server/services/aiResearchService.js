import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import MarketAnalysis from '../models/MarketAnalysis.js'; 

/**
 * MOTOR QUANTITATIVO - VÉRTICE INVEST (PHASE 2.2 - FIX)
 * Adicionado: Proteções contra NaN e Infinity em Valuation
 */

const RISK_FREE_BR = 0.105; 
const RISK_FREE_US = 0.045; 

// Helper seguro para números
const safeNum = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val)) return 0;
    return val;
}

// --- Technical & Valuation Engines ---
const calculateTechnicals = (history, currentPrice) => {
    if (!history || history.length < 30 || currentPrice <= 0) return { volatility: 0, sharpe: 0, rsi: 50, priceVsSMA200: 0 };
    const closes = history.map(h => h.close).filter(p => p > 0);
    if (closes.length < 14) return { volatility: 0, sharpe: 0, rsi: 50, priceVsSMA200: 0 };

    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i-1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / closes.length;
    const avgLoss = losses / closes.length;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    const returns = [];
    for (let i = 1; i < closes.length; i++) returns.push(Math.log(closes[i] / closes[i - 1]));
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const annualizedVol = Math.sqrt(variance) * Math.sqrt(12);

    const totalReturn = (closes[closes.length - 1] - closes[0]) / closes[0];
    const annualizedReturn = Math.pow(1 + totalReturn, 12 / closes.length) - 1;
    const sharpe = annualizedVol > 0 ? (annualizedReturn - RISK_FREE_BR) / annualizedVol : 0;

    const sma = closes.reduce((a,b) => a+b, 0) / closes.length;
    const priceVsSMA = sma > 0 ? ((currentPrice - sma) / sma) * 100 : 0;

    return { 
        volatility: safeNum(annualizedVol * 100), 
        sharpe: safeNum(sharpe), 
        rsi: safeNum(rsi), 
        priceVsSMA200: safeNum(priceVsSMA) 
    };
};

const calculateValuation = (metrics, price, type) => {
    const m = { ...metrics };
    
    // Graham (Apenas se EPS e BVPS positivos)
    m.grahamPrice = (m.eps > 0 && m.bvps > 0) ? Math.sqrt(22.5 * m.eps * m.bvps) : 0;
    
    // Bazin (Dividendos)
    // Preço Teto = Div Pago / 6%
    // Usamos DY para estimar o Div Pago em R$
    const dividendVal = (m.dy / 100) * price;
    m.bazinPrice = dividendVal > 0 ? dividendVal / 0.06 : 0;
    
    // Altman Z-Score
    let z = 1.0;
    if (m.currentRatio > 1.5) z += 1.0;
    if (m.debtToEquity < 100) z += 1.0;
    if (m.debtToEquity > 200) z -= 1.5;
    if (m.netMargin > 10) z += 1.0;
    if (type === 'FII' && m.pvp > 0.8 && m.pvp < 1.15) z = 3.5; 
    m.altmanZScore = parseFloat(z.toFixed(2));

    const growth = m.revenueGrowth > 0 ? m.revenueGrowth : (m.roe > 0 ? m.roe : 1);
    m.pegRatio = (m.pl > 0 && growth > 0) ? parseFloat((m.pl / growth).toFixed(2)) : 0;
    m.earningsYield = m.pl > 0 ? parseFloat((100 / m.pl).toFixed(2)) : 0;
    
    return m;
};

const calculateScore = (asset, m, tech) => {
    if (asset.price <= 0) return 0; // Preço inválido zera score

    let score = 50;
    if (asset.type === 'STOCK' || asset.type === 'STOCK_US') {
        if (m.grahamPrice > asset.price) score += 10;
        if (m.bazinPrice > asset.price) score += 5;
        if (m.pegRatio > 0 && m.pegRatio < 1.5) score += 5;
        if (m.pl > 0 && m.pl < 15) score += 5;
        if (m.roe > 15) score += 10;
        if (m.netMargin > 10) score += 5;
        if (m.debtToEquity < 80) score += 5;
        if (m.revenueGrowth > 10) score += 5;
        if (m.altmanZScore > 2.5) score += 5;
        if (tech.rsi < 30) score += 5;
        if (tech.priceVsSMA200 > 0) score += 5;
        if (tech.sharpe > 1) score += 5;
        if (m.dy > 6) score += 10;
        if (m.dy > 0) score += 5;
    } else if (asset.type === 'FII') {
        if (m.dy > 12) score += 25;
        else if (m.dy > 9) score += 15;
        else if (m.dy > 6) score += 5;
        if (m.bazinPrice > asset.price) score += 15;
        if (m.pvp >= 0.85 && m.pvp <= 1.05) score += 15;
        else if (m.pvp < 0.85) score += 10;
        else if (m.pvp > 1.2) score -= 15;
        if (tech.volatility < 15) score += 10;
        if (tech.priceVsSMA200 > -5) score += 5;
    } else if (asset.type === 'CRYPTO') {
        if (tech.rsi > 70) score -= 10;
        if (tech.rsi < 40) score += 15;
        if (tech.priceVsSMA200 > 0) score += 15;
        if (tech.volatility < 80) score += 10;
        if (m.mktCap > 10000000000) score += 15;
    }
    if (m.pl < 0) score -= 25;
    if (m.dy === 0 && asset.type === 'FII') score -= 50;
    return Math.min(99, Math.max(1, Math.floor(score)));
};

const getLatestAuditFromDB = async (assetClass) => {
    const report = await MarketAnalysis.findOne({ assetClass }).sort({ createdAt: -1 });
    return report?.content?.fullAuditLog || [];
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy) {
        try {
            // --- BRASIL 10 ---
            if (assetClass === 'BRASIL_10') {
                logger.info("🧪 [QUANT] Compondo Carteira Brasil 10...");
                
                const [stocks, fiis, cryptos] = await Promise.all([
                    getLatestAuditFromDB('STOCK'),
                    getLatestAuditFromDB('FII'),
                    getLatestAuditFromDB('CRYPTO')
                ]);

                if (!stocks.length || !fiis.length || !cryptos.length) {
                    logger.warn("⚠️ Dados insuficientes no DB para Brasil 10.");
                    return [];
                }

                const sortedStocks = stocks.sort((a, b) => b.score - a.score);
                const sortedFiis = fiis.sort((a, b) => b.score - a.score);
                const sortedCryptos = cryptos.sort((a, b) => b.score - a.score);

                const topStocks = sortedStocks.slice(0, 5);
                const topFiis = sortedFiis.slice(0, 4);
                const topCrypto = sortedCryptos.slice(0, 1);

                const combined = [...topStocks, ...topFiis, ...topCrypto];
                combined.sort((a, b) => b.score - a.score);

                logger.info(`✅ [QUANT] Brasil 10 composto.`);
                return combined;
            }

            // --- LÓGICA PADRÃO ---
            logger.info(`🧪 [QUANT] Coletando dados para ${assetClass}...`);
            const rawData = await marketDataService.getMarketData(assetClass);
            
            if (!rawData || rawData.length === 0) return [];

            const analyzedAssets = rawData.map(asset => {
                const tech = calculateTechnicals(asset.history, asset.price);
                let metrics = calculateValuation(asset.metrics, asset.price, asset.type);
                metrics = { 
                    ...metrics, 
                    volatility: parseFloat(tech.volatility.toFixed(2)), 
                    sharpeRatio: parseFloat(tech.sharpe.toFixed(2)),
                    rsi: parseFloat(tech.rsi.toFixed(2)),
                    priceVsSMA200: parseFloat(tech.priceVsSMA200.toFixed(2))
                };

                const score = calculateScore(asset, metrics, tech);

                let action = 'WAIT';
                if (score >= 75) action = 'BUY';
                else if (score <= 40) action = 'SELL';

                let targetPrice = asset.price;
                if (metrics.grahamPrice > 0 && asset.type === 'STOCK') {
                    targetPrice = (metrics.grahamPrice + metrics.bazinPrice + asset.price) / 3;
                } else if (asset.type === 'FII') {
                    targetPrice = metrics.bazinPrice > 0 ? metrics.bazinPrice : asset.price;
                } else if (asset.type === 'CRYPTO') {
                    targetPrice = asset.price * (1 + (metrics.volatility / 100));
                }

                return {
                    ticker: asset.ticker,
                    name: asset.name,
                    sector: asset.sector,
                    action,
                    targetPrice: safeNum(parseFloat(targetPrice.toFixed(2))),
                    score,
                    probability: Math.floor(score * 0.9),
                    thesis: score > 70 ? 'STRONG BUY' : 'NEUTRAL',
                    reason: `Score ${score}. DY: ${metrics.dy.toFixed(1)}%. Vol: ${metrics.volatility}%`,
                    metrics
                };
            });

            // Filtra ativos com preço zerado ou erro grave
            const sorted = analyzedAssets
                .filter(a => a.metrics && a.targetPrice > 0 && a.score > 0)
                .sort((a, b) => b.score - a.score);

            logger.info(`✅ [QUANT] Ranking ${assetClass} calculado: ${sorted.length} ativos válidos.`);
            return sorted;

        } catch (error) {
            logger.error(`❌ [QUANT FAIL] ${error.message}`);
            return null;
        }
    },

    async generateNarrative(ranking, assetClass) {
        if (!process.env.API_KEY || !ranking || ranking.length === 0) return "Relatório indisponível.";
        
        const top3 = ranking.slice(0, 3);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const summary = top3.map(a => 
            `> ${a.ticker} (${a.sector}): Score ${a.score}. DY ${a.metrics.dy.toFixed(1)}%. Graham R$${a.metrics.grahamPrice.toFixed(2)}. RSI ${a.metrics.rsi}.`
        ).join("\n");
        
        const prompt = `
        Analista Sênior Vértice Invest.
        Gere um 'Morning Call' executivo sobre o ranking de ${assetClass}.
        
        Destaques do Top 3:
        ${summary}
        
        Estrutura:
        1. **Resumo do Mercado**: Visão macro rápida.
        2. **Top Picks**: Por que esses 3 ativos venceram o algoritmo (cite fundamentos e técnico)?
        3. **Aviso de Risco**: Cite volatilidade ou cenário político.
        
        Tom: Profissional, direto, institucional. Use Markdown.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: { temperature: 0.3 }
            });
            return response.text;
        } catch (e) {
            return "Narrativa indisponível no momento.";
        }
    }
};