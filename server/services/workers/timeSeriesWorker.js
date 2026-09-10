import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import SystemConfig from '../../models/SystemConfig.js';
import { marketDataService } from '../marketDataService.js';
import { historyStorageKey, mergeCandleSeries } from '../../utils/assetHistory.js';
import { externalMarketService } from '../externalMarketService.js';
import { B3_TIP_OUTCOME, collectB3CandlesDetailed, isB3Coverable, lastBusinessDayUpTo } from '../b3HistoryFallback.js';
import { recordEscalation } from '../../utils/sourceHealth.js';
import { brNow } from '../../utils/sourceSchedule.js';
import { brazilDayKey } from '../../utils/walletSnapshot.js';
import { ASSET_HISTORY_MAX_POINTS, HISTORY_CAP_EXEMPT_TICKERS } from '../../config/financialConstants.js';
import { isTransientMongoError, withMongoRetry } from '../../utils/mongoResilience.js';
import { repairCryptoCandleGaps } from '../cryptoCandleRepairService.js';

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

/** Data do candle mais novo da série guardada. Não assume ordenação. */
export const latestCandleDate = (history = []) => {
    let latest = '';
    for (const h of history) if (h?.date && h.date > latest) latest = h.date;
    return latest || null;
};

/**
 * REFORÇO DA B3 PARA A SÉRIE DO UNIVERSO.
 *
 * O Yahoo era fonte ÚNICA aqui. Quando ele não entrega — e ele publica a linha do
 * dia com `close` nulo sem aviso: 661 séries da B3 numa sexta de agosto/2026 — a
 * série simplesmente parava, e com ela SMA, RSI, beta, volatilidade e o backtest.
 * O caminho da carteira já tinha essa segunda fonte desde 31/08/2026; o universo de
 * pesquisa, não.
 *
 * Cobre os dois modos de falha com o mesmo teste, que é o único que importa: a
 * ponta da série alcança o último pregão? Não alcança tanto quando o Yahoo devolveu
 * nada quanto quando devolveu a série inteira menos o dia — e o segundo caso é o
 * pior dos dois, porque a série parece saudável enquanto o buraco não se fecha
 * sozinho.
 *
 * NÃO reconstrói série vazia. O arquivo é por pregão (~8,5 MB), então um ano
 * custaria ~250 downloads; a B3 estende a ponta de quem já tem histórico, e quem
 * não tem continua dependendo do Yahoo. Prometer mais que isso na tela seria
 * inventar uma cobertura que não existe.
 */
/**
 * A sessão de `throughDay` já fechou?
 *
 * Só existe para o LEDGER, não para o reforço: rodar antes do fechamento não
 * torna a busca na B3 errada (o arquivo simplesmente não está lá), mas torna o
 * registro mentiroso. Um `sync` manual às 15h com `throughDay` = hoje veria a
 * série de todo papel da bolsa "atrasada" e escreveria centenas de linhas de
 * "sem fechamento em fonte nenhuma" — o painel gritaria por um pregão que ainda
 * está acontecendo. O cron oficial roda às 18:30, depois do fechamento das
 * 17:30; a margem até as 18h absorve a publicação do arquivo.
 */
export const sessaoJaFechou = (throughDay, now) => throughDay < brazilDayKey(now) || brNow(now).hour >= 18;

const reinforceWithB3 = async ({ asset, storageKey, historyEntry, throughDay, now }) => {
    if (!throughDay || !isB3Coverable(asset.ticker, asset.type)) return null;

    const guardada = historyEntry?.history || [];
    if (guardada.length === 0) return null;

    const ultimo = latestCandleDate(guardada);
    if (!ultimo || ultimo >= throughDay) return null;

    // Daqui para baixo é ESCALADA: o Yahoo não trouxe o fechamento deste pregão e
    // a cadeia desce um degrau. Registrar o caminho é o que permite ao painel
    // dizer QUAIS ativos a B3 socorreu — o card dela ficava verde ("recebendo,
    // há 4h") sem que nada na tela ligasse aquela chamada a um ativo.
    //
    // O registro fica DEPOIS das guardas de propósito. Ativo que a B3 não cobre
    // (ação americana, cripto) não entra: o calendário dele não é o da B3, e
    // acusar atraso a cada feriado de lá seria alarme falso. Série vazia também
    // não — a B3 estende a ponta de quem já tem histórico, não reconstrói, e
    // série ausente é assunto da sentinela, não da cadeia.
    //
    // O DESFECHO manda na frase e na cor. "Sem fechamento em fonte nenhuma" é
    // acusação contra a cadeia, e ela é falsa quando o arquivo oficial do pregão
    // está publicado e o papel simplesmente não está lá: aí não houve negócio, e
    // fechamento que não existe não é dado que faltou (ver B3_TIP_OUTCOME).
    const registrar = (resolvedBy, desfecho) => {
        if (!sessaoJaFechou(throughDay, now)) return;
        const semNegocio = desfecho === B3_TIP_OUTCOME.SEM_NEGOCIO;
        recordEscalation({
            chain: 'candle',
            subject: asset.ticker,
            tried: ['yahoo.history', 'b3'],
            resolvedBy,
            reason: semNegocio
                ? `O papel não negociou em ${throughDay} — ausente também no arquivo oficial da B3`
                : `O Yahoo publicou a série sem o fechamento de ${throughDay}`,
            // Escalada conhecida e sem novidade: a linha fica na lista, mas fora
            // do caminho da atenção. Foram 49 ilíquidos em 08/09/2026 — volume
            // suficiente para enterrar o dia em que a B3 atrasar de verdade.
            expected: semNegocio,
        });
    };

    const { candles, tipOutcome } = await collectB3CandlesDetailed(
        [{ key: storageKey, ticker: asset.ticker, type: asset.type, lastCandleDate: ultimo }],
        throughDay,
    );
    const desfecho = tipOutcome.get(storageKey) || null;
    const novos = candles.get(storageKey);
    if (!novos?.length) { registrar(null, desfecho); return null; }
    // Preencher buraco antigo não resolve a PONTA, que é o dia que o ledger
    // nomeia: quem só recuperou dia velho segue sem o fechamento de hoje.
    registrar(desfecho === B3_TIP_OUTCOME.COBERTO ? 'b3' : null, desfecho);

    // Mesma mescla do caminho do Yahoo: o cap de pontos e a recusa de candle em dia
    // sem pregão valem igual, venha o fechamento de onde vier.
    const historyToStore = mergeCandleSeries(guardada, novos, {
        maxPoints: HISTORY_CAP_EXEMPT_TICKERS.has(asset.ticker) ? Infinity : ASSET_HISTORY_MAX_POINTS,
        type: asset.type,
        now,
    });
    await withMongoRetry(() => AssetHistory.updateOne(
        { ticker: storageKey },
        { $set: { history: historyToStore, lastUpdated: now, lastCheckedAt: now } },
        { upsert: true },
    ), { label: `candles da B3 de ${asset.ticker}` });
    return { ticker: storageKey, history: historyToStore, lastUpdated: now };
};

/**
 * O último pregão que JÁ FECHOU — o alvo legítimo de uma varredura de ponta.
 *
 * Não é `lastBusinessDayUpTo(hoje)`, e a diferença é a rotina inteira. Numa
 * quinta às 09:25 aquele devolve a própria quinta; a sessão ainda está aberta,
 * `sessaoJaFechou` recusa, e a varredura sairia sem fazer nada JUSTAMENTE nas
 * horas em que ela existe para trabalhar — o fechamento pendente é o de ONTEM.
 * Depois das 18h o pregão do dia entra como alvo e as duas réguas coincidem de
 * novo.
 */
export const lastClosedSessionDay = (now = new Date()) => {
    const hoje = brazilDayKey(now);
    const util = lastBusinessDayUpTo(hoje);
    if (!util) return null;
    if (util !== hoje || sessaoJaFechou(util, now)) return util;
    const anterior = new Date(`${util}T12:00:00.000Z`);
    anterior.setUTCDate(anterior.getUTCDate() - 1);
    return lastBusinessDayUpTo(anterior.toISOString().slice(0, 10));
};

/** Quantas séries são lidas por vez para a mescla. Limita memória; não há rede aqui. */
const UNIVERSE_TIP_BATCH = 100;

/**
 * SEGUNDA CHANCE DA PONTA DO UNIVERSO — o que só a carteira tinha.
 *
 * O buraco era estrutural, e foi medido em 09/09/2026: das 1.253 séries ativas,
 * 1.002 ficaram sem o fechamento do dia, nenhuma delas por falha de fonte. São
 * duas réguas nossas discordando que produzem esse estado:
 *
 *  - `isHistoryStale` tolera ~1 pregão de atraso DE PROPÓSITO (ver
 *    HISTORY_MAX_CANDLE_AGE_DAYS): série com ponta em D-1 passa por fresca no run
 *    das 18:30, e o Yahoo nem chega a ser consultado. É a economia que mantém o
 *    universo dentro do orçamento de chamadas.
 *  - `reinforceWithB3` olha essa MESMA ponta, vê que falta o pregão do dia e
 *    desce para a B3 — cujo arquivo, naquele dia, ainda não estava publicado às
 *    18:30. Resultado: ~584 escaladas `SEM_ARQUIVO` de uma vez, em vermelho.
 *
 * O arquivo subiu no fim da noite e ficou disponível o dia seguinte inteiro. Não
 * havia quem voltasse lá: a recuperação horária existente
 * (`reconcilePreviousWalletSnapshot`) só cobre ativo EM CARTEIRA, porque nasceu
 * para consertar o snapshot patrimonial. O universo — as séries que alimentam
 * SMA, RSI, beta, volatilidade e o backtest — só teria nova chance no run
 * seguinte, 24h depois.
 *
 * Esta rotina é a contraparte daquela, com a mesma filosofia: em vez de apostar
 * na hora em que a B3 publica, tentar enquanto a lacuna existir. E é barata por
 * construção — UM arquivo por pregão para o universo inteiro (memo em
 * `b3DailyFileService`), zero chamadas ao Yahoo, e saída em duas consultas
 * quando não há o que fazer, que é o caso na esmagadora maioria das horas.
 *
 * NÃO renova `lastCheckedAt`. Aquele relógio é a fila do `timeSeriesWorker` (ver
 * orderByStaleness), e esta varredura não é uma visita dele: não busca no Yahoo e
 * não calcula métrica nenhuma. Renová-lo faria um conserto de candle se passar
 * por visita completa e reordenaria uma fila que ela não está atendendo.
 *
 * @returns {Promise<{status: string, day: string|null, targets: number,
 *   recovered: number, written: number, noTrade: number, missing: number}>}
 */
export const recoverUniverseTipWithB3 = async ({ now = new Date() } = {}) => {
    const vazio = (status, day = null) => ({
        status, day, targets: 0, recovered: 0, written: 0, noTrade: 0, missing: 0,
    });

    const throughDay = lastClosedSessionDay(now);
    if (!throughDay) return vazio('SKIPPED');

    const assets = (await withMongoRetry(
        () => MarketAsset.find({ isActive: true }).select('ticker type').lean(),
        { label: 'universo para varredura de ponta' },
    )).filter((a) => isB3Coverable(a.ticker, a.type));
    if (assets.length === 0) return vazio('SKIPPED', throughDay);

    const chavePorAtivo = new Map(assets.map((a) => [a, historyStorageKey(a.ticker, a.type)]));
    // A ponta de cada série, sem trazer o array inteiro para o processo. É a mesma
    // agregação que a sentinela de saúde já roda de hora em hora — custo conhecido,
    // e o `$match` a deixa mais barata que aquela.
    const pontas = await withMongoRetry(
        () => AssetHistory.aggregate([
            { $match: { ticker: { $in: [...chavePorAtivo.values()] } } },
            { $project: { _id: 0, ticker: 1, tip: { $max: '$history.date' } } },
        ]),
        { label: 'ponta das séries do universo' },
    );
    const pontaPorChave = new Map(pontas.map((r) => [r.ticker, r.tip || null]));

    const alvos = [];
    for (const asset of assets) {
        const key = chavePorAtivo.get(asset);
        const tip = pontaPorChave.get(key) || null;
        // Série vazia fica de fora: a B3 ESTENDE a ponta de quem já tem histórico,
        // não reconstrói (um ano custaria ~250 downloads). Série já na ponta
        // também não — é a saída barata, e é o caso normal.
        if (!tip || tip >= throughDay) continue;
        alvos.push({ key, ticker: asset.ticker, type: asset.type, lastCandleDate: tip });
    }
    if (alvos.length === 0) return vazio('SUCCESS', throughDay);

    const { candles, tipOutcome } = await collectB3CandlesDetailed(alvos, throughDay);

    // O LEDGER PRIMEIRO, e ele vale por si. Cada linha aqui SOBRESCREVE a que o run
    // das 18:30 deixou para o mesmo ticker (a chave é `cadeia|assunto`), e é assim
    // que o painel deixa de exibir por 24h uma falha já curada: o vermelho "sem
    // fechamento em fonte nenhuma" vira "resolvidos pela B3" assim que o arquivo
    // entra no ar. Sem isto, consertar o dado não conserta a tela.
    let recovered = 0;
    let noTrade = 0;
    let missing = 0;
    for (const alvo of alvos) {
        const desfecho = tipOutcome.get(alvo.key) || null;
        const coberto = desfecho === B3_TIP_OUTCOME.COBERTO;
        const semNegocio = desfecho === B3_TIP_OUTCOME.SEM_NEGOCIO;
        if (coberto) recovered += 1;
        else if (semNegocio) noTrade += 1;
        else missing += 1;
        recordEscalation({
            chain: 'candle',
            subject: alvo.ticker,
            tried: ['yahoo.history', 'b3'],
            resolvedBy: coberto ? 'b3' : null,
            reason: semNegocio
                ? `O papel não negociou em ${throughDay} — ausente também no arquivo oficial da B3`
                : `A série parou em ${alvo.lastCandleDate} e o fechamento de ${throughDay} não veio pelo Yahoo`,
            expected: semNegocio,
        });
    }

    const comCandles = alvos.filter((a) => (candles.get(a.key) || []).length > 0);
    let written = 0;
    for (let i = 0; i < comCandles.length; i += UNIVERSE_TIP_BATCH) {
        const lote = comCandles.slice(i, i + UNIVERSE_TIP_BATCH);
        const docs = await withMongoRetry(
            () => AssetHistory.find(
                { ticker: { $in: lote.map((a) => a.key) } }, { ticker: 1, history: 1 },
            ).lean(),
            { label: 'séries para a mescla da varredura de ponta' },
        );
        const guardadaPorChave = new Map(docs.map((d) => [d.ticker, d.history || []]));

        const ops = [];
        for (const alvo of lote) {
            const guardada = guardadaPorChave.get(alvo.key);
            // Sem série guardada não se mescla — mesma recusa de `reinforceWithB3`.
            // Aqui ela cobre também a corrida com o run das 18:30, que pode ter
            // reescrito o documento entre a leitura da ponta e esta.
            if (!guardada?.length) continue;
            // Mesma mescla dos outros dois caminhos: o cap de pontos e a recusa de
            // candle em dia sem pregão valem igual, venha o fechamento de onde vier.
            const merged = mergeCandleSeries(guardada, candles.get(alvo.key), {
                maxPoints: HISTORY_CAP_EXEMPT_TICKERS.has(alvo.ticker) ? Infinity : ASSET_HISTORY_MAX_POINTS,
                type: alvo.type,
                now,
            });
            ops.push({
                updateOne: {
                    filter: { ticker: alvo.key },
                    update: { $set: { history: merged, lastUpdated: now } },
                },
            });
        }
        if (ops.length === 0) continue;
        await withMongoRetry(() => AssetHistory.bulkWrite(ops), { label: 'varredura de ponta do universo' });
        written += ops.length;
    }

    // Silêncio quando não houve conserto: a rotina roda 15 vezes por dia e, no dia
    // bom, não tem nada a dizer. Log de rotina ociosa é o que treina o olho a pular
    // justamente a linha que interessa.
    if (written > 0) {
        logger.info('🩹 [UniverseTip] Fechamento oficial entrou depois do run e a ponta do universo foi fechada', {
            day: throughDay, targets: alvos.length, recovered, written, noTrade, missing,
        });
    } else if (missing > 0) {
        // A B3 não publicou o arquivo do pregão e a hora do run já passou. Não é
        // defeito nosso, mas é o estado que deixa a série curta — e a execução
        // seguinte tenta de novo.
        logger.warn('⚠️ [UniverseTip] Arquivo do pregão ainda ausente na B3 — ponta do universo segue curta', {
            day: throughDay, targets: alvos.length, missing, noTrade,
        });
    }

    return { status: 'SUCCESS', day: throughDay, targets: alvos.length, recovered, written, noTrade, missing };
};

export const timeSeriesWorker = {
    async run() {
        logger.info("📈 [TimeSeriesWorker] Iniciando cálculo de Volatilidade, Beta, SMA e EMA...");
        // Contabilidade do run. Sem isso a cobertura incompleta não deixa rastro:
        // em 19/08/2026 o run parou em 234/1300 sem uma linha de log dizendo isso.
        const stats = {
            total: 0, visited: 0, fetched: 0, fresh: 0, failed: 0, metrics: 0,
            // Séries que só avançaram porque a B3 cobriu o que o Yahoo não deu.
            b3: 0,
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
            // Último pregão que já deveria ter fechamento. Sábado e domingo olham a
            // sexta. Ancorado no dia-calendário BR, não no instante UTC, que na
            // virada da meia-noite aponta para o dia errado.
            const throughDay = lastBusinessDayUpTo(brazilDayKey(new Date()));
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
                                    {
                                        maxPoints: HISTORY_CAP_EXEMPT_TICKERS.has(asset.ticker) ? Infinity : ASSET_HISTORY_MAX_POINTS,
                                        // Classe informada = candle em dia sem pregão é recusado. Sem
                                        // isso, a barra "viva" de domingo que a fonte emite para ticker
                                        // ilíquido entra na série e congela a re-busca (isHistoryStale
                                        // só olha a data do último candle).
                                        type: asset.type,
                                        now,
                                    },
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

                        // SEGUNDA FONTE — fora do ramo de staleness, e é aí que está
                        // a graça. O modo de falha mais comum do Yahoo não é cair: é
                        // publicar a série inteira MENOS o dia. Uma série a que só
                        // falta hoje tem ~1,8 dia de idade, ou seja, passa por FRESCA
                        // na régua de 2 dias — o ramo acima nem a visita, e o buraco
                        // ficaria aberto até a série envelhecer. Testar a ponta contra
                        // o último pregão custa uma comparação de string por ativo, e
                        // o arquivo do dia desce uma vez só para o run inteiro.
                        try {
                            const reforcado = await reinforceWithB3({ asset, storageKey, historyEntry, throughDay, now });
                            if (reforcado) {
                                historyEntry = reforcado;
                                stats.b3 += 1;
                            }
                        } catch (e) {
                            // Fail-open: reforço que derruba o run deixa de ser reforço.
                            // A série fica como o Yahoo a entregou.
                            logger.warn(`[TimeSeriesWorker] Reforço da B3 falhou para ${asset.ticker}: ${e.message}`);
                        }

                        // SÉRIE CURTA DEMAIS PARA MEDIR: apaga a medida velha, não a preserva.
                        //
                        // Sair calado aqui parece inofensivo — "sem dado novo, fica o que
                        // havia" — e é o contrário: o que havia foi calculado sobre a série
                        // ANTERIOR, que pode não ser mais a série deste ativo. Medido em
                        // 06/09/2026 no TON: a correção do símbolo de cripto apagou a série
                        // do impostor (`repairCryptoSymbols`), o símbolo certo
                        // (`TON11419-USD`) só publica 2 candles diários, e a SMA200 do
                        // impostor (0,0060) ficou colada num preço de 1,42 — o scoring lia
                        // "236x acima da tendência" e penalizava o ativo por isso.
                        //
                        // Zero é o que o resto do sistema já entende por ausente (todo
                        // consumidor guarda `m.sma200 > 0`), então limpar é a mesma decisão
                        // de "métrica inaplicável = ausente" que vale no scoring. Beta fica
                        // de fora de propósito: para STOCK_US/ETF/CRYPTO ele vem do sync de
                        // fundamentos, não daqui, e zerá-lo apagaria dado bom de outra fonte.
                        if (!historyEntry || !historyEntry.history || historyEntry.history.length < 20) {
                            operations.push({
                                updateOne: {
                                    filter: { ticker: asset.ticker },
                                    update: { $set: { sma200: 0, ema50: 0, volatility: 0 } },
                                },
                            });
                            return;
                        }

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

            // A barra DIÁRIA da cripto às vezes vem com close nulo enquanto as
            // horárias do mesmo dia existem (04/09/2026: BTC, ETH e USDC). Roda
            // DEPOIS do run porque só faz sentido sobre a série já atualizada — e
            // fora do try de cada lote, porque é reparo, não parte da coleta:
            // falhar aqui não pode derrubar o relatório do run.
            try {
                await repairCryptoCandleGaps();
            } catch (e) {
                logger.warn(`⚠️ [TimeSeriesWorker] Reparo de candle da cripto falhou: ${e.message}`);
            }

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
        // O reforço da B3 só é citado quando entrou em ação: numa semana em que o
        // Yahoo se comporta, ele é zero, e imprimir "0 pela B3" todo run treinaria
        // o olho a ignorar justamente o número que interessa no dia da falha.
        const viaB3 = stats.b3 ? ` · ${stats.b3} completados pelo fechamento oficial da B3` : '';
        const linha = `${stats.visited}/${stats.total} visitados · ${stats.fetched} re-buscados · `
            + `${stats.fresh} já frescos · ${stats.failed} sem dado no Yahoo${viaB3} · `
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
                            recoveredByB3: stats.b3 || 0,
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
