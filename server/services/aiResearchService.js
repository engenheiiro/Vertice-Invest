
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';

// Lista de modelos em ordem de prioridade
const MODEL_CHAIN = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-flash-latest' // Último recurso
];

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

// Função auxiliar para tentar gerar conteúdo com fallback
const generateWithFallback = async (aiClient, prompt, systemInstruction) => {
    let lastError = null;

    for (const modelName of MODEL_CHAIN) {
        try {
            logger.debug(`🤖 [AI TRY] Tentando modelo: ${modelName}`);
            
            const response = await aiClient.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                    systemInstruction,
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40
                }
            });
            
            // Sucesso!
            logger.info(`✅ [AI SUCCESS] Resposta gerada com ${modelName}`);
            return response;

        } catch (error) {
            const errorMsg = error.message || JSON.stringify(error);
            logger.warn(`⚠️ [AI WARN] Falha no modelo ${modelName}: ${errorMsg.substring(0, 100)}...`);
            
            // Se for erro de cota (429) ou sobrecarga (503), continua loop
            if (errorMsg.includes('429') || errorMsg.includes('503')) {
                lastError = error;
                continue; 
            }
            
            // Outros erros (400, auth) abortam imediatamente
            throw error;
        }
    }
    
    // Se saiu do loop, todos falharam
    throw new Error(`Todas as tentativas de modelo falharam. Último erro: ${lastError?.message}`);
};

export const aiResearchService = {
    async generateAnalysis(assetClass, strategy) {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        try {
            logger.info(`🚀 [AI INIT] Iniciando Engine para: ${assetClass} (${strategy})`);
            
            // 1. Obtenção de Dados
            let marketData = [];
            if (assetClass === 'BRASIL_10') {
                const [stocks, fiis] = await Promise.all([
                    marketDataService.getMarketData('STOCK'),
                    marketDataService.getMarketData('FII')
                ]);
                marketData = [...stocks.slice(0, 20), ...fiis.slice(0, 15)];
            } else {
                marketData = await marketDataService.getMarketData(assetClass);
            }

            if (!marketData || marketData.length < 5) {
                logger.error(`❌ [AI ABORT] Dados insuficientes (${marketData?.length || 0} ativos). Abortando.`);
                throw new Error(`Dados insuficientes para ${assetClass}.`);
            }

            const macroContext = await marketDataService.getMacroContext();

            // 2. Prompt Engineering
            const systemInstruction = `Você é o "Vértice Neural Engine", um Analyst CFA Level 3.
            
SUA MISSÃO: Analisar a lista de ativos fornecida e selecionar o TOP 10.

REGRAS RÍGIDAS DE OUTPUT (JSON):
1. Você DEVE retornar um JSON válido.
2. Você DEVE preencher o campo "detailedAnalysis" para CADA ativo do ranking. NÃO DEIXE VAZIO.
3. Você DEVE preencher "pros" (mínimo 2 itens) e "cons" (mínimo 1 item).
4. "probability" deve ser um número entre 0 e 100 (baseado em fundamentos).
5. "thesis" deve ser uma palavra-chave: "DIVIDENDOS", "VALOR", "CRESCIMENTO", "TURNAROUND" ou "DEFENSIVO".
6. NÃO INVENTE ATIVOS. Use APENAS os dados fornecidos no JSON de entrada. Se a lista for de FIIs, não sugira Ações.

FORMATO JSON OBRIGATÓRIO:
{
  "morningCall": "Texto Markdown rico sobre o cenário.",
  "ranking": [
    { 
      "position": 1, 
      "ticker": "STRING DO JSON ENVIADO", 
      "name": "Nome", 
      "action": "BUY", 
      "targetPrice": number, 
      "score": number, 
      "probability": number,
      "thesis": "STRING",
      "reason": "Resumo curto.",
      "detailedAnalysis": {
         "summary": "Parágrafo técnico detalhado (3-4 linhas).",
         "pros": ["Ponto 1", "Ponto 2"],
         "cons": ["Risco 1"],
         "valuationMethod": "Ex: Gordon Growth ou Desconto de Fluxo de Caixa"
      }
    }
  ]
}`;

            const prompt = `CONTEXTO MACRO:
${JSON.stringify(macroContext)}

LISTA DE CANDIDATOS (DADOS REAIS):
${JSON.stringify(marketData.slice(0, 50))}

TAREFA: 
Selecione os 10 melhores ativos da lista acima para a estratégia "${strategy}".
Calcule o Score baseado em P/L, P/VP, DY e Momentum.
Gere o JSON completo com detailedAnalysis preenchido.`;

            // Logs pré-execução
            const promptSize = prompt.length + systemInstruction.length;
            logger.info(`📤 [AI REQUEST] Enviando contexto de ~${(promptSize / 1000).toFixed(1)}k caracteres...`);

            // 3. Execução com Fallback
            const startTime = Date.now();
            
            const response = await generateWithFallback(ai, prompt, systemInstruction);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`⚡ [AI RESPONSE] Recebido em ${duration}s`);

            // 4. Parsing e Validação
            const result = extractJSON(response.text);
            
            if (!result || !result.ranking || !Array.isArray(result.ranking)) {
                logger.error("💥 [AI PARSER] Falha ao extrair JSON válido da resposta.");
                logger.debug(`Raw Response Preview: ${response.text.substring(0, 200)}...`);
                throw new Error("Falha na formatação JSON da IA.");
            }

            logger.info(`📝 [AI PARSER] JSON extraído com sucesso (${result.ranking.length} itens no ranking).`);

            // Pós-processamento
            const finalRanking = result.ranking.map((item, index) => ({
                ...item,
                position: index + 1,
                score: item.score || 70,
                probability: item.probability || 65,
                thesis: item.thesis || "OPORTUNIDADE",
                detailedAnalysis: {
                    summary: item.detailedAnalysis?.summary || item.reason || "Análise fundamentalista baseada nos dados fornecidos.",
                    pros: item.detailedAnalysis?.pros || ["Fundamentos sólidos", "Tendência positiva"],
                    cons: item.detailedAnalysis?.cons || ["Volatilidade de mercado"],
                    valuationMethod: item.detailedAnalysis?.valuationMethod || "Análise de Múltiplos"
                }
            }));

            return {
                morningCall: result.morningCall,
                ranking: finalRanking.sort((a, b) => a.position - b.position)
            };

        } catch (error) {
            logger.error(`❌ [AI ERROR] Falha no fluxo ${assetClass}: ${error.message}`);
            throw error;
        }
    }
};
