import logger from '../config/logger.js';
import AssetHistory from '../models/AssetHistory.js';
import { externalMarketService } from './externalMarketService.js';
import { historyStorageKey, mergeCandleSeries } from '../utils/assetHistory.js';
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

/**
 * Por que este ativo ficou sem o candle do dia — no vocabulário de quem vai ler
 * o alarme amanhã de manhã.
 *
 * As três causas pedem ações diferentes, e o log antigo (só a contagem agregada)
 * não separava nenhuma delas:
 *  · `dia publicado VAZIO` — a fonte tem a linha do pregão com preço nulo. É
 *    lacuna de terceiro, definitiva, e NÃO há o que consertar aqui: o candle não
 *    vai chegar depois. Foi o caso dos 7 ETFs da B3 em 27/08/2026.
 *  · `fonte ainda sem o dia` — a série mais nova para antes do dia pedido. Às
 *    23:59 do próprio dia isso costuma ser publicação atrasada, e o candle entra
 *    no run seguinte. Só vira defeito se persistir.
 *  · `sem série na fonte` — o símbolo não devolveu nada. Aí sim é o ticker que
 *    deixou de resolver: deslistamento, troca de código, ou o breaker aberto.
 *
 * Pressupõe que o candle de `dayStr` NÃO foi encontrado — é a única situação em
 * que faz pergunta. Chamada com uma série que TEM o dia, devolve o motivo
 * genérico do fim da lista, que aí seria mentira.
 */
export const describeMiss = (dayStr, payload) => {
    if (!payload) return 'sem resposta da fonte';
    const { candles = [], emptyDates = [] } = payload;
    if (emptyDates.includes(dayStr)) return 'dia publicado VAZIO pela fonte (close nulo)';
    if (candles.length === 0) return 'sem série na fonte';
    const latest = candles[candles.length - 1]?.date;
    if (latest && latest < dayStr) return `fonte ainda sem o dia (última: ${latest})`;
    return 'dia ausente na série da fonte';
};

/**
 * Une a série armazenada com a recém-buscada. Implementação compartilhada em
 * `utils/assetHistory.js` — o timeSeriesWorker grava na MESMA coleção e precisa
 * das mesmas regras, senão os dois escritores desfazem o trabalho um do outro.
 *
 * Duas razões para mesclar em vez de só empurrar o candle do dia:
 * 1) empurrar o candle de hoje numa série parada há 2 dias deixaria um buraco
 *    permanente — e, pior, faria `isHistoryStale` ver a série como fresca, então
 *    o worker nunca mais preencheria o buraco;
 * 2) sobrescrever a série inteira pelo que veio da fonte encurtaria séries mais
 *    profundas que o cap, e é justamente a profundidade que o rebuild exige para
 *    não marcar o período anterior ao cap pelo preço de compra.
 */
export const mergeDayCandles = (existing = [], fetched = []) => mergeCandleSeries(
    existing, fetched, { maxPoints: ASSET_HISTORY_MAX_POINTS },
);

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
    const unresolved = [];
    for (let i = 0; i < entries.length; i += DAY_CANDLE_BATCH_SIZE) {
        const batch = entries.slice(i, i + DAY_CANDLE_BATCH_SIZE);
        await Promise.all(batch.map(async ([storageKey, { ticker, type }]) => {
            try {
                // A variante `Detailed` existe para este diagnóstico: ela conserva as
                // datas que a fonte publicou VAZIAS, que `getFullHistory` descarta.
                const payload = await externalMarketService.getFullHistoryDetailed(ticker, type);
                const series = payload?.candles;
                if (!Array.isArray(series) || series.length === 0) {
                    unresolved.push({ ticker, reason: describeMiss(dayStr, payload) });
                    return;
                }
                const dayCandle = series.find((c) => c?.date === dayStr && c.close > 0);
                if (!dayCandle) { // ativo sem negócio no dia / fonte atrasada → fallback
                    unresolved.push({ ticker, reason: describeMiss(dayStr, payload) });
                    return;
                }

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
                unresolved.push({ ticker, reason: `erro na busca (${e.message})` });
                logger.warn(`[DayCandle] Falha ao garantir candle de ${ticker} @ ${dayStr}: ${e.message}`);
            }
        }));
        if (i + DAY_CANDLE_BATCH_SIZE < entries.length) await sleep(DAY_CANDLE_BATCH_PAUSE_MS);
    }

    logger.info('[DayCandle] Candles do dia garantidos para ativos em carteira', {
        day: dayStr, pending: pending.size, fetched, missing: unresolved.length,
    });
    // Cada ativo aqui teve o patrimônio marcado pelo preço das 23:59 em vez do
    // fechamento, e é este o conjunto que a sentinela vai acusar amanhã. Sem os
    // NOMES e o MOTIVO, o alarme obriga a refazer à mão a ida ao Mongo e à fonte
    // que já foi feita uma vez — foi o custo de diagnosticar BOVA11/IVVB11 em
    // 28/08/2026. Warn, e não info: o snapshot do dia saiu degradado.
    if (unresolved.length > 0) {
        logger.warn('[DayCandle] Ativos em carteira sem candle do dia — snapshot cai no preço corrente', {
            day: dayStr,
            missing: unresolved.length,
            assets: unresolved.map((u) => `${u.ticker}: ${u.reason}`),
        });
    }
    return resolved;
};
