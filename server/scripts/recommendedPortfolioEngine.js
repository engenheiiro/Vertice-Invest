
/**
 * Carteira Recomendada — backtest event-driven de UMA carteira contínua que segue
 * as recomendações da Research, rebalanceando a cada publicação (entradas/saídas).
 *
 * Produz uma curva de equity REAL (base 100) + benchmarks (IBOV/SPX/CDI/IFIX) medidos
 * a partir da MESMA data-base, persistida em RecommendedPortfolioCurve.
 *
 * Diferente do antigo runBacktestEngine (fotos independentes coladas), aqui há um
 * patrimônio único que evolui dia a dia com turnover puro (sem injeção de caixa).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

import MarketAnalysis from '../models/MarketAnalysis.js';
import RecommendedPortfolioCurve from '../models/RecommendedPortfolioCurve.js';
import EconomicIndex from '../models/EconomicIndex.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MS_DAY = 86400000;
const WINDOW_DAYS = 180;          // horizonte máximo da curva
const DEFAULT_CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'STOCK_US'];
const DEFAULT_PROFILE = 'MODERATE';

const toKey = (d) => financialService.toDateKey(d);

// ── Seleção da cesta recomendada de um relatório ─────────────────────────────
// BRASIL_10 já é uma carteira curada (top 5 ações + top 5 FIIs) → usa todos não-SELL.
// Demais classes: BUY do perfil; fallback BUY de qualquer perfil; fallback top-score.
const selectBasket = (report, profile) => {
    const ranking = report.content?.ranking || [];
    if (!ranking.length) return [];

    let picks;
    if (report.assetClass === 'BRASIL_10') {
        picks = ranking.filter(r => r.action !== 'SELL');
    } else {
        picks = ranking.filter(r => r.action === 'BUY' && r.riskProfile === profile);
        if (picks.length < 3) picks = ranking.filter(r => r.action === 'BUY');
        if (picks.length === 0) picks = [...ranking].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
    }

    // dedupe por ticker, máx 10 nomes
    const seen = new Set();
    const out = [];
    for (const p of picks) {
        const t = (p.ticker || '').toUpperCase();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push({ ticker: t, type: p.type || 'STOCK' });
        if (out.length >= 10) break;
    }
    return out;
};

// ── Carregadores de série (reusam AssetHistory via marketDataService) ─────────
const loadPriceMap = async (ticker) => {
    const norm = financialService.normalizeTickerForHistory(ticker);
    const history = await marketDataService.getBenchmarkHistory(norm);
    if (!history || history.length < 2) return null;
    return financialService.indexHistoryByDate(history);
};

const loadIfixMap = async () => {
    try {
        const token = process.env.BRAPI_TOKEN;
        if (!token) return null;
        const url = `https://brapi.dev/api/quote/IFIX?range=1y&interval=1d&token=${token}`;
        const resp = await axios.get(url, { timeout: 10000 });
        const hist = resp.data?.results?.[0]?.historicalDataPrice;
        if (!hist || !hist.length) return null;
        const map = new Map();
        for (const h of hist) {
            if (h.close > 0) {
                const key = new Date(h.date * 1000).toISOString().split('T')[0];
                map.set(key, { close: h.close, adjClose: h.close });
            }
        }
        return map;
    } catch {
        return null;
    }
};

// CDI: accumulatedFactor é o fator DIÁRIO (1 + taxa do dia), 1 por dia útil.
// Construímos o produto acumulado por data (running product) e, no loop diário,
// carregamos o último acumulado conhecido — CDI não rende em dias sem pregão.
const loadCdiCumulative = async (baseDate) => {
    const docs = await EconomicIndex.find({ series: 'SELIC', date: { $gte: baseDate } })
        .sort({ date: 1 }).lean();
    let acc = 1;
    return docs.map(d => {
        acc *= (d.accumulatedFactor || 1);
        return { key: toKey(d.date), cum: acc };
    });
};

// ── Construção da curva de uma classe ────────────────────────────────────────
const buildCurveForClass = async (assetClass, profile) => {
    const windowStart = new Date(Date.now() - WINDOW_DAYS * MS_DAY);

    const reports = await MarketAnalysis.find({
        assetClass,
        isRankingPublished: true,
        date: { $gte: windowStart },
    }).sort({ date: 1 }).lean();

    if (!reports.length) {
        logger.debug(`⚠️  [Carteira] Sem relatórios publicados para ${assetClass}.`);
        return null;
    }

    // Eventos de rebalance: 1 por dia (último relatório do dia vence).
    const basketByDay = new Map();
    for (const r of reports) {
        const basket = selectBasket(r, profile);
        if (basket.length) basketByDay.set(toKey(r.date), basket);
    }
    const rebalances = [...basketByDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, holdings]) => ({ date, holdings }));

    if (!rebalances.length) {
        logger.debug(`⚠️  [Carteira] Nenhuma cesta válida para ${assetClass}.`);
        return null;
    }

    // added/removed para o histórico de rebalances
    let prevSet = new Set();
    for (const reb of rebalances) {
        const set = new Set(reb.holdings.map(h => h.ticker));
        reb.added = [...set].filter(t => !prevSet.has(t));
        reb.removed = [...prevSet].filter(t => !set.has(t));
        prevSet = set;
    }

    const baseKey = rebalances[0].date;
    const baseDate = new Date(baseKey);
    const todayKey = toKey(new Date());

    // Pré-carrega séries de preço de todos os tickers que já apareceram em alguma cesta.
    const allTickers = [...new Set(rebalances.flatMap(r => r.holdings.map(h => h.ticker)))];
    const priceMaps = new Map();
    await Promise.all(allTickers.map(async (t) => {
        const m = await loadPriceMap(t);
        if (m) priceMaps.set(t, m);
    }));

    // Benchmarks
    const isUS = assetClass === 'STOCK_US';
    const [ibovMap, spxMap, ifixMap] = await Promise.all([
        loadPriceMap('^BVSP'),
        loadPriceMap('^GSPC'),
        isUS ? Promise.resolve(null) : loadIfixMap(),
    ]);
    const cdiCum = await loadCdiCumulative(baseDate);
    const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const annualCdi = sysConfig?.cdi || 10.65;

    // Helpers de valuation
    const lastKnown = new Map();
    const priceOf = (ticker, dayKey) => {
        const m = priceMaps.get(ticker);
        const pd = m ? financialService.findPriceInMap(m, dayKey) : null;
        if (pd && pd.close > 0) { lastKnown.set(ticker, pd.close); return pd.close; }
        return lastKnown.get(ticker) || 0;
    };

    const benchBase = (map) => (map ? financialService.findPriceInMap(map, baseKey).close : 0);
    const ibovBase = benchBase(ibovMap);
    const spxBase = benchBase(spxMap);
    const ifixBase = benchBase(ifixMap);
    const benchReturn = (map, base, dayKey) => {
        if (!map || !base) return 0;
        const day = financialService.findPriceInMap(map, dayKey).close;
        return day > 0 ? day / base - 1 : 0;
    };

    // Estado da carteira (base 100, turnover puro)
    let value = 100;
    let units = new Map();
    let rebIdx = 0;
    let cdiPtr = 0;        // ponteiro no array cumulativo de CDI
    let activeRebalanceDate = null;
    // Fallback (sem dados de CDI no banco): estimativa flat por dias corridos.
    const baseMs = baseDate.getTime();
    const cdiReturnAt = (dayKey, dayMs) => {
        if (cdiCum.length) {
            while (cdiPtr + 1 < cdiCum.length && cdiCum[cdiPtr + 1].key <= dayKey) cdiPtr++;
            return cdiCum[cdiPtr].key <= dayKey ? cdiCum[cdiPtr].cum - 1 : 0;
        }
        const elapsed = Math.max(0, (dayMs - baseMs) / MS_DAY);
        return Math.pow(1 + annualCdi / 100, elapsed / 365) - 1;
    };

    const computeValue = (dayKey) => {
        let v = 0;
        for (const [t, u] of units) v += u * priceOf(t, dayKey);
        return v;
    };
    const rebalanceTo = (holdings, dayKey) => {
        const valid = holdings.filter(h => priceOf(h.ticker, dayKey) > 0);
        const n = valid.length || 1;
        const per = value / n;
        units = new Map();
        valid.forEach(h => units.set(h.ticker, per / priceOf(h.ticker, dayKey)));
        activeRebalanceDate = dayKey;
    };

    const points = [];
    // Iteração em UTC (passo de 1 dia em ms) — evita off-by-one de timezone.
    for (let dayMs = baseMs; ; dayMs += MS_DAY) {
        const dayKey = new Date(dayMs).toISOString().slice(0, 10);
        if (dayKey > todayKey) break;

        // Aplica rebalances cuja data já chegou (valoriza ANTES de trocar → turnover)
        while (rebIdx < rebalances.length && rebalances[rebIdx].date <= dayKey) {
            if (units.size > 0) value = computeValue(dayKey);
            rebalanceTo(rebalances[rebIdx].holdings, dayKey);
            rebIdx++;
        }

        if (units.size > 0) value = computeValue(dayKey);

        points.push({
            date: dayKey,
            equityReturn: value / 100 - 1,
            ibovReturn: benchReturn(ibovMap, ibovBase, dayKey),
            spxReturn: benchReturn(spxMap, spxBase, dayKey),
            cdiReturn: cdiReturnAt(dayKey, dayMs),
            ifixReturn: benchReturn(ifixMap, ifixBase, dayKey),
            holdingsCount: units.size,
            lastRebalanceDate: activeRebalanceDate,
        });
    }

    await RecommendedPortfolioCurve.updateOne(
        { assetClass, profile },
        {
            $set: {
                assetClass,
                profile,
                base: baseDate,
                lastRebuild: new Date(),
                points,
                rebalances: rebalances.map(r => ({
                    date: r.date,
                    holdings: r.holdings.map(h => h.ticker),
                    added: r.added,
                    removed: r.removed,
                })),
            },
        },
        { upsert: true }
    );

    const last = points[points.length - 1];
    logger.info(`📈 [Carteira ${assetClass}/${profile}] ${points.length}d | base ${baseKey} | equity ${(last.equityReturn * 100).toFixed(2)}% vs IBOV ${(last.ibovReturn * 100).toFixed(2)}% · CDI ${(last.cdiReturn * 100).toFixed(2)}% | ${rebalances.length} rebalances`);
    return last;
};

// Exportada — usada pelo scheduler (DB já conectado)
export const buildRecommendedPortfolioCurves = async (options = {}) => {
    const classes = options.classes || DEFAULT_CLASSES;
    const profile = options.profile || DEFAULT_PROFILE;
    for (const assetClass of classes) {
        try {
            await buildCurveForClass(assetClass, profile);
        } catch (e) {
            logger.warn(`⚠️ [Carteira] Falha em ${assetClass}: ${e.message}`);
        }
    }
};

// CLI — conecta DB e sai ao terminar
const runCli = async () => {
    try {
        if (!process.env.MONGO_URI) throw new Error('MONGO_URI ausente.');
        await mongoose.connect(process.env.MONGO_URI);
        await buildRecommendedPortfolioCurves();
        process.exit(0);
    } catch (error) {
        console.error(`❌ Erro Fatal: ${error.message}`);
        process.exit(1);
    }
};

const isRunDirectly = process.argv[1] === __filename;
if (isRunDirectly) runCli();
