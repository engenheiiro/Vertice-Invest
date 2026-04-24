
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import MarketAnalysis from '../models/MarketAnalysis.js';
import AlgorithmPerformance from '../models/AlgorithmPerformance.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Retorno via histórico Yahoo Finance (AssetHistory cache no MongoDB)
const getBenchmarkReturn = async (ticker, startDate, endDate) => {
    try {
        const history = await marketDataService.getBenchmarkHistory(ticker);
        if (!history || history.length === 0) return 0;

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
        const startPoint = sorted.find(h => h.date >= startStr) || sorted[0];
        const endPoint = [...sorted].reverse().find(h => h.date <= endStr) || sorted[sorted.length - 1];

        if (!startPoint || !endPoint) return 0;
        const startVal = startPoint.close || startPoint.adjClose;
        const endVal = endPoint.close || endPoint.adjClose;
        if (!startVal || startVal === 0) return 0;

        return ((endVal - startVal) / startVal) * 100;
    } catch {
        return 0;
    }
};

// CDI estimado com base na taxa SELIC/CDI anual do SystemConfig (252 dias úteis/ano)
const getCDIReturn = async (days) => {
    try {
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const annualCDI = config?.cdi || 10.65;
        return (Math.pow(1 + annualCDI / 100, days / 252) - 1) * 100;
    } catch {
        return 0;
    }
};

// IFIX via Brapi (Yahoo Finance não tem o índice IFIX)
const getIFIXReturn = async (startDate, endDate) => {
    try {
        const token = process.env.BRAPI_TOKEN;
        if (!token) return 0;

        const url = `https://brapi.dev/api/quote/IFIX?range=5y&interval=1d&token=${token}`;
        const response = await axios.get(url, { timeout: 10000 });
        const history = response.data?.results?.[0]?.historicalDataPrice;
        if (!history || history.length === 0) return 0;

        // Brapi retorna timestamps em segundos
        const startMs = startDate.getTime();
        const endMs = endDate.getTime();

        const sorted = [...history]
            .filter(h => h.close > 0)
            .sort((a, b) => a.date - b.date);

        const startEntry = sorted.find(h => h.date * 1000 >= startMs) || sorted[0];
        const endEntry = [...sorted].reverse().find(h => h.date * 1000 <= endMs) || sorted[sorted.length - 1];

        if (!startEntry?.close || !endEntry?.close || startEntry.close === 0) return 0;
        return ((endEntry.close - startEntry.close) / startEntry.close) * 100;
    } catch {
        return 0;
    }
};

const evaluatePeriod = async (days, assetClass) => {
    const now = new Date();
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - days);

    // Busca o MarketAnalysis salvo há ~days dias com pelo menos Top 5
    const report = await MarketAnalysis.findOne({
        assetClass,
        date: { $lte: targetDate },
        'content.ranking.4': { $exists: true }
    }).sort({ date: -1 });

    if (!report) {
        logger.debug(`⚠️  [${days}d] Sem histórico suficiente para ${assetClass}.`);
        return null;
    }

    return processReport(report, days, now);
};

const processReport = async (report, daysAgo, now = new Date()) => {
    const topPicks = report.content.ranking
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    if (topPicks.length === 0) return null;

    const reportDate = new Date(report.date);
    const isUSClass = report.assetClass === 'STOCK_US';

    const [ibovReturn, spxReturn, cdiReturn, ifixReturn] = await Promise.all([
        getBenchmarkReturn('^BVSP', reportDate, now),
        getBenchmarkReturn('^GSPC', reportDate, now),
        getCDIReturn(daysAgo),
        isUSClass ? Promise.resolve(0) : getIFIXReturn(reportDate, now),
    ]);

    const primaryBenchmark = isUSClass ? spxReturn : ibovReturn;
    const benchmarkLabel = isUSClass ? 'SPX' : 'IBOV';

    logger.debug(`   📅 [${daysAgo}d/${report.assetClass}] ${benchmarkLabel}: ${primaryBenchmark >= 0 ? '+' : ''}${primaryBenchmark.toFixed(2)}%  CDI: +${cdiReturn.toFixed(2)}%`);

    let totalReturn = 0;
    let hits = 0;
    const snapshot = [];
    let deviationAlert = false;

    for (const pick of topPicks) {
        const entryPrice = pick.currentPrice;
        const currentData = await marketDataService.getMarketDataByTicker(pick.ticker);
        const currentPrice = currentData?.price;

        if (!currentPrice || !entryPrice) continue;

        const returnPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
        totalReturn += returnPercent;
        if (returnPercent > 0) hits++;
        if (returnPercent < -15) {
            deviationAlert = true;
            logger.warn(`🚨 [Backtest] ALERTA: ${pick.ticker} (${report.assetClass}) caiu ${returnPercent.toFixed(2)}% no período de ${daysAgo}d`);
        }
        snapshot.push({ ticker: pick.ticker, startPrice: entryPrice, currentPrice, returnPercent });
    }

    if (snapshot.length === 0) return null;

    const avgReturn = totalReturn / snapshot.length;
    const alpha = avgReturn - primaryBenchmark;
    const hitRate = (hits / snapshot.length) * 100;

    await AlgorithmPerformance.create({
        date: now,
        assetClass: report.assetClass,
        lookbackWindow: daysAgo,
        avgReturn,
        benchmarkReturn: primaryBenchmark,
        ibovReturn,
        spxReturn,
        cdiReturn,
        ifixReturn,
        alpha,
        topPicksSnapshot: snapshot,
        hitRate,
        deviationAlert
    });

    logger.debug(`   [${daysAgo}d/${report.assetClass}] Perf: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}% | Alpha vs ${benchmarkLabel}: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`);

    return { avgReturn, alpha, hitRate, daysAgo };
};

// Exportada — usada pelo syncProdData (DB já conectado)
export const runBacktestAnalysis = async () => {
    const periods = [7, 30, 60, 90];
    const classes = ['STOCK', 'FII', 'BRASIL_10', 'STOCK_US'];

    for (const assetClass of classes) {
        const results = await Promise.all(periods.map(d => evaluatePeriod(d, assetClass)));
        const parts = results
            .filter(Boolean)
            .map(r => `${r.daysAgo}d: ${r.avgReturn >= 0 ? '+' : ''}${r.avgReturn.toFixed(1)}% (α${r.alpha >= 0 ? '+' : ''}${r.alpha.toFixed(1)}%)`);
        if (parts.length > 0) {
            logger.info(`📊 [Audit] ${assetClass} | ${parts.join(' | ')}`);
        }
    }
};

// CLI — conecta DB e sai ao terminar
const runBacktest = async () => {
    try {
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI ausente.");
        await mongoose.connect(process.env.MONGO_URI);
        await runBacktestAnalysis();
        process.exit(0);
    } catch (error) {
        console.error(`${COLORS.red}❌ Erro Fatal: ${error.message}${COLORS.reset}`);
        process.exit(1);
    }
};

const isRunDirectly = process.argv[1] === __filename;
if (isRunDirectly) runBacktest();
