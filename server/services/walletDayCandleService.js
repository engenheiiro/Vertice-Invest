import logger from '../config/logger.js';
import AssetHistory from '../models/AssetHistory.js';
import { externalMarketService } from './externalMarketService.js';
import { fetchB3DailyCloses } from './b3DailyFileService.js';
import { historyStorageKey, mergeCandleSeries } from '../utils/assetHistory.js';
import { isBrBusinessDay } from '../utils/walletSnapshot.js';
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
 *
 * DUAS FONTES desde 31/08/2026. O Yahoo continua primeiro, mas ele publica a
 * linha do dia com preço nulo sem aviso — 661 séries da B3 na sexta 28/08/2026 —
 * e esse buraco é definitivo. Quando ele falha, o reforço busca o fechamento
 * OFICIAL no arquivo da própria B3 (`b3DailyFileService`), que cobre ação, FII e
 * ETF nacional. O preço corrente segue como último recurso, agora de verdade
 * excepcional.
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
 *
 * `type` é a classe do ativo: com ela, candle em dia sem pregão é recusado (ver
 * `isStorableCandleDate`). Omitida, nada é filtrado.
 */
export const mergeDayCandles = (existing = [], fetched = [], type) => mergeCandleSeries(
    existing, fetched, { maxPoints: ASSET_HISTORY_MAX_POINTS, type },
);

/** Classes e formato de ticker que o arquivo da B3 cobre. */
const B3_FALLBACK_TYPES = new Set(['STOCK', 'FII', 'ETF']);
const B3_TICKER_RE = /^[A-Z]{4}\d{1,2}$/; // ITSA4, BOVA11, KNSC11 — exclui VOO, QQQ e afins

/**
 * Teto de dias úteis que o reforço da B3 preenche de uma vez.
 *
 * Não é economia de rede (o arquivo é memoizado por dia), é limite de escopo: a
 * garantia do candle serve ao snapshot de HOJE. Rombo maior que uma semana é
 * assunto da varredura do universo (`scripts/backfillB3Closes.js`), que enxerga
 * a base inteira e roda sob supervisão.
 */
export const MAX_B3_BACKFILL_DAYS = 5;

/**
 * Dias ÚTEIS sem candle entre o último guardado e `dayStr` (inclusive).
 *
 * Preencher só o dia pedido seria pior que não preencher: empurrar o candle de
 * hoje numa série parada há três dias deixa o buraco no meio E faz
 * `isHistoryStale` ver a série como fresca, então o worker nunca mais volta lá —
 * exatamente o defeito que congelou 21 séries em 30/08/2026. Como o arquivo da
 * B3 existe para qualquer dia passado, o reforço fecha a lacuna inteira.
 *
 * Sem série guardada, devolve só o dia pedido: reconstruir o histórico completo
 * é trabalho do worker, não do caminho do snapshot.
 */
export const missingBusinessDays = (lastCandleDate, dayStr, maxDays = MAX_B3_BACKFILL_DAYS) => {
    if (!dayStr || !isBrBusinessDay(dayStr)) return [];
    if (!lastCandleDate || lastCandleDate >= dayStr) {
        return lastCandleDate === dayStr ? [] : [dayStr];
    }
    const dias = [];
    const cursor = new Date(`${dayStr}T12:00:00.000Z`);
    while (dias.length < maxDays) {
        const key = cursor.toISOString().slice(0, 10);
        if (key <= lastCandleDate) break;
        if (isBrBusinessDay(key)) dias.push(key);
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return dias.reverse();
};

/**
 * REFORÇO: busca na B3 o fechamento oficial dos que o Yahoo não entregou.
 *
 * Só entra depois que o Yahoo falhou, e só para o que o arquivo da B3 cobre —
 * ação, FII e ETF com ticker no formato da bolsa brasileira. ETF internacional
 * (VOO, QQQ), ação americana e cripto não passam pelo regex e seguem no Yahoo.
 *
 * Um download por DIA, não por ticker: a lacuna de todos os alvos vira uma união
 * de dias, e o memo de `b3DailyFileService` garante que cada dia seja baixado uma
 * vez só. Na prática, o pior caso realista é um arquivo.
 *
 * `resolved` é mutado de propósito — é o mesmo mapa que o chamador já usa para os
 * candles vindos do Yahoo, e o snapshot não deve saber de qual fonte veio cada
 * fechamento.
 *
 * @returns {Promise<Set<string>>} tickers cujo candle DO DIA foi recuperado
 */
const recoverWithB3 = async (unresolved, storedByKey, dayStr, resolved) => {
    const alvos = unresolved.filter((u) => B3_FALLBACK_TYPES.has(String(u.type || '').trim().toUpperCase())
        && B3_TICKER_RE.test(String(u.ticker || '').trim().toUpperCase()));
    if (alvos.length === 0) return new Set();

    const diasPorAlvo = new Map();
    const todosOsDias = new Set();
    for (const alvo of alvos) {
        const guardada = storedByKey.get(alvo.storageKey) || [];
        const ultimo = guardada.length ? guardada[guardada.length - 1]?.date : null; // a mescla devolve ordenado
        const dias = missingBusinessDays(ultimo, dayStr);
        if (dias.length === 0) continue;
        diasPorAlvo.set(alvo.storageKey, dias);
        for (const dia of dias) todosOsDias.add(dia);
    }
    if (todosOsDias.size === 0) return new Set();

    const porDia = new Map();
    for (const dia of [...todosOsDias].sort()) porDia.set(dia, await fetchB3DailyCloses(dia));

    const recuperados = new Set();
    for (const alvo of alvos) {
        const dias = diasPorAlvo.get(alvo.storageKey);
        if (!dias) continue;
        const ticker = String(alvo.ticker).trim().toUpperCase();
        const novos = [];
        for (const dia of dias) {
            const linha = porDia.get(dia)?.get(ticker);
            // Ausente no arquivo = o papel não negociou naquele dia. Não é falha:
            // dia sem negócio não tem fechamento, e inventar um seria pior.
            if (linha) {
                // Sem `adjClose`: o arquivo da B3 não ajusta por provento, e
                // `normalizeCandle` já espelha o close quando ele falta — que é o
                // que o próprio Yahoo devolve enquanto não há provento no meio.
                novos.push({ date: dia, close: linha.close, volume: linha.volume });
            }
        }
        if (novos.length === 0) continue;

        try {
            const merged = mergeDayCandles(storedByKey.get(alvo.storageKey) || [], novos, alvo.type);
            await AssetHistory.updateOne(
                { ticker: alvo.storageKey },
                { $set: { history: merged, lastUpdated: new Date() } },
                { upsert: true },
            );
            const candleDoDia = novos.find((c) => c.date === dayStr);
            if (candleDoDia) {
                resolved.set(alvo.storageKey, candleDoDia.close);
                recuperados.add(alvo.ticker);
            }
        } catch (e) {
            logger.warn(`[DayCandle] Reforço da B3 falhou ao gravar ${alvo.ticker}: ${e.message}`);
        }
    }
    return recuperados;
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
    const unresolved = [];
    for (let i = 0; i < entries.length; i += DAY_CANDLE_BATCH_SIZE) {
        const batch = entries.slice(i, i + DAY_CANDLE_BATCH_SIZE);
        await Promise.all(batch.map(async ([storageKey, { ticker, type }]) => {
            try {
                // A variante `Detailed` existe para este diagnóstico: ela conserva as
                // datas que a fonte publicou VAZIAS, que `getFullHistory` descarta.
                // `dayStr` é inclusivo; o serviço converte para o `period2`
                // exclusivo do Yahoo. Passá-lo explicitamente evita depender do
                // acaso do fuso UTC às 23:59 BRT.
                const payload = await externalMarketService.getFullHistoryDetailed(ticker, type, dayStr);
                const series = payload?.candles;
                if (!Array.isArray(series) || series.length === 0) {
                    unresolved.push({ ticker, storageKey, type, reason: describeMiss(dayStr, payload) });
                    return;
                }
                const dayCandle = series.find((c) => c?.date === dayStr && c.close > 0);
                if (!dayCandle) { // ativo sem negócio no dia / fonte atrasada → fallback
                    unresolved.push({ ticker, storageKey, type, reason: describeMiss(dayStr, payload) });
                    return;
                }

                const merged = mergeDayCandles(storedByKey.get(storageKey) || [], series, type);
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
                unresolved.push({ ticker, storageKey, type, reason: `erro na busca (${e.message})` });
                logger.warn(`[DayCandle] Falha ao garantir candle de ${ticker} @ ${dayStr}: ${e.message}`);
            }
        }));
        if (i + DAY_CANDLE_BATCH_SIZE < entries.length) await sleep(DAY_CANDLE_BATCH_PAUSE_MS);
    }

    // O Yahoo desistiu destes; a B3 tem o fechamento oficial do mesmo pregão.
    const recuperados = await recoverWithB3(unresolved, storedByKey, dayStr, resolved);
    const semCandle = unresolved.filter((u) => !recuperados.has(u.ticker));

    logger.info('[DayCandle] Candles do dia garantidos para ativos em carteira', {
        day: dayStr,
        pending: pending.size,
        fetched,
        recoveredFromB3: recuperados.size,
        missing: semCandle.length,
    });
    if (recuperados.size > 0) {
        logger.info('[DayCandle] Fechamento oficial da B3 cobriu a lacuna do Yahoo', {
            day: dayStr, assets: [...recuperados],
        });
    }
    // Cada ativo aqui teve o patrimônio marcado pelo preço das 23:59 em vez do
    // fechamento, e é este o conjunto que a sentinela vai acusar amanhã. Sem os
    // NOMES e o MOTIVO, o alarme obriga a refazer à mão a ida ao Mongo e à fonte
    // que já foi feita uma vez — foi o custo de diagnosticar BOVA11/IVVB11 em
    // 28/08/2026. Warn, e não info: o snapshot do dia saiu degradado.
    if (semCandle.length > 0) {
        logger.warn('[DayCandle] Ativos em carteira sem candle do dia — snapshot cai no preço corrente', {
            day: dayStr,
            missing: semCandle.length,
            assets: semCandle.map((u) => `${u.ticker}: ${u.reason}`),
        });
    }
    return resolved;
};
