
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getB3IndexSeries } from '../services/b3IndexHistoryService.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import AlgorithmPerformance from '../models/AlgorithmPerformance.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import { marketDataService } from '../services/marketDataService.js';
import { loadCdiCurve } from '../utils/cdiCurve.js';
import { isBrBusinessDay } from '../utils/walletSnapshot.js';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARKS: `null` QUANDO NÃO HÁ DADO, NUNCA 0.
//
// Até 22/11/2026 toda falha de benchmark (série vazia, Brapi fora, sem token)
// devolvia 0 e o 0 era gravado no AlgorithmPerformance como retorno medido —
// "IFIX 0,00% no período" é indistinguível de um índice que andou de lado, e o
// alpha saía inflado exatamente quando a régua faltava. Sem dado → null.
// ─────────────────────────────────────────────────────────────────────────────

/** Variação % entre o primeiro ponto ≥ início e o último ≤ fim de uma série ascendente `{date:'YYYY-MM-DD', close, adjClose}`. */
export const seriesReturnBetween = (asc, startDate, endDate) => {
    if (!Array.isArray(asc) || asc.length === 0) return null;
    const s = startDate.toISOString().split('T')[0];
    const e = endDate.toISOString().split('T')[0];
    const sp = asc.find(h => h.date >= s) || asc[0];
    let ep = asc[asc.length - 1];
    for (let i = asc.length - 1; i >= 0; i--) { if (asc[i].date <= e) { ep = asc[i]; break; } }
    const sv = sp.close || sp.adjClose;
    const ev = ep.close || ep.adjClose;
    if (!(sv > 0) || !(ev > 0)) return null;
    return ((ev - sv) / sv) * 100;
};

/**
 * CDI acumulado entre duas datas, composto DIA ÚTIL a dia útil pela taxa
 * vigente em cada dia (curva histórica de utils/cdiCurve.js).
 *
 * Substitui `(1 + cdiDeHoje)^(diasCorridos/252)`, que errava duas vezes: dias
 * CORRIDOS no expoente de base 252 (90 dias viravam 90/252 de ano em vez de
 * ~62/252 — CDI de 90d em 4,68% contra ~3,2% real) e a taxa de HOJE aplicada a
 * todo o período, com 10,65% inventado quando o banco não tinha taxa.
 *
 * Acumula os dias úteis em [início, fim). Fail-closed: curva sem nenhuma linha
 * real, ou dia sem taxa resolvível → null.
 */
export const cdiReturnBetween = (curve, startDate, endDate, isBizDay = isBrBusinessDay) => {
    if (!curve || !(curve.size > 0)) return null;
    const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    let factor = 1;
    while (cursor < end) {
        const dayKey = cursor.toISOString().slice(0, 10);
        if (isBizDay(dayKey)) {
            const annual = curve.annualRateFor(dayKey);
            if (!Number.isFinite(annual) || annual <= 0) return null;
            factor *= Math.pow(1 + annual / 100, 1 / 252);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return (factor - 1) * 100;
};

const BENCH_PROJECTION = { lastUpdated: 1, 'history.date': 1, 'history.close': 1, 'history.adjClose': 1 };
const BENCH_CACHE_HOURS = 12;

/**
 * Contexto de UM run do backtest: cada dado caro é lido uma vez e compartilhado
 * pelas 16 avaliações (4 classes × 4 janelas). Antes, cada relatório relia a
 * série inteira do benchmark três vezes (documentos Mongoose, não lean) e
 * baixava a série de 5 anos do IFIX da Brapi de novo — 12 downloads por run.
 */
export const createBacktestContext = () => {
    const memo = new Map();
    const once = (key, fn) => {
        if (!memo.has(key)) memo.set(key, fn().catch((err) => {
            logger.warn(`⚠️ [Backtest] ${key} indisponível: ${err.message}`);
            return null;
        }));
        return memo.get(key);
    };

    // Série ascendente do índice. Lê lean e só com os campos usados; se o cache
    // estiver vazio ou velho (>12h), delega UMA vez ao getBenchmarkHistory, que
    // sabe atualizar pelo Yahoo.
    const benchmarkSeries = (ticker) => once(`bench:${ticker}`, async () => {
        const doc = await AssetHistory.findOne({ ticker }, BENCH_PROJECTION).lean();
        const fresh = doc?.history?.length > 0 && doc.lastUpdated
            && Date.now() - new Date(doc.lastUpdated).getTime() < BENCH_CACHE_HOURS * 3600 * 1000;
        const history = fresh ? doc.history : await marketDataService.getBenchmarkHistory(ticker);
        const asc = (history || [])
            .map(h => ({ date: h.date, close: h.close, adjClose: h.adjClose }))
            .filter(h => typeof h.date === 'string')
            .sort((a, b) => a.date.localeCompare(b.date));
        return asc.length > 0 ? asc : null;
    });

    // IFIX direto da B3 (o Yahoo não tem o índice; a brapi grátis recusa range
    // de 5 anos com 400, e o IFIX saía nulo de todo backtest). Série ascendente
    // `{ date, close }`, no mesmo formato das outras.
    const ifixSeries = () => once('ifix', async () => {
        const desde = new Date();
        desde.setUTCFullYear(desde.getUTCFullYear() - 5);
        return getB3IndexSeries('IFIX', desde.toISOString().slice(0, 10));
    });

    const cdiCurve = () => once('cdi', async () => {
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).select('cdi').lean();
        const currentRate = config?.cdi > 0 ? config.cdi : undefined;
        // Seis anos cobrem a janela máxima (90d) com folga e os relatórios antigos.
        const since = new Date(Date.now() - 6 * 365 * 24 * 3600 * 1000);
        const curve = await loadCdiCurve({ since, currentRate });
        // Sem taxa corrente, os dias depois da última linha cairiam no default
        // de 10% da curva — número nosso. Sem as duas pontas, não há CDI.
        return curve.size > 0 && currentRate ? curve : null;
    });

    return { benchmarkSeries, ifixSeries, cdiCurve };
};

/** Último preço de cada ticker numa consulta só (antes: uma por pick, em série). */
const loadLastPrices = async (tickers) => {
    if (tickers.length === 0) return new Map();
    const rows = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice').lean();
    return new Map(rows.filter(r => r.lastPrice > 0).map(r => [r.ticker, r.lastPrice]));
};

const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : 'n/d');

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

const evaluatePeriod = async (days, assetClass, ctx) => {
    const now = new Date();
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - days);

    // Busca o ranking PUBLICADO salvo há ~days dias com pelo menos Top 5.
    // isRankingPublished:true garante que a auditoria reflita só o que o usuário
    // viu na Research — rascunhos do pipeline (não publicados) não entram na conta.
    // Projeção de inclusão + lean: o documento traz `content.fullAuditLog` e um
    // `auditLog[]` por item, e daqui só saem ticker/score/preço de entrada.
    const report = await MarketAnalysis.findOne({
        assetClass,
        isRankingPublished: true,
        date: { $lte: targetDate },
        'content.ranking.4': { $exists: true }
    })
        .sort({ date: -1 })
        .select('date assetClass strategy content.ranking.ticker content.ranking.score content.ranking.currentPrice')
        .lean();

    if (!report) {
        logger.debug(`⚠️  [${days}d] Sem histórico publicado suficiente para ${assetClass}.`);
        return null;
    }

    return processReport(report, days, now, ctx);
};

const processReport = async (report, daysAgo, now = new Date(), ctx = createBacktestContext()) => {
    const topPicks = [...(report.content?.ranking || [])]
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    if (topPicks.length === 0) return null;

    const reportDate = new Date(report.date);
    const isUSClass = report.assetClass === 'STOCK_US';
    const benchmarkLabel = isUSClass ? 'SPX' : 'IBOV';

    // Séries do run (lidas uma vez, compartilhadas entre relatórios).
    const [ibovAsc, spxAsc, cdiCurve, ifixAsc] = await Promise.all([
        ctx.benchmarkSeries('^BVSP'),
        ctx.benchmarkSeries('^GSPC'),
        ctx.cdiCurve(),
        isUSClass ? Promise.resolve(null) : ctx.ifixSeries(),
    ]);

    // Contexto da janela cheia (relatório → hoje), guardado para referência no doc.
    const ibovReturn = seriesReturnBetween(ibovAsc, reportDate, now);
    const spxReturn = seriesReturnBetween(spxAsc, reportDate, now);
    const cdiReturn = cdiReturnBetween(cdiCurve, reportDate, now);
    const ifixReturn = isUSClass ? null : seriesReturnBetween(ifixAsc, reportDate, now);
    const windowBenchmark = isUSClass ? spxReturn : ibovReturn;

    logger.debug(`   📅 [${daysAgo}d/${report.assetClass}] ${benchmarkLabel}: ${fmtPct(windowBenchmark)}  CDI: ${fmtPct(cdiReturn)}`);

    // Benchmark casado com o período em que cada pick esteve em carteira.
    const benchAsc = isUSClass ? spxAsc : ibovAsc;

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

    // Resolve a permanência de todos os picks primeiro e busca o preço de hoje
    // dos que seguem publicados numa consulta só (antes: uma por pick, em série).
    const holdings = topPicks
        .filter(pick => pick.currentPrice)
        .map(pick => ({ pick, ...resolveHolding(pick.currentPrice, pick.ticker, laterBaskets) }));
    const lastPrices = await loadLastPrices(holdings.filter(h => !h.exited).map(h => h.pick.ticker));

    let totalReturn = 0;
    let totalBenchmark = 0;
    let benchmarkCount = 0;
    let hits = 0;
    const snapshot = [];
    let deviationAlert = false;

    for (const { pick, exited, exitPrice: heldExitPrice, exitDate } of holdings) {
        const entryPrice = pick.currentPrice;
        let exitPrice = heldExitPrice;
        let effectiveExitDate = exitDate;
        if (!exited) {
            // Ainda no ranking publicado mais recente → marca a preço de hoje.
            const price = lastPrices.get(pick.ticker);
            if (!price) continue;
            exitPrice = price;
            effectiveExitDate = now;
        }

        const returnPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
        // Benchmark casado com o período REAL de permanência do pick (entrada → saída),
        // não com a janela cheia — alpha justo agora que os picks saem em datas diferentes.
        const pickBenchmark = seriesReturnBetween(benchAsc, reportDate, effectiveExitDate);

        totalReturn += returnPercent;
        if (Number.isFinite(pickBenchmark)) { totalBenchmark += pickBenchmark; benchmarkCount++; }
        if (returnPercent > 0) hits++;
        if (returnPercent < -15) {
            deviationAlert = true;
            const ctxLabel = exited ? 'enquanto publicado' : `período de ${daysAgo}d`;
            logger.warn(`🚨 [Backtest] ALERTA: ${pick.ticker} (${report.assetClass}) caiu ${returnPercent.toFixed(2)}% (${ctxLabel})`);
        }
        snapshot.push({ ticker: pick.ticker, startPrice: entryPrice, currentPrice: exitPrice, returnPercent, exited, benchmarkReturn: pickBenchmark });
    }

    if (snapshot.length === 0) return null;

    const avgReturn = totalReturn / snapshot.length;
    // Benchmark só existe se TODO pick teve a sua régua: média sobre um
    // subconjunto compararia o retorno de dez picks com o índice de sete.
    const avgBenchmark = benchmarkCount === snapshot.length ? totalBenchmark / benchmarkCount : null;
    const alpha = avgBenchmark !== null ? avgReturn - avgBenchmark : null;
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

    logger.debug(`   [${daysAgo}d/${report.assetClass}] Perf: ${fmtPct(avgReturn)} | Alpha vs ${benchmarkLabel} (por holding): ${fmtPct(alpha)}`);

    return { avgReturn, alpha, hitRate, daysAgo };
};

// Exportada — usada pelo syncProdData (DB já conectado)
export const runBacktestAnalysis = async () => {
    const periods = [7, 30, 60, 90];
    const classes = ['STOCK', 'FII', 'BRASIL_10', 'STOCK_US'];
    // Um contexto por run: séries de benchmark, curva do CDI e IFIX lidos uma vez.
    const ctx = createBacktestContext();

    for (const assetClass of classes) {
        const results = await Promise.all(periods.map(d => evaluatePeriod(d, assetClass, ctx)));
        const parts = results
            .filter(Boolean)
            .map(r => `${r.daysAgo}d: ${fmtPct(r.avgReturn)} (α ${fmtPct(r.alpha)})`);
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
