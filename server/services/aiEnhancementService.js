
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const aiEnhancementService = {
    async enhanceRankingWithNews(currentRanking, assetClass) {
        if (!process.env.API_KEY) throw new Error("API_KEY ausente.");

        const candidates = currentRanking; // Recebe os 50 do Draft
        if (!candidates || candidates.length === 0) return [];

        logger.info(`🤖 [IA] Iniciando Refinamento do Lote (${candidates.length} ativos)...`);

        const candidateListString = candidates.map(c => 
            `- ${c.ticker} (Setor: ${c.sector || 'Geral'})`
        ).join('\n');

        // PROMPT ENGENHEIRADO PARA ALTA PRECISÃO E RETORNO JSON
        const prompt = `
        Você é um **Senior Risk Officer (SRO)** de um Hedge Fund Global. Sua tarefa é auditar a lista de ativos pré-selecionados pelo nosso algoritmo quantitativo.

        CONTEXTO:
        Classe de Ativo: ${assetClass}
        Total de Ativos para Análise: ${candidates.length}

        INSTRUÇÕES DE AUDITORIA (SEARCH GROUNDING):
        Para CADA ativo da lista abaixo, utilize o Google Search para verificar:
        1. **Fatos Relevantes Recentes (30 dias):** Fusões, aquisições, resultados trimestrais muito acima/abaixo do esperado.
        2. **Risk Flags (Críticos):** Recuperação Judicial, Fraudes Contábeis, Processos CVM, Escândalos de Governança, Risco de Calote (Default) ou Quebra de Covenants.
        3. **Sentimento de Mercado:** O mercado está comprador ou vendedor neste papel especificamente?

        LISTA DE ATIVOS:
        ${candidateListString}

        REGRAS DE OUTPUT (ESTRITO):
        Você DEVE retornar APENAS um JSON válido. Não adicione markdown (\`\`\`json), não adicione texto introdutório. Apenas o objeto JSON puro.
        O JSON deve conter um array chamado "analysis" com exatos ${candidates.length} objetos.

        FORMATO DO OBJETO:
        {
            "ticker": "CÓDIGO",
            "aiScore": NUMBER, // 0 a 100. (0=Fraude/RJ, 50=Neutro/Sem News, 100=Fato Relevante Extraordinário Positivo)
            "rationale": "STRING" // Máximo 15 palavras. Ex: "RJ aprovada, risco máximo." ou "Lucro recorde +50% YoY."
        }

        Exemplo de Lógica de Score:
        - Americanas (AMER3) em fraude -> Score 0
        - Empresa estável sem notícias -> Score 50
        - Empresa anunciou dividendos recordes -> Score 80
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash-exp', 
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    tools: [{ googleSearch: {} }], 
                    responseMimeType: "application/json",
                    temperature: 0.1, // Temperatura mínima para máxima obediência
                }
            });

            const responseText = response.text;
            let aiAnalysis = [];
            
            try {
                const parsed = JSON.parse(responseText);
                aiAnalysis = parsed.analysis || parsed; // Tenta pegar a chave ou o array direto
            } catch (e) {
                logger.error(`Erro ao parsear JSON da IA: ${e.message}`);
                // Fallback para não quebrar o fluxo
                return candidates;
            }
            
            const enhancedList = candidates.map(original => {
                const aiData = aiAnalysis.find(a => a.ticker === original.ticker);
                
                // Se a IA não retornou dado para este ticker, assume neutro
                const aiScore = aiData ? aiData.aiScore : 50; 
                const rationale = aiData ? aiData.rationale : "Sem fatos relevantes recentes.";

                // Ponderação Final: Matemática (60%) + IA (40%)
                const finalScore = Math.round((original.score * 0.6) + (aiScore * 0.4));

                let finalAction = original.action;
                // Kill Switch da IA: Se detectar risco grave (<20), força WAIT/SELL imediatamente
                if (aiScore < 20) {
                    finalAction = 'WAIT';
                    logger.warn(`🚨 IA vetou ${original.ticker}: ${rationale}`);
                }

                return {
                    ...original,
                    score: finalScore,
                    thesis: `[IA Check]: ${rationale}`,
                    bullThesis: [...(original.bullThesis || []), `IA Sentiment: ${rationale}`],
                    action: finalAction
                };
            });

            logger.info(`✅ Refinamento IA Concluído. Ranking reordenado.`);
            return enhancedList.sort((a, b) => b.score - a.score);

        } catch (error) {
            logger.error(`❌ Erro Fatal IA: ${error.message}`);
            return candidates; // Fallback: retorna lista original sem IA
        }
    }
};
