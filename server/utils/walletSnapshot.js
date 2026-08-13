import { resolveTransactionCurrency } from './assetCurrency.js';
import { safeAdd, safeMult } from './mathUtils.js';

export const MAX_DAILY_TWRR_ABS_RETURN = 0.5;

export const isValidDayKey = (dayKey) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ''))) return false;
    const [year, month, day] = dayKey.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
};

const assertDayKey = (dayKey) => {
    if (!isValidDayKey(dayKey)) throw new RangeError(`dayKey inválido: ${dayKey}`);
};

export const brazilDayKey = (date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(date));

export const snapshotInstantForDay = (dayKey) => {
    assertDayKey(dayKey);
    return new Date(`${dayKey}T23:59:00.000-03:00`);
};

export const utcEndOfCalendarDay = (dayKey) => {
    assertDayKey(dayKey);
    return new Date(`${dayKey}T23:59:59.999Z`);
};

export const isTwrrReturnAnomalous = (dailyReturn) =>
    !Number.isFinite(Number(dailyReturn))
    || Math.abs(Number(dailyReturn)) > MAX_DAILY_TWRR_ABS_RETURN;

/**
 * Transações ainda não incorporadas ao snapshot.
 *
 * - `date > dayKey` captura aportes de dias posteriores mesmo quando foram
 *   cadastrados antes de um rebuild executado hoje;
 * - `createdAt > calculatedAt` captura lançamentos retroativos ou do mesmo dia
 *   feitos depois do cálculo.
 */
export const transactionsAfterSnapshotFilter = (snapshot) => {
    if (!snapshot) return {};

    const dayKey = snapshot.dayKey || brazilDayKey(snapshot.date);
    const calculatedAt = snapshot.calculatedAt || snapshot.createdAt;
    const conditions = [{ date: { $gt: utcEndOfCalendarDay(dayKey) } }];
    if (calculatedAt) {
        const calculatedInstant = new Date(calculatedAt);
        if (!Number.isFinite(calculatedInstant.getTime())) {
            throw new TypeError(`calculatedAt inválido: ${calculatedAt}`);
        }
        conditions.push({ createdAt: { $gt: calculatedInstant } });
    }
    return { $or: conditions };
};

/** Soma BUY-SELL na moeda-base da carteira (BRL). */
export const sumTransactionFlowBRL = (transactions, assetsByTicker, usdRateForDate) => {
    let flow = 0;
    for (const tx of transactions || []) {
        if (!tx || !['BUY', 'SELL'].includes(tx.type)) {
            throw new TypeError(`Tipo de transação inválido: ${tx?.type}`);
        }
        const totalValue = Number(tx.totalValue);
        if (!Number.isFinite(totalValue) || totalValue < 0) {
            throw new TypeError(`Valor de transação inválido: ${tx.totalValue}`);
        }
        const transactionDate = new Date(tx.date);
        if (!Number.isFinite(transactionDate.getTime())) {
            throw new TypeError(`Data de transação inválida: ${tx.date}`);
        }
        const normalizedTicker = String(tx.ticker || '').toUpperCase();
        const asset = assetsByTicker?.get?.(tx.ticker)
            || assetsByTicker?.get?.(normalizedTicker)
            || null;
        const currency = resolveTransactionCurrency(tx, asset);
        const dateKey = transactionDate.toISOString().slice(0, 10);
        // Câmbio carimbado no lançamento tem precedência sobre a reconstrução
        // histórica — é o mesmo número que entrou no custo da posição, e usar
        // fontes diferentes faria fluxo e custo divergirem no TWRR.
        const stampedRate = Number(tx.fxRate);
        const usdRate = Number.isFinite(stampedRate) && stampedRate > 0
            ? stampedRate
            : Number(typeof usdRateForDate === 'function'
                ? usdRateForDate(dateKey)
                : usdRateForDate);
        if (currency === 'USD' && (!Number.isFinite(usdRate) || usdRate <= 0)) {
            throw new RangeError(`Câmbio USD/BRL inválido para ${dateKey}: ${usdRate}`);
        }
        const baseValue = currency === 'USD' ? safeMult(totalValue, usdRate) : totalValue;
        flow = tx.type === 'SELL' ? safeAdd(flow, -baseValue) : safeAdd(flow, baseValue);
    }
    return flow;
};

/** Upsert resistente à corrida entre cron interno e scheduler externo. */
export const upsertWalletSnapshotForDay = async (SnapshotModel, walletId, dayKey, payload) => {
    const filter = { wallet: walletId, dayKey };
    const options = {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
    };
    try {
        return await SnapshotModel.findOneAndUpdate(filter, { $set: payload }, options);
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const winner = await SnapshotModel.findOneAndUpdate(
            filter,
            { $set: payload },
            { ...options, upsert: false },
        );
        if (!winner) throw error;
        return winner;
    }
};
