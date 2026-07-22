
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { finalizeRanking } from '../utils/rankingContract.js';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper para limpar markdown de JSON
const cleanJsonString = (str) => {
    if (!str) return "{}";
    // Remove blocos de código markdown ```json ... ```
    let cleaned = str.replace(/```json/g, "").replace(/```/g, "");
    // Remove textos antes ou depois do primeiro { e último }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace >= 0) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return cleaned;
};

export const applyAiRiskAssessment = (candidates, aiAnalysis) => {
    const enhancedList = (candidates || []).map(original => {
        const aiData = Array.isArray(aiAnalysis)
            ? aiAnalysis.find(item => item.ticker === original.ticker)
            : null;
        const rationale = aiData ? aiData.rationale : 'Sem fatos relevantes recentes.';
        const hasRisk = aiData ? aiData.hasBankruptcyRisk : false;
        const riskLevel = aiData ? aiData.riskLevel : 'LOW';
        const riskVetoActive = hasRisk || riskLevel === 'CRITICAL';
        if (riskVetoActive) {
            logger.warn(`🚨 IA sinalizou risco crítico em ${original.ticker}: ${rationale}`);
        }

        return {
            ...original,
            aiMetadata: { riskLevel, rationale, vetoed: riskVetoActive },
            riskVeto: {
                active: riskVetoActive,
                level: riskLevel,
                rationale,
                source: 'GEMINI',
                evaluatedAt: new Date(),
            },
            thesis: `[Quant]: ${original.thesis}. [IA Audit]: ${rationale}`,
            bullThesis: [...(original.bullThesis || []), `IA Sentiment: ${rationale}`],
        };
    });
    return finalizeRanking(enhancedList);
};

export const aiEnhancementService = {
    async enhanceRankingWithNews(currentRanking, assetClass) {
        if (!process.env.API_KEY) throw new Error("API_KEY ausente.");

        const candidates = currentRanking; // Recebe os ativos do Draft
        if (!candidates || candidates.length === 0) return [];

        logger.info(`🤖 [IA] Iniciando Auditoria Qualitativa (${candidates.length} ativos)...`);

        const candidateListString = candidates.map(c => 
            `- ${c.ticker} (Setor: ${c.sector || 'Geral'})`
        ).join('\n');

        // PROMPT REFINADO: Foco em Risco e Contexto, não em dar nota
        const prompt = `
        Você é um **Senior Risk Officer (SRO)** de um Hedge Fund Global. Sua tarefa é auditar a lista de ativos pré-selecionados pelo nosso algoritmo quantitativo.

        CONTEXTO:
        Classe de Ativo: ${assetClass}
        Total de Ativos para Análise: ${candidates.length}

        INSTRUÇÕES DE AUDITORIA (SEARCH GROUNDING):
        Para CADA ativo da lista abaixo, utilize o Google Search para verificar:
        1. **Fatos Relevantes Recentes (30 dias):** Fusões, aquisições, resultados trimestrais.
        2. **Red Flags (Críticos):** Recuperação Judicial, Fraudes Contábeis, Processos CVM, Escândalos de Governança.
        3. **Sentimento:** O mercado está comprador ou vendedor neste papel?

        LISTA DE ATIVOS:
        ${candidateListString}

        REGRAS DE OUTPUT (ESTRITO):
        Retorne APENAS um JSON válido contendo um array "analysis".
        NÃO altere a ordem.

        FORMATO DO OBJETO:
        {
            "ticker": "CÓDIGO",
            "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
            "rationale": "Resumo executivo de 15 palavras sobre o momento atual da empresa.",
            "hasBankruptcyRisk": boolean // True se estiver em RJ ou risco iminente de quebra
        }
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash-exp', 
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    tools: [{ googleSearch: {} }], 
                    responseMimeType: "application/json",
                    temperature: 0.1, 
                }
            });

            const responseText = response.text;
            let aiAnalysis = [];
            
            try {
                const cleanedText = cleanJsonString(responseText);
                const parsed = JSON.parse(cleanedText);
                aiAnalysis = parsed.analysis || parsed; 
            } catch (e) {
                logger.error(`Erro ao parsear JSON da IA: ${e.message}`);
                return candidates;
            }
            
            logger.info(`✅ Auditoria IA Concluída. Ranking matemático preservado.`);
            return applyAiRiskAssessment(candidates, aiAnalysis);

        } catch (error) {
            logger.error(`❌ Erro Fatal IA: ${error.message}`);
            return candidates; // Fallback seguro
        }
    }
};
