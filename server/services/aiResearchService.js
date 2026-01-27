
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { portfolioEngine } from './engines/portfolioEngine.js';

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            logger.info(`📥 [ORCHESTRATOR] Coletando dados para ${assetClass}...`);
            const rawData = await marketDataService.getMarketData(assetClass);
            
            if (!rawData || rawData.length === 0) {
                logger.warn("⚠️ Nenhum dado bruto encontrado.");
                return { ranking: [], fullList: [] };
            }

            // 1. Scoring Engine: Processa cada ativo individualmente
            // (Valuation, Scores, Teses, Filtros de Integridade)
            const processedAssets = rawData
                .map(asset => scoringEngine.processAsset(asset))
                .filter(Boolean); // Remove nulos (Penny stocks, Blacklist, etc)

            // 2. Portfolio Engine: Realiza o Draft Competitivo
            // (Seleção dos melhores, Regra dos 25%, Diversificação)
            let ranking = portfolioEngine.performCompetitiveDraft(processedAssets);
            
            // 3. Portfolio Engine: Aplica penalidades finais de concentração
            ranking = portfolioEngine.applyConcentrationPenalty(ranking);

            // 4. Gera Lista Completa para Auditoria (Full List)
            // (Mapeia o melhor perfil de cada ativo não selecionado para visualização no admin)
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

    // Função mantida aqui pois usa a IA Generativa diretamente
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
