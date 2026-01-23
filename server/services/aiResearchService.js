
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';

// Lista de modelos (Backup)
const MODEL_CHAIN = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-flash-latest'
];

// --- MOTOR QUANTITATIVO (Matemática Pura) ---
const calculateQuantScore = (asset, strategy) => {
    let score = 50; // Base
    const metrics = asset.metrics || {};
    const analysis = asset.analysis || {};

    // 1. Fator Valor (Value)
    if (metrics.dy > 6) score += 10; // Bons dividendos
    if (metrics.dy > 12) score += 5; // Dividendos excelentes
    if (metrics.pl > 0 && metrics.pl < 10) score += 15; // P/L Descontado
    if (metrics.pvp > 0 && metrics.pvp < 1.0) score += 10; // Abaixo valor patrimonial
    if (analysis.upsideGraham > 20) score += 10; // Margem de segurança Graham

    // 2. Fator Qualidade (Quality)
    if (metrics.roe > 15) score += 15; // Alta rentabilidade
    if (analysis.qualityScore > 2000) score += 5; // Margens altas

    // 3. Fator Momento (Momentum - Simples)
    const change = parseFloat(asset.change);
    if (change > 0) score += 5; // Tendência de alta curto prazo

    // Penalizações
    if (metrics.pl < 0) score -= 20; // Prejuízo
    if (metrics.dy === 0 && strategy === 'BUY_HOLD') score -= 10;

    // Normalização 0-99
    return Math.min(99, Math.max(10, Math.floor(score)));
};

const determineThesis = (asset) => {
    const m = asset.metrics;
    if (m.dy > 10) return "DIVIDENDOS";
    if (m.pl > 0 && m.pl < 6) return "VALOR";
    if (m.roe > 20) return "QUALIDADE";
    if (asset.analysis.upsideGraham > 30) return "GRAHAM";
    return "MOMENTO";
};

// --- GERAÇÃO DE TEXTO (IA ou Template) ---
const generateMorningCall = async (topAssets, macroData, aiClient) => {
    // Se não tiver cliente IA configurado, retorna template direto
    if (!aiClient) return generateTemplateText(topAssets);

    const prompt = `
Contexto Macro: ${JSON.stringify(macroData)}
Destaques (Top 3): ${JSON.stringify(topAssets.slice(0, 3).map(a => ({t: a.ticker, s: a.score, dy: a.metrics.dy})))}

Tarefa: Escreva um "Morning Call" curto (2 parágrafos) e profissional para investidores.
Foco: Analise o sentimento macro e cite brevemente por que os destaques foram escolhidos (baseado nos dados).
Estilo: Direto, analítico, sem saudações genéricas.
Output: Apenas o texto Markdown.`;

    try {
        // Tenta modelos em cadeia
        for (const model of MODEL_CHAIN) {
            try {
                const response = await aiClient.models.generateContent({
                    model: model,
                    contents: prompt,
                    config: { temperature: 0.4 }
                });
                if (response.text) return response.text;
            } catch (e) {
                // Se for erro de permissão (403), aborta loop e joga erro para cair no fallback
                if (e.message.includes('403') || e.message.includes('API key')) throw e;
                continue; // Tenta próximo modelo
            }
        }
        throw new Error("Todos modelos falharam");
    } catch (e) {
        logger.warn(`⚠️ [AI TEXT FAIL] Usando fallback de texto: ${e.message}`);
        return generateTemplateText(topAssets);
    }
};

const generateTemplateText = (topAssets) => {
    const top1 = topAssets[0];
    return `
### Análise Quantitativa Automática

O **Vértice Neural Engine** processou os indicadores fundamentais e técnicos do mercado. 

O destaque principal é **${top1.ticker}**, apresentando um Score de **${top1.score}/100**. O ativo demonstra solidez com um Dividend Yield de ${top1.metrics.dy?.toFixed(1)}% e indicadores de valor atrativos.

Recomendamos cautela e diversificação. Este ranking é baseado puramente em métricas matemáticas (P/L, PVP, ROE, DY) e não constitui promessa de retorno.
    `.trim();
};

export const aiResearchService = {
    async generateAnalysis(assetClass, strategy) {
        // Inicializa cliente IA (pode falhar se sem chave, mas não para o fluxo)
        let aiClient = null;
        if (process.env.API_KEY) {
            try {
                aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
            } catch (e) { logger.warn("Falha ao init AI client"); }
        }

        try {
            logger.info(`🚀 [ENGINE] Iniciando Análise Híbrida: ${assetClass}`);
            
            // 1. Coleta de Dados (Yahoo Finance)
            let rawData = [];
            if (assetClass === 'BRASIL_10') {
                const [stocks, fiis] = await Promise.all([
                    marketDataService.getMarketData('STOCK'),
                    marketDataService.getMarketData('FII')
                ]);
                rawData = [...stocks, ...fiis];
            } else {
                rawData = await marketDataService.getMarketData(assetClass);
            }

            if (!rawData || rawData.length < 3) throw new Error("Dados insuficientes.");

            // 2. Processamento Quantitativo (Matemática)
            const rankedAssets = rawData.map(asset => {
                const score = calculateQuantScore(asset, strategy);
                return {
                    ticker: asset.ticker,
                    name: asset.name,
                    price: asset.price,
                    score: score,
                    // Lógica simples de ação baseada no score
                    action: score > 75 ? 'BUY' : (score < 40 ? 'SELL' : 'WAIT'),
                    targetPrice: asset.price * (1 + (analysis.upsideGraham > 0 ? analysis.upsideGraham/100 : 0.15)),
                    probability: Math.min(95, 50 + (score / 2.5)), // Probabilidade derivada do score
                    thesis: determineThesis(asset),
                    reason: `Score Quant: ${score}. DY: ${asset.metrics.dy?.toFixed(1)}%, P/L: ${asset.metrics.pl?.toFixed(1)}.`,
                    detailedAnalysis: {
                        summary: `Ativo selecionado via algoritmo quantitativo. Apresenta ROE de ${asset.metrics.roe?.toFixed(1)}% e Margens consistentes.`,
                        pros: ["Múltiplos descontados", "Tendência de fundamentos positiva"],
                        cons: ["Volatilidade de mercado", "Risco setorial"],
                        valuationMethod: "Vértice Quant Score v1.0"
                    },
                    ...asset // Mantém dados originais se precisar
                };
            })
            .sort((a, b) => b.score - a.score) // Ordena por Score (Maior para menor)
            .slice(0, 10); // Top 10

            // 3. Geração de Texto (IA ou Fallback)
            const macro = await marketDataService.getMacroContext();
            const morningCallText = await generateMorningCall(rankedAssets, macro, aiClient);

            logger.info(`✅ [ENGINE] Análise concluída com sucesso para ${assetClass}`);

            return {
                morningCall: morningCallText,
                ranking: rankedAssets.map((item, idx) => ({
                    position: idx + 1,
                    ticker: item.ticker,
                    name: item.name,
                    action: item.action,
                    targetPrice: item.targetPrice,
                    score: item.score,
                    probability: Math.floor(item.probability),
                    thesis: item.thesis,
                    reason: item.reason,
                    detailedAnalysis: item.detailedAnalysis
                }))
            };

        } catch (error) {
            logger.error(`❌ [ENGINE FAIL] ${error.message}`);
            return null;
        }
    }
};
