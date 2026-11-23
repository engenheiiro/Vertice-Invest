import logger from '../config/logger.js';
import AssetHistory from '../models/AssetHistory.js';
import { externalMarketService } from './externalMarketService.js';
import { fetchB3DailyCloses } from './b3DailyFileService.js';
import {
    B3_FALLBACK_TYPES,
    B3_TICKER_RE,
    B3_TIP_OUTCOME,
    MAX_B3_FALLBACK_DAYS,
    collectB3CandlesDetailed,
    missingBusinessDays,
} from './b3HistoryFallback.js';
import { logDayCandleOutcome, logGapHealOutcome, recordDayCandleChain } from './candles/walletCandleReport.js';
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

// Cobertura da B3 e matemática de dia útil vivem em `b3HistoryFallback.js`: o
// timeSeriesWorker usa as MESMAS regras, e duas cópias divergem — foi assim que
// a janela de drawdown do motor âncora ficou corrigida só de um lado.

// Nomes históricos, mantidos porque o resto do arquivo e os testes já os usam.
// A implementação é a compartilhada — o worker do universo depende da mesma
// matemática de dia útil para não gravar candle em dia sem pregão.
export const MAX_B3_BACKFILL_DAYS = MAX_B3_FALLBACK_DAYS;
export { missingBusinessDays };

/**
 * Dias úteis da janela que termina em `throughDay`, do mais antigo ao mais novo.
 */
export const businessWindowDays = (throughDay, maxDays = MAX_B3_BACKFILL_DAYS) => {
    if (!throughDay || !isBrBusinessDay(throughDay)) return [];
    const dias = [];
    const cursor = new Date(`${throughDay}T12:00:00.000Z`);
    while (dias.length < maxDays) {
        const key = cursor.toISOString().slice(0, 10);
        if (isBrBusinessDay(key)) dias.push(key);
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return dias.reverse();
};

/**
 * Dias úteis SEM candle DENTRO da janela — buraco no MEIO da série inclusive.
 *
 * `missingBusinessDays` olha só a ponta (o último candle guardado), e isso basta
 * enquanto o dia que falta É a ponta. Deixa de bastar assim que o dia seguinte
 * chega: em 02/09/2026 o Yahoo publicou o dia VAZIO para BOVA11 e IVVB11, a B3 só
 * publicou o arquivo oficial depois das duas tentativas do dia, e no dia 03 o
 * candle novo entrou por cima — o buraco de 02 virou permanente. É a cicatriz de
 * 27 e 28/08 se repetindo, que da outra vez só saiu com varredura à mão.
 *
 * Medindo por PERTENCIMENTO à janela, a lacuna continua visível depois que a
 * ponta se fecha, e a recuperação segue tentando até o arquivo oficial aparecer.
 *
 * Série sem NENHUM candle na janela não produz lacuna: aí não é buraco, é série
 * morta ou recém-criada, e reconstruir histórico é trabalho do `timeSeriesWorker`.
 * Pelo mesmo motivo nada anterior ao candle mais antigo da janela é cobrado —
 * ativo comprado ontem não tem pregão anterior a preencher.
 *
 * @param {Iterable<string>|Set<string>} existingDates datas já guardadas (idealmente só as da janela)
 * @param {string} throughDay último dia da janela (YYYY-MM-DD, dia útil)
 * @param {number} [maxDays] tamanho da janela, em dias úteis
 */
export const missingDaysInWindow = (existingDates, throughDay, maxDays = MAX_B3_BACKFILL_DAYS) => {
    const presentes = existingDates instanceof Set ? existingDates : new Set(existingDates || []);
    if (presentes.size === 0) return [];
    const janela = businessWindowDays(throughDay, maxDays);
    if (janela.length === 0) return [];
    let piso = null;
    for (const data of presentes) if (!piso || data < piso) piso = data;
    return janela.filter((dia) => dia >= piso && !presentes.has(dia));
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
 * @returns {Promise<{recuperados: Set<string>, semNegocio: Set<string>}>} tickers cujo
 *   candle DO DIA foi recuperado, e os que não têm fechamento porque não houve
 *   negócio no papel (arquivo oficial publicado e o ticker fora dele).
 */
const recoverWithB3 = async (unresolved, storedByKey, dayStr, resolved) => {
    const vazio = { recuperados: new Set(), semNegocio: new Set() };
    const alvos = unresolved.filter((u) => B3_FALLBACK_TYPES.has(String(u.type || '').trim().toUpperCase())
        && B3_TICKER_RE.test(String(u.ticker || '').trim().toUpperCase()));
    if (alvos.length === 0) return vazio;

    // A busca é a compartilhada com o worker do universo; só a gravação fica aqui,
    // porque as regras de mescla legitimamente divergem entre os dois caminhos.
    // Sem `adjClose`: o arquivo da B3 não ajusta por provento, e `normalizeCandle`
    // já espelha o close quando ele falta — igual ao que o Yahoo devolve enquanto
    // não há provento no meio.
    const { candles: candlesPorChave, tipOutcome } = await collectB3CandlesDetailed(
        alvos.map((alvo) => {
            const guardada = storedByKey.get(alvo.storageKey) || [];
            return {
                key: alvo.storageKey,
                ticker: alvo.ticker,
                type: alvo.type,
                // A mescla devolve ordenado, então a ponta é o último elemento.
                lastCandleDate: guardada.length ? guardada[guardada.length - 1]?.date : null,
            };
        }),
        dayStr,
    );

    // O papel que não negociou não tem fechamento em fonte alguma — nem hoje nem
    // depois. Sem essa distinção o ledger acusa a cadeia por uma ausência que é
    // do MERCADO, e o alarme vira ruído (ver B3_TIP_OUTCOME).
    const recuperados = new Set();
    const semNegocio = new Set();
    for (const alvo of alvos) {
        if (tipOutcome.get(alvo.storageKey) === B3_TIP_OUTCOME.SEM_NEGOCIO) semNegocio.add(alvo.ticker);
    }
    if (candlesPorChave.size === 0) return { recuperados, semNegocio };

    for (const alvo of alvos) {
        const novos = candlesPorChave.get(alvo.storageKey);
        if (!novos?.length) continue;
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
    return { recuperados, semNegocio };
};

/**
 * Posição viva em carteira. Quantidade zerada não entra: não pesa no patrimônio
 * e buscar histórico dela só encareceria o run. Sem `quantity` informada, entra.
 */
const isLivePosition = (asset) => Boolean(asset?.ticker)
    && !(asset.quantity !== undefined && !(asset.quantity > 0));

/** Universo do candle do dia: posições vivas cujo fechamento ainda não se conhece. */
const collectPendingDayAssets = (assetRefs, closeMap) => {
    const pending = new Map();
    for (const asset of assetRefs) {
        if (!isLivePosition(asset)) continue;
        const storageKey = historyStorageKey(asset.ticker, asset.type);
        if (!storageKey || closeMap.has(storageKey) || pending.has(storageKey)) continue;
        pending.set(storageKey, { ticker: asset.ticker, type: asset.type });
    }
    return pending;
};

/** Séries guardadas por chave; leitura que falha devolve mapa vazio (fail-open). */
const loadStoredSeries = async (keys) => {
    try {
        const docs = await AssetHistory.find({ ticker: { $in: keys } }).lean();
        return new Map(docs.map((doc) => [doc.ticker, doc.history || []]));
    } catch (e) {
        // Sem a série armazenada seguimos assim mesmo: o pior caso é regravar a
        // série vinda da fonte, nunca derrubar o snapshot.
        logger.warn(`[DayCandle] Falha ao ler séries armazenadas: ${e.message}`);
        return new Map();
    }
};

/**
 * Um ativo pelo Yahoo: grava a série mesclada quando o dia veio com preço, ou
 * entra em `ctx.unresolved` com o motivo. Muta `ctx` (resolved, unresolved,
 * fetched) — os ativos do lote correm em paralelo sobre o mesmo contexto.
 */
const fetchOneDayCandle = async (storageKey, { ticker, type }, ctx) => {
    const { dayStr } = ctx;
    try {
        // A variante `Detailed` existe para este diagnóstico: ela conserva as
        // datas que a fonte publicou VAZIAS, que `getFullHistory` descarta.
        // `dayStr` é inclusivo; o serviço converte para o `period2`
        // exclusivo do Yahoo. Passá-lo explicitamente evita depender do
        // acaso do fuso UTC às 23:59 BRT.
        const payload = await externalMarketService.getFullHistoryDetailed(ticker, type, dayStr);
        const series = payload?.candles;
        const dayCandle = Array.isArray(series)
            ? series.find((c) => c?.date === dayStr && c.close > 0)
            : undefined;
        if (!dayCandle) { // sem série, sem negócio no dia ou fonte atrasada → fallback
            ctx.unresolved.push({ ticker, storageKey, type, reason: describeMiss(dayStr, payload) });
            return;
        }

        const merged = mergeDayCandles(ctx.storedByKey.get(storageKey) || [], series, type);
        await AssetHistory.updateOne(
            { ticker: storageKey },
            // lastCheckedAt fica intocado: ele mede a VISITA do timeSeriesWorker,
            // e renová-lo aqui mascararia a cobertura incompleta daquele run.
            { $set: { history: merged, lastUpdated: new Date() } },
            { upsert: true },
        );
        ctx.resolved.set(storageKey, dayCandle.close);
        ctx.fetched += 1;
    } catch (e) {
        ctx.unresolved.push({ ticker, storageKey, type, reason: `erro na busca (${e.message})` });
        logger.warn(`[DayCandle] Falha ao garantir candle de ${ticker} @ ${dayStr}: ${e.message}`);
    }
};

/** Yahoo em lotes pequenos com pausa entre eles. */
const fetchDayCandlesInBatches = async (pending, ctx) => {
    const entries = [...pending.entries()];
    for (let i = 0; i < entries.length; i += DAY_CANDLE_BATCH_SIZE) {
        const batch = entries.slice(i, i + DAY_CANDLE_BATCH_SIZE);
        await Promise.all(batch.map(([storageKey, ref]) => fetchOneDayCandle(storageKey, ref, ctx)));
        if (i + DAY_CANDLE_BATCH_SIZE < entries.length) await sleep(DAY_CANDLE_BATCH_PAUSE_MS);
    }
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

    const pending = collectPendingDayAssets(assetRefs, closeMap);
    if (pending.size === 0) return resolved;

    const storedByKey = await loadStoredSeries([...pending.keys()]);
    const ctx = { dayStr, storedByKey, resolved, unresolved: [], fetched: 0 };
    await fetchDayCandlesInBatches(pending, ctx);

    // O Yahoo desistiu destes; a B3 tem o fechamento oficial do mesmo pregão.
    const b3 = await recoverWithB3(ctx.unresolved, storedByKey, dayStr, resolved);
    const semCandle = ctx.unresolved.filter((u) => !b3.recuperados.has(u.ticker));

    recordDayCandleChain(ctx.unresolved, b3, dayStr);
    logDayCandleOutcome({ dayStr, pending: pending.size, fetched: ctx.fetched, recuperados: b3.recuperados, semCandle });
    return resolved;
};

/** Alvos da varredura: posições vivas que o arquivo da B3 cobre, uma por série. */
const collectGapTargets = (assetRefs) => {
    const alvos = new Map();
    for (const asset of assetRefs) {
        if (!isLivePosition(asset)) continue;
        const ticker = String(asset.ticker).trim().toUpperCase();
        if (!B3_FALLBACK_TYPES.has(String(asset.type || '').trim().toUpperCase())) continue;
        if (!B3_TICKER_RE.test(ticker)) continue;
        const storageKey = historyStorageKey(asset.ticker, asset.type);
        if (storageKey && !alvos.has(storageKey)) alvos.set(storageKey, { ticker, type: asset.type });
    }
    return alvos;
};

/** Agregação que lê só as DATAS da janela de cada série, não os candles. */
const windowDatesPipeline = (keys, firstDay, throughDay) => [
    { $match: { ticker: { $in: keys } } },
    {
        $project: {
            ticker: 1,
            dates: {
                $map: {
                    input: {
                        $filter: {
                            input: { $ifNull: ['$history', []] },
                            as: 'h',
                            cond: { $and: [{ $gte: ['$$h.date', firstDay] }, { $lte: ['$$h.date', throughDay] }] },
                        },
                    },
                    as: 'h',
                    in: '$$h.date',
                },
            },
        },
    },
];

/**
 * Dias faltantes por chave. `null` quando a leitura falhou — fail-open: sem a
 * leitura não há varredura, e o caminho de quem chamou segue com o que já tinha.
 */
const readWindowGaps = async (keys, janela, throughDay, maxDays) => {
    try {
        const rows = await AssetHistory.aggregate(windowDatesPipeline(keys, janela[0], throughDay));
        const faltantesPorChave = new Map();
        for (const row of rows) {
            const dias = missingDaysInWindow(row.dates, throughDay, maxDays);
            if (dias.length > 0) faltantesPorChave.set(row.ticker, dias);
        }
        return faltantesPorChave;
    } catch (e) {
        logger.warn(`[DayCandle] Varredura de lacuna não pôde ler as séries: ${e.message}`);
        return null;
    }
};

/** Um download por dia faltante (união de todas as séries), em ordem. */
const fetchB3ClosesForGaps = async (faltantesPorChave) => {
    const todosOsDias = new Set();
    for (const dias of faltantesPorChave.values()) for (const dia of dias) todosOsDias.add(dia);
    const porDia = new Map();
    for (const dia of [...todosOsDias].sort()) porDia.set(dia, await fetchB3DailyCloses(dia));
    return porDia;
};

/** Candles oficiais dos dias que faltam; ticker ausente do arquivo não vira candle. */
const officialCandlesFor = (ticker, dias, porDia) => {
    const novos = [];
    for (const dia of dias) {
        const linha = porDia.get(dia)?.get(ticker);
        if (linha) novos.push({ date: dia, close: linha.close, volume: linha.volume });
    }
    return novos;
};

/** Grava a série mesclada (sem upsert: a varredura só fecha série que já existe). */
const writeHealedSeries = async (storageKey, alvo, guardada, novos, recuperados) => {
    try {
        const merged = mergeDayCandles(guardada, novos, alvo.type);
        await AssetHistory.updateOne(
            { ticker: storageKey },
            { $set: { history: merged, lastUpdated: new Date() } },
        );
        recuperados.set(storageKey, novos.map((c) => c.date));
    } catch (e) {
        logger.warn(`[DayCandle] Varredura de lacuna falhou ao gravar ${alvo.ticker}: ${e.message}`);
    }
};

/**
 * VARREDURA DE LACUNA: fecha, pelo arquivo oficial da B3, os buracos que ficaram
 * na janela recente das séries em carteira.
 *
 * Complementa `ensureWalletDayCandles`, que só enxerga a PONTA da série (o dia
 * que está sendo marcado). Quando as duas fontes falham no dia D e o candle de
 * D+1 chega normalmente, a ponta se fecha com o buraco de D lá dentro — e some do
 * radar do caminho do snapshot para sempre. Foi o que aconteceu em 27 e 28/08 e
 * de novo em 02/09/2026, com BOVA11 e IVVB11: o Yahoo publicou o dia vazio e a
 * B3 só publicou o arquivo oficial DEPOIS das tentativas das 23:59 e das 09:00.
 *
 * Barata quando não há o que fazer, que é o caso quase sempre: uma agregação lê
 * apenas as DATAS da janela (não os ~1.600 candles de cada série) e, sem lacuna,
 * a função sai sem tocar na rede. A série completa só é carregada para os tickers
 * que realmente têm buraco.
 *
 * Ausente do arquivo da B3 = papel que não negociou no dia. Não é falha e não
 * vira candle: inventar fechamento é pior que a lacuna.
 *
 * @param {Array<{ticker:string,type:string,quantity?:number}>} assetRefs posições em carteira
 * @param {string} throughDay último dia útil da janela (YYYY-MM-DD)
 * @param {{maxDays?:number}} [options]
 * @returns {Promise<Map<string, string[]>>} storageKey → dias recuperados
 */
export const healWalletCandleGaps = async (assetRefs = [], throughDay, { maxDays = MAX_B3_BACKFILL_DAYS } = {}) => {
    const recuperados = new Map();
    const janela = businessWindowDays(throughDay, maxDays);
    if (janela.length === 0) return recuperados;

    const alvos = collectGapTargets(assetRefs);
    if (alvos.size === 0) return recuperados;

    const faltantesPorChave = await readWindowGaps([...alvos.keys()], janela, throughDay, maxDays);
    if (!faltantesPorChave?.size) return recuperados;

    const porDia = await fetchB3ClosesForGaps(faltantesPorChave);
    const docs = await AssetHistory.find({ ticker: { $in: [...faltantesPorChave.keys()] } }).lean();
    const guardadaPorChave = new Map(docs.map((doc) => [doc.ticker, doc.history || []]));

    for (const [storageKey, dias] of faltantesPorChave) {
        const alvo = alvos.get(storageKey);
        const novos = officialCandlesFor(alvo.ticker, dias, porDia);
        if (novos.length === 0) continue;
        await writeHealedSeries(storageKey, alvo, guardadaPorChave.get(storageKey) || [], novos, recuperados);
    }

    logGapHealOutcome(throughDay, recuperados, faltantesPorChave);
    return recuperados;
};
