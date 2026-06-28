
import YahooFinance from 'yahoo-finance2';
import MarketAsset from '../models/MarketAsset.js';
import { SP500_STOCKS } from '../config/sp500List.js';
import { US_ETF_LIST } from '../config/usEtfList.js';
import { BR_ETF_LIST } from '../config/brEtfList.js';
import { toYahooSymbol, externalMarketService } from './externalMarketService.js';
import logger from '../config/logger.js';

// Universo completo do Exterior: ações do S&P 500 + ETFs/REITs/Ouro curados.
// Mapa ticker→sub-tipo (dica inicial; a heurística classifyUsAsset confirma no sync).
const US_UNIVERSE = [...SP500_STOCKS, ...US_ETF_LIST];

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 300;
const TICKER_TIMEOUT_MS = 10000;
const RETRY_PASS_DELAY_MS = 2000; // pausa antes do retry das falhas (alivia throttle do Yahoo)

const QUOTESUMMARY_MODULES = [
    'summaryDetail',
    'defaultKeyStatistics',
    'financialData',
    'assetProfile',
    'price', // nome da empresa (longName/shortName) — assetProfile NÃO tem longName
];

function extractFundamentals(ticker, data) {
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const fd = data.financialData || {};
    const ap = data.assetProfile || {};
    const pr = data.price || {};

    const pl = sd.trailingPE || ks.forwardPE || null;
    const pvp = ks.priceToBook || null;
    // DY ciente de fundo: ETFs/REITs frequentemente NÃO expõem `summaryDetail.dividendYield`
    // (campo de ação) — o yield do fundo vem em `yield` ou `trailingAnnualDividendYield`.
    // Sem este fallback, todo ETF saía com dy=0 (VOO/SCHD/VYM zerados).
    // Number.isFinite descarta null/undefined E NaN — o Yahoo às vezes devolve NaN nesses
    // campos, e um NaN aqui quebrava o cast Mongoose do `dy` (abortava todo o sync).
    const dyRaw = [sd.dividendYield, sd.yield, sd.trailingAnnualDividendYield].find(Number.isFinite);
    const dy = Number.isFinite(dyRaw) ? dyRaw * 100 : 0;
    const beta = ks.beta || sd.beta || null;
    const marketCap = sd.marketCap || ks.enterpriseValue || null;
    const roe = fd.returnOnEquity ? fd.returnOnEquity * 100 : null;
    const netMargin = fd.profitMargins ? fd.profitMargins * 100 : null;
    const revenueGrowth = fd.revenueGrowth ? fd.revenueGrowth * 100 : null;
    const earningsGrowth = fd.earningsGrowth ? fd.earningsGrowth * 100 : null;
    // Yahoo Finance retorna debtToEquity em formato percentual (ex: 47.49 = 47.49% = ratio 0.4749)
    const debtToEquity = fd.debtToEquity != null ? fd.debtToEquity / 100 : null;
    const lastPrice = fd.currentPrice || sd.regularMarketPrice || null;
    // Liquidez em VALOR financeiro (US$/dia), não em nº de ações — alinha com a
    // liquidez dos ativos BR (Liq.2meses, em R$) que o scoringEngine compara contra
    // o piso de 1M. Sem isso, ações caras de baixo giro de papéis (AZO ~$3000,
    // <1M ações/dia mas >$2bi/dia em valor) levavam -30 de confiança indevidamente.
    const avgVolumeShares = sd.averageVolume || ks.averageDailyVolume10Day || null;
    const avgLiquidity = (avgVolumeShares && lastPrice) ? avgVolumeShares * lastPrice : null;
    const payoutRatio = sd.payoutRatio ? sd.payoutRatio * 100 : null;
    const vpa = ks.bookValue || null;
    const lpa = ks.trailingEps || ks.forwardEps || null;
    const sector = ap.sector || null;
    const industry = ap.industry || null;
    // Nome da empresa vem do módulo `price` (longName/shortName). NUNCA usar
    // companyOfficers — isso retornava o nome do CEO (ex.: "Mr. Timothy D. Cook").
    const name = pr.longName || pr.shortName || null;

    // PEG ratio: P/E ÷ earnings growth
    let peg = null;
    if (pl && earningsGrowth && earningsGrowth > 0) {
        peg = pl / earningsGrowth;
    }

    return {
        pl, pvp, dy, beta, marketCap, roe, netMargin, revenueGrowth, earningsGrowth,
        debtToEquity, avgLiquidity, lastPrice, payoutRatio, vpa, lpa, sector, industry, name, peg,
    };
}

async function fetchFundamentalsForTicker(ticker) {
    try {
        const data = await Promise.race([
            // Ticker canônico (BRK.B) → símbolo do Yahoo (BRK-B); mantém `ticker` como chave do DB.
            yahooFinance.quoteSummary(toYahooSymbol(ticker), { modules: QUOTESUMMARY_MODULES }, { validateResult: false }),
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

// Monta o bulkOp de upsert de fundamentos a partir do quoteSummary do Yahoo.
// Extraído para ser reusado pela passada principal e pelo retry (DRY).
function buildFundamentalsOp(ticker, data) {
    const fundamentals = extractFundamentals(ticker, data);

    // Get sector/name from the curated universe if Yahoo didn't return it
    const universeEntry = US_UNIVERSE.find(s => s.ticker === ticker);
    const sector = fundamentals.sector || universeEntry?.sector || 'Technology';
    const name = fundamentals.name || universeEntry?.name || ticker;

    const updatePayload = {
        type: 'STOCK_US',
        currency: 'USD',
        sector,
        name,
        isActive: true,
        lastFundamentalsDate: new Date(),
    };
    if (fundamentals.industry) updatePayload.industry = fundamentals.industry;

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
    if (fundamentals.debtToEquity !== null) updatePayload.debtToEquity = fundamentals.debtToEquity;
    if (fundamentals.avgLiquidity) updatePayload.liquidity = fundamentals.avgLiquidity;
    if (fundamentals.payoutRatio !== null) updatePayload.payout = fundamentals.payoutRatio;
    if (fundamentals.vpa !== null) updatePayload.vpa = fundamentals.vpa;
    if (fundamentals.lpa !== null) updatePayload.lpa = fundamentals.lpa;
    if (fundamentals.peg !== null) updatePayload.peg = fundamentals.peg;

    return {
        updateOne: {
            filter: { ticker },
            update: { $set: updatePayload },
            upsert: true
        }
    };
}

export const usStocksFundamentalsService = {

    async syncUSStocksFundamentals(tickerList = null) {
        const targets = tickerList ?? US_UNIVERSE.map(s => s.ticker);
        logger.info(`🌎 [US Fundamentals] Iniciando sync para ${targets.length} ativos...`);

        let processed = 0;
        const bulkOps = [];

        // Executa uma passada batcheada sobre `list`; ops de sucesso vão para bulkOps
        // (com flush incremental) e os tickers que falharam são devolvidos para retry.
        const runPass = async (list) => {
            const stillFailed = [];
            for (let i = 0; i < list.length; i += BATCH_SIZE) {
                const batch = list.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(batch.map(fetchFundamentalsForTicker));

                for (const result of results) {
                    if (result.status !== 'fulfilled') continue;
                    const { ticker, ok, data, error } = result.value;

                    if (!ok) {
                        stillFailed.push(ticker);
                        logger.debug(`[US Fundamentals] Falhou ${ticker}: ${error}`);
                        continue;
                    }

                    bulkOps.push(buildFundamentalsOp(ticker, data));
                    processed++;
                }

                if (bulkOps.length >= 50) {
                    await MarketAsset.bulkWrite(bulkOps.splice(0, bulkOps.length));
                }

                if (i + BATCH_SIZE < list.length) {
                    await sleep(BATCH_DELAY_MS);
                }
            }
            return stillFailed;
        };

        let failedTickers = await runPass(targets);

        // Retry único: a maioria das falhas é throttle/crumb transitório do Yahoo
        // (tickers válidos como IPG/HOLX/MMC retornando "Quote not found" sob rajada),
        // não delisting. Uma segunda passada com folga recupera esses sem martelar.
        if (failedTickers.length > 0) {
            logger.debug(`[US Fundamentals] Retry de ${failedTickers.length} ativos após pausa...`);
            await sleep(RETRY_PASS_DELAY_MS);
            const recovered = failedTickers.length;
            failedTickers = await runPass(failedTickers);
            const got = recovered - failedTickers.length;
            if (got > 0) logger.info(`↻ [US Fundamentals] Retry recuperou ${got} ativos.`);
        }

        // Flush remaining ops
        if (bulkOps.length > 0) {
            await MarketAsset.bulkWrite(bulkOps);
        }

        const failed = failedTickers.length;
        logger.info(`✅ [US Fundamentals] Concluído: ${processed} atualizados, ${failed} falhas de ${targets.length} total.`);
        return { processed, failed, total: targets.length };
    },

    // Seed inicial: cria os registros básicos do universo (S&P 500 + ETFs/REITs/Ouro).
    async seedSP500Assets() {
        logger.info(`🌱 [US Seed] Populando ${US_UNIVERSE.length} ativos do Exterior (S&P 500 + ETFs/REITs/Ouro)...`);

        const ops = US_UNIVERSE.map(stock => ({
            updateOne: {
                filter: { ticker: stock.ticker },
                update: {
                    $setOnInsert: {
                        ticker: stock.ticker,
                        name: stock.name,
                        type: 'STOCK_US',
                        currency: 'USD',
                        sector: stock.sector,
                        // usSubType é dica inicial; o backfill (classifyUsAsset) confirma no sync.
                        ...(stock.usSubType ? { usSubType: stock.usSubType } : {}),
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

    // Seed inicial dos ETFs NACIONAIS (B3, BRL) — classe própria `ETF`.
    // Espelha seedSP500Assets, mas com type:'ETF'/currency:'BRL'. As cotações são
    // mantidas pelo refresh normal (Yahoo .SA), igual a Ações/FIIs.
    async seedBrEtfAssets() {
        logger.info(`🌱 [BR ETF Seed] Populando ${BR_ETF_LIST.length} ETFs nacionais (B3)...`);

        const ops = BR_ETF_LIST.map(etf => ({
            updateOne: {
                filter: { ticker: etf.ticker },
                update: {
                    $setOnInsert: {
                        ticker: etf.ticker,
                        name: etf.name,
                        type: 'ETF',
                        currency: 'BRL',
                        sector: etf.sector,
                        isActive: true,
                        isBlacklisted: false,
                    }
                },
                upsert: true
            }
        }));

        const result = await MarketAsset.bulkWrite(ops);
        logger.info(`✅ [BR ETF Seed] ${result.upsertedCount} novos ETFs criados, ${result.matchedCount} já existentes.`);
        return result;
    },

    // Fundamentos dos ETFs NACIONAIS (B3) via Yahoo no símbolo `.SA`. Reaproveita
    // extractFundamentals (agora ciente de fundo → `yield`/`trailingAnnualDividendYield`),
    // populando sobretudo o `dy` — que o seed básico não traz e o Fundamentus não cobre.
    // Preserva type:'ETF'/currency:'BRL'/sector da lista curada.
    async syncBrEtfFundamentals() {
        const list = BR_ETF_LIST;
        logger.info(`🌎 [BR ETF Fundamentals] Iniciando sync para ${list.length} ETFs (.SA)...`);
        let processed = 0, failed = 0;
        const bulkOps = [];

        for (let i = 0; i < list.length; i += BATCH_SIZE) {
            const batch = list.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(async (etf) => {
                try {
                    const data = await Promise.race([
                        yahooFinance.quoteSummary(`${etf.ticker}.SA`, { modules: QUOTESUMMARY_MODULES }, { validateResult: false }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TICKER_TIMEOUT_MS)),
                    ]);
                    return { etf, data, ok: true };
                } catch (err) {
                    return { etf, ok: false, error: err.message };
                }
            }));

            for (const r of results) {
                if (r.status !== 'fulfilled') continue;
                const { etf, ok, data, error } = r.value;
                if (!ok) { failed++; logger.debug(`[BR ETF Fundamentals] Falhou ${etf.ticker}: ${error}`); continue; }

                const f = extractFundamentals(etf.ticker, data);
                const updatePayload = { type: 'ETF', currency: 'BRL', sector: etf.sector, isActive: true, lastFundamentalsDate: new Date() };
                if (f.lastPrice > 0) updatePayload.lastPrice = f.lastPrice;
                if (f.beta != null) updatePayload.beta = f.beta;
                if (f.marketCap) updatePayload.marketCap = f.marketCap;

                // Liquidez + preço de fallback via Brapi (Yahoo costuma dar volume/preço
                // 0 p/ ETF .SA). Busca única, reusada para liquidez E para o cálculo de DY.
                let liquidity = f.avgLiquidity || 0;
                let price = f.lastPrice || 0;
                if (!liquidity || !price) {
                    const brapi = await externalMarketService.fetchFromBrapi(`${etf.ticker}.SA`);
                    if (brapi?.price > 0 && !price) price = brapi.price;
                    if (brapi?.volume > 0 && brapi.price > 0 && !liquidity) liquidity = brapi.volume * brapi.price;
                }
                if (liquidity) updatePayload.liquidity = liquidity;

                // DY: Yahoo .SA raramente devolve yield de fundo (vinha 0 até em DIVO11,
                // um ETF de dividendos). Fallback: soma dos proventos dos últimos 12 meses
                // ÷ preço. ETFs de acumulação (IVVB11/NASD11) não distribuem → dy 0 correto.
                let dy = (f.dy != null && f.dy > 0) ? f.dy : 0;
                if (!dy && price > 0) {
                    const hist = await externalMarketService.getDividendsHistory(etf.ticker, 'ETF');
                    if (hist.length) {
                        const cutoff = new Date();
                        cutoff.setFullYear(cutoff.getFullYear() - 1);
                        const ttm = hist.filter(d => d.date >= cutoff).reduce((s, d) => s + d.amount, 0);
                        if (ttm > 0) dy = (ttm / price) * 100;
                    }
                }
                // Fallback final: seed curado p/ ETFs distribuidores (DIVO11/BOVA11/SMAL11).
                // Yahoo não traz yield de fundo .SA e a Brapi cobra dividendos; a fonte viva
                // acima tem precedência — o seed só entra se nada vivo respondeu. Ver brEtfList.
                if (!dy && etf.seedYield > 0) dy = etf.seedYield;
                updatePayload.dy = dy;

                bulkOps.push({ updateOne: { filter: { ticker: etf.ticker }, update: { $set: updatePayload }, upsert: true } });
                processed++;
            }

            if (bulkOps.length >= 50) await MarketAsset.bulkWrite(bulkOps.splice(0, bulkOps.length));
            if (i + BATCH_SIZE < list.length) await sleep(BATCH_DELAY_MS);
        }

        if (bulkOps.length > 0) await MarketAsset.bulkWrite(bulkOps);
        logger.info(`✅ [BR ETF Fundamentals] Concluído: ${processed} atualizados, ${failed} falhas de ${list.length}.`);
        return { processed, failed, total: list.length };
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
