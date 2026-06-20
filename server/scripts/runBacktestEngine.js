
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

// Regra "enquanto publicado" (pura, testável): caminha pelos rankings publicados
// SEGUINTES (em ordem cronológica) e rola o último preço enquanto o ticker aparecer.
// Ao ser omitido por um ranking mais novo, o pick é considerado rotacionado para fora
// (exited) naquele último preço. Se nunca sair, retorna exited=false e o caller marca
// a preço de hoje, na DATA do ranking que o omitiu (usada para casar o benchmark
// com o período em que o pick realmente esteve em carteira).
// @param {Array<{date:Date|string, ranking:Array<{ticker:string,currentPrice:number}>}>} laterBaskets
export const resolveHolding = (entryPrice, ticker, laterBaskets) => {
    let lastSeenPrice = entryPrice;
    for (const basket of laterBaskets) {
        const found = (basket.ranking || []).find(r => r.ticker === ticker);
        if (found && found.currentPrice > 0) {
            lastSeenPrice = found.currentPrice;
        } else {
            return { exited: true, exitPrice: lastSeenPrice, exitDate: new Date(basket.date) };
        }
    }
    return { exited: false, exitPrice: null, exitDate: null };
};

const evaluatePeriod = async (days, assetClass) => {
    const now = new Date();
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - days);

    // Busca o ranking PUBLICADO salvo há ~days dias com pelo menos Top 5.
    // isRankingPublished:true garante que a auditoria reflita só o que o usuário
    // viu na Research — rascunhos do pipeline (não publicados) não entram na conta.
    const report = await MarketAnalysis.findOne({
        assetClass,
        isRankingPublished: true,
        date: { $lte: targetDate },
        'content.ranking.4': { $exists: true }
    }).sort({ date: -1 });

    if (!report) {
        logger.debug(`⚠️  [${days}d] Sem histórico publicado suficiente para ${assetClass}.`);
        return null;
    }

    return processReport(report, days, now);
};

const processReport = async (report, daysAgo, now = new Date()) => {
    const topPicks = report.content.ranking
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    if (topPicks.length === 0) return null;

    const reportDate = new Date(report.date);
    const isUSClass = report.assetClass === 'STOCK_US';
    const benchmarkLabel = isUSClass ? 'SPX' : 'IBOV';
    const benchmarkTicker = isUSClass ? '^GSPC' : '^BVSP';

    // Contexto da janela cheia (relatório → hoje), guardado para referência no doc.
    const [ibovReturn, spxReturn, cdiReturn, ifixReturn] = await Promise.all([
        getBenchmarkReturn('^BVSP', reportDate, now),
        getBenchmarkReturn('^GSPC', reportDate, now),
        getCDIReturn(daysAgo),
        isUSClass ? Promise.resolve(0) : getIFIXReturn(reportDate, now),
    ]);
    const windowBenchmark = isUSClass ? spxReturn : ibovReturn;

    logger.debug(`   📅 [${daysAgo}d/${report.assetClass}] ${benchmarkLabel}: ${windowBenchmark >= 0 ? '+' : ''}${windowBenchmark.toFixed(2)}%  CDI: +${cdiReturn.toFixed(2)}%`);

    // Pré-carrega a série do benchmark UMA vez para medir o retorno do índice no
    // MESMO período em que cada pick esteve em carteira (benchmark por holding).
    const benchHist = await marketDataService.getBenchmarkHistory(benchmarkTicker);
    const benchAsc = (benchHist && benchHist.length)
        ? [...benchHist].sort((a, b) => a.date.localeCompare(b.date)) : [];
    const benchReturnBetween = (startDate, endDate) => {
        if (benchAsc.length === 0) return 0;
        const s = startDate.toISOString().split('T')[0];
        const e = endDate.toISOString().split('T')[0];
        const sp = benchAsc.find(h => h.date >= s) || benchAsc[0];
        let ep = benchAsc[benchAsc.length - 1];
        for (let i = benchAsc.length - 1; i >= 0; i--) { if (benchAsc[i].date <= e) { ep = benchAsc[i]; break; } }
        const sv = sp.close || sp.adjClose;
        const ev = ep.close || ep.adjClose;
        return sv ? ((ev - sv) / sv) * 100 : 0;
    };

    // Rankings PUBLICADOS posteriores a este (mesma classe/estratégia), em ordem
    // cronológica. Usados para medir o retorno só ENQUANTO o ativo permaneceu no
    // ranking publicado: ao ser omitido por um ranking mais novo, considera-se que
    // o usuário rotacionou para fora (mark-to-market no último preço em que esteve),
    // em vez de um buy-and-hold cego que imputaria quedas pós-saída ao algoritmo.
    const laterReports = await MarketAnalysis.find({
        assetClass: report.assetClass,
        strategy: report.strategy,
        isRankingPublished: true,
        date: { $gt: reportDate }
    })
        .sort({ date: 1 })
        .select('date content.ranking.ticker content.ranking.currentPrice')
        .lean();
    const laterBaskets = laterReports.map(r => ({ date: r.date, ranking: r.content?.ranking || [] }));

    let totalReturn = 0;
    let totalBenchmark = 0;
    let hits = 0;
    const snapshot = [];
    let deviationAlert = false;

    for (const pick of topPicks) {
        const entryPrice = pick.currentPrice;
        if (!entryPrice) continue;

        const { exited, exitPrice: heldExitPrice, exitDate } = resolveHolding(entryPrice, pick.ticker, laterBaskets);

        let exitPrice = heldExitPrice;
        let effectiveExitDate = exitDate;
        if (!exited) {
            // Ainda no ranking publicado mais recente → marca a preço de hoje.
            const currentData = await marketDataService.getMarketDataByTicker(pick.ticker);
            if (!currentData?.price) continue;
            exitPrice = currentData.price;
            effectiveExitDate = now;
        }

        const returnPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
        // Benchmark casado com o período REAL de permanência do pick (entrada → saída),
        // não com a janela cheia — alpha justo agora que os picks saem em datas diferentes.
        const pickBenchmark = benchReturnBetween(reportDate, effectiveExitDate);

        totalReturn += returnPercent;
        totalBenchmark += pickBenchmark;
        if (returnPercent > 0) hits++;
        if (returnPercent < -15) {
            deviationAlert = true;
            const ctx = exited ? 'enquanto publicado' : `período de ${daysAgo}d`;
            logger.warn(`🚨 [Backtest] ALERTA: ${pick.ticker} (${report.assetClass}) caiu ${returnPercent.toFixed(2)}% (${ctx})`);
        }
        snapshot.push({ ticker: pick.ticker, startPrice: entryPrice, currentPrice: exitPrice, returnPercent, exited, benchmarkReturn: pickBenchmark });
    }

    if (snapshot.length === 0) return null;

    const avgReturn = totalReturn / snapshot.length;
    const avgBenchmark = totalBenchmark / snapshot.length; // média do benchmark por holding
    const alpha = avgReturn - avgBenchmark;
    const hitRate = (hits / snapshot.length) * 100;

    await AlgorithmPerformance.create({
        date: now,
        assetClass: report.assetClass,
        lookbackWindow: daysAgo,
        avgReturn,
        benchmarkReturn: avgBenchmark, // benchmark casado por holding (base do alpha)
        ibovReturn,
        spxReturn,
        cdiReturn,
        ifixReturn,
        alpha,
        topPicksSnapshot: snapshot,
        hitRate,
        deviationAlert
    });

    logger.debug(`   [${daysAgo}d/${report.assetClass}] Perf: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}% | Alpha vs ${benchmarkLabel} (por holding): ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`);

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
        console.error(`❌ Erro Fatal: ${error.message}`);
        process.exit(1);
    }
};

const isRunDirectly = process.argv[1] === __filename;
if (isRunDirectly) runBacktest();
