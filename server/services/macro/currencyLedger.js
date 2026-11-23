// Trilha do câmbio para o painel de Saúde (parte de `updateCurrencies`).
import { recordEscalation } from '../../utils/sourceHealth.js';

/**
 * Escalada é a moeda que a PRIMEIRA fonte não trouxe. Quando o Yahoo entrega as
 * duas, a trilha tem um elo só e nada é registrado — o ledger é a lista de quem
 * precisou de reserva, não o log de toda coleta.
 *
 * @param {{ trilha: {usd: string[], btc: string[]}, reading: object,
 *   skipped: Set<string>, idByName: Map<string, string> }} args
 */
export const reportCurrencyEscalations = ({ trilha, reading, skipped, idByName }) => {
    for (const [moeda, assunto] of [['usd', 'USD'], ['btc', 'BTC']]) {
        const tried = trilha[moeda];
        const resolvedBy = idByName.get(reading[`${moeda}Source`]) || null;
        if (tried.length <= 1 && resolvedBy) continue;
        recordEscalation({
            chain: 'fx',
            subject: assunto,
            tried,
            skipped: [...skipped],
            resolvedBy,
            reason: 'O Yahoo não trouxe esta cotação',
        });
    }
};
