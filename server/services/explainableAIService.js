/**
 * Geração do texto "Explainable IA" a partir do prompt já montado no
 * MarketAnalysis (`explainableAIPrompt`, produzido pelo crunch/sync).
 *
 * Extraído do researchController para que a rota admin e o script de lote
 * (`scripts/generateExplainableAI.js`) usem exatamente a mesma chamada — modelo,
 * prompt e regra de gravação por perfil.
 */

import { GEMINI_TEXT_MODEL } from '../config/aiModels.js';

export const PROFILE_LABEL_PT = { DEFENSIVE: 'Defensivo', MODERATE: 'Moderado', BOLD: 'Arrojado' };

export class ExplainableAIError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Grava o texto no campo certo: por perfil quando informado, senão no campo único. */
export const saveExplainableText = (analysis, text, profile = null) => {
  if (profile) {
    if (!analysis.generatedExplainableAIByProfile) analysis.generatedExplainableAIByProfile = {};
    analysis.generatedExplainableAIByProfile[profile] = text;
    analysis.markModified?.('generatedExplainableAIByProfile');
  } else {
    analysis.generatedExplainableAI = text;
  }
};

export const buildExplainablePrompt = (analysis, profile = null) => {
  const base = analysis?.explainableAIPrompt;
  if (!base) throw new ExplainableAIError('Prompt não gerado ainda. Rode o sync primeiro.', 'PROMPT_MISSING');
  if (!profile) return base;
  return `${base}\n\nIMPORTANTE: Escreva a análise focada exclusivamente no perfil ${PROFILE_LABEL_PT[profile]}, destacando os ativos e a tese adequados a esse perfil de risco.`;
};

/**
 * Chama o Gemini com o prompt da análise e devolve o texto. Não persiste —
 * quem chama decide quando salvar.
 */
export const generateExplainableText = async (analysis, profile = null) => {
  const prompt = buildExplainablePrompt(analysis, profile);
  if (!process.env.API_KEY) throw new ExplainableAIError('API_KEY não configurada.', 'API_KEY_MISSING');

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt });

  const text = String(response?.text || '').trim();
  if (!text) throw new ExplainableAIError('A IA devolveu texto vazio.', 'EMPTY_RESPONSE');
  return text;
};
