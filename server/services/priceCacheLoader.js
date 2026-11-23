/**
 * Série de preços de UM ticker para o cache do rebuild (`_loadPriceCacheMap`).
 *
 * Lê a série local e, quando ela é rasa, busca a profunda na fonte externa. A
 * profundidade é uma exigência, não um acaso: `requiredFrom` é o 1º dia em que a
 * carteira segurou o papel, e o timeSeriesWorker grava só os últimos ~1,6 ano
 * (`ASSET_HISTORY_MAX_POINTS`) de todo ticker fora de HISTORY_CAP_EXEMPT_TICKERS.
 * Uma série truncada tem 400 candles — passa folgada no antigo teste `length < 5`
 * — e fazia o rebuild marcar TODO o período anterior ao cap pelo preço de compra.
 */
import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { externalMarketService } from './externalMarketService.js';
import { dropUntradableCandles, historyStorageKey } from '../utils/assetHistory.js';

const NO_PRICE_SERIES_TYPES = new Set(['FIXED_INCOME', 'CASH']);

/** Renda fixa, caixa e a reserva não têm série de preço: valem pela curva. */
export const hasNoPriceSeries = (ticker, assetMeta) => NO_PRICE_SERIES_TYPES.has(assetMeta?.type) || ticker === 'RESERVA';

const isUnusable = (history) => !history || history.length < 5;

// Rasa = sem série, ou série que não alcança o 1º dia da posição.
const isShallow = (history, requiredFrom) => {
    const firstCandle = history?.length ? history[0]?.date : null;
    return isUnusable(history) || Boolean(requiredFrom && (!firstCandle || firstCandle > requiredFrom));
};

// Fallback externo é best-effort: sem histórico, o ativo é marcado pelo último
// preço conhecido/custo no loop. A falha vai para debug para não ficar invisível.
async function deepenFromExternal(ticker, searchTicker, assetMeta, history) {
    const info = await MarketAsset.findOne({ ticker });
    const type = assetMeta?.type || info?.type || 'STOCK';
    try {
        // Recusa candle em dia sem pregão antes de qualquer uso: este caminho grava
        // por SUBSTITUIÇÃO (não passa por mergeCandleSeries), então é a única barreira.
        const extHistory = dropUntradableCandles(await externalMarketService.getFullHistory(searchTicker, type), type);
        if (!extHistory || extHistory.length === 0) return history;
        // Só persiste quando não havia série utilizável. Regravar a série cheia num
        // ticker que o worker capa todo dia às 18:30 seria escrever para ser truncado
        // de novo — o rebuild usa a série profunda em memória e deixa o cache como está.
        if (isUnusable(history)) {
            await AssetHistory.updateOne(
                { ticker: historyStorageKey(ticker, type) },
                { history: extHistory, lastUpdated: new Date() },
                { upsert: true }
            );
        }
        return (!history || extHistory.length > history.length) ? extHistory : history;
    } catch (err) {
        logger.debug(`[History] Fallback externo falhou para ${ticker}: ${err.message}`);
        return history;
    }
}

/** Série local do ticker, aprofundada pela fonte externa quando é rasa. */
export async function loadTickerHistory(ticker, { assetMeta, requiredFrom, searchTicker }) {
    const history = await marketDataService.getBenchmarkHistory(ticker, assetMeta?.type || 'INDEX');
    if (!isShallow(history, requiredFrom)) return history;
    return deepenFromExternal(ticker, searchTicker, assetMeta, history);
}
