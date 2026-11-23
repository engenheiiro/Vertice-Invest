/**
 * Transações do dia no rebuild do histórico da carteira.
 *
 * Aplica, em ordem, os lançamentos com dia <= cursor, mutando `portfolio`,
 * `fixedIncomeState` e `lastKnownPrices` in-place, e devolve o novo `txIndex` e
 * o fluxo do dia (ajustado e nominal, em BRL) para o Modified Dietz.
 *
 * Saiu de `financialService._applyDayTransactions` (complexidade 43) em partes
 * por tipo de lançamento e classe de ativo, com a aritmética intacta — a
 * caracterização em `tests/apply_day_transactions_characterization.spec.js` foi
 * gravada no código anterior à divisão.
 */
import { resolveTransactionCurrency } from './assetCurrency.js';
import { effectiveFxRate } from './fxRate.js';
import { findTreasuryPu } from './fixedIncome.js';
import { toDateKey } from './dateUtils.js';
import { QUANTITY_EPSILON } from './mathUtils.js';

/** Renda fixa não busca candle: o fluxo ajustado é o próprio valor do lançamento. */
const NO_PRICE = Object.freeze({ close: 0, adjClose: 0 });

const isFixedIncomeMeta = (meta) => meta?.type === 'FIXED_INCOME' || meta?.type === 'CASH';

const maturityIsoOf = (meta) => (meta?.maturityDate ? toDateKey(meta.maturityDate) : null);

/**
 * Estado de renda fixa de uma posição vista pela primeira vez.
 * Marcação a mercado: série de PU do título público (null = segue na curva) +
 * lotes em `{dateIso, cost}` para a razão de PU, que é o que torna a marcação
 * independente de como quantidade e preço foram cadastrados.
 */
const openingFixedIncomeState = (meta, treasuryPricing) => ({
    currentValue: 0,
    rate: meta.fixedIncomeRate > 0 ? meta.fixedIncomeRate : (meta.type === 'CASH' ? 100 : 10),
    index: meta.fixedIncomeIndex || null,
    spread: meta.fixedIncomeSpread || 0,
    history: treasuryPricing.historyFor(meta),
    maturityIso: maturityIsoOf(meta),
    lots: [],
});

/**
 * Estado criado na compra quando a posição já existia sem ele (portfolio vindo
 * de fora). Os defaults são os da regra original desse caminho — taxa 100, não
 * 10 — e não foram unificados com `openingFixedIncomeState` de propósito.
 */
const lateFixedIncomeState = (meta, treasuryPricing) => ({
    currentValue: 0,
    rate: meta?.fixedIncomeRate || 100,
    index: meta?.fixedIncomeIndex || null,
    spread: meta?.fixedIncomeSpread || 0,
    history: meta ? treasuryPricing.historyFor(meta) : null,
    maturityIso: maturityIsoOf(meta),
    lots: [],
});

/** cost = moeda nativa; costBrl = mesmo custo com o câmbio de cada compra congelado. */
const ensurePosition = ({ portfolio, fixedIncomeState, assetMetadataMap, treasuryPricing }, ticker) => {
    if (portfolio[ticker]) return;
    portfolio[ticker] = { qty: 0, cost: 0, costBrl: 0 };
    const meta = assetMetadataMap.get(ticker);
    if (meta && isFixedIncomeMeta(meta)) fixedIncomeState[ticker] = openingFixedIncomeState(meta, treasuryPricing);
};

/**
 * Câmbio do PRÓPRIO lançamento (carimbado na compra; senão reconstruído pela
 * data dele) — nunca o do dia do cursor, que difere quando o lançamento cai em
 * fim de semana/feriado. Câmbio inválido interrompe o rebuild em vez de gerar NaN.
 */
const transactionFxRate = (tx, meta, getUsdRateForDate, cursorIso) => {
    const txIsDollarized = resolveTransactionCurrency(tx, meta) === 'USD';
    const txUsdRate = txIsDollarized ? effectiveFxRate(tx, 'USD', getUsdRateForDate) : 1;
    if (!Number.isFinite(Number(txUsdRate)) || Number(txUsdRate) <= 0) {
        throw new RangeError(`Câmbio USD/BRL inválido para ${cursorIso}: ${txUsdRate}`);
    }
    return txUsdRate;
};

/** Preço e fluxo ajustados por provento/desdobramento pelo candle do cursor. */
const adjustedFlowOf = (tx, pData) => {
    if (!(pData.adjClose > 0)) return { txAdjPrice: tx.price, trueAdjustedFlow: tx.totalValue };
    if (pData.close > 0) {
        const ratio = pData.adjClose / pData.close;
        return { txAdjPrice: pData.adjClose, trueAdjustedFlow: tx.totalValue * ratio };
    }
    return { txAdjPrice: pData.adjClose, trueAdjustedFlow: tx.quantity * pData.adjClose };
};

/**
 * `currentValue` é só o valor de partida do dia da compra: dali em diante quem
 * manda são os LOTES, recompostos a cada dia por `accrueLotsValue` (a aplicação
 * não rende no próprio dia). Compra anterior ao início da série de PU abandona a
 * marcação do título de vez — metade marcada e metade na curva não tem régua.
 */
const addFixedIncomeLot = ({ fixedIncomeState, treasuryPricing }, tx, { meta, txDateIso }) => {
    if (!fixedIncomeState[tx.ticker]) fixedIncomeState[tx.ticker] = lateFixedIncomeState(meta, treasuryPricing);
    const state = fixedIncomeState[tx.ticker];
    state.currentValue += tx.totalValue;
    state.lots.push({ dateIso: txDateIso, cost: tx.totalValue, qty: tx.quantity });
    if (state.history && !findTreasuryPu(state.history, txDateIso)) state.history = null;
};

const applyBuy = (ctx, tx, step) => {
    const position = ctx.portfolio[tx.ticker];
    position.qty += tx.quantity;
    position.cost += tx.totalValue;
    position.costBrl += tx.totalValue * step.txUsdRate;
    if (step.isFixed) addFixedIncomeLot(ctx, tx, step);
    if (!ctx.lastKnownPrices[tx.ticker]) ctx.lastKnownPrices[tx.ticker] = { close: tx.price, adjClose: step.txAdjPrice };
    return { adjusted: step.trueAdjustedFlow * step.txUsdRate, nominal: tx.totalValue * step.txUsdRate };
};

/**
 * Baixa PEPS dos lotes de renda fixa (muta `state.lots`) — a mesma regra de
 * `recalculatePosition`, de onde saem os taxLots que o KPI ao vivo e o snapshot
 * valorizam; a baixa proporcional em todos os lotes abria degrau de ~R$ 1,1 mil
 * entre os dois caminhos. Lote sem `qty` (não deveria existir) derruba para a
 * baixa proporcional pela fração da posição, que era a regra antiga.
 */
const consumeFixedIncomeLotsFifo = (state, soldQty, soldFraction) => {
    if (!(soldQty > 0) || !state?.lots?.length) return;
    if (state.lots.some((lot) => !(lot.qty > 0))) {
        const remaining = Math.max(0, 1 - soldFraction);
        state.lots = state.lots.map((lot) => ({ ...lot, cost: lot.cost * remaining }));
        return;
    }
    let toSell = soldQty;
    const kept = [];
    for (const lot of state.lots) {
        if (toSell <= QUANTITY_EPSILON) { kept.push(lot); continue; }
        if (lot.qty > toSell + QUANTITY_EPSILON) {
            const left = lot.qty - toSell;
            kept.push({ ...lot, qty: left, cost: lot.cost * (left / lot.qty) });
            toSell = 0;
        } else {
            toSell -= lot.qty;
        }
    }
    state.lots = kept;
};

/** Baixa proporcional em BRL: a venda não reprecifica o câmbio das compras que ficaram. */
const applySell = ({ portfolio, fixedIncomeState }, tx, step) => {
    const position = portfolio[tx.ticker];
    const qtyBefore = position.qty;
    const currentAvg = qtyBefore > 0 ? position.cost / qtyBefore : 0;
    const soldFraction = qtyBefore > 0 ? tx.quantity / qtyBefore : 0;
    position.qty -= tx.quantity;
    position.cost -= (tx.quantity * currentAvg);
    position.costBrl -= position.costBrl * soldFraction;
    if (step.isFixed) {
        const state = fixedIncomeState[tx.ticker];
        state.currentValue = Math.max(0, state.currentValue - tx.totalValue);
        consumeFixedIncomeLotsFifo(state, tx.quantity, soldFraction);
    }
    return { adjusted: -(step.trueAdjustedFlow * step.txUsdRate), nominal: -(tx.totalValue * step.txUsdRate) };
};

const closeIfEmpty = ({ portfolio, fixedIncomeState }, ticker) => {
    const position = portfolio[ticker];
    if (!(position.qty < QUANTITY_EPSILON)) return;
    position.qty = 0;
    position.cost = 0;
    position.costBrl = 0;
    if (fixedIncomeState[ticker]) {
        fixedIncomeState[ticker].currentValue = 0;
        fixedIncomeState[ticker].lots = [];
    }
};

/** Aplica um lançamento; devolve o fluxo do dia (BUY +, SELL −) ou null para outros tipos. */
const applyTransaction = (ctx, tx, txDateIso, findPrice) => {
    ensurePosition(ctx, tx.ticker);
    const meta = ctx.assetMetadataMap.get(tx.ticker);
    const isFixed = isFixedIncomeMeta(meta);
    const txUsdRate = transactionFxRate(tx, meta, ctx.getUsdRateForDate, ctx.cursorIso);
    const pData = isFixed ? NO_PRICE : findPrice(ctx.priceCacheMap.get(tx.ticker), ctx.cursorIso);
    const step = { meta, isFixed, txDateIso, txUsdRate, ...adjustedFlowOf(tx, pData) };

    let flow = null;
    if (tx.type === 'BUY') flow = applyBuy(ctx, tx, step);
    else if (tx.type === 'SELL') flow = applySell(ctx, tx, step);
    closeIfEmpty(ctx, tx.ticker);
    return flow;
};

/**
 * @param ctx { txs, txIndex, cursorIso, portfolio, fixedIncomeState, assetMetadataMap,
 *              priceCacheMap, lastKnownPrices, getUsdRateForDate, treasuryPricing }
 * @param findPrice `(priceMap, dayKey) => { close, adjClose }` (candle do dia ou anterior)
 */
export const applyDayTransactions = (ctx, findPrice) => {
    const { txs, cursorIso } = ctx;
    let txIndex = ctx.txIndex;
    let dayFlowAdjusted = 0;
    let dayFlowNominal = 0;

    while (txIndex < txs.length) {
        const tx = txs[txIndex];
        const txDateIso = toDateKey(tx.date);
        if (txDateIso > cursorIso) break;
        const flow = applyTransaction(ctx, tx, txDateIso, findPrice);
        if (flow) {
            dayFlowAdjusted += flow.adjusted;
            dayFlowNominal += flow.nominal;
        }
        txIndex++;
    }

    return { txIndex, dayFlowAdjusted, dayFlowNominal };
};
