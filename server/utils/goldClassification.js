/**
 * Classificação (PURA) de Ouro como classe de ativo própria (`OURO`).
 *
 * Diferente do sub-tipo de Exterior (usSubType), aqui o objetivo é o BUCKET de
 * alocação da Carteira Ideal: ouro é uma classe distinta (como Cripto), não uma
 * ação estrangeira. Detecta os instrumentos de ouro mais comuns para investidor
 * BR/US: ETFs de ouro (GLD, IAU, SGOL, BAR, AAAU, OUNZ) e o ETF de ouro da B3
 * (GOLD11), além de contratos/símbolos de ouro (OZ1, XAU).
 *
 * A detecção é por ticker (sem rede). Override manual do usuário (escolha do
 * `type` no cadastro) sempre prevalece — esta heurística só age como default.
 */

// Tickers conhecidos de exposição a ouro. Comparação case-insensitive e tolerante
// a sufixos de bolsa (ex.: 'GOLD11.SA', 'IAU.US').
export const KNOWN_GOLD_TICKERS = new Set([
  // ETFs de ouro (EUA)
  'GLD', 'IAU', 'SGOL', 'BAR', 'AAAU', 'OUNZ', 'IAUM', 'GLDM',
  // ETF de ouro (B3)
  'GOLD11',
  // Contratos / símbolos de ouro
  'OZ1', 'XAU', 'XAUUSD',
]);

const base = (ticker = '') =>
  String(ticker).toUpperCase().trim().split('.')[0]; // remove sufixo de bolsa

/**
 * @param {string} ticker
 * @returns {boolean} true se o ticker representa exposição a ouro.
 */
export function isGoldTicker(ticker) {
  if (!ticker) return false;
  const raw = String(ticker).toUpperCase().trim();
  return KNOWN_GOLD_TICKERS.has(raw) || KNOWN_GOLD_TICKERS.has(base(ticker));
}

export default isGoldTicker;
