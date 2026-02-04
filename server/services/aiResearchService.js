
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { portfolioEngine } from './engines/portfolioEngine.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAnalysis from '../models/MarketAnalysis.js'; 

// Normalizador Helper AGRESSIVO (Sanitizer)
const normalize = (ticker) => {
    if (!ticker) return '';
    // Remove .SA, espaços, quebras de linha e caracteres não-alfanuméricos (exceto dígitos se houver)
    return ticker.toUpperCase().replace('.SA', '').replace(/[^A-Z0-9]/g, '').trim();
};

// Função auxiliar para calcular Delta de Posição
const calculateRankingDelta = async (currentList, assetClass, strategy) => {
    try {
        // CORREÇÃO: Removido isRankingPublished: true
        // Agora busca o último relatório GERADO, permitindo comparação entre rascunhos consecutivos.
        const lastReport = await MarketAnalysis.findOne({ 
            assetClass, 
            strategy
        }).sort({ createdAt: -1 });

        // Cria mapa de posições anteriores com normalização
        const prevPosMap = new Map();
        
        if (lastReport && lastReport.content && lastReport.content.ranking) {
            lastReport.content.ranking.forEach(r => {
                const t = normalize(r.ticker);
                if (t) prevPosMap.set(t, r.position);
            });
            logger.info(`🔍 [Delta] Comparando com relatório anterior (${lastReport._id}) de ${lastReport.date}. ${prevPosMap.size} ativos mapeados.`);
        } else {
            logger.info(`🔍 [Delta] Nenhum relatório anterior encontrado para ${assetClass}. Todos serão NOVO.`);
        }

        // Aplica o delta
        return currentList.map(item => {
            const t = normalize(item.ticker);
            const prev = prevPosMap.get(t);
            
            // Se prev for undefined, é null (Novo). Se for número, mantém.
            const previousPosition = prev !== undefined ? prev : null;

            return {
                ...item,
                previousPosition: previousPosition
            };
        });

    } catch (e) {
        logger.error(`Erro ao calcular delta de ranking: ${e.message}`);
        return currentList;
    }
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            logger.info(`📥 [ORCHESTRATOR] Lendo DB para ${assetClass}...`);
            
            const rawData = await marketDataService.getMarketData(assetClass);
            
            if (!rawData || rawData.length === 0) {
                logger.warn("⚠️ Nenhum dado encontrado no Banco. Execute 'Sync Preços' primeiro.");
                return { ranking: [], fullList: [], processedAssets: [] };
            }
            
            const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            
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

            const processedAssets = rawData
                .map(asset => scoringEngine.processAsset(asset, context))
                .filter(Boolean); 

            // Ranking Padrão (Draft Competitivo)
            let ranking = portfolioEngine.performCompetitiveDraft(processedAssets);
            ranking = portfolioEngine.applyConcentrationPenalty(ranking);

            // Calcula Deltas antes de retornar
            ranking = await calculateRankingDelta(ranking, assetClass, strategy);

            // Full List com melhor perfil selecionado (Audit Log)
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

            return { ranking, fullList, processedAssets }; 

        } catch (error) {
            logger.error(`Erro orquestração ranking: ${error.message}`);
            return { ranking: [], fullList: [], processedAssets: [] };
        }
    },

    async runBatchAnalysis(adminId = null) {
        logger.info("🚀 [AI SERVICE] Iniciando Batch Analysis (Cálculo Matemático)...");
        const strat = 'BUY_HOLD';

        // 1. Ações
        const stockData = await this.calculateRanking('STOCK', strat);
        await MarketAnalysis.create({ assetClass: 'STOCK', strategy: strat, content: { ranking: stockData.ranking, fullAuditLog: stockData.fullList }, generatedBy: adminId });

        // 2. FIIs
        const fiiData = await this.calculateRanking('FII', strat);
        await MarketAnalysis.create({ assetClass: 'FII', strategy: strat, content: { ranking: fiiData.ranking, fullAuditLog: fiiData.fullList }, generatedBy: adminId });

        // 3. Brasil 10 (LÓGICA RÍGIDA CORRIGIDA)
        logger.info("   ➤ Gerando Brasil 10 (Strict Merge: 5 Stocks + 5 FIIs)...");
        
        // Função auxiliar para extrair Top 5 Defensivo
        const getTop5Defensive = (fullList) => {
            return fullList
                .map(a => ({
                    ...a,
                    score: a.scores['DEFENSIVE'], // Força Score Defensivo
                    riskProfile: 'DEFENSIVE',     // Força Perfil Defensivo
                    action: a.scores['DEFENSIVE'] >= 60 ? 'BUY' : 'WAIT',
                    thesis: `Brasil 10: Score Defensivo ${a.scores['DEFENSIVE']}`
                }))
                .sort((a, b) => b.score - a.score) // Ordena pelo Score Defensivo
                .slice(0, 5); // Pega Top 5 estrito
        };

        const top5Stocks = getTop5Defensive(stockData.processedAssets);
        const top5FIIs = getTop5Defensive(fiiData.processedAssets);
        
        // Junta as duas listas (5 + 5 = 10)
        let brasil10List = [...top5Stocks, ...top5FIIs];

        // Ordena a lista final de 10 pelo Score para apresentação (quem tem maior score fica em cima)
        brasil10List.sort((a, b) => b.score - a.score);

        // Atribui Posições (1 a 10)
        brasil10List = brasil10List.map((item, idx) => ({
            ...item,
            position: idx + 1
        }));

        // Calcula Delta para o Brasil 10
        brasil10List = await calculateRankingDelta(brasil10List, 'BRASIL_10', strat);
        
        await MarketAnalysis.create({ 
            assetClass: 'BRASIL_10', 
            strategy: strat, 
            content: { ranking: brasil10List, fullAuditLog: brasil10List }, 
            generatedBy: adminId 
        });
        
        logger.info(`✅ [AI SERVICE] Batch Analysis Concluído.`);
        return true;
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
