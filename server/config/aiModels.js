/**
 * Modelo Gemini usado nas gerações de texto (Explainable IA, Morning Call,
 * refinamento de relatório).
 *
 * Ficava hardcoded em três serviços como `gemini-2.0-flash-exp` — um modelo
 * experimental que o Google aposentou, e cuja retirada quebrou as três geraç��es
 * de uma vez com 404 (sem alarme, porque a falha só aparecia ao clicar). Ponto
 * único + override por env para que a próxima troca não exija deploy de código.
 */
export const GEMINI_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Teto de cada chamada ao Gemini (ms). Sem ele o SDK espera indefinidamente: a
 * chamada não falha, ela FICA — e prende junto o request do admin ou o job que
 * a disparou (mesma regra de "toda chamada externa tem relógio" do CLAUDE.md).
 * Busca com googleSearch leva dezenas de segundos; 90s dá folga sem pendurar.
 */
export const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90_000;

/** Opções do cliente Gemini com o teto acima — use em todo `new GoogleGenAI`. */
export const geminiClientOptions = () => ({
    apiKey: process.env.API_KEY,
    httpOptions: { timeout: GEMINI_TIMEOUT_MS },
});
