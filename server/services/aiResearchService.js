
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const extractJSON = (text) => {
    try {
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        return null;
    }
};

export const aiResearchService = {
    async generateAnalysis(assetClass, strategy, retryCount = 0) {
        const MAX_RETRIES = 2;
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        try {
            logger.info(`🤖 [AI] Gerando ${assetClass}...`);
            
            let marketData = [];
            if (assetClass === 'BRASIL_10') {
                const [stocks, fiis] = await Promise.all([
                    marketDataService.getMarketData('STOCK'),
                    marketDataService.getMarketData('FII')
                ]);
                marketData = [...stocks, ...fiis].slice(0, 15);
            } else {
                const raw = await marketDataService.getMarketData(assetClass === 'STOCK_US' ? 'STOCK_US' : assetClass);
                marketData = raw.slice(0, 15);
            }

            const systemInstruction = `Você é o Analista Chefe da Vértice Invest. 
Responda EXCLUSIVAMENTE em JSON. 
morningCall: Texto macro direto e profissional (mínimo 300 palavras), sem markdown.
ranking: Array de 10 objetos com: position, ticker, name, action (BUY/SELL/WAIT), targetPrice (number), score (0-100), reason.`;

            const prompt = `DADOS ATUAIS: ${JSON.stringify(marketData)}. Analise a classe ${assetClass} com estratégia ${strategy}.`;

            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: {
                    systemInstruction,
                    temperature: 0.1,
                    thinkingConfig: { thinkingBudget: 0 }
                }
            });

            const result = extractJSON(response.text);
            
            // Validação de Integridade: Se faltar campos cruciais, consideramos falha
            if (!result || !result.morningCall || !result.ranking || result.ranking.length < 5) {
                throw new Error("Resposta da IA incompleta ou inválida.");
            }
            
            return result;

        } catch (error) {
            const isQuota = error.message?.includes('429') || error.status === 'RESOURCE_EXHAUSTED';
            
            if (isQuota && retryCount < MAX_RETRIES) {
                const wait = 65000; // 65s para resetar cota RPM=1
                logger.warn(`⏳ [QUOTA] Limite atingido em ${assetClass}. Aguardando ${wait}ms...`);
                await sleep(wait);
                return this.generateAnalysis(assetClass, strategy, retryCount + 1);
            }

            logger.error(`❌ [AI ERROR] ${assetClass}: ${error.message}`);
            throw error;
        }
    }
};
