import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import SystemConfig from '../../models/SystemConfig.js';
import { marketDataService } from '../marketDataService.js';
import { externalMarketService } from '../externalMarketService.js';
import { ASSET_HISTORY_MAX_POINTS, HISTORY_CAP_EXEMPT_TICKERS } from '../../config/financialConstants.js';

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
        try {
            const assets = await MarketAsset.find({ isActive: true }).select('ticker type');
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
            const operations = [];
            let processedCount = 0;
            const totalAssets = assets.length;
            const BATCH_SIZE = 5;

            for (let i = 0; i < totalAssets; i += BATCH_SIZE) {
                const batch = assets.slice(i, i + BATCH_SIZE);
                const now = new Date();

                // Carrega o histórico de todo o lote em uma única query. O .lean() evita
                // hidratar o array grande de candles quando só vamos ler (e renovar
                // lastUpdated em massa via updateMany), reduzindo overhead no caminho quente.
                const batchTickers = batch.map(a => a.ticker);
                const histDocs = await AssetHistory.find({ ticker: { $in: batchTickers } }).lean();
                const histByTicker = new Map(histDocs.map(d => [d.ticker, d]));

                let batchDidFetch = false;  // só dorme entre lotes que realmente bateram no Yahoo
                const touchTickers = [];    // frescos: renova lastUpdated em massa, sem .save() por doc

                await Promise.all(batch.map(async (asset) => {
                    let historyEntry = histByTicker.get(asset.ticker) || null;

                    // Staleness pela data do último candle (ver isHistoryStale) — nunca por
                    // lastUpdated, que o touch renovava sem dados novos.
                    const isStale = isHistoryStale(historyEntry, now);

                    if (!historyEntry || isStale || !historyEntry.history || historyEntry.history.length < 20) {
                        batchDidFetch = true;
                        try {
                            const externalHistory = await externalMarketService.getFullHistory(asset.ticker, asset.type);
                            if (externalHistory && externalHistory.length > 0) {
                                // Cap de armazenamento: guarda só os últimos ASSET_HISTORY_MAX_POINTS
                                // candles (a série vem oldest→newest do Yahoo, então .slice(-N) mantém os
                                // mais recentes). Câmbio/benchmarks ficam de fora — precisam de série longa.
                                const historyToStore = HISTORY_CAP_EXEMPT_TICKERS.has(asset.ticker)
                                    ? externalHistory
                                    : externalHistory.slice(-ASSET_HISTORY_MAX_POINTS);
                                await AssetHistory.updateOne(
                                    { ticker: asset.ticker },
                                    { $set: { history: historyToStore, lastUpdated: now, lastCheckedAt: now } },
                                    { upsert: true }
                                );
                                // Reaproveita o array recém-buscado para o cálculo, sem reler do banco.
                                historyEntry = { ticker: asset.ticker, history: historyToStore, lastUpdated: now };
                            }
                        } catch (e) {
                            logger.warn(`[TimeSeriesWorker] Falha ao buscar histórico para ${asset.ticker}`);
                        }
                    } else {
                        // "Touch" de monitoramento: renova lastCheckedAt (visita do worker),
                        // NUNCA lastUpdated — renovar lastUpdated sem buscar dados era o que
                        // mascarava a staleness e congelava as séries.
                        touchTickers.push(asset.ticker);
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

                // Renova lastCheckedAt dos ativos frescos em uma única operação por lote.
                // (lastUpdated fica intocado — só muda quando candles são realmente re-buscados.)
                if (touchTickers.length > 0) {
                    await AssetHistory.updateMany(
                        { ticker: { $in: touchTickers } },
                        { $set: { lastCheckedAt: now } }
                    );
                }

                processedCount += batch.length;
                logger.info(`[TimeSeriesWorker] Processando lote... ${processedCount}/${totalAssets} ativos.`);

                // Rate limit protection — só pausa entre lotes que dispararam busca externa no Yahoo.
                // Em runs "quentes" (tudo fresco) não há throttle a aplicar, eliminando o piso ocioso.
                if (batchDidFetch) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
                logger.info(`✅ [TimeSeriesWorker] Atualizados ${operations.length} ativos com métricas temporais.`);

                // Atualiza estatísticas no SystemConfig
                await SystemConfig.findOneAndUpdate(
                    { key: 'MACRO_INDICATORS' },
                    {
                        $set: {
                            lastTimeSeriesStats: {
                                assetsProcessed: operations.length,
                                timestamp: new Date()
                            }
                        }
                    },
                    { upsert: true }
                );
            }

        } catch (error) {
            logger.error(`❌ [TimeSeriesWorker] Erro: ${error.message}`);
        }
    }
};
