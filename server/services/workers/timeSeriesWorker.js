import logger from '../../config/logger.js';
import MarketAsset from '../../models/MarketAsset.js';
import AssetHistory from '../../models/AssetHistory.js';
import { marketDataService } from '../marketDataService.js';
import { externalMarketService } from '../externalMarketService.js';

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
    if (prices.length < 2) return 0;
    const returns = [];
    for (let i = 0; i < prices.length - 1; i++) {
        returns.push((prices[i] - prices[i + 1]) / prices[i + 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    return stdDev * Math.sqrt(252) * 100; // Anualizada em %
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

            // Puxa o histórico do IBOV para calcular o Beta das ações/FIIs
            const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP');
            let ibovReturns = [];
            if (ibovHistory && ibovHistory.length > 1) {
                for (let i = 0; i < ibovHistory.length - 1; i++) {
                    ibovReturns.push((ibovHistory[i].close - ibovHistory[i + 1].close) / ibovHistory[i + 1].close);
                }
            }

            const operations = [];
            let processedCount = 0;
            const totalAssets = assets.length;
            const BATCH_SIZE = 5;

            for (let i = 0; i < totalAssets; i += BATCH_SIZE) {
                const batch = assets.slice(i, i + BATCH_SIZE);
                
                await Promise.all(batch.map(async (asset) => {
                    let historyEntry = await AssetHistory.findOne({ ticker: asset.ticker });
                    
                    // Se não tem histórico ou está desatualizado (> 7 dias), tenta buscar
                    const now = new Date();
                    const isStale = historyEntry && (now - new Date(historyEntry.lastUpdated)) > 7 * 24 * 60 * 60 * 1000;
                    
                    if (!historyEntry || isStale || !historyEntry.history || historyEntry.history.length < 20) {
                        try {
                            const externalHistory = await externalMarketService.getFullHistory(asset.ticker, asset.type);
                            if (externalHistory && externalHistory.length > 0) {
                                if (historyEntry) {
                                    historyEntry.history = externalHistory;
                                    historyEntry.lastUpdated = now;
                                    await historyEntry.save();
                                } else {
                                    historyEntry = await AssetHistory.create({
                                        ticker: asset.ticker,
                                        history: externalHistory,
                                        lastUpdated: now
                                    });
                                }
                            }
                        } catch (e) {
                            logger.warn(`[TimeSeriesWorker] Falha ao buscar histórico para ${asset.ticker}`);
                        }
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

                    let beta = 1;
                    if ((asset.type === 'STOCK' || asset.type === 'FII') && ibovReturns.length > 0) {
                        const assetReturns = [];
                        for (let j = 0; j < volatilityPrices.length - 1; j++) {
                            assetReturns.push((volatilityPrices[j] - volatilityPrices[j + 1]) / volatilityPrices[j + 1]);
                        }
                        beta = calculateBeta(assetReturns, ibovReturns);
                    }

                    operations.push({
                        updateOne: {
                            filter: { ticker: asset.ticker },
                            update: {
                                $set: {
                                    volatility: isNaN(volatility) ? 0 : volatility,
                                    beta: isNaN(beta) ? 1 : beta,
                                    sma200: isNaN(sma200) ? 0 : sma200,
                                    ema50: isNaN(ema50) ? 0 : ema50
                                }
                            }
                        }
                    });
                }));

                processedCount += batch.length;
                logger.info(`[TimeSeriesWorker] Processando lote... ${processedCount}/${totalAssets} ativos.`);
                
                // Rate limit protection entre lotes
                await new Promise(r => setTimeout(r, 1000));
            }

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
                logger.info(`✅ [TimeSeriesWorker] Atualizados ${operations.length} ativos com métricas temporais.`);
            }

        } catch (error) {
            logger.error(`❌ [TimeSeriesWorker] Erro: ${error.message}`);
        }
    }
};
