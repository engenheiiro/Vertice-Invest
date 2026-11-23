
import YahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import { fundamentusService } from './fundamentusService.js';
import { macroDataService } from './macroDataService.js';
import { usStocksFundamentalsService } from './usStocksFundamentalsService.js';
import { resolveSector, deriveFiiSubType } from '../utils/sectorResolver.js';
import {
    createFundamentusStats,
    finalizeFundamentusStats,
    validateFundamentusIngestion,
} from '../utils/ingestionHealth.js';
import { trackJob } from '../utils/jobRun.js';
import { withJobLease } from '../utils/jobLease.js';
import {
    loadRetiredTickers,
    prepareExternalAssets,
    refreshQuotesInBatches,
    reportDegradedIngestion,
    runDailyStep,
    runPostWriteBackfills,
    saveFailedSyncStats,
    saveHealthySyncStats,
} from './sync/fullSyncSteps.js';
import { withMongoRetry } from '../utils/mongoResilience.js';

const yahooFinanceLTM = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const LTM_BATCH_SIZE = 10;
const LTM_BATCH_DELAY_MS = 400;
const LTM_TICKER_TIMEOUT_MS = 8000;
// Backoff do enriquecimento LTM. Medido em 11/2026: ~116 ações BR voltavam do
// Yahoo sem nenhum campo aproveitável TODO DIA (~11s de chamadas por run, sem
// resultado). Quem respondeu "nada" fica 30 dias sem ser perguntado de novo;
// demonstrativo trimestral não muda em menos que isso.
export const LTM_ENRICH_BACKOFF_DAYS = 30;

// Erro que é RESPOSTA da fonte ("não tenho esse papel"), não falha de transporte.
// Só resposta conta como tentativa: timeout/429/conexão derrubada não dizem nada
// sobre o ativo, e carimbar o backoff por eles calaria um papel bom por 30 dias.
const LTM_DEFINITIVE_ERROR = /not\s*found|no fundamentals|no data/i;

// Leitura LTM de um quoteSummary do Yahoo; campo ausente/zerado vira null.
const ltmFromQuoteSummary = (data) => {
    const fd = data.financialData || {};
    const ks = data.defaultKeyStatistics || {};
    const sd = data.summaryDetail || {};
    const shares = ks.sharesOutstanding || 0;
    return {
        marketCap: sd.marketCap || null,
        netRevenue: fd.totalRevenue || null,
        netIncome: fd.netIncomeToCommon || null,
        netDebt: (fd.totalDebt && fd.totalCash != null) ? (fd.totalDebt - fd.totalCash) : null,
        patrimLiq: (ks.bookValue && shares) ? ks.bookValue * shares : null,
    };
};

async function fetchYahooLTM(ticker) {
    try {
        const data = await Promise.race([
            yahooFinanceLTM.quoteSummary(`${ticker}.SA`, {
                modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail']
            }, { validateResult: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LTM_TICKER_TIMEOUT_MS))
        ]);
        return ltmFromQuoteSummary(data);
    } catch (err) {
        // Resposta definitiva vira leitura vazia (conta como tentativa); o resto é
        // transitório e devolve null (não conta).
        return LTM_DEFINITIVE_ERROR.test(String(err?.message || '')) ? {} : null;
    }
}

/**
 * Filtro dos candidatos ao enriquecimento LTM: ação BR com receita ou lucro
 * zerado/ausente e que NÃO tenha sido tentada sem resultado nos últimos
 * LTM_ENRICH_BACKOFF_DAYS dias.
 */
export function buildLtmCandidateFilter(now = new Date()) {
    const cutoff = new Date(now.getTime() - LTM_ENRICH_BACKOFF_DAYS * 24 * 60 * 60 * 1000);
    return {
        type: 'STOCK',
        $and: [
            { $or: [{ netRevenue: { $in: [0, null] } }, { netIncome: { $in: [0, null] } }] },
            { $or: [{ ltmEnrichAttemptedAt: null }, { ltmEnrichAttemptedAt: { $lt: cutoff } }] },
        ],
    };
}

/**
 * Operação de gravação para um ativo, dado o que o Yahoo devolveu.
 *  - `ltm === null` (falha transitória): nada — nem dado, nem carimbo.
 *  - algum campo novo: grava só os campos que estavam zerados/ausentes.
 *  - nada aproveitável: grava SÓ o carimbo de tentativa (inicia o backoff).
 */
export function buildLtmEnrichOp(asset, ltm, now = new Date()) {
    if (!ltm) return null;
    const $set = {};
    // Só atualiza o campo se ainda estava zerado/ausente E o Yahoo retornou valor
    if ((!asset.marketCap) && ltm.marketCap) $set.marketCap = ltm.marketCap;
    if ((!asset.netRevenue) && ltm.netRevenue) $set.netRevenue = ltm.netRevenue;
    if ((!asset.netIncome) && ltm.netIncome) $set.netIncome = ltm.netIncome;
    if ((!asset.netDebt && asset.netDebt !== 0) && ltm.netDebt != null) $set.netDebt = ltm.netDebt;
    if ((!asset.patrimLiq) && ltm.patrimLiq) $set.patrimLiq = ltm.patrimLiq;
    if (Object.keys($set).length === 0) {
        return { updateOne: { filter: { ticker: asset.ticker }, update: { $set: { ltmEnrichAttemptedAt: now } } }, enriched: false };
    }
    return { updateOne: { filter: { ticker: asset.ticker }, update: { $set } }, enriched: true };
}

async function enrichBRStocksLTM() {
    // Só enriquece ativos STOCK BR (sem sufixo .SA no banco, mas com sufixo na busca)
    // onde algum campo LTM ainda é zero ou ausente — e fora do backoff.
    const now = new Date();
    const candidates = await MarketAsset.find(buildLtmCandidateFilter(now))
        .select('ticker netRevenue netIncome netDebt patrimLiq marketCap').lean();

    if (candidates.length === 0) return;

    logger.info(`ℹ️ [Sync] Etapa 4.5: Enriquecendo LTM de ${candidates.length} ações BR via Yahoo Finance...`);
    const bulkOps = [];
    let enrichedCount = 0;
    let backedOff = 0;

    for (let i = 0; i < candidates.length; i += LTM_BATCH_SIZE) {
        const batch = candidates.slice(i, i + LTM_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(a => fetchYahooLTM(a.ticker)));

        for (let j = 0; j < results.length; j++) {
            if (results[j].status !== 'fulfilled') continue;
            const op = buildLtmEnrichOp(batch[j], results[j].value, now);
            if (!op) continue;
            if (op.enriched) enrichedCount++; else backedOff++;
            bulkOps.push({ updateOne: op.updateOne });
        }

        if (i + LTM_BATCH_SIZE < candidates.length) {
            await new Promise(r => setTimeout(r, LTM_BATCH_DELAY_MS));
        }
    }

    if (bulkOps.length > 0) await MarketAsset.bulkWrite(bulkOps);
    if (enrichedCount > 0) {
        logger.info(`✅ [Sync] Etapa 4.5: LTM enriquecido para ${enrichedCount} ações BR.`);
    } else {
        logger.info(`ℹ️ [Sync] Etapa 4.5: Nenhum campo LTM novo encontrado via Yahoo Finance.`);
    }
    if (backedOff > 0) {
        logger.info(`ℹ️ [Sync] Etapa 4.5: ${backedOff} ações sem LTM no Yahoo — fora da fila por ${LTM_ENRICH_BACKOFF_DAYS} dias.`);
    }
}

// Mapa de Correção de Erros da Fonte Externa (Fundamentus/Scraping)
const KNOWN_TYPOS = {
    'CPLEE5': 'CPLE6',   // Copel PNB
    'AZULL4': 'AZUL4',   // Azul PN
    'CVBII11': 'CVBI11', // VBI CRI
    'MALLL11': 'MALL11', // Malls Brasil
    'QAGRR11': 'QAGR11', // Quasar Agro
    'JPSA3': 'IGTI3',    // Jereissati -> Iguatemi (Rebranding antigo não atualizado na fonte)
};
// Fora do mapa desde 30/10/2026: 'RBHG11' → 'RBRL11' e 'BLMO11' → 'BLMG11'. Os
// dois "typos" são FIIs de verdade, negociando, com preço próprio (RBHG11 a
// ~R$ 55, BLMO11 a ~R$ 95). Como o Fundamentus lista RBHG11 ANTES de RBRL11, a
// "correção" gravava DY, P/VP, VP por cota, setor e preço do RBHG11 no RBRL11, e
// o RBRL11 verdadeiro caía no filtro de duplicidade. Era essa a origem do
// "RBRL11 valendo 58,45 (o preço do RBHG11)" de 07/09/2026, que pôs assinatura no
// `lastPrice` mas não achou o escritor. No outro par o alvo vinha antes, e o
// BLMO11 sumia em silêncio.

/**
 * Corrige o ticker da fonte pelo mapa de typos — a não ser que a fonte liste o
 * ALVO também. Typo de verdade não convive com o nome certo na mesma listagem;
 * se os dois estão lá, são dois papéis, e "corrigir" funde um no outro. PURA.
 */
export const correctSourceTicker = (rawTicker, listed = null) => {
    const target = KNOWN_TYPOS[rawTicker];
    if (!target) return rawTicker;
    if (listed?.has(target)) return rawTicker;
    return target;
};

// Número da fonte; vazio, texto ou NaN viram 0.
const num = (value) => Number(value) || 0;

/**
 * Gravação de UMA linha do Fundamentus no MarketAsset (PURA, sem banco).
 *
 * Sem `isActive: true` / `failCount: 0` no `$set`. Estar na listagem do
 * Fundamentus NÃO prova que o papel negocia: ela traz FII parado há semanas, e a
 * liquidez que passa no filtro de 5k é média de 2 meses. O reset desfazia, a cada
 * sync, o envelhecimento que a cotação faz (sessão velha e sessão sem negócio
 * contam falha, e 10 falhas desativam): JASC11, REME11, KISU11 & cia. repetiam o
 * mesmo aviso todo run e nunca chegavam à baixa. Reativar é com quem prova o
 * pregão — `tryReactivateAssets`, que exige sessão datada. Papel NOVO nasce ativo
 * pelo `$setOnInsert`.
 */
export const buildFundamentusAssetUpdate = ({ ticker, type, data, liquidity, timestamp }) => {
    // Resolução resiliente: override exato → override por base (ações)
    // → setor do scraping (FIIs) → default por tipo.
    const finalSector = resolveSector({ ticker, type, scrapedSector: data.sector });

    const updateFields = {
        lastPrice: num(data.price),
        // Assinatura do preço. Este caminho grava `lastPrice` e NÃO grava
        // `priceDate` — o scraping não diz de que sessão é o número —,
        // então depois de uma passada aqui o par (preço, data) pode ter
        // dois donos diferentes. É exatamente isso que o juiz de
        // magnitude precisa saber antes de acusar o preço novo de
        // destoar do guardado (ver utils/quoteSanity.js).
        priceSource: 'FUNDAMENTUS',
        dy: num(data.dy),
        p_vp: num(data.pvp),
        liquidity,

        pl: num(data.pl),
        roe: num(data.roe),
        roic: num(data.roic),
        netMargin: num(data.netMargin),
        evEbitda: num(data.evEbitda),
        revenueGrowth: num(data.cresRec5a),
        debtToEquity: num(data.debtToEquity ?? data.divBrutaPatrim),

        vacancy: num(data.vacancy),
        capRate: num(data.capRate),
        qtdImoveis: num(data.qtdImoveis),
        // FFO do FII. O scraper já entregava estes três campos; sem esta linha
        // eles morriam aqui (o schema também não os tinha) e o P/FFO — múltiplo
        // padrão do setor — ficava indisponível para todo o universo de FIIs.
        // Ação não devolve FFO: cai em 0, mesma convenção de vacancy/capRate.
        ffoYield: num(data.ffoYield),
        vpCota: num(data.vpCota),
        ffoCota: num(data.ffoCota),

        sector: finalSector,
        fiiSubType: type === 'FII' ? deriveFiiSubType(finalSector) : null,
        lastFundamentalsDate: timestamp,
        lastAnalysisDate: timestamp,
        updatedAt: timestamp,
    };

    // Financials LTM derivados (engenharia reversa): 0 = não foi possível
    // calcular. Carry-forward — só sobrescreve quando o novo valor é
    // significativo, evitando que um scrape parcial zere dados bons
    // (corrige lacunas intermitentes no modal "Financials (LTM)").
    const ltmFields = {
        marketCap: num(data.marketCap),
        netDebt: num(data.netDebt),
        netRevenue: num(data.netRevenue),
        netIncome: num(data.netIncome),
        totalAssets: num(data.totalAssets),
        patrimLiq: num(data.patrimLiq),
        payout: num(data.payout),
    };
    for (const [k, v] of Object.entries(ltmFields)) {
        if (v !== 0) updateFields[k] = v;
    }

    return {
        $set: updateFields,
        $setOnInsert: {
            name: ticker, // Usa o ticker como nome se não tiver outro
            type,
            currency: 'BRL',
            isIgnored: false,
            isBlacklisted: false,
            isActive: true,
            failCount: 0,
        },
    };
};

const MIN_SOURCE_LIQUIDITY = 5000;
const MIN_LIQUIDITY_FOR_LIVE_QUOTE = 100000;

/**
 * Uma linha do Fundamentus: correção de typo, duplicidade pós-correção,
 * aposentadoria (terminal — vale mesmo com dado bom na fonte) e liquidez mínima
 * para não sujar o banco com lixo. Aceita, vira operação + leitura da série.
 */
function ingestFundamentusRow(run, rawTicker, data, type) {
    const classStats = run.ingestionStats[type];
    // 1. CAMADA DE SANITIZAÇÃO (CORREÇÃO DE TYPOS)
    const ticker = correctSourceTicker(rawTicker, type === 'FII' ? run.fiiMap : run.stocksMap);
    if (ticker !== rawTicker) run.typosFixed++;

    // 2. FILTRO DE DUPLICIDADE PÓS-CORREÇÃO
    if (run.processedTickers.has(ticker)) {
        classStats.duplicates++;
        return;
    }
    run.processedTickers.add(ticker);

    // 3. FILTRO DE APOSENTADORIA
    if (run.retiredTickers.has(ticker)) {
        classStats.retired++;
        return;
    }

    const liquidity = Number(data.liq2m) || Number(data.liquidity) || 0;
    if (liquidity < MIN_SOURCE_LIQUIDITY) {
        classStats.rejectedLowLiquidity++;
        return;
    }
    classStats.accepted++;

    const update = buildFundamentusAssetUpdate({ ticker, type, data, liquidity, timestamp: run.timestamp });
    const updateFields = update.$set;
    run.operations.push({ updateOne: { filter: { ticker: ticker }, update, upsert: true } });

    // (Fase 3) Coleta a leitura de fundamentos para a série temporal (track record).
    // payout vem por carry-forward em ltmFields; aqui usamos o dado bruto do scrape.
    run.snapshotRecords.push({
        ticker,
        type,
        roe: updateFields.roe,
        netMargin: updateFields.netMargin,
        payout: num(data.payout),
        dy: updateFields.dy,
        revenueGrowth: updateFields.revenueGrowth,
        pl: updateFields.pl,
    });
}

/** Etapa 2: as duas listagens do Fundamentus viram operações de gravação. */
function ingestFundamentus({ stocksMap, fiiMap, retiredTickers, ingestionStats, timestamp }) {
    const run = {
        stocksMap, fiiMap, retiredTickers, ingestionStats, timestamp,
        processedTickers: new Set(),
        typosFixed: 0, // Contador para Monitor de Qualidade
        operations: [],
        // (Fase 3) Leituras de fundamentos a anexar na série temporal (track record).
        snapshotRecords: [],
    };
    if (stocksMap.size > 0) stocksMap.forEach((v, k) => ingestFundamentusRow(run, k, v, 'STOCK'));
    if (fiiMap.size > 0) fiiMap.forEach((v, k) => ingestFundamentusRow(run, k, v, 'FII'));
    return run;
}

/** Tickers da Etapa 3: BR com liquidez para cotação ao vivo + exterior/cripto. */
function collectLiveQuoteTickers(operations, externalTickers) {
    const validTickers = [];
    // Reconstrói a lista de validTickers baseada nos dados JÁ SANITIZADOS
    operations.forEach(op => {
        const update = op.updateOne?.update?.$set;
        if (update?.liquidity > MIN_LIQUIDITY_FOR_LIVE_QUOTE) validTickers.push(op.updateOne.filter.ticker);
    });
    // Exterior/cripto entram direto: a escrita de cotação deles saiu da
    // Etapa 2 (ver `externalTickers`), e o filtro de liquidez acima lia
    // justamente a `liquidity` que aquela escrita punha em `operations`.
    validTickers.push(...externalTickers);
    return validTickers;
}

/** Etapas 2 (estatísticas), 3, 4 e 4.5 — depois de o acervo ter sido gravado. */
async function finishPersistedSync({ operations, typosFixed, ingestionHealth, externalTickers }) {
    await saveHealthySyncStats(typosFixed, operations.length, ingestionHealth.stats);
    const { STOCK, FII } = ingestionHealth.stats;
    logger.info(
        `ℹ️ [Sync] Etapa 2: STOCK ${STOCK.accepted}/${STOCK.parsed} · ` +
        `FII ${FII.accepted}/${FII.parsed} aceitos ` +
        `(operações totais: ${operations.length}; typos: ${typosFixed}).`
    );

    logger.info("ℹ️ [Sync] Etapa 3: Cotações em tempo real");
    await refreshQuotesInBatches(collectLiveQuoteTickers(operations, externalTickers));

    // Etapa 4: Fundamentals US (1x/dia via guard de tempo)
    await runDailyStep({
        stampField: 'lastUSFundamentalsSync',
        stepLabel: 'Etapa 4',
        skipMessage: "ℹ️ [Sync] Etapa 4: Fundamentals US — já sincronizados nas últimas 23h, pulando.",
        run: async () => {
            logger.info("ℹ️ [Sync] Etapa 4: Fundamentals S&P 500 (sincronização diária)");
            await usStocksFundamentalsService.syncUSStocksFundamentals();
            // ETFs nacionais (B3) — dy/marketCap via Yahoo .SA (o seed não traz fundamentos)
            await usStocksFundamentalsService.syncBrEtfFundamentals();
        },
    });
    // Etapa 4.5: Enriquecimento LTM via Yahoo Finance para ações BR (1x/dia)
    await runDailyStep({
        stampField: 'lastBRLTMEnrichSync',
        stepLabel: 'Etapa 4.5',
        skipMessage: "ℹ️ [Sync] Etapa 4.5: LTM BR — já enriquecido nas últimas 23h, pulando.",
        run: enrichBRStocksLTM,
    });

    return {
        success: true,
        count: operations.length,
        fundamentalsProcessed: STOCK.accepted + FII.accepted,
        fundamentals: ingestionHealth.stats,
    };
}

async function runFullSyncStages() {
    logger.info("ℹ️ [Sync] Etapa 1: Macroeconomia");
    await macroDataService.performMacroSync();

    logger.info("ℹ️ [Sync] Etapa 2: Fundamentos (Scraping)");
    const timestamp = new Date();
    const stocksMap = await fundamentusService.getStocksMap();
    const fiiMap = await fundamentusService.getFIIsMap();
    const ingestionStats = createFundamentusStats({ stockParsed: stocksMap.size, fiiParsed: fiiMap.size });

    if (stocksMap.size === 0 && fiiMap.size === 0) {
        const stats = finalizeFundamentusStats(ingestionStats);
        await saveFailedSyncStats({ typosFixed: 0, errorCode: 'FUNDAMENTUS_BLOCKED', fundamentals: stats, timestamp });
        return { success: false, error: "Scraping blocked.", errorCode: 'FUNDAMENTUS_BLOCKED', fundamentals: stats };
    }

    const retiredTickers = await loadRetiredTickers();
    const { operations, snapshotRecords, typosFixed } = ingestFundamentus({
        stocksMap, fiiMap, retiredTickers, ingestionStats, timestamp,
    });
    const ingestionHealth = validateFundamentusIngestion(ingestionStats);
    if (!ingestionHealth.ok) return reportDegradedIngestion(ingestionHealth, typosFixed, timestamp);

    // 3. Atualiza Ativos Internacionais e Cripto (seed; a cotação é da Etapa 3)
    const externalTickers = await prepareExternalAssets(operations);

    // Etapa 3.5: Seed inicial S&P 500 + ETFs nacionais (cria registros se não existirem)
    logger.info("ℹ️ [Sync] Etapa 3.5: Seed S&P 500 + ETFs nacionais (se necessário)");
    await usStocksFundamentalsService.seedSP500Assets();
    await usStocksFundamentalsService.seedBrEtfAssets();

    if (operations.length === 0) return { success: false, count: 0, error: "Nenhum ativo válido encontrado." };

    // A gravação do acervo é o ÚNICO write desta etapa sem rede de
    // proteção: um timeout aqui derruba o sync inteiro (a etapa é
    // crítica). Todos os ops são $set+upsert por ticker, então
    // re-aplicar é seguro. Ver utils/mongoResilience.js.
    await withMongoRetry(() => MarketAsset.bulkWrite(operations), { label: 'acervo de ativos' });
    await runPostWriteBackfills(snapshotRecords, timestamp);
    return finishPersistedSync({ operations, typosFixed, ingestionHealth, externalTickers });
}

export const syncService = {
    /**
     * Orquestrador Principal de Sincronização.
     *
     * Envelopado em `trackJob` para que TODA execução — script manual, botão do
     * Admin ou rotina diária — deixe registro no painel de Saúde dos Dados. Ao
     * final dispara a sentinela: o momento logo após o sync é justamente quando
     * uma quebra de fonte é mais detectável.
     */
    async performFullSync() {
        const result = await trackJob('full-sync', () => withJobLease('full-sync', () => this._runFullSync()));
        // Fora do trackJob: uma falha ao avaliar a saúde não deve marcar o sync
        // (que pode ter ido bem) como falho.
        try {
            const { runDataHealthCheck } = await import('./dataHealthService.js');
            await runDataHealthCheck({ trigger: 'SYNC' });
        } catch (err) {
            logger.debug(`[Sync] Sentinela de saúde não rodou: ${err.message}`);
        }
        return result;
    },

    async _runFullSync() {
        try {
            return await runFullSyncStages();
        } catch (error) {
            logger.error(`❌ [Sync Interno] Falha: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};
