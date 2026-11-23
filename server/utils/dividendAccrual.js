/**
 * Acumulado de proventos por EX-DATE com a quantidade que a carteira tinha
 * naquele dia — o laço puro de `financialService.accrueDividendsByTicker`, que
 * carrega lançamentos, proventos e câmbio e entrega tudo aqui.
 */
import { toDateKey } from './dateUtils.js';
import { resolvePaymentDate } from './dividendPaymentDate.js';
import { safeAdd, safeCurrency, addQty, QUANTITY_EPSILON } from './mathUtils.js';

/** Resultado de uma carteira sem lançamentos (objeto novo a cada chamada). */
export const emptyDividendAccrual = () => ({ total: 0, paid: 0, pending: 0, byTicker: {}, sinceTotal: 0, sinceByTicker: {} });

// Direito ao provento do dia-ex D = posição ao FIM do pregão anterior: só entram
// as transações com data ESTRITAMENTE anterior a D. Quem compra NO dia-ex já
// compra "ex" (não recebe) e quem vende NO dia-ex vendeu "com" (recebe). Mesma
// regra do rebuild, do snapshot diário e de `calculateUserDividends` — divergir
// aqui reabre o vão KPI × snapshot.
function applyTransactionsBefore(cursor, txs, day) {
    while (cursor.index < txs.length && toDateKey(txs[cursor.index].date) < day) {
        const tx = txs[cursor.index];
        const delta = tx.type === 'SELL' ? -tx.quantity : tx.quantity;
        cursor.qty[tx.ticker] = addQty(cursor.qty[tx.ticker] || 0, delta);
        if (cursor.qty[tx.ticker] < QUANTITY_EPSILON) cursor.qty[tx.ticker] = 0;
        cursor.index++;
    }
}

function creditDividend(acc, div, day, value, window) {
    acc.total = safeAdd(acc.total, value);
    acc.byTicker[div.ticker] = safeAdd(acc.byTicker[div.ticker] || 0, value);
    if (window.sinceDayKey && day > window.sinceDayKey) {
        acc.sinceTotal = safeAdd(acc.sinceTotal, value);
        acc.sinceByTicker[div.ticker] = safeAdd(acc.sinceByTicker[div.ticker] || 0, value);
    }
    // Oficial quando existe; senão a estimativa única do serviço.
    const payKey = toDateKey(resolvePaymentDate({ date: day, paymentDate: div.paymentDate }).date);
    if (payKey <= window.throughDayKey) acc.paid = safeAdd(acc.paid, value);
}

function roundValues(map) {
    for (const ticker of Object.keys(map)) map[ticker] = safeCurrency(map[ticker]);
    return map;
}

/**
 * `txs` em ordem de data; `dividendDateMap` dayKey → proventos do dia;
 * `dividendFx(ticker, dayKey)` → câmbio do provento. `sinceDayKey` (EXCLUSIVO)
 * abre o balde `sinceTotal`/`sinceByTicker`.
 */
export function accrueDividendLedger(txs, dividendDateMap, dividendFx, window) {
    const days = [...dividendDateMap.keys()].filter(d => d <= window.throughDayKey).sort();
    const cursor = { qty: {}, index: 0 };
    const acc = { total: 0, paid: 0, sinceTotal: 0, byTicker: {}, sinceByTicker: {} };

    for (const day of days) {
        applyTransactionsBefore(cursor, txs, day);
        for (const div of dividendDateMap.get(day)) {
            if (cursor.qty[div.ticker] > 0) {
                creditDividend(acc, div, day, cursor.qty[div.ticker] * div.amount * dividendFx(div.ticker, day), window);
            }
        }
    }

    const byTicker = roundValues(acc.byTicker);
    const sinceByTicker = roundValues(acc.sinceByTicker);
    const safeTotal = safeCurrency(acc.total);
    const safePaid = safeCurrency(acc.paid);
    // `pending` é derivado da subtração, nunca somado em paralelo: garante que as
    // duas parcelas fechem o total exibido mesmo com arredondamento de centavo.
    return {
        total: safeTotal,
        paid: safePaid,
        pending: safeCurrency(safeTotal - safePaid),
        byTicker,
        sinceTotal: safeCurrency(acc.sinceTotal),
        sinceByTicker,
    };
}
