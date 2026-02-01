
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { portfolioEngine } from './engines/portfolioEngine.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAnalysis from '../models/MarketAnalysis.js'; 

const getDiverseCandidates = (list, count, maxPerSector = 2) => {
    const selected = [];
    const sectorCounts = {};
    const usedTickers = new Set();

    // 1. Força a ordenação pelo Score Defensivo (que foi passado no objeto)
    // Se for Brasil 10, queremos segurança e dividendos.
    const sortedList = list.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.metrics?.avgLiquidity || 0) - (a.metrics?.avgLiquidity || 0);
    });

    for (const asset of sortedList) {
        if (selected.length >= count) break;
        if (usedTickers.has(asset.ticker)) continue;
        
        const sector = asset.sector || 'Outros';
        const currentCount = sectorCounts[sector] || 0;
        
        // Só adiciona se não estourar o limite do setor
        if (currentCount < maxPerSector) {
            selected.push(asset);
            sectorCounts[sector] = currentCount + 1;
            usedTickers.add(asset.ticker);
        }
    }
    
    // Fallback: Se não preencheu devido a travas setoriais, preenche com o que tiver de melhor
    // para garantir que a lista sempre tenha o tamanho solicitado (ex: 5).
    if (selected.length < count) {
        for (const asset of sortedList) {
            if (selected.length >= count) break;
            if (!usedTickers.has(asset.ticker)) {
                selected.push(asset);
                usedTickers.add(asset.ticker);
            }
        }
    }
    return selected;
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

            // Full List com melhor perfil selecionado
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

        // 3. Brasil 10 (SMART MIX DEFENSIVO)
        logger.info("   ➤ Gerando Brasil 10 (Smart Mix Defensivo)...");
        
        // REGRA: Pegar os melhores Scores Defensivos, independente do perfil principal.
        // Removemos o filtro de corte (>= 60) para garantir que sempre tenhamos candidatos para o Top 5.
        const mapToDefensiveContext = (list) => {
            return list
                .map(a => ({
                    ...a,
                    score: a.scores['DEFENSIVE'], // Força o uso do score defensivo
                    riskProfile: 'DEFENSIVE',     // Força o label para consistência visual no Top 10
                    action: a.scores['DEFENSIVE'] >= 70 ? 'BUY' : 'WAIT',
                    thesis: `Brasil 10 (Defensivo): Score ${a.scores['DEFENSIVE']}`
                }))
                .filter(a => a.score > 0); // Remove apenas zerados/inválidos
        };

        const defStocksCandidates = mapToDefensiveContext(stockData.processedAssets);
        const defFIIsCandidates = mapToDefensiveContext(fiiData.processedAssets);
        
        // Seleciona Top 5 de cada usando a lógica de diversificação (Max 2 por setor)
        const top5Stocks = getDiverseCandidates(defStocksCandidates, 5, 2); 
        const top5FIIs = getDiverseCandidates(defFIIsCandidates, 5, 2);
        
        // Junta e ordena pelo Score Defensivo final
        let brasil10List = [...top5Stocks, ...top5FIIs]
            .sort((a, b) => b.score - a.score)
            .map((item, idx) => ({ 
                ...item, 
                position: idx + 1 
            })); 
        
        await MarketAnalysis.create({ assetClass: 'BRASIL_10', strategy: strat, content: { ranking: brasil10List, fullAuditLog: brasil10List }, generatedBy: adminId });
        
        logger.info(`✅ [AI SERVICE] Batch Analysis Concluído. Brasil 10 gerado com ${brasil10List.length} ativos.`);
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
