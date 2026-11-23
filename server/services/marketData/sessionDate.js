import { brazilDateKey } from '../../utils/dateUtils.js';

/**
 * Dia da SESSÃO a que a cotação pertence, no calendário brasileiro. É o carimbo
 * que separa "fechou +1,19% hoje" de "fechou +1,19% ontem": `updatedAt` responde
 * quando perguntamos ao provedor, nunca quando o negócio aconteceu.
 *
 * null quando a fonte não publica o horário (scraping do Google Finance, fallback
 * de histórico) — o consumidor decide o que fazer com a ausência, e o de hoje
 * (walletController) mantém o comportamento antigo em vez de zerar a variação.
 */
export const sessionDateKey = (marketTime) => {
    if (!marketTime) return null;
    const d = new Date(marketTime);
    return Number.isNaN(d.getTime()) ? null : brazilDateKey(d);
};
