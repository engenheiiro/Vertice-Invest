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
