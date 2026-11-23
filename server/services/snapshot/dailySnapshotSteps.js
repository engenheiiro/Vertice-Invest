/**
 * Etapas do snapshot diário de uma carteira (`persistUserSnapshotForDay` em
 * services/schedulerService.js): renda de proventos do dia-ex, cota TWRR por
 * Modified Dietz, trava contra reset indevido da cota e o documento gravado.
 */
import * as Sentry from '@sentry/node';
import logger from '../../config/logger.js';
import DividendEvent from '../../models/DividendEvent.js';
import WalletSnapshot from '../../models/WalletSnapshot.js';
import { isDollarized } from '../../utils/assetCurrency.js';
import { toDateKey } from '../../utils/dateUtils.js';
import { calculateDailyDietz, addQty, QUANTITY_EPSILON } from '../../utils/mathUtils.js';
import { isTwrrReturnAnomalous, snapshotInstantForDay } from '../../utils/walletSnapshot.js';

// Direito ao provento = posição de ANTES das movimentações do próprio dia-ex:
// quem compra no dia-ex não recebe, quem vende no dia-ex recebe. A posição
// gravada é a do FIM do dia, então os lançamentos do dia são desfeitos aqui —
// mesma regra do accrual (`accrueDividendsByTicker`) e do rebuild. Provento em
// dólar entra em reais pelo câmbio do dia-ex (o amount é da fonte).
function entitledPositionsForExDate(positions, transactions, dayStr, dayUsdRate) {
    const qtyByTicker = new Map();
    const divFxByTicker = new Map();
    positions.forEach(p => {
        const t = String(p.ticker).toUpperCase();
        qtyByTicker.set(t, Number(p.quantity) > 0 ? Number(p.quantity) : 0);
        divFxByTicker.set(t, isDollarized(p) ? dayUsdRate : 1);
    });
    // Dia do lançamento pela chave UTC — a mesma do accrual e do rebuild.
    for (const tx of transactions) {
        if (toDateKey(tx.date) !== dayStr) continue;
        const t = String(tx.ticker).toUpperCase();
        const delta = tx.type === 'SELL' ? Number(tx.quantity) : -Number(tx.quantity);
        qtyByTicker.set(t, addQty(qtyByTicker.get(t) || 0, delta));
        if (!divFxByTicker.has(t)) divFxByTicker.set(t, tx.currency === 'USD' ? dayUsdRate : 1);
    }
    for (const [t, qty] of qtyByTicker) {
        if (!(qty > QUANTITY_EPSILON)) qtyByTicker.delete(t);
    }
    return { qtyByTicker, divFxByTicker };
}

function sumDayDividends(divEvents, qtyByTicker, divFxByTicker) {
    let income = 0;
    const seenDiv = new Set();
    for (const ev of divEvents) {
        const t = String(ev.ticker).toUpperCase();
        const key = `${t}|${ev.type || 'DIVIDEND'}`; // dedup multi-fonte (mesmo provento)
        if (seenDiv.has(key)) continue;
        seenDiv.add(key);
        const qty = qtyByTicker.get(t);
        if (qty > 0) income += qty * ev.amount * (divFxByTicker.get(t) ?? 1);
    }
    return income;
}

/**
 * Proventos com EX-DATE no dia BR (crédito de RENDA no TWRR). O preço cai no
 * dia-ex; sem somar o provento recebido à cota, essa queda vira prejuízo-fantasma
 * e a cota vaza ~1%/mês em FIIs distribuidores. DividendEvent.date é a ex-date
 * normalizada à meia-noite UTC do dia-calendário — casa 1:1 com dayStr.
 * O câmbio do dia-ex vem da série (`getUsdRateForDate`) ou, sem ela, de `usdRate`.
 */
export async function dayDividendIncomeBRL(positions, transactions, dayStr, { getUsdRateForDate, usdRate }) {
    const dayUsdRate = getUsdRateForDate ? getUsdRateForDate(dayStr) : usdRate;
    const { qtyByTicker, divFxByTicker } = entitledPositionsForExDate(positions, transactions, dayStr, dayUsdRate);
    if (qtyByTicker.size === 0) return 0;
    const [dy, dm, dd] = dayStr.split('-').map(Number);
    const exDateUtc = new Date(Date.UTC(dy, dm - 1, dd));
    const divEvents = await DividendEvent.find({ ticker: { $in: [...qtyByTicker.keys()] }, date: exDateUtc }).lean();
    return sumDayDividends(divEvents, qtyByTicker, divFxByTicker);
}

/**
 * Cota do dia pela cota anterior e o retorno Modified Dietz. Sem patrimônio
 * anterior, aporte nem provento, a cota nasce em 100. `{ anomalous: true }`
 * quando o retorno passa do circuit breaker (dado corrompido).
 */
export function dietzQuotaForDay(lastSnapshot, totalEquity, dayFlow, dayDividendIncome) {
    const v0 = lastSnapshot ? lastSnapshot.totalEquity : 0;
    if (!(v0 > 0 || dayFlow > 0 || dayDividendIncome > 0)) return { quotaPrice: 100 };
    const dailyReturn = calculateDailyDietz(v0, totalEquity, dayFlow, dayDividendIncome);
    if (isTwrrReturnAnomalous(dailyReturn)) return { anomalous: true, dailyReturn };
    const prevQuota = lastSnapshot ? (lastSnapshot.quotaPrice || 100) : 100;
    return { quotaPrice: prevQuota * (1 + dailyReturn) };
}

export function reportTwrrAnomaly(walletId, dayStr, dailyReturn) {
    logger.warn(`⚠️ Anomalia TWRR wallet ${walletId} @ ${dayStr}: ${(dailyReturn * 100).toFixed(2)}%. Snapshot ignorado.`);
    if (process.env.SENTRY_DSN) {
        Sentry.captureMessage(`TWRR Anomaly: Wallet ${walletId} @ ${dayStr} = ${dailyReturn.toFixed(2)}%. Skipped.`);
    }
}

/** Proteção contra reset indevido da cota (histórico existente + cota ~100). */
export async function isUndueQuotaReset(lastSnapshot, quotaPrice, walletId, dayStr) {
    if (!(Math.abs(quotaPrice - 100) < 0.1)) return false;
    const hasHistory = lastSnapshot
        ? Math.abs(lastSnapshot.quotaPrice - 100) > 5
        : await WalletSnapshot.exists({ wallet: walletId });
    if (hasHistory) logger.error(`❌ Cota resetou p/ 100 indevidamente wallet ${walletId} @ ${dayStr}. Snapshot abortado.`);
    return Boolean(hasHistory);
}

/** Documento do snapshot diário (calculationVersion 5). */
export function buildDailySnapshotPayload({ userId, walletId, dayStr, force, calculatedAt, totalEquity, totalInvested, totalDividends, quotaPrice }) {
    return {
        user: userId,
        wallet: walletId,
        date: snapshotInstantForDay(dayStr),
        dayKey: dayStr,
        source: force ? 'BACKFILL' : 'DAILY',
        calculationVersion: 5,
        calculatedAt,
        totalEquity,
        totalInvested,
        totalDividends,
        profit: totalEquity - totalInvested + totalDividends,
        profitPercent: totalInvested > 0 ? ((totalEquity - totalInvested + totalDividends) / totalInvested) * 100 : 0,
        quotaPrice,
    };
}
