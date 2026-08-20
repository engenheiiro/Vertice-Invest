import logger from '../config/logger.js';
import AssetHistory from '../models/AssetHistory.js';
import { externalMarketService } from './externalMarketService.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { ASSET_HISTORY_MAX_POINTS } from '../config/financialConstants.js';

/**
 * GARANTIA DO CANDLE DO DIA PARA ATIVOS EM CARTEIRA.
 *
 * O snapshot patrimonial marca a renda variável pelo FECHAMENTO do dia lido de
 * `AssetHistory` (mesma régua do rebuild). Quando o candle do dia não existe, o
 * snapshot cai no preço corrente do instante do cron (23:59) — o que fazia o
 * ponto do gráfico discordar do card "Variação Hoje" e injetava ruído no TWRR/
 * Sharpe, que derivam da série de `WalletSnapshot`.
 *
 * A série atrasa por design: o `timeSeriesWorker` só re-busca quando o último
 * candle passa de `HISTORY_MAX_CANDLE_AGE_DAYS` (2 dias) — tolerância correta
 * para SMA/RSI/beta e que NÃO deve ser mexida. A saída é o snapshot parar de
 * depender dela: aqui buscamos o candle do dia apenas para os tickers que estão
 * em carteiras de verdade (algumas dezenas, não as ~1.264 do universo de
 * pesquisa), logo antes do snapshot.
 *
 * Fail-open por ticker: qualquer falha de rede/fonte deixa o ativo sem candle e
 * o snapshot volta ao preço corrente — o fallback vira exceção, não a regra.
 */

// Lotes pequenos com pausa entre eles: mesmo padrão do timeSeriesWorker, para
// não estourar o rate limit do Yahoo quando a base de carteiras crescer.
export const DAY_CANDLE_BATCH_SIZE = 5;
export const DAY_CANDLE_BATCH_PAUSE_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeCandle = (candle) => ({
    date: candle.date,
    close: candle.close,
    adjClose: candle.adjClose ?? candle.close,
    volume: candle.volume || 0,
});

/**
 * Une a série armazenada com a recém-buscada (a nova vence em datas repetidas) e
 * devolve oldest→newest.
 *
 * Duas razões para mesclar em vez de só empurrar o candle do dia:
 * 1) empurrar o candle de hoje numa série parada há 2 dias deixaria um buraco
 *    permanente — e, pior, faria `isHistoryStale` ver a série como fresca, então
 *    o worker nunca mais preencheria o buraco;
 * 2) sobrescrever a série inteira pelo que veio da fonte encurtaria séries mais
 *    profundas que o cap, e é justamente a profundidade que o rebuild exige para
 *    não marcar o período anterior ao cap pelo preço de compra.
 * Por isso o teto respeita o tamanho já armazenado (`existing.length`).
 */
export const mergeDayCandles = (existing = [], fetched = []) => {
    const byDate = new Map();
    for (const candle of existing) {
        if (candle?.date) byDate.set(candle.date, normalizeCandle(candle));
    }
    for (const candle of fetched) {
        if (candle?.date && candle.close > 0) byDate.set(candle.date, normalizeCandle(candle));
    }
    const merged = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const limit = Math.max(ASSET_HISTORY_MAX_POINTS, existing.length);
    return merged.slice(-limit);
};

/**
 * Busca e persiste o candle de `dayStr` dos ativos de renda variável em carteira
 * que ainda não o têm.
 *
 * @param {Array<{ticker:string,type:string,quantity?:number}>} assetRefs posições (UserAsset), não o universo de MarketAsset
 * @param {string} dayStr dia-calendário BR (YYYY-MM-DD)
 * @param {Map<string,number>} closeMap fechamentos já conhecidos, indexados por historyStorageKey
 * @returns {Promise<Map<string,number>>} fechamentos recém-obtidos (mesma indexação de closeMap)
 */
export const ensureWalletDayCandles = async (assetRefs = [], dayStr, closeMap = new Map()) => {
    const resolved = new Map();
    if (!dayStr) return resolved;

    // Universo = posições vivas em carteira. Quantidade zerada não entra: não
    // pesa no patrimônio e buscar histórico dela só encareceria o run.
    const pending = new Map();
    for (const asset of assetRefs) {
        if (!asset?.ticker) continue;
        if (asset.quantity !== undefined && !(asset.quantity > 0)) continue;
        const storageKey = historyStorageKey(asset.ticker, asset.type);
        if (!storageKey || closeMap.has(storageKey) || pending.has(storageKey)) continue;
        pending.set(storageKey, { ticker: asset.ticker, type: asset.type });
    }
    if (pending.size === 0) return resolved;

    let storedByKey = new Map();
    try {
        const docs = await AssetHistory.find({ ticker: { $in: [...pending.keys()] } }).lean();
        storedByKey = new Map(docs.map((doc) => [doc.ticker, doc.history || []]));
    } catch (e) {
        // Sem a série armazenada seguimos assim mesmo: o pior caso é regravar a
        // série vinda da fonte, nunca derrubar o snapshot.
        logger.warn(`[DayCandle] Falha ao ler séries armazenadas: ${e.message}`);
    }

    const entries = [...pending.entries()];
    let fetched = 0;
    for (let i = 0; i < entries.length; i += DAY_CANDLE_BATCH_SIZE) {
        const batch = entries.slice(i, i + DAY_CANDLE_BATCH_SIZE);
        await Promise.all(batch.map(async ([storageKey, { ticker, type }]) => {
            try {
                const series = await externalMarketService.getFullHistory(ticker, type);
                if (!Array.isArray(series) || series.length === 0) return;
                const dayCandle = series.find((c) => c?.date === dayStr && c.close > 0);
                if (!dayCandle) return; // ativo sem negócio no dia / fonte atrasada → fallback

                const merged = mergeDayCandles(storedByKey.get(storageKey) || [], series);
                await AssetHistory.updateOne(
                    { ticker: storageKey },
                    // lastCheckedAt fica intocado: ele mede a VISITA do timeSeriesWorker,
                    // e renová-lo aqui mascararia a cobertura incompleta daquele run.
                    { $set: { history: merged, lastUpdated: new Date() } },
                    { upsert: true },
                );
                resolved.set(storageKey, dayCandle.close);
                fetched += 1;
            } catch (e) {
                logger.warn(`[DayCandle] Falha ao garantir candle de ${ticker} @ ${dayStr}: ${e.message}`);
            }
        }));
        if (i + DAY_CANDLE_BATCH_SIZE < entries.length) await sleep(DAY_CANDLE_BATCH_PAUSE_MS);
    }

    const missing = pending.size - fetched;
    logger.info('[DayCandle] Candles do dia garantidos para ativos em carteira', {
        day: dayStr, pending: pending.size, fetched, missing,
    });
    return resolved;
};
