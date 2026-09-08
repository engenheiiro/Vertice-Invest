import { resolveTransactionCurrency } from './assetCurrency.js';
import { safeAdd, safeMult } from './mathUtils.js';
import { holidayService } from '../services/holidayService.js';

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

// Dia útil a partir da STRING do dia BR — independente do fuso do servidor.
// getUTCDay() sobre a âncora ao meio-dia UTC dá o dia da semana correto do dia BR;
// o feriado é checado pela própria string YYYY-MM-DD. (isBusinessDay usa getDay()
// local, que só é correto num servidor UTC — evitamos essa dependência aqui.)
//
// Mora aqui, ao lado de brazilDayKey, e não no schedulerService: a sentinela de
// saúde precisa contar dias úteis e importá-la do scheduler criaria ciclo, já que
// o scheduler é quem dispara a sentinela. O schedulerService re-exporta para
// preservar o ponto de importação histórico.
export const isBrBusinessDay = (dayStr) => {
    const dow = new Date(`${dayStr}T12:00:00.000Z`).getUTCDay(); // 0=Dom .. 6=Sáb
    if (dow === 0 || dow === 6) return false;
    return !holidayService.isHoliday(dayStr);
};

// Próximo dia BR (string). Âncora ao meio-dia UTC evita bordas de fuso/DST.
const nextBrDayKey = (dayKey) => {
    const d = new Date(`${dayKey}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return brazilDayKey(d);
};

// Teto de varredura: um buraco maior que isto não é "atraso", é série morta — e
// quem consome só precisa saber que há buraco, não medi-lo até o fim.
export const MAX_SNAPSHOT_GAP_SCAN_DAYS = 60;

/**
 * Dias úteis estritamente APÓS `fromDayKey` e estritamente ANTES de `untilDayKey`
 * — os fechamentos que DEVERIAM existir entre um snapshot e hoje e não existem.
 *
 * Fonte ÚNICA de duas leituras que precisam concordar:
 *  - o backfill (`backfillUserGap`) usa a lista para saber o que reconstruir;
 *  - o selo Auditado/Estimado do KPI usa o TAMANHO dela para dizer se a cota
 *    live está ancorada no último fechamento ou extrapolando sobre um buraco.
 *
 * Excluir as duas pontas não é detalhe: o snapshot de HOJE só nasce às 23:59 BRT,
 * então durante o pregão a ausência dele é o estado normal, não um buraco.
 */
export const businessDaysBetween = (fromDayKey, untilDayKey) => {
    const days = [];
    if (!isValidDayKey(fromDayKey) || !isValidDayKey(untilDayKey)) return days;
    let cur = nextBrDayKey(fromDayKey);
    let guard = 0;
    while (cur < untilDayKey && guard++ < MAX_SNAPSHOT_GAP_SCAN_DAYS) {
        if (isBrBusinessDay(cur)) days.push(cur);
        cur = nextBrDayKey(cur);
    }
    return days;
};

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
