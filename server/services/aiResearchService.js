
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { portfolioEngine } from './engines/portfolioEngine.js';
import SystemConfig from '../models/SystemConfig.js';

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            logger.info(`📥 [ORCHESTRATOR] Coletando dados para ${assetClass}...`);
            
            // 1. Coleta Dados de Mercado (Já vem com flags DB e Setores DB)
            const rawData = await marketDataService.getMarketData(assetClass);
            
            if (!rawData || rawData.length === 0) {
                logger.warn("⚠️ Nenhum dado bruto encontrado.");
                return { ranking: [], fullList: [] };
            }

            // 2. Coleta Configuração Macro do Banco (Contexto)
            const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            
            // Contexto padrão caso o banco esteja vazio na primeira execução
            const context = {
                MACRO: macroConfig ? {
                    SELIC: macroConfig.selic,
                    IPCA: macroConfig.ipca,
                    RISK_FREE: macroConfig.riskFree,
                    NTNB_LONG: macroConfig.ntnbLong
                } : {
                    SELIC: 11.25, IPCA: 4.50, RISK_FREE: 11.25, NTNB_LONG: 6.30
                }
            };

            // 3. Scoring Engine: Processa cada ativo individualmente com o Contexto
            const processedAssets = rawData
                .map(asset => scoringEngine.processAsset(asset, context))
                .filter(Boolean); 

            // 4. Portfolio Engine: Realiza o Draft Competitivo
            let ranking = portfolioEngine.performCompetitiveDraft(processedAssets);
            
            // 5. Portfolio Engine: Aplica penalidades finais de concentração
            ranking = portfolioEngine.applyConcentrationPenalty(ranking);

            // 6. Gera Lista Completa para Auditoria
            const fullList = processedAssets.map(asset => {
                const entries = Object.entries(asset.scores);
                const [bestProfile, bestScore] = entries.reduce((a, b) => a[1] > b[1] ? a : b);
                
                let action = 'WAIT';
                if (bestScore >= 70) action = 'BUY'; 
                
                return {
                    ...asset,
                    riskProfile: bestProfile,
                    score: bestScore,
                    action: action,
                    thesis: `Audit: Score ${bestScore} em ${bestProfile}`
                };
            }).sort((a, b) => b.score - a.score); 

            return { ranking, fullList };

        } catch (error) {
            logger.error(`Erro orquestração ranking: ${error.message}`);
            return { ranking: [], fullList: [] };
        }
    },

    async generateNarrative(ranking, assetClass) {
        if (!process.env.API_KEY || ranking.length === 0) return "Análise indisponível.";
        const highlights = ranking.filter(r => r.action === 'BUY').slice(0, 5);
        const contextItems = highlights.map(a => 
            `- ${a.ticker} (${a.riskProfile}): R$ ${a.currentPrice} (Score ${a.score}). ${a.thesis}`
        ).join('\n');
        const prompt = `Aja como Head Research. Morning Call curto sobre ${assetClass}.\nDestaques:\n${contextItems}`;
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({ model: 'gemini-2.0-flash-exp', contents: prompt });
            return response.text;
        } catch (e) { return "Análise IA indisponível."; }
    }
};
