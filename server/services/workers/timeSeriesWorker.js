import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import SystemConfig from '../../models/SystemConfig.js';
import { marketDataService } from '../marketDataService.js';
import { historyStorageKey, mergeCandleSeries } from '../../utils/assetHistory.js';
import { externalMarketService } from '../externalMarketService.js';
import { ASSET_HISTORY_MAX_POINTS, HISTORY_CAP_EXEMPT_TICKERS } from '../../config/financialConstants.js';
import { isTransientMongoError, withMongoRetry } from '../../utils/mongoResilience.js';

// Funções matemáticas auxiliares
const calculateSMA = (prices, period) => {
    if (prices.length < period) return 0;
    const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
};

const calculateEMA = (prices, period) => {
    if (prices.length < period) return 0;
    const k = 2 / (period + 1);
    let ema = prices[prices.length - 1]; // Inicia com o preço mais antigo
    for (let i = prices.length - 2; i >= 0; i--) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
};

const calculateVolatility = (prices) => {
    // Remove preços inválidos: zeros (gaps/fins de semana na fonte) e infinitos causam retornos espúrios
    const validPrices = prices.filter(p => p > 0 && isFinite(p));
    if (validPrices.length < 10) return 0;

    const returns = [];
    for (let i = 0; i < validPrices.length - 1; i++) {
        const r = (validPrices[i] - validPrices[i + 1]) / validPrices[i + 1];
        // Descarta retornos diários impossíveis (>50%): indicam splits não ajustados ou dados corrompidos.
        // Retornos legítimos extremos (circuit breaker -10%) ficam bem abaixo deste limite.
        if (isFinite(r) && !isNaN(r) && Math.abs(r) < 0.50) {
            returns.push(r);
        }
    }
    if (returns.length < 10) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    return stdDev * Math.sqrt(252) * 100; // Anualizada em %
};

// Staleness pela DATA DO ÚLTIMO CANDLE, não por lastUpdated. O critério antigo
// (lastUpdated > 7d) era derrotado pelo "touch" diário que renovava lastUpdated sem
// buscar dados — a série congelava para sempre após a primeira carga (bug confirmado
// em produção: candles parados 2-4 semanas). Limite de 2 dias corridos: como a data
// do candle é meia-noite, "ontem" tem ~1,8d de idade no run das 18:30 (fresco) e
// "anteontem" ~2,8d (stale) → cada série re-busca a cada ~2 dias, defasagem máxima
// de ~1 pregão para SMA/volatilidade/RSI. Exportada para teste.
export const HISTORY_MAX_CANDLE_AGE_DAYS = 2;
export const isHistoryStale = (historyEntry, now = new Date()) => {
    if (!historyEntry?.history?.length) return true;
    // Não assume ordenação: acha a maior data (strings YYYY-MM-DD comparam lexicograficamente).
    let latest = '';
    for (const h of historyEntry.history) {
        if (h?.date && h.date > latest) latest = h.date;
    }
    if (!latest) return true;
    const ageMs = now.getTime() - new Date(`${latest}T00:00:00Z`).getTime();
    return ageMs > HISTORY_MAX_CANDLE_AGE_DAYS * 24 * 60 * 60 * 1000;
};

// Liquidez média (R$/dia) de um ETF a partir dos candles: turnover diário médio
// (volume × close) sobre uma janela de ~3 meses úteis. Dias sem negócio (volume=0)
// entram no denominador de propósito — refletem iliquidez real (ex.: FIXA11), não são
// descartados. Retorna null quando não há janela mínima (mantém o valor de bootstrap do
// sync). Exportada para teste. `sortedHistory` deve vir newest-first.
export const ETF_LIQUIDITY_WINDOW = 60;
export const computeEtfAvgLiquidity = (sortedHistory, window = ETF_LIQUIDITY_WINDOW) => {
    if (!Array.isArray(sortedHistory)) return null;
    const liqWindow = sortedHistory.slice(0, window);
    if (liqWindow.length < 20) return null;
    const sumTurnover = liqWindow.reduce(
        (s, h) => s + ((h?.volume > 0 && h?.close > 0) ? h.volume * h.close : 0), 0);
    const avg = sumTurnover / liqWindow.length;
    return avg > 0 ? Math.round(avg) : null;
};

// (RETOMADA) Ordem de atendimento do run: quem foi visitado há mais tempo primeiro.
//
// O worker sempre varreu a lista na ordem natural do Mongo, que é estável entre
// runs. Como todo run recomeça do zero, um run truncado sempre reatende a MESMA
// cabeça e a cauda nunca chega a ser processada. Foi o que aconteceu em 19/08/2026:
// o processo morreu 62s depois de começar, o run cobriu exatamente as posições
// 0–233 e os outros 1.066 ativos (82% do universo) ficaram sem visita — 660 séries
// congeladas na mesma data, que é a assinatura desse tipo de falha.
//
// Ordenar por `lastCheckedAt` faz a retomada cair de graça: o que não foi alcançado
// ontem tem a visita mais antiga e encabeça a fila hoje. Sem cursor persistido para
// corromper, idempotente, e correto mesmo com dois schedulers rodando em paralelo.
// Ativo sem série ainda vai primeiro (checkedAt 0) — é quem mais precisa.
// Exportada para teste.
export const orderByStaleness = (assets = [], lastCheckedByKey = new Map()) => assets
    .map((asset, index) => ({
        asset,
        index,
        checkedAt: lastCheckedByKey.get(historyStorageKey(asset?.ticker, asset?.type)) ?? 0,
    }))
    // Empate (lote inteiro tocado no mesmo updateMany) mantém a ordem natural.
    .sort((a, b) => a.checkedAt - b.checkedAt || a.index - b.index)
    .map(({ asset }) => asset);

// (DURABILIDADE) Métricas pendentes antes de irem ao banco.
//
// O bulkWrite único no fim do run era all-or-nothing: quando o processo morria no
// meio, beta/SMA/EMA/volatilidade de TODOS os ativos já processados iam junto — os
// candles sobreviviam (gravados um a um dentro do loop), as métricas não. Falha cara
// e silenciosa. Com flush parcial, um run interrompido perde no máximo o último lote.
// Exportada para teste.
export const METRICS_FLUSH_SIZE = 200;

// (RESILIÊNCIA) Quantos lotes seguidos podem falhar por queda de conexão antes de
// desistir do run.
//
// Até 22/08/2026 QUALQUER erro de Mongo no meio do laço matava a etapa inteira:
// o run daquele dia parou em 570/1300 quando o pool tentou abrir um socket novo e
// o handshake TLS estourou o `connectTimeoutMS`. Um flap de 30s custou 730 ativos
// com beta/volatilidade/SMA/EMA velhos — dado que alimenta o portão do ranking.
//
// Agora cada operação do lote já re-tenta sozinha (withMongoRetry) e, se o lote
// ainda assim cair, ele é PULADO em vez de abortar: os ~15 ativos seguintes têm
// chance de passar. Só desistimos quando o banco está de fato fora — 5 lotes
// seguidos, ou seja ~1 minuto sem conseguir uma única operação. Lote pulado não
// renova `lastCheckedAt`, então volta para a cabeça da fila no próximo run.
// Exportada para teste.
export const MAX_CONSECUTIVE_BATCH_FAILURES = 5;

// Pausa após lote que caiu: 2s, 4s, 8s, 16s (teto de 30s). Dá tempo de a malha
// refazer o caminho antes de martelar o banco de novo.
const batchFailureBackoffMs = (consecutiveFailures) =>
    Math.min(30_000, 2_000 * 2 ** (consecutiveFailures - 1));

const calculateBeta = (assetReturns, benchmarkReturns) => {
    if (assetReturns.length < 2 || benchmarkReturns.length < 2) return 1;
    const length = Math.min(assetReturns.length, benchmarkReturns.length);
    const aRet = assetReturns.slice(0, length);
    const bRet = benchmarkReturns.slice(0, length);

    const meanA = aRet.reduce((a, b) => a + b, 0) / length;
    const meanB = bRet.reduce((a, b) => a + b, 0) / length;

    let covariance = 0;
    let varianceB = 0;

    for (let i = 0; i < length; i++) {
        covariance += (aRet[i] - meanA) * (bRet[i] - meanB);
        varianceB += Math.pow(bRet[i] - meanB, 2);
    }

    if (varianceB === 0) return 1;
    return covariance / varianceB;
};

export const timeSeriesWorker = {
    async run() {
        logger.info("📈 [TimeSeriesWorker] Iniciando cálculo de Volatilidade, Beta, SMA e EMA...");
        // Contabilidade do run. Sem isso a cobertura incompleta não deixa rastro:
        // em 19/08/2026 o run parou em 234/1300 sem uma linha de log dizendo isso.
        const stats = {
            total: 0, visited: 0, fetched: 0, fresh: 0, failed: 0, metrics: 0,
            // Lotes perdidos por queda de conexão (ver MAX_CONSECUTIVE_BATCH_FAILURES).
            batchesFailed: 0, skipped: 0,
        };
        const operations = [];

        // Grava o que já foi calculado e esvazia o buffer (ver METRICS_FLUSH_SIZE).
        // Fora do try de propósito: o caminho de erro também precisa chamá-la.
        // Só devolve os itens ao buffer se o bulkWrite falhar de vez — assim uma
        // queda no flush não descarta métricas já calculadas.
        const flushMetrics = async () => {
            if (operations.length === 0) return;
            const pending = operations.splice(0, operations.length);
            try {
                // $set idempotente: re-aplicar o mesmo valor é seguro (ver mongoResilience).
                await withMongoRetry(() => MarketAsset.bulkWrite(pending), { label: 'métricas' });
            } catch (err) {
                operations.unshift(...pending);
                throw err;
            }
            stats.metrics += pending.length;
        };

        try {
            const assets = await withMongoRetry(
                () => MarketAsset.find({ isActive: true }).select('ticker type').lean(),
                { label: 'universo de ativos' });
            if (assets.length === 0) return;

            // Puxa o histórico do IBOV para calcular o Beta das ações/FIIs.
            // Indexa retornos por data (YYYY-MM-DD) para alinhar com o ativo por data,
            // evitando que gaps de pregão (preço=0 filtrado) desalinhem as séries por índice.
            const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP');
            const ibovReturnsByDate = new Map();
            if (ibovHistory && ibovHistory.length > 1) {
                const sortedIbov = [...ibovHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // oldest→newest
                for (let i = 1; i < sortedIbov.length; i++) {
                    if (sortedIbov[i - 1].close > 0 && sortedIbov[i].close > 0) {
                        const r = (sortedIbov[i].close - sortedIbov[i - 1].close) / sortedIbov[i - 1].close;
                        if (isFinite(r) && !isNaN(r) && Math.abs(r) < 0.50) {
                            const dateKey = new Date(sortedIbov[i].date).toISOString().slice(0, 10);
                            ibovReturnsByDate.set(dateKey, r);
                        }
                    }
                }
            }
            // Fila por defasagem de visita (ver orderByStaleness). Projeção enxuta:
            // `history` fica de fora, senão isto puxaria a coleção inteira.
            const checkedDocs = await withMongoRetry(
                () => AssetHistory.find({}, { ticker: 1, lastCheckedAt: 1 }).lean(),
                { label: 'fila de staleness' });
            const lastCheckedByKey = new Map(checkedDocs.map(
                d => [d.ticker, d.lastCheckedAt ? new Date(d.lastCheckedAt).getTime() : 0]));
            const queue = orderByStaleness(assets, lastCheckedByKey);

            stats.total = queue.length;
            const BATCH_SIZE = 5;
            let consecutiveFailures = 0;

            for (let i = 0; i < stats.total; i += BATCH_SIZE) {
                const batch = queue.slice(i, i + BATCH_SIZE);
                const now = new Date();

                // Um lote que cai por queda de conexão é PULADO, não fatal
                // (ver MAX_CONSECUTIVE_BATCH_FAILURES).
                try {
                    // Carrega o histórico de todo o lote em uma única query. O .lean() evita
                    // hidratar o array grande de candles quando só vamos ler (e renovar
                    // lastUpdated em massa via updateMany), reduzindo overhead no caminho quente.
                    const batchTickers = batch.map(a => historyStorageKey(a.ticker, a.type));
                    const histDocs = await withMongoRetry(
                        () => AssetHistory.find({ ticker: { $in: batchTickers } }).lean(),
                        { label: 'histórico do lote' });
                    const histByTicker = new Map(histDocs.map(d => [d.ticker, d]));

                    let batchDidFetch = false;  // só dorme entre lotes que realmente bateram no Yahoo
                    const visitedTickers = [];  // frescos + falhos: renova lastCheckedAt em massa, sem .save() por doc

                    await Promise.all(batch.map(async (asset) => {
                        const storageKey = historyStorageKey(asset.ticker, asset.type);
                        let historyEntry = histByTicker.get(storageKey) || null;

                        // Staleness pela data do último candle (ver isHistoryStale) — nunca por
                        // lastUpdated, que o touch renovava sem dados novos.
                        const isStale = isHistoryStale(historyEntry, now);

                        if (!historyEntry || isStale || !historyEntry.history || historyEntry.history.length < 20) {
                            batchDidFetch = true;
                            let fetched = false;

                            // O catch cobre SÓ a fonte externa. Antes ele envolvia
                            // também a gravação, então uma queda de banco virava
                            // "Falha ao buscar histórico" — o ticker era contado como
                            // sem dado na fonte e a queda passava batida. São coisas
                            // diferentes: falha de fonte é normal e local; falha de
                            // banco é do run inteiro e sobe para o tratamento de lote.
                            let externalHistory = null;
                            try {
                                externalHistory = await externalMarketService.getFullHistory(asset.ticker, asset.type);
                            } catch {
                                logger.warn(`[TimeSeriesWorker] Falha ao buscar histórico para ${asset.ticker}`);
                            }

                            if (externalHistory && externalHistory.length > 0) {
                                // MESCLA com o que já está guardado — nunca substitui.
                                //
                                // Substituir transformava qualquer degradação da fonte em perda
                                // permanente: o Yahoo passou a devolver UM candle para HSRE11 e a
                                // gravação apagou os 623 que tínhamos (a cópia sob a chave legada
                                // `HSRE11.SA` ainda os tem). O mesmo padrão explica as outras séries
                                // de 1 candle na base — e, uma vez encurtadas, elas não se recuperam
                                // sozinhas, porque `isHistoryStale` só olha a DATA do último candle:
                                // um único candle de ontem parece uma série perfeitamente em dia.
                                //
                                // O cap continua governando quanto se guarda de série nova, mas
                                // deixa de autorizar encurtar série profunda (ver mergeCandleSeries).
                                // Câmbio/benchmarks seguem isentos — precisam de série longa.
                                const historyToStore = mergeCandleSeries(
                                    historyEntry?.history || [],
                                    externalHistory,
                                    { maxPoints: HISTORY_CAP_EXEMPT_TICKERS.has(asset.ticker) ? Infinity : ASSET_HISTORY_MAX_POINTS },
                                );
                                await withMongoRetry(() => AssetHistory.updateOne(
                                    { ticker: storageKey },
                                    { $set: { history: historyToStore, lastUpdated: now, lastCheckedAt: now } },
                                    { upsert: true }
                                ), { label: `candles de ${asset.ticker}` });
                                // Reaproveita o array recém-buscado para o cálculo, sem reler do banco.
                                historyEntry = { ticker: storageKey, history: historyToStore, lastUpdated: now };
                                fetched = true;
                            }
                            if (fetched) {
                                stats.fetched += 1;
                            } else {
                                // Falha na fonte também é VISITA. Sem marcar lastCheckedAt, um
                                // ticker morto no Yahoo voltaria ao topo da fila todo run e
                                // travaria a rotação. (Sem upsert de propósito: criar doc vazio
                                // aqui inflaria a contagem de "sem série" da sentinela de saúde.)
                                stats.failed += 1;
                                visitedTickers.push(storageKey);
                            }
                        } else {
                            // "Touch" de monitoramento: renova lastCheckedAt (visita do worker),
                            // NUNCA lastUpdated — renovar lastUpdated sem buscar dados era o que
                            // mascarava a staleness e congelava as séries.
                            stats.fresh += 1;
                            visitedTickers.push(storageKey);
                        }

                        if (!historyEntry || !historyEntry.history || historyEntry.history.length < 20) return;

                        // Ordena do mais recente para o mais antigo
                        const sortedHistory = historyEntry.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                        const prices = sortedHistory.map(h => h.close);

                        const sma200 = calculateSMA(prices, 200);
                        const ema50 = calculateEMA(prices.slice(0, 50), 50); // Passa os últimos 50 dias

                        // Volatilidade baseada nos últimos 252 dias úteis (1 ano)
                        const volatilityPrices = prices.slice(0, 252);
                        const volatility = calculateVolatility(volatilityPrices);

                        // Liquidez média (R$/dia) via candles — SÓ ETF nacional (.SA). As fontes
                        // devolvem averageVolume=0 p/ tickers .SA, então o sync cai num snapshot de
                        // volume de 1 dia (Brapi): ruidoso e que SUBCONTA (ex.: SMAL11 ~52M no
                        // snapshot vs ~250M na média real). O worker roda SEMPRE após o sync e antes
                        // do ranking (sync:prod e cron das 09h) → este valor supera o snapshot.
                        const etfAvgLiquidity = asset.type === 'ETF' ? computeEtfAvgLiquidity(sortedHistory) : null;

                        // Beta só é recalculado aqui para STOCK/FII (benchmark IBOV). Para os
                        // demais tipos (STOCK_US/ETF/CRYPTO) o beta vem do Yahoo no sync de
                        // fundamentos — gravá-lo aqui sobrescrevia esse valor com 1.0 a cada run,
                        // neutralizando os gates de beta do scoring. Só entra no $set quando é BR.
                        const isBrBetaType = asset.type === 'STOCK' || asset.type === 'FII';
                        let beta = 1;
                        if (isBrBetaType && ibovReturnsByDate.size > 0) {
                            // Alinha retornos do ativo com IBOV por data, evitando desalinhamento
                            // causado por dias com preço=0 (gaps) que encurtam a série do ativo mas
                            // não a do IBOV, corrompendo a covariância e zerando o beta.
                            // sortedHistory já está newest→oldest; filtrar e inverter evita um
                            // segundo sort O(n log n) sobre a mesma série (reverse opera sobre
                            // o array novo do filter, sem mutar a série original).
                            const sortedForBeta = sortedHistory
                                .filter(h => h.close > 0 && isFinite(h.close))
                                .reverse(); // → oldest→newest

                            const alignedAssetReturns = [];
                            const alignedIbovReturns = [];

                            for (let j = 1; j < sortedForBeta.length; j++) {
                                const dateKey = new Date(sortedForBeta[j].date).toISOString().slice(0, 10);
                                if (!ibovReturnsByDate.has(dateKey)) continue;

                                const assetReturn = (sortedForBeta[j].close - sortedForBeta[j - 1].close) / sortedForBeta[j - 1].close;
                                if (!isFinite(assetReturn) || isNaN(assetReturn) || Math.abs(assetReturn) >= 0.50) continue;

                                alignedAssetReturns.push(assetReturn);
                                alignedIbovReturns.push(ibovReturnsByDate.get(dateKey));
                            }

                            if (alignedAssetReturns.length >= 20) beta = calculateBeta(alignedAssetReturns, alignedIbovReturns);
                        }

                        const setFields = {
                            volatility: isNaN(volatility) ? 0 : volatility,
                            sma200: isNaN(sma200) ? 0 : sma200,
                            ema50: isNaN(ema50) ? 0 : ema50
                        };
                        if (isBrBetaType) setFields.beta = isNaN(beta) ? 1 : beta;
                        // ETF nacional: liquidez média dos candles é a autoridade (supera o
                        // snapshot Brapi gravado no sync). Só grava quando há janela suficiente.
                        if (etfAvgLiquidity !== null) setFields.liquidity = etfAvgLiquidity;

                        operations.push({
                            updateOne: {
                                filter: { ticker: asset.ticker },
                                update: { $set: setFields }
                            }
                        });
                    }));

                    // Renova lastCheckedAt dos ativos visitados em uma única operação por lote.
                    // (lastUpdated fica intocado — só muda quando candles são realmente re-buscados.)
                    if (visitedTickers.length > 0) {
                        await withMongoRetry(() => AssetHistory.updateMany(
                            { ticker: { $in: visitedTickers } },
                            { $set: { lastCheckedAt: now } }
                        ), { label: 'visitas do lote' });
                    }

                    stats.visited += batch.length;
                    logger.info(`[TimeSeriesWorker] Processando lote... ${stats.visited}/${stats.total} ativos.`);

                    // Grava as métricas acumuladas antes que o buffer cresça demais: o run
                    // pode ser interrompido a qualquer lote (ver METRICS_FLUSH_SIZE).
                    if (operations.length >= METRICS_FLUSH_SIZE) await flushMetrics();

                    // Rate limit protection — só pausa entre lotes que dispararam busca externa no Yahoo.
                    // Em runs "quentes" (tudo fresco) não há throttle a aplicar, eliminando o piso ocioso.
                    if (batchDidFetch) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                } catch (error) {
                    // Erro que não é de transporte (bug de cálculo, schema) segue fatal:
                    // re-tentar 260 vezes o mesmo defeito só esconderia o problema.
                    if (!isTransientMongoError(error)) throw error;

                    consecutiveFailures += 1;
                    stats.batchesFailed += 1;
                    stats.skipped += batch.length;
                    logger.warn(`⚠️ [TimeSeriesWorker] Lote ${i / BATCH_SIZE + 1} perdido por queda de `
                        + `conexão (${error.message}). Falhas seguidas: ${consecutiveFailures}/${MAX_CONSECUTIVE_BATCH_FAILURES}.`);

                    // O que já foi calculado não espera pelo próximo lote.
                    try { await flushMetrics(); } catch { /* tenta de novo no flush seguinte */ }

                    if (consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) throw error;
                    await new Promise(r => setTimeout(r, batchFailureBackoffMs(consecutiveFailures)));
                    continue;
                }
                consecutiveFailures = 0;
            }

            await flushMetrics();
            await this.reportRun(stats);

        } catch (error) {
            // O que já foi calculado não pode morrer com o erro.
            try { await flushMetrics(); } catch { /* já estamos no caminho de falha */ }
            logger.error(`❌ [TimeSeriesWorker] Erro após ${stats.visited}/${stats.total} ativos: ${error.message}`);
            await this.reportRun(stats);
        }
    },

    /**
     * Fecha o run: log de contabilidade + registro em SystemConfig.
     *
     * Um run que cobre 234 de 1.300 ativos é indistinguível de um run completo pelo
     * log antigo (`✅ Atualizados N ativos`), que só contava o bulkWrite final. O
     * denominador é o que denuncia cobertura parcial — e fica gravado também no
     * banco, porque um processo morto não escreve log nenhum.
     */
    async reportRun(stats) {
        const complete = stats.total > 0 && stats.visited >= stats.total;
        // Lotes pulados por queda de conexão são citados só quando existem — a
        // linha do run normal continua idêntica à de antes.
        const perdidos = stats.batchesFailed
            ? ` · ${stats.skipped} pulados em ${stats.batchesFailed} lote(s) com queda de conexão`
            : '';
        const linha = `${stats.visited}/${stats.total} visitados · ${stats.fetched} re-buscados · `
            + `${stats.fresh} já frescos · ${stats.failed} sem dado na fonte · `
            + `${stats.metrics} métricas gravadas${perdidos}.`;
        if (complete) logger.info(`✅ [TimeSeriesWorker] ${linha}`);
        else logger.warn(`⚠️ [TimeSeriesWorker] Cobertura INCOMPLETA — ${linha}`);

        try {
            await SystemConfig.findOneAndUpdate(
                { key: 'MACRO_INDICATORS' },
                {
                    $set: {
                        lastTimeSeriesStats: {
                            assetsProcessed: stats.metrics,
                            visited: stats.visited,
                            total: stats.total,
                            fetched: stats.fetched,
                            failed: stats.failed,
                            batchesFailed: stats.batchesFailed || 0,
                            skipped: stats.skipped || 0,
                            complete,
                            timestamp: new Date()
                        }
                    }
                },
                { upsert: true }
            );
        } catch (e) {
            logger.warn(`[TimeSeriesWorker] Falha ao registrar estatísticas: ${e.message}`);
        }
    }
};
