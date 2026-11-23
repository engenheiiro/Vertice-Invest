
import YahooFinance from 'yahoo-finance2';
import MarketAsset from '../models/MarketAsset.js';
import { SP500_STOCKS } from '../config/sp500List.js';
import { US_ETF_LIST } from '../config/usEtfList.js';
import { BR_ETF_LIST } from '../config/brEtfList.js';
import { toYahooSymbol, externalMarketService } from './externalMarketService.js';
import { safeFloat } from '../utils/mathUtils.js';
import { extractFundamentals, assignKnownFundamentals } from './fundamentals/yahooFundamentalsMapper.js';
import logger from '../config/logger.js';

// Universo completo do Exterior: ações do S&P 500 + ETFs/REITs/Ouro curados.
// Mapa ticker→sub-tipo (dica inicial; a heurística classifyUsAsset confirma no sync).
//
// A CONCATENAÇÃO CRUA REPETIA CINCO TICKERS. Os REITs individuais (O, PLD, AMT,
// SPG, EQIX) moram nas DUAS listas — são componentes do S&P 500 e entraram no
// `usEtfList` para carregar a dica `usSubType: 'REIT'`. As duas classes são a
// mesma (`STOCK_US`), então isso nunca corrompeu linha nenhuma; o que custava era
// trabalho duplicado (cada um perguntado duas vezes ao Yahoo em toda varredura
// diária de fundamentos) e a dica `REIT` caindo no chão, porque `$setOnInsert` só
// olha a PRIMEIRA ocorrência e a do S&P 500 vem antes, sem `usSubType`.
//
// Deduplicar mesclando resolve os dois: a primeira entrada define a identidade,
// as seguintes só PREENCHEM o que faltava. Colisão entre CLASSES diferentes é
// outro assunto e não se resolve mesclando — ver `config/tickerNamespace.js`.
const US_UNIVERSE = (() => {
    const porTicker = new Map();
    for (const asset of [...SP500_STOCKS, ...US_ETF_LIST]) {
        const anterior = porTicker.get(asset.ticker);
        if (!anterior) porTicker.set(asset.ticker, { ...asset });
        else for (const [campo, valor] of Object.entries(asset)) {
            if (anterior[campo] === undefined || anterior[campo] === null) anterior[campo] = valor;
        }
    }
    return [...porTicker.values()];
})();

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 300;
const TICKER_TIMEOUT_MS = 10000;
const RETRY_PASS_DELAY_MS = 2000; // pausa-base antes do retry das falhas (alivia throttle do Yahoo); escala por passada
const MAX_RETRY_PASSES = 2;       // nº de passadas extras sobre o resíduo de falhas transitórias

const QUOTESUMMARY_MODULES = [
    'summaryDetail',
    'defaultKeyStatistics',
    'financialData',
    'assetProfile',
    'price', // nome da empresa (longName/shortName) — assetProfile NÃO tem longName
];

// Conjunto de tickers blacklistados (estado terminal) dentro de um universo dado.
// Usado para subtrair deslistados das listas ESTÁTICAS de fundamentals (que não
// consultam o DB por si). Falha de DB → Set vazio (degrada para "não filtra",
// nunca derruba o sync). Sem filtro, um deslistado é re-tentado todo run.
async function getBlacklistedSet(tickers) {
    try {
        const rows = await MarketAsset.find({ ticker: { $in: tickers }, isBlacklisted: true }).select('ticker').lean();
        return new Set(rows.map(r => r.ticker));
    } catch {
        return new Set();
    }
}

// quoteSummary com teto de relógio: chamada ao Yahoo sem prazo não falha, fica.
function quoteSummaryWithTimeout(symbol) {
    return Promise.race([
        yahooFinance.quoteSummary(symbol, { modules: QUOTESUMMARY_MODULES }, { validateResult: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TICKER_TIMEOUT_MS))
    ]);
}

async function fetchFundamentalsForTicker(ticker) {
    try {
        // Ticker canônico (BRK.B) → símbolo do Yahoo (BRK-B); mantém `ticker` como chave do DB.
        const data = await quoteSummaryWithTimeout(toYahooSymbol(ticker));
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

    // Setor/nome: Yahoo primeiro, lista curada depois — e NADA inventado. O
    // default 'Technology' punha banco, REIT e ouro no setor de tecnologia sempre
    // que o `assetProfile` faltava, e o teto de concentração por setor do draft
    // passava a contar errado. Sem fonte, o campo não é tocado.
    const universeEntry = US_UNIVERSE.find(s => s.ticker === ticker);
    const sector = fundamentals.sector || universeEntry?.sector || null;
    const name = fundamentals.name || universeEntry?.name || null;

    const updatePayload = {
        type: 'STOCK_US',
        currency: 'USD',
        lastFundamentalsDate: new Date(),
    };
    if (sector) updatePayload.sector = sector;
    if (name) updatePayload.name = name;
    if (fundamentals.industry) updatePayload.industry = fundamentals.industry;

    // SEM `lastPrice` e SEM `isActive: true` aqui.
    //  - Preço é do passo de cotação (`marketDataService.refreshQuotesBatch`),
    //    que grava `lastPrice` junto de `priceSource`/`priceDate` e passa pelos
    //    juízes de eco/sessão velha/sem negócio. Este caminho gravava o
    //    `currentPrice` do quoteSummary sem assinatura nem data — preço anônimo
    //    que o juiz de magnitude não tinha como julgar.
    //  - `isActive: true` em todo ticker do universo desfazia, uma vez por dia, a
    //    desativação feita pela blacklist dinâmica de cotação. Só nasce ativo
    //    (`$setOnInsert` abaixo); depois, quem decide é o caminho de cotação.
    assignKnownFundamentals(updatePayload, fundamentals);

    // Linha nova (upsert) precisa de nome — o schema exige. Sem nome de fonte,
    // a sigla serve de rótulo provisório, e só na criação: nunca sobrescreve.
    const setOnInsert = { isActive: true };
    if (!name) setOnInsert.name = ticker;

    return {
        updateOne: {
            filter: { ticker },
            update: { $set: updatePayload, $setOnInsert: setOnInsert },
            upsert: true
        }
    };
}

// ETFs nacionais (B3): fundamentos via Yahoo `.SA`, com Brapi e proventos de apoio.

async function fetchBrEtfQuoteSummary(etf) {
    try {
        const data = await quoteSummaryWithTimeout(`${etf.ticker}.SA`);
        return { etf, data, ok: true };
    } catch (err) {
        return { etf, ok: false, error: err.message };
    }
}

// Liquidez + preço de fallback via Brapi (Yahoo costuma dar volume/preço
// 0 p/ ETF .SA). Busca única, reusada para liquidez E para o cálculo de DY.
async function resolveBrEtfLiquidityAndPrice(etf, f) {
    let liquidity = f.avgLiquidity || 0;
    let price = f.lastPrice || 0;
    if (!liquidity || !price) {
        const brapi = await externalMarketService.fetchFromBrapi(`${etf.ticker}.SA`);
        if (brapi?.price > 0 && !price) price = brapi.price;
        if (brapi?.volume > 0 && brapi.price > 0 && !liquidity) liquidity = brapi.volume * brapi.price;
    }
    return { liquidity, price };
}

// Soma dos proventos dos últimos 12 meses.
function trailingTwelveMonthsAmount(hist) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    return hist.filter(d => d.date >= cutoff).reduce((s, d) => s + d.amount, 0);
}

// DY: Yahoo .SA raramente devolve yield de fundo. Fallback: soma dos
// proventos dos últimos 12 meses ÷ preço. ETF de ACUMULAÇÃO não distribui
// — dy 0 é o valor correto, não um dado faltando, e é o caso de TODOS os
// ETFs de BR_ETF_LIST hoje. NÃO existe mais fallback semeado à mão: até
// 29/08/2026 um `seedYield` curado dava 4,5% a BOVA11, 6% a DIVO11 e 2% a
// SMAL11 — os três acumuladores —, e como a fonte viva nunca respondia p/
// `.SA`, o seed era a única fonte. Resultado: a carteira projetava renda
// mensal de ativo que jamais gera um evento de provento, e o ranking dava
// bônus de "ETF de Renda". Ver o histórico completo em config/brEtfList.js.
//
// Devolve `{ dy, dyKnown }`: `dyKnown: false` quando a fonte de proventos está
// fora — não sabemos se distribui, então o DY gravado é preservado (o $set sem
// a chave mantém o anterior) em vez de zerado.
async function resolveBrEtfDy(etf, f, price) {
    let dy = (f.dy != null && f.dy > 0) ? f.dy : 0;
    if (dy || !(price > 0)) return { dy, dyKnown: true };
    const hist = await externalMarketService.getDividendsHistory(etf.ticker, 'ETF', { nullOnError: true });
    if (hist === null) return { dy, dyKnown: false };
    if (hist.length) {
        const ttm = trailingTwelveMonthsAmount(hist);
        if (ttm > 0) dy = safeFloat((ttm / price) * 100);
    }
    return { dy, dyKnown: true };
}

// Mesma regra do caminho US: preço é do passo de cotação e `isActive` não é
// reafirmado aqui (só nasce ativo, via $setOnInsert). Preserva
// type:'ETF'/currency:'BRL'/sector da lista curada.
async function buildBrEtfOp(etf, data) {
    const f = extractFundamentals(etf.ticker, data);
    const updatePayload = {
        type: 'ETF',
        currency: 'BRL',
        sector: etf.sector,
        allocationClass: etf.allocationClass || null,
        lastFundamentalsDate: new Date(),
    };
    if (f.beta != null) updatePayload.beta = f.beta;
    if (f.marketCap) updatePayload.marketCap = f.marketCap;

    const { liquidity, price } = await resolveBrEtfLiquidityAndPrice(etf, f);
    if (liquidity) updatePayload.liquidity = liquidity;

    const { dy, dyKnown } = await resolveBrEtfDy(etf, f, price);
    if (dyKnown) updatePayload.dy = dy;

    const update = { $set: updatePayload, $setOnInsert: { isActive: true, name: etf.name } };
    return { updateOne: { filter: { ticker: etf.ticker }, update, upsert: true } };
}

// Processa os resultados de um lote: sucesso vira op em `bulkOps`, falha conta.
// Sequencial de propósito — cada ETF pode chamar Brapi e proventos.
async function collectBrEtfBatch(results, bulkOps) {
    let processed = 0, failed = 0;
    for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { etf, ok, data, error } = r.value;
        if (!ok) { failed++; logger.debug(`[BR ETF Fundamentals] Falhou ${etf.ticker}: ${error}`); continue; }
        bulkOps.push(await buildBrEtfOp(etf, data));
        processed++;
    }
    return { processed, failed };
}

// Exposto para os testes (mapeamento puro Yahoo → MarketAsset).
export const _internals = { extractFundamentals, buildFundamentalsOp };

export const usStocksFundamentalsService = {

    async syncUSStocksFundamentals(tickerList = null) {
        let targets = tickerList ?? US_UNIVERSE.map(s => s.ticker);
        // A lista é ESTÁTICA (US_UNIVERSE), então não conhece o flag isBlacklisted do
        // DB. Sem subtrair os deslistados (IPG, SGEN…), o sync os martelava todo run
        // com "Quote not found", inflando warnings e a lista "sem cotação" mesmo após
        // a blacklist. Subtrai o conjunto blacklistado (estado terminal) uma vez.
        const blacklisted = await getBlacklistedSet(targets);
        if (blacklisted.size > 0) {
            targets = targets.filter(t => !blacklisted.has(t));
        }
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

        // Retry escalonado: a maioria das falhas é throttle/crumb transitório do Yahoo
        // (tickers válidos como IPG/HOLX/MMC retornando "Quote not found" sob rajada),
        // não delisting. Cada passada carrega só o resíduo (~dezenas de tickers) e usa
        // folga crescente para não martelar o endpoint já saturado. Duas passadas costumam
        // zerar as falhas; o que sobrar mantém o valor anterior no DB (upsert só grava sucesso).
        for (let attempt = 1; attempt <= MAX_RETRY_PASSES && failedTickers.length > 0; attempt++) {
            logger.debug(`[US Fundamentals] Retry ${attempt}/${MAX_RETRY_PASSES} de ${failedTickers.length} ativos após pausa...`);
            await sleep(RETRY_PASS_DELAY_MS * attempt);
            const before = failedTickers.length;
            failedTickers = await runPass(failedTickers);
            const got = before - failedTickers.length;
            if (got > 0) logger.info(`↻ [US Fundamentals] Retry ${attempt} recuperou ${got} ativos.`);
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
                    // Metadados de taxonomia são atualizados também nos documentos
                    // existentes; o seed funciona como backfill idempotente.
                    $set: {
                        sector: etf.sector,
                        allocationClass: etf.allocationClass || null,
                    },
                    $setOnInsert: {
                        ticker: etf.ticker,
                        name: etf.name,
                        type: 'ETF',
                        currency: 'BRL',
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
        // Mesma lógica do sync US: BR_ETF_LIST é estática, subtrai os ETFs blacklistados
        // (EURP11, BDRX11…) para não re-tentar deslistados a cada run.
        const blacklisted = await getBlacklistedSet(BR_ETF_LIST.map(e => e.ticker));
        const list = blacklisted.size > 0 ? BR_ETF_LIST.filter(e => !blacklisted.has(e.ticker)) : BR_ETF_LIST;
        logger.info(`🌎 [BR ETF Fundamentals] Iniciando sync para ${list.length} ETFs (.SA)...`);
        let processed = 0, failed = 0;
        const bulkOps = [];

        for (let i = 0; i < list.length; i += BATCH_SIZE) {
            const batch = list.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(fetchBrEtfQuoteSummary));
            const counts = await collectBrEtfBatch(results, bulkOps);
            processed += counts.processed;
            failed += counts.failed;

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
