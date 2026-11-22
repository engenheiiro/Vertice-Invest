// Peças de financialService.recalculatePosition: o razão da posição (preço médio,
// FIFO e o espelho em BRL com o câmbio de cada lançamento) e os passos de
// persistência em volta dele. Separado só para cada passo caber numa função
// legível; a ordem das escritas no banco continua a de recalculatePosition.
import AssetTransaction from '../models/AssetTransaction.js';
import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import logger from '../config/logger.js';
import { safeFloat, safeUnitPrice, safeCurrency, safeAdd, safeSub, safeQuantity, addQty, subQty, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import { toDateKey } from '../utils/dateUtils.js';
import { classifyUsAsset } from '../utils/usClassification.js';
import { isGoldTicker } from '../utils/goldClassification.js';
import { resolveAllocationClass } from '../utils/assetAllocation.js';
import { effectiveFxRate } from '../utils/fxRate.js';

const MAX_TAX_LOTS = 500;
const LOTS_TO_MERGE = 100;

// Consome os lotes mais antigos (FIFO) e devolve o custo do que saiu. Muta `taxLots`.
const consumeFifoLots = (taxLots, qty) => {
    let remainingToSell = qty;
    let fifoCostOfSoldShares = 0;
    while (remainingToSell > QUANTITY_EPSILON && taxLots.length > 0) {
        const oldestLot = taxLots[0];
        if (oldestLot.quantity > remainingToSell) {
            fifoCostOfSoldShares = safeAdd(fifoCostOfSoldShares, safeCurrency(remainingToSell * oldestLot.price));
            oldestLot.quantity = subQty(oldestLot.quantity, remainingToSell);
            remainingToSell = 0;
        } else {
            fifoCostOfSoldShares = safeAdd(fifoCostOfSoldShares, safeCurrency(oldestLot.quantity * oldestLot.price));
            remainingToSell = subQty(remainingToSell, oldestLot.quantity);
            taxLots.shift();
        }
    }
    return fifoCostOfSoldShares;
};

const applyBuy = (state, tx, entry) => {
    state.quantity = addQty(state.quantity, entry.txQty);
    state.totalCost = safeAdd(state.totalCost, entry.txTotal);
    state.totalCostBrl = safeAdd(state.totalCostBrl, entry.txTotalBrl);
    state.taxLots.push({ quantity: entry.txQty, price: entry.txPrice, date: tx.date, fxRate: entry.txFx });
    if (!state.firstBuyDate) state.firstBuyDate = tx.date;
};

const applySell = (state, { txQty, txTotal, txTotalBrl }) => {
    // Venda que ZERA a posição baixa o custo inteiro, não qtd × médio.
    // O médio é arredondado (safeUnitPrice, 4 casas acima de 1), e
    // qtd × médio arredondado deixava um resíduo: COMPRA 1000@10 +
    // COMPRA 2000@10,01 → médio 10,0067 → a venda de 3000 baixava
    // 30.020,10 de um custo de 30.020,00. O lucro saía 0,10 menor e o
    // custo ficava em −0,10, herdado pela próxima compra (999,90 em vez
    // de 1.000). O zeramento do fim do laço não alcança esse caso porque
    // a posição reabre antes dele.
    const { quantity, totalCost, totalCostBrl } = state;
    const closesPosition = quantity > 0
        && Math.abs(subQty(quantity, txQty)) <= QUANTITY_EPSILON;
    const currentAvg = quantity > 0 ? safeUnitPrice(totalCost / quantity) : 0;
    const costOfSoldShares = closesPosition ? totalCost : safeCurrency(txQty * currentAvg);
    const profit = safeSub(txTotal, costOfSoldShares);
    // Baixa proporcional do custo em BRL — preserva o câmbio médio das
    // compras remanescentes (a venda não reprecifica o que ficou).
    // Zerando, sai o espelho inteiro pelo mesmo motivo acima.
    let costOfSoldSharesBrl = 0;
    if (closesPosition) costOfSoldSharesBrl = totalCostBrl;
    else if (quantity > 0) costOfSoldSharesBrl = safeCurrency(totalCostBrl * (txQty / quantity));

    state.realizedProfit = safeAdd(state.realizedProfit, profit);
    state.realizedProfitBrl = safeAdd(state.realizedProfitBrl, safeSub(txTotalBrl, costOfSoldSharesBrl));
    state.quantity = subQty(quantity, txQty);
    state.totalCost = safeSub(totalCost, costOfSoldShares);
    state.totalCostBrl = safeSub(totalCostBrl, costOfSoldSharesBrl);
    if (closesPosition) { state.quantity = 0; state.totalCost = 0; state.totalCostBrl = 0; }

    const fifoProfit = safeSub(txTotal, consumeFifoLots(state.taxLots, txQty));
    state.fifoRealizedProfit = safeAdd(state.fifoRealizedProfit, fifoProfit);
};

// Acima de 500 lotes, os 100 mais antigos viram um só (mesmo custo nativo e em BRL).
const consolidateTaxLots = (taxLots) => {
    if (taxLots.length <= MAX_TAX_LOTS) return taxLots;
    const lotsToMerge = taxLots.slice(0, LOTS_TO_MERGE);
    const keptLots = taxLots.slice(LOTS_TO_MERGE);
    let mergedQty = 0;
    let mergedCost = 0;
    let mergedCostBrl = 0;

    lotsToMerge.forEach(l => {
        mergedQty = addQty(mergedQty, l.quantity);
        mergedCost = safeAdd(mergedCost, safeCurrency(l.quantity * l.price));
        mergedCostBrl = safeAdd(mergedCostBrl, safeCurrency(l.quantity * l.price * (l.fxRate || 1)));
    });

    // safeUnitPrice, não safeFloat (regra 7): as 4 casas zeravam o lote consolidado
    // de cripto sub-centavo.
    const mergedPrice = mergedQty > 0 ? safeUnitPrice(mergedCost / mergedQty) : 0;
    // Câmbio médio ponderado pelo custo — mantém o lote consolidado com o
    // mesmo valor em reais que os lotes originais somavam.
    const mergedFx = mergedCost > 0 ? safeFloat(mergedCostBrl / mergedCost) : 1;

    return [{
        date: lotsToMerge[lotsToMerge.length - 1].date,
        quantity: mergedQty,
        price: mergedPrice,
        fxRate: mergedFx,
        _id: false
    }, ...keptLots];
};

// Mesma precedência de moeda usada na criação da posição (cadastro explícito >
// MarketAsset > BRL), só que resolvida antes do laço por necessidade.
export const resolveNativeCurrency = (forcedCurrency, asset, marketInfo) => (
    forcedCurrency || asset?.currency || marketInfo?.currency || 'BRL'
);

// Câmbio nativo→BRL de cada lançamento (1 para posição em real). Em dólar, a
// cotação corrente entra como âncora para lançamentos posteriores ao último
// candle da série (compra de hoje, p.ex.).
export const buildFxRateOf = async (nativeCurrency, loadUsdRateResolver) => {
    let usdRateForDate = null;
    if (nativeCurrency === 'USD') {
        const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).select('dollar').lean().catch(() => null);
        usdRateForDate = await loadUsdRateResolver(macro?.dollar);
    }
    return (tx) => (nativeCurrency === 'USD' ? effectiveFxRate(tx, 'USD', usdRateForDate) : 1);
};

/**
 * Reproduz a sequência de lançamentos (já ordenada) e devolve a posição em
 * memória, mais os carimbos de câmbio a gravar nos lançamentos legados em dólar.
 *
 * Saldo negativo é checado na VIRADA DE DIA, não só no fim. Com o check apenas
 * no fim, VENDA 10 em 01/01 + COMPRA 20 em 01/02 passava: a venda saía com preço
 * médio 0 (lucro realizado fictício = valor inteiro da venda) e a compra herdava
 * o custo da quantidade negativa (médio 80 em vez de 40), enquanto o rebuild do
 * histórico zerava o negativo e chegava a outra posição. Dentro do mesmo dia a
 * ordem de digitação decide (day trade lançado com a venda primeiro é aceito).
 */
export const replayPositionLedger = (transactions, { nativeCurrency, rateOf, insufficientBalance }) => {
    // Espelho em BRL de totalCost/realizedProfit: mesma base de preço médio,
    // cada lançamento convertido pelo câmbio do PRÓPRIO dia. Só assim o
    // resultado cambial aparece (em vez de se cancelar contra o saldo).
    const state = {
        quantity: 0, totalCost: 0, realizedProfit: 0, fifoRealizedProfit: 0,
        taxLots: [], firstBuyDate: null, totalCostBrl: 0, realizedProfitBrl: 0,
    };
    const fxToStamp = [];
    let currentDayKey = null;

    for (const tx of transactions) {
        const txDayKey = toDateKey(tx.date);
        if (currentDayKey !== null && txDayKey !== currentDayKey && state.quantity < -QUANTITY_EPSILON) {
            throw insufficientBalance();
        }
        currentDayKey = txDayKey;
        // Quantidade em 8 casas (cripto); valor monetário continua em 2/4 casas.
        const txQty = safeQuantity(tx.quantity);
        const txPrice = safeUnitPrice(tx.price);
        const txTotal = safeCurrency(txQty * txPrice);
        const txFx = rateOf(tx);
        const entry = { txQty, txPrice, txTotal, txFx, txTotalBrl: safeCurrency(txTotal * txFx) };
        // Carimba o câmbio nos lançamentos legados EM DÓLAR (auto-heal): a
        // partir daí o custo em reais não depende mais da reconstrução
        // histórica. Posição em real não é carimbada — gravar "1" em todo
        // lançamento do país inteiro seria escrita pura sem informação.
        if (nativeCurrency === 'USD' && !(Number(tx.fxRate) > 0)) {
            fxToStamp.push({ id: tx._id, fxRate: txFx });
        }

        if (tx.type === 'BUY') applyBuy(state, tx, entry);
        else if (tx.type === 'SELL') applySell(state, entry);
    }

    state.taxLots = consolidateTaxLots(state.taxLots);

    // Erro do USUÁRIO, não do servidor: a sequência de lançamentos vende mais
    // do que havia (venda datada antes das compras, ou exclusão de uma compra
    // da qual uma venda posterior depende). Sem status, virava 500 e chegava
    // como "Erro interno no servidor" — e entrava no painel como falha nossa.
    if (state.quantity < -QUANTITY_EPSILON) {
        throw insufficientBalance();
    }
    if (state.quantity <= QUANTITY_EPSILON) {
        state.quantity = 0; state.totalCost = 0; state.totalCostBrl = 0; state.taxLots = [];
    }
    return { ...state, fxToStamp };
};

// Persistência do carimbo de câmbio: em uma escrita só, e best-effort — falhar
// aqui não pode derrubar o recálculo da posição (o valor já foi reconstruído em
// memória e o próximo recalc tenta de novo).
export const stampFxRates = async (fxToStamp, session, ticker) => {
    if (fxToStamp.length === 0) return;
    try {
        await AssetTransaction.bulkWrite(
            fxToStamp.map(({ id, fxRate }) => ({
                updateOne: { filter: { _id: id }, update: { $set: { fxRate } } },
            })),
            session ? { session } : {},
        );
    } catch (err) {
        logger.warn(`[FX] Falha ao carimbar câmbio em ${ticker}: ${err.message}`);
    }
};

// Rede de segurança: ticker sem registro de mercado (ex.: ETF nacional fora da
// lista curada, ou ativo digitado direto) ganha um stub para o refresh de
// cotações ter um documento para atualizar — senão ficaria com preço 0 no total
// da carteira. Caixa/Renda Fixa não têm cotação.
const ensureMarketStub = async (asset, ticker, marketInfo, session) => {
    if (marketInfo || ['CASH', 'FIXED_INCOME'].includes(asset.type)) return;
    await MarketAsset.updateOne(
        { ticker },
        { $setOnInsert: {
            ticker, name: asset.name || ticker, type: asset.type, currency: asset.currency || 'BRL',
            allocationClass: asset.allocationClass || null, isActive: true,
        } },
        { upsert: true, session }
    ).catch(() => {});
};

/**
 * Posição nova a partir do primeiro lançamento. `marketInfo` já foi buscado (a
 * moeda dele decide o câmbio). Ouro não é mais classe própria na carteira: entra
 * como ETF lastreado (GLD/IAU/GOLD11…) quando o tipo não foi escolhido.
 */
export const createPositionAsset = async ({ userId, walletId, ticker, forcedType, forcedCurrency, marketInfo, session }) => {
    const goldDefault = isGoldTicker(ticker) ? 'ETF' : null;
    const type = forcedType || goldDefault || marketInfo?.type || 'STOCK';
    const asset = new UserAsset({
        user: userId, wallet: walletId, ticker,
        type,
        // Moeda explícita do cadastro tem prioridade (ETF nacional R$ vs
        // internacional US$); senão herda do MarketAsset; senão BRL.
        currency: forcedCurrency || marketInfo?.currency || 'BRL',
        allocationClass: resolveAllocationClass({
            ticker,
            type,
            allocationClass: marketInfo?.allocationClass,
            sector: marketInfo?.sector,
        }),
    });

    await ensureMarketStub(asset, ticker, marketInfo, session);
    return asset;
};

// Self-heal idempotente de posições anteriores ao campo allocationClass.
// O MarketAsset prevalece; a lista curada/ticker e o setor são fallbacks.
// Devolve o marketInfo (eventualmente buscado aqui) para os passos seguintes.
export const healAllocationClass = async (asset, ticker, marketInfo) => {
    let info = marketInfo;
    if (!info && (asset.type === 'ETF' || !asset.allocationClass)) {
        info = await MarketAsset.findOne({ ticker })
            .select('sector currency name type allocationClass')
            .lean()
            .catch(() => null);
    }
    asset.allocationClass = resolveAllocationClass({
        ticker,
        type: asset.type,
        allocationClass: info?.allocationClass || asset.allocationClass,
        sector: info?.sector,
    });
    return info;
};

export const applyLedgerToAsset = (asset, ledger) => {
    asset.quantity = ledger.quantity;
    asset.totalCost = safeCurrency(ledger.totalCost);
    asset.realizedProfit = safeCurrency(ledger.realizedProfit);
    asset.fifoRealizedProfit = safeCurrency(ledger.fifoRealizedProfit);
    asset.taxLots = ledger.taxLots;
    // Custo/realizado em BRL com o câmbio de cada lançamento congelado.
    asset.totalCostBrl = safeCurrency(ledger.totalCostBrl);
    asset.realizedProfitBrl = safeCurrency(ledger.realizedProfitBrl);
    asset.updatedAt = new Date();

    if (ledger.firstBuyDate && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
        asset.startDate = ledger.firstBuyDate;
    }
};

// Exterior: auto-classifica o sub-tipo (Stocks/ETF/REIT/Dólar) quando o
// usuário não definiu manualmente. Override manual permanece intocado.
export const refreshUsSubType = async (asset, ticker, marketInfo) => {
    if (asset.type !== 'STOCK_US') {
        if (asset.usSubType) {
            // Mudou de classe: o sub-tipo de Exterior deixa de fazer sentido.
            asset.usSubType = null;
            asset.usSubTypeManual = false;
        }
        return;
    }
    if (asset.usSubTypeManual) return;
    const info = marketInfo
        || await MarketAsset.findOne({ ticker }).select('sector currency name').lean().catch(() => null);
    asset.usSubType = classifyUsAsset({
        ticker,
        sector: info?.sector,
        type: asset.type,
        currency: asset.currency || info?.currency,
        name: asset.name || info?.name,
    });
};
