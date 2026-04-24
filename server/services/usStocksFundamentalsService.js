
import YahooFinance from 'yahoo-finance2';
import MarketAsset from '../models/MarketAsset.js';
import { SP500_STOCKS } from '../config/sp500List.js';
import logger from '../config/logger.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 300;
const TICKER_TIMEOUT_MS = 10000;

const QUOTESUMMARY_MODULES = [
    'summaryDetail',
    'defaultKeyStatistics',
    'financialData',
    'assetProfile',
];

function extractFundamentals(ticker, data) {
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const fd = data.financialData || {};
    const ap = data.assetProfile || {};

    const pl = sd.trailingPE || ks.forwardPE || null;
    const pvp = ks.priceToBook || null;
    const dy = sd.dividendYield ? sd.dividendYield * 100 : 0;
    const beta = ks.beta || sd.beta || null;
    const marketCap = sd.marketCap || ks.enterpriseValue || null;
    const roe = fd.returnOnEquity ? fd.returnOnEquity * 100 : null;
    const netMargin = fd.profitMargins ? fd.profitMargins * 100 : null;
    const revenueGrowth = fd.revenueGrowth ? fd.revenueGrowth * 100 : null;
    const earningsGrowth = fd.earningsGrowth ? fd.earningsGrowth * 100 : null;
    const debtToEquity = fd.debtToEquity || null;
    const avgLiquidity = sd.averageVolume || ks.averageDailyVolume10Day || null;
    const lastPrice = fd.currentPrice || sd.regularMarketPrice || null;
    const payoutRatio = sd.payoutRatio ? sd.payoutRatio * 100 : null;
    const vpa = ks.bookValue || null;
    const lpa = ks.trailingEps || ks.forwardEps || null;
    const sector = ap.sector || null;
    const name = ap.longName || ap.companyOfficers?.[0]?.name || ticker;

    // PEG ratio: P/E ÷ earnings growth
    let peg = null;
    if (pl && earningsGrowth && earningsGrowth > 0) {
        peg = pl / earningsGrowth;
    }

    return {
        pl, pvp, dy, beta, marketCap, roe, netMargin, revenueGrowth, earningsGrowth,
        netDebt: debtToEquity, avgLiquidity, lastPrice, payoutRatio, vpa, lpa, sector, name, peg,
    };
}

async function fetchFundamentalsForTicker(ticker) {
    try {
        const data = await Promise.race([
            yahooFinance.quoteSummary(ticker, { modules: QUOTESUMMARY_MODULES }, { validateResult: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TICKER_TIMEOUT_MS))
        ]);
        return { ticker, data, ok: true };
    } catch (err) {
        return { ticker, ok: false, error: err.message };
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const usStocksFundamentalsService = {

    async syncUSStocksFundamentals(tickerList = null) {
        const targets = tickerList ?? SP500_STOCKS.map(s => s.ticker);
        logger.info(`🌎 [US Fundamentals] Iniciando sync para ${targets.length} ativos...`);

        let processed = 0;
        let failed = 0;
        const bulkOps = [];

        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            const batch = targets.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(fetchFundamentalsForTicker));

            for (const result of results) {
                if (result.status !== 'fulfilled') continue;
                const { ticker, ok, data, error } = result.value;

                if (!ok) {
                    failed++;
                    logger.debug(`[US Fundamentals] Falhou ${ticker}: ${error}`);
                    continue;
                }

                const fundamentals = extractFundamentals(ticker, data);

                // Get sector from SP500_STOCKS config if Yahoo didn't return it
                const sp500Entry = SP500_STOCKS.find(s => s.ticker === ticker);
                const sector = fundamentals.sector || sp500Entry?.sector || 'Technology';
                const name = fundamentals.name || sp500Entry?.name || ticker;

                const updatePayload = {
                    type: 'STOCK_US',
                    currency: 'USD',
                    sector,
                    name,
                    isActive: true,
                    lastFundamentalsDate: new Date(),
                };

                if (fundamentals.lastPrice > 0) updatePayload.lastPrice = fundamentals.lastPrice;
                if (fundamentals.pl !== null) updatePayload.pl = fundamentals.pl;
                if (fundamentals.pvp !== null) updatePayload.pvp = fundamentals.pvp;
                if (fundamentals.dy !== null) updatePayload.dy = fundamentals.dy;
                if (fundamentals.beta !== null) updatePayload.beta = fundamentals.beta;
                if (fundamentals.marketCap) updatePayload.marketCap = fundamentals.marketCap;
                if (fundamentals.roe !== null) updatePayload.roe = fundamentals.roe;
                if (fundamentals.netMargin !== null) updatePayload.netMargin = fundamentals.netMargin;
                if (fundamentals.revenueGrowth !== null) updatePayload.revenueGrowth = fundamentals.revenueGrowth;
                if (fundamentals.earningsGrowth !== null) updatePayload.earningsGrowth = fundamentals.earningsGrowth;
                if (fundamentals.netDebt !== null) updatePayload.debtToEquity = fundamentals.netDebt;
                if (fundamentals.avgLiquidity) updatePayload.liquidity = fundamentals.avgLiquidity;
                if (fundamentals.payoutRatio !== null) updatePayload.payoutRatio = fundamentals.payoutRatio;
                if (fundamentals.vpa !== null) updatePayload.vpa = fundamentals.vpa;
                if (fundamentals.lpa !== null) updatePayload.lpa = fundamentals.lpa;
                if (fundamentals.peg !== null) updatePayload.peg = fundamentals.peg;

                bulkOps.push({
                    updateOne: {
                        filter: { ticker },
                        update: { $set: updatePayload },
                        upsert: true
                    }
                });

                processed++;
            }

            if (bulkOps.length >= 50) {
                await MarketAsset.bulkWrite(bulkOps.splice(0, bulkOps.length));
            }

            if (i + BATCH_SIZE < targets.length) {
                await sleep(BATCH_DELAY_MS);
            }
        }

        // Flush remaining ops
        if (bulkOps.length > 0) {
            await MarketAsset.bulkWrite(bulkOps);
        }

        logger.info(`✅ [US Fundamentals] Concluído: ${processed} atualizados, ${failed} falhas de ${targets.length} total.`);
        return { processed, failed, total: targets.length };
    },

    // Seed inicial: cria os registros básicos dos 500 ativos caso não existam
    async seedSP500Assets() {
        logger.info(`🌱 [US Seed] Populando ${SP500_STOCKS.length} ativos do S&P 500...`);

        const ops = SP500_STOCKS.map(stock => ({
            updateOne: {
                filter: { ticker: stock.ticker },
                update: {
                    $setOnInsert: {
                        ticker: stock.ticker,
                        name: stock.name,
                        type: 'STOCK_US',
                        currency: 'USD',
                        sector: stock.sector,
                        isActive: true,
                        isBlacklisted: false,
                        isTier1: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JPM', 'V'].includes(stock.ticker),
                    }
                },
                upsert: true
            }
        }));

        const result = await MarketAsset.bulkWrite(ops);
        logger.info(`✅ [US Seed] ${result.upsertedCount} novos ativos criados, ${result.matchedCount} já existentes.`);
        return result;
    },

    // Fetch dividends history for a US stock and return array of {date, value}
    async fetchDividendsHistory(ticker) {
        try {
            const data = await Promise.race([
                yahooFinance.quoteSummary(ticker, { modules: ['summaryDetail', 'dividendsAndSplits'] }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TICKER_TIMEOUT_MS))
            ]);

            const dividends = data.dividendsAndSplits?.dividends || [];
            return dividends.map(d => ({
                date: new Date(d.date).toISOString().split('T')[0],
                value: d.amount || 0,
                currency: 'USD'
            })).filter(d => d.value > 0);
        } catch {
            return [];
        }
    }
};
