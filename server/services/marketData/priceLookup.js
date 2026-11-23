// Leitura de preço para a tela e para o lote (getMarketDataByTicker /
// getMarketDataMap): resposta do cache do MarketAsset e fallback no último
// candle do AssetHistory. Mesma forma de objeto (e ordem de chaves) de antes.
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import { getTunablesSync } from '../configService.js';
import { recordCacheAccess } from '../../utils/performanceMetrics.js';
import { historyStorageKey } from '../../utils/assetHistory.js';

const NAME_HEAL_TYPES = ['STOCK', 'FII', 'STOCK_US', 'ETF'];

const byDateDesc = (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime();

/** Fechamento do candle mais recente. Ordena NO LUGAR: quem quer preservar a série passa cópia. */
const lastCloseOf = (candles) => {
    const sorted = candles.sort(byDateDesc);
    return sorted[0].close || sorted[0].adjClose;
};

const historyKeyOf = (clean, asset) => historyStorageKey(clean, asset?.type || 'INDEX');

const withAllocationClass = (asset) => (asset?.allocationClass ? { allocationClass: asset.allocationClass } : {});

// Campos comuns da resposta servida do cache (a ordem das chaves é contrato).
const assetQuoteFields = (asset) => ({
    price: asset.lastPrice,
    change: asset.change || 0,
    priceDate: asset.priceDate || null,
    previousClose: asset.previousClose || 0,
    name: asset.name,
    sector: asset.sector,
});

/** Nome ainda vazio ou igual ao ticker (ação BR não enriquecida). */
export const needsNameHeal = (asset, cleanTicker) => {
    if (!asset || !NAME_HEAL_TYPES.includes(asset.type)) return false;
    const nm = (asset.name || '').trim();
    return !nm || nm.toUpperCase() === cleanTicker.toUpperCase();
};

/** Refresh + releitura; qualquer falha mantém o asset atual. */
export const healAssetName = async (service, cleanTicker, asset) => {
    try {
        await service.refreshQuotesBatch([cleanTicker], true);
        return await MarketAsset.findOne({ ticker: cleanTicker });
    } catch {
        return asset;
    }
};

/** Resposta HIT/STALE do cache; STALE interativo renova em background. */
export const respondFromCache = (service, asset, cleanTicker, interactive) => {
    const cacheMinutes = getTunablesSync().marketCacheMinutes;
    const staleBefore = Date.now() - cacheMinutes * 60 * 1000;
    const isStale = !asset.updatedAt || new Date(asset.updatedAt).getTime() < staleBefore;
    if (interactive && isStale) service.refreshQuoteInBackground(cleanTicker);
    recordCacheAccess('market-price', isStale ? 'stale' : 'hit');
    return {
        ...assetQuoteFields(asset),
        dy: asset.dy || 0,
        cacheStatus: isStale ? 'STALE' : 'HIT',
        isStale,
    };
};

/** Último fechamento da série do ticker (undefined/null quando não há). */
export const historyFallbackClose = async (cleanTicker, asset) => {
    const history = await AssetHistory.findOne({ ticker: historyKeyOf(cleanTicker, asset) });
    if (history && history.history && history.history.length > 0) return lastCloseOf(history.history);
    return null;
};

// --- lote ---

/** Primeira passada: quem tem lastPrice resolve do MarketAsset; o resto pede série. */
export const fillPrimaryQuotes = (map, pairs, byTicker) => {
    let primaryHits = 0;
    const missingKeys = new Set();
    for (const { original, clean } of pairs) {
        const asset = byTicker.get(clean);
        if (asset && asset.lastPrice > 0) {
            primaryHits += 1;
            map.set(original, { ...assetQuoteFields(asset), ...withAllocationClass(asset), dy: asset.dy || 0 });
        } else {
            missingKeys.add(historyKeyOf(clean, asset));
        }
    }
    return { primaryHits, missingKeys };
};

/** Fallback de histórico em UMA query (evita o N+1 de AssetHistory). */
export const loadFallbackHistories = async (missingKeys) => {
    if (missingKeys.size === 0) return new Map();
    const histories = await AssetHistory.find({ ticker: { $in: [...missingKeys] } })
        .select('ticker history');
    return new Map(histories.map(h => [h.ticker, h]));
};

const fallbackCloseOf = (hist) => (
    hist && Array.isArray(hist.history) && hist.history.length > 0 ? lastCloseOf([...hist.history]) : null
);

/** Segunda passada: série como fallback, senão preço 0 (cada ticker por si). */
export const fillHistoryFallbacks = (map, pairs, byTicker, histByTicker) => {
    let fallbackHits = 0;
    let misses = 0;
    for (const { original, clean } of pairs) {
        if (map.has(original)) continue;
        const asset = byTicker.get(clean);
        const lastClose = fallbackCloseOf(histByTicker.get(historyKeyOf(clean, asset)));
        const base = (price) => ({ price, change: 0, name: original, sector: 'Outros', ...withAllocationClass(asset) });
        const resolved = lastClose > 0 ? { ...base(lastClose), isFallback: true } : base(0);
        if (resolved.isFallback) fallbackHits += 1;
        else misses += 1;
        map.set(original, resolved);
    }
    return { fallbackHits, misses };
};
