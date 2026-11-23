// Partes da auditoria de sinais (`signalEngine.runBacktest`): decide o
// encerramento de cada sinal ativo pelo preço de hoje e pela idade.

const TAKE_PROFIT_PCT = 3.5;
const STOP_LOSS_PCT = -3.5;
const TALLY_KEY = { HIT: 'hits', MISS: 'misses', NEUTRAL: 'expired' };

// HIT no alvo, MISS no stop, NEUTRAL quando venceu o horizonte; null segue ativo.
function classifyOutcome(resultPercent, signalAgeDays, horizonDays) {
    if (resultPercent >= TAKE_PROFIT_PCT) return 'HIT';
    if (resultPercent <= STOP_LOSS_PCT) return 'MISS';
    if (signalAgeDays >= horizonDays) return 'NEUTRAL';
    return null;
}

function auditUpdate(signal, status, currentPrice, resultPercent) {
    return {
        updateOne: {
            filter: { _id: signal._id },
            update: {
                $set: {
                    status,
                    finalPrice: currentPrice,
                    resultPercent: resultPercent,
                    auditDate: new Date()
                }
            }
        }
    };
}

// Operações de encerramento e a contagem por desfecho.
export function auditSignals(activeSignals, priceMap, horizonDays) {
    const tally = { processed: 0, hits: 0, misses: 0, expired: 0 };
    const updates = [];
    const now = new Date();

    for (const signal of activeSignals) {
        const currentPrice = priceMap.get(signal.ticker);
        if (!currentPrice || currentPrice <= 0 || !signal.priceAtSignal) continue;

        const resultPercent = ((currentPrice - signal.priceAtSignal) / signal.priceAtSignal) * 100;
        const signalAgeDays = (now.getTime() - new Date(signal.timestamp).getTime()) / (1000 * 3600 * 24);
        const status = classifyOutcome(resultPercent, signalAgeDays, horizonDays);
        if (!status) continue;

        updates.push(auditUpdate(signal, status, currentPrice, resultPercent));
        tally.processed++;
        tally[TALLY_KEY[status]]++;
    }
    return { updates, tally };
}
