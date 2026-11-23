
import mongoose from 'mongoose';
import { runTransaction, txError } from '../utils/dbTransaction.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UserAsset from '../models/UserAsset.js';
import DividendEvent from '../models/DividendEvent.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import EconomicIndex from '../models/EconomicIndex.js'; 
import AuditLog from '../models/AuditLog.js'; // Novo
import { marketDataService } from './marketDataService.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js'; // (M9)
import { externalMarketService } from './externalMarketService.js';
import { DERIVED_EXPIRY_MS, DERIVED_RECONCILE_WINDOW_MS } from '../utils/dividendGap.js';
import { safeCurrency, safeAdd, safeMult, safeDiv, safeValue, addQty, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import { HISTORICAL_CDI_RATES } from '../config/financialConstants.js';
import { isBusinessDay, toDateKey as toDateKeyUtil, startOfDay } from '../utils/dateUtils.js';
import { normalizeToUtcDay, resolvePaymentDate as resolvePaymentDateUtil } from '../utils/dividendPaymentDate.js';
import { fillPaymentDatesForTicker } from './dividendPaymentDateService.js';
import { isDollarized as isDollarizedAsset } from '../utils/assetCurrency.js';
import logger from '../config/logger.js';
import { dropUntradableCandles, historyStorageKey } from '../utils/assetHistory.js';
import { brazilDayKey, isValidDayKey } from '../utils/walletSnapshot.js';
import { loadUsdRateResolver, positionCostBRL } from '../utils/fxRate.js';
import { markLotsToMarket, accrueLotsValue } from '../utils/fixedIncome.js';
import { loadCdiCurve, annualRateFromDailyFactor } from '../utils/cdiCurve.js';
import { loadTreasuryPricing, EMPTY_TREASURY_PRICING } from './treasuryPriceService.js';
import {
    buildRebuildSnapshot, cdiFactorForDay, dayDividendCash, describeCoverageGaps, missingMacroRates, nextQuota,
    rebuildWindow, requiredFromByTicker, resolveRebuildRates,
} from '../utils/rebuildHistoryRules.js';
import { isAccumulatingBrEtf } from '../config/brEtfList.js';
import { applyDayTransactions } from '../utils/rebuildDayTransactions.js';
import {
    resolveNativeCurrency, buildFxRateOf, replayPositionLedger, stampFxRates, createPositionAsset, healAllocationClass, applyLedgerToAsset,
    refreshUsSubType,
} from './positionRecalc.js';

export const financialService = {
    
    // (6.10) Delegam ao utilitário único de datas (utils/dateUtils.js) — mantidos
    // como métodos para preservar todos os call sites internos (this.toDateKey).
    toDateKey(date) {
        return toDateKeyUtil(date);
    },

    normalizeDate(date) {
        return startOfDay(date);
    },

    // Identidade canônica de um provento = ticker + ex-date (dia) + type.
    // O MESMO pagamento mensal volta de fontes diferentes (Yahoo/Brapi/
    // Fundamentus) com hora diferente (00:00Z vs 13:00Z) E valor levemente
    // diferente (ex.: 0.109829 vs 0.109744). O índice antigo {ticker,date,amount}
    // NÃO os unia (o valor difere), gerando DOIS eventos por mês e DOBRANDO a
    // soma de proventos. Por isso o valor NÃO entra na identidade: mesmo ticker
    // + mesma ex-date = mesmo provento. `type` distingue DIVIDEND × JCP etc.
    normalizeDividendDate(date) {
        return normalizeToUtcDay(date);
    },

    roundDividendAmount(amount) {
        return Math.round((Number(amount) || 0) * 1e6) / 1e6;
    },

    // Data de pagamento pela régua ÚNICA do projeto (utils/dividendPaymentDate.js):
    // a oficial quando a fonte publica, senão ex-date + 15 dias em UTC, marcada como
    // estimativa. Mantido como método porque os call sites internos usam `this`.
    resolvePaymentDate(event) {
        return resolvePaymentDateUtil(event);
    },

    // Chave de deduplicação: ticker + dia (UTC) + type. Sem o valor por ação.
    dividendIdentity(ticker, date, type = 'DIVIDEND') {
        return `${String(ticker).toUpperCase()}|${this.toDateKey(this.normalizeDividendDate(date))}|${type || 'DIVIDEND'}`;
    },

    normalizeTickerForHistory(ticker) {
        const clean = ticker.trim().toUpperCase();
        if (clean.endsWith('.SA') || clean.startsWith('^') || clean.includes('-')) return clean;
        if (/^[A-Z]{4}\d{1,2}B?$/.test(clean)) return `${clean}.SA`;
        return clean;
    },

    indexHistoryByDate(history) {
        const map = new Map();
        if (!history || !Array.isArray(history)) return map;
        history.forEach(h => {
            if (h.date) {
                map.set(h.date, { 
                    close: h.close || 0, 
                    adjClose: h.adjClose || h.close || 0 
                });
            }
        });
        return map;
    },

    findPriceInMap(priceMap, dateStr) {
        if (!priceMap || priceMap.size === 0) return { close: 0, adjClose: 0 };
        if (!isValidDayKey(dateStr)) return { close: 0, adjClose: 0 };
        if (priceMap.has(dateStr)) return priceMap.get(dateStr);
        const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
        for (let i = 1; i <= 5; i++) {
            const prevDate = new Date(targetDate);
            prevDate.setUTCDate(targetDate.getUTCDate() - i);
            const prevKey = prevDate.toISOString().split('T')[0];
            if (priceMap.has(prevKey)) return priceMap.get(prevKey);
        }
        return { close: 0, adjClose: 0 };
    },

    /**
     * Carrega o histórico USD/BRL e devolve um resolvedor de taxa por data.
     * Para datas sem cotação, faz busca binária pela taxa mais recente <= alvo,
     * evitando cair na taxa ATUAL em datas passadas com gaps (P&L histórico).
     */
    /**
     * Câmbio do PROVENTO: `(ticker, dayKey) => taxa`, 1 para ativo em real.
     *
     * DividendEvent.amount fica na moeda da fonte, por ação — e para STOCK_US (e
     * ETF/REIT em dólar) o Yahoo publica em DÓLAR. Toda soma de provento da carteira
     * (rebuild, snapshot, acumulado, tela de Proventos) é em REAIS, e somava o valor
     * em dólar como se fosse real: 10 AAPL × US$ 0,25 viravam R$ 2,50 em vez de
     * ~R$ 13,75, subestimando proventos, resultado e a renda do TWRR no dia-ex.
     *
     * A moeda vem do ATIVO (posição ou lançamento), não do evento: o `currency` do
     * DividendEvent sempre foi gravado 'BRL' e não diz nada. A taxa é a do DIA-EX
     * — a mesma régua do acumulado, que credita o provento na data-ex.
     *
     * `assetsLike`: posições/lançamentos com { ticker, type?, currency? }.
     * `getUsdRateForDate`: resolvedor já carregado pelo chamador (evita 2ª leitura).
     */
    async _dividendFxResolver(assetsLike, getUsdRateForDate = null) {
        const dollarTickers = new Set();
        for (const a of assetsLike || []) {
            if (a && isDollarizedAsset(a)) dollarTickers.add(String(a.ticker).toUpperCase());
        }
        if (dollarTickers.size === 0) return () => 1;
        let resolve = getUsdRateForDate;
        if (!resolve) {
            const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).select('dollar').lean().catch(() => null);
            resolve = await this._loadUsdRateResolver(macro?.dollar);
        }
        return (ticker, dayKey) => (dollarTickers.has(String(ticker).toUpperCase()) ? resolve(dayKey) : 1);
    },

    async _loadUsdRateResolver(currentUsdRate) {
        // Implementação única em utils/fxRate.js — a mesma que carimba o câmbio de
        // compra nos lançamentos, para que P&L histórico e custo da posição não
        // possam divergir por terem resolvedores diferentes.
        return loadUsdRateResolver(currentUsdRate);
    },

    /**
     * Monta o cache de preços (Map ticker → Map data→{close,adjClose}) para os
     * tickers de renda variável. Faz fallback para externalMarketService quando
     * o histórico local é curto, persistindo o resultado em AssetHistory.
     *
     * `requiredFromByTicker` (Map ticker → dayKey do 1º dia em que a carteira
     * segurou o papel) é o que torna a profundidade da série uma exigência, não
     * um acaso: o timeSeriesWorker grava `history.slice(-ASSET_HISTORY_MAX_POINTS)`
     * (~1,6 ano) para todo ticker fora de HISTORY_CAP_EXEMPT_TICKERS. Uma série
     * truncada tem 400 candles — passa folgada no antigo teste `length < 5` — e
     * fazia o rebuild marcar TODO o período anterior ao cap pelo preço de compra.
     */
    async _loadPriceCacheMap(uniqueTickers, assetMetadataMap, requiredFromByTicker = new Map()) {
        const priceCacheMap = new Map();

        await Promise.all(uniqueTickers.map(async (ticker) => {
            const assetMeta = assetMetadataMap.get(ticker);
            if (assetMeta?.type === 'FIXED_INCOME' || assetMeta?.type === 'CASH' || ticker === 'RESERVA') return;

            try {
                const searchTicker = this.normalizeTickerForHistory(ticker);
                let history = await marketDataService.getBenchmarkHistory(ticker, assetMeta?.type || 'INDEX');

                const requiredFrom = requiredFromByTicker.get(ticker) || null;
                const firstCandle = history?.length ? history[0]?.date : null;
                // Rasa = sem série, ou série que não alcança o 1º dia da posição.
                const isShallow = !history
                    || history.length < 5
                    || (requiredFrom && (!firstCandle || firstCandle > requiredFrom));

                if (isShallow) {
                    const info = await MarketAsset.findOne({ ticker });
                    const type = assetMeta?.type || info?.type || 'STOCK';
                    try {
                        // Recusa candle em dia sem pregão antes de qualquer uso: este
                        // caminho grava por SUBSTITUIÇÃO (não passa por mergeCandleSeries),
                        // então é a única barreira aqui.
                        const extHistory = dropUntradableCandles(
                            await externalMarketService.getFullHistory(searchTicker, type), type);
                        if (extHistory && extHistory.length > 0) {
                            // Só persiste quando não havia série utilizável. Regravar a
                            // série cheia num ticker que o worker capa todo dia às 18:30
                            // seria escrever para ser truncado de novo — o rebuild usa a
                            // série profunda em memória e deixa o cache como está.
                            if (!history || history.length < 5) {
                                await AssetHistory.updateOne(
                                    { ticker: historyStorageKey(ticker, type) },
                                    { history: extHistory, lastUpdated: new Date() },
                                    { upsert: true }
                                );
                            }
                            if (!history || extHistory.length > history.length) history = extHistory;
                        }
                    } catch (err) {
                        // Fallback externo é best-effort: sem histórico, o ativo é
                        // marcado pelo último preço conhecido/custo no loop. Logamos
                        // em debug para a falha não ficar invisível.
                        logger.debug(`[History] Fallback externo falhou para ${ticker}: ${err.message}`);
                    }
                }

                if (history && history.length > 0) {
                    priceCacheMap.set(ticker, this.indexHistoryByDate(history));
                }
            } catch (e) {
                logger.warn(`Histórico falhou para ${ticker}: ${e.message}`);
            }
        }));

        return priceCacheMap;
    },

    /**
     * Tickers cuja série de preços NÃO cobre o período em que a carteira teve a
     * posição. Devolve `[{ ticker, requiredFrom, availableFrom }]`.
     *
     * Sem esta checagem o rebuild é silenciosamente destrutivo: `_markPortfolioToMarket`
     * cai no último preço conhecido (na prática, o preço da 1ª compra) e grava anos de
     * patrimônio congelado no custo — cota parada em 100 — e depois um degrau de vários
     * por cento no primeiro dia com candle, pequeno demais para o circuit breaker de
     * TWRR (50%) barrar. Foi exatamente o que aconteceu numa carteira de produção:
     * 1.244 dias marcados no custo e um salto de +16,01% no dia em que a série começava.
     */
    findPriceCoverageGaps(priceCacheMap, requiredFromByTicker) {
        const gaps = [];
        for (const [ticker, requiredFrom] of requiredFromByTicker) {
            const priceMap = priceCacheMap.get(ticker);
            if (!priceMap || priceMap.size === 0) {
                gaps.push({ ticker, requiredFrom, availableFrom: null });
                continue;
            }
            let availableFrom = null;
            for (const day of priceMap.keys()) {
                if (availableFrom === null || day < availableFrom) availableFrom = day;
            }
            // `findPriceInMap` já olha até 5 dias para trás (fim de semana/feriado);
            // a mesma folga vale aqui para não acusar gap de uma compra na sexta.
            const tolerated = new Date(`${requiredFrom}T12:00:00.000Z`);
            tolerated.setUTCDate(tolerated.getUTCDate() + 5);
            if (availableFrom > tolerated.toISOString().slice(0, 10)) {
                gaps.push({ ticker, requiredFrom, availableFrom });
            }
        }
        return gaps;
    },

    /**
     * Proventos ACUMULADOS da carteira até um dia, pela mesma regra do rebuild:
     * soma por EX-DATE, com a quantidade que a carteira tinha NAQUELE dia.
     *
     * Existe para que o job diário e o rebuild gravem o MESMO `totalDividends` no
     * snapshot. O diário usava `calculateUserDividends().totalAllTime`, que conta
     * por DATA DE PAGAMENTO e multiplica cada evento pela quantidade de HOJE —
     * numa carteira que dobrou a posição, isso creditava o dobro dos proventos
     * realmente recebidos (produção: R$ 873,78 gravado × R$ 477,50 real), e o
     * número saltava sozinho no primeiro rebuild. `calculateUserDividends`
     * continua servindo a tela de Proventos (recorte mensal por pagamento), que é uma
     * visão de CAIXA — lá "recebido" e "provisionado" aparecem separados e rotulados.
     */
    async accruedDividendsThroughDay(userId, walletId, throughDayKey, options = {}) {
        const { total } = await this.accrueDividendsByTicker(userId, walletId, throughDayKey, options);
        return total;
    },

    /**
     * Mesma soma de `accruedDividendsThroughDay`, com o detalhe por ticker.
     *
     * O detalhe existe porque a coluna "Rentabilidade" da carteira ((saldo − custo +
     * proventos) / custo) sofre do MESMO vão que o KPI: no dia-ex o preço do ativo já
     * caiu, e se o provento daquele ativo só for creditado na data de pagamento, a
     * linha exibe um prejuízo que não existe. Por ativo e no total, a regra tem que
     * ser uma só — senão as partes deixam de somar o todo.
     *
     * `paid` / `pending` quebram o MESMO total pela data de pagamento (paid + pending
     * === total, por construção). É a ponte que a tela de Proventos usa para explicar
     * por que o gráfico de pagamentos mostra um número menor que o card: a diferença é
     * exatamente o que já foi declarado e ainda não caiu na conta. Recalcular essa
     * quebra por fora — somando `totalAllTime` com `provisioned` — daria quase sempre o
     * mesmo número e ERRARIA justamente quando a posição mudou entre as ex-dates, que é
     * o caso em que o acumulado importa.
     *
     * `options.sinceDayKey` (EXCLUSIVO) abre um segundo balde no mesmo laço:
     * `sinceTotal`/`sinceByTicker` contam só as ex-dates POSTERIORES àquele dia. É o
     * que o detalhamento da Variação Hoje usa para explicar a queda do dia-ex — no
     * dia em que o ativo fica ex, o preço cai e o crédito ainda não aparece em lugar
     * nenhum da tela. A janela é a MESMA que a variação mede (o dia-âncora), não
     * "hoje": numa segunda após feriado a âncora é quinta, e usar hoje deixaria de
     * fora os proventos de sexta.
     */
    async accrueDividendsByTicker(userId, walletId, throughDayKey, options = {}) {
        const sinceDayKey = options.sinceDayKey || null;
        const txs = options.transactions
            || await AssetTransaction.find({ user: userId, wallet: walletId }).sort({ date: 1 });
        if (!txs || txs.length === 0) {
            return { total: 0, paid: 0, pending: 0, byTicker: {}, sinceTotal: 0, sinceByTicker: {} };
        }

        const dividendDateMap = options.dividendDateMap
            || await this._loadDividendDateMap([...new Set(txs.map(t => t.ticker))]);
        // Moeda: lançamento com currency gravado + posição atual (cobre o legado sem
        // o campo). Posição zerada e sem registro fica em real, como antes. Com
        // `transactions` injetado e sem `assets`, fica só com os lançamentos: o
        // caminho injetado é puro (não vai ao banco) por contrato.
        const positions = options.assets
            || (options.transactions ? [] : await UserAsset.find({ user: userId, wallet: walletId }).select('ticker type currency').lean());
        const dividendFx = options.dividendFx || await this._dividendFxResolver([
            ...txs.filter(t => t.currency === 'USD'),
            ...positions,
        ], options.getUsdRateForDate || null);

        const days = [...dividendDateMap.keys()].filter(d => d <= throughDayKey).sort();
        const qty = {};
        const byTicker = {};
        const sinceByTicker = {};
        let txIndex = 0;
        let total = 0;
        let paid = 0;
        let sinceTotal = 0;

        for (const day of days) {
            // Direito ao provento do dia-ex D = posição ao FIM do pregão anterior:
            // só entram as transações com data ESTRITAMENTE anterior a D. Quem
            // compra NO dia-ex já compra "ex" (não recebe) e quem vende NO dia-ex
            // vendeu "com" (recebe). Aplicar as transações do dia antes (`<=`) dava
            // o provento a quem não tinha direito e o tirava de quem tinha. Mesma
            // regra do rebuild, do snapshot diário e de `calculateUserDividends`
            // — divergir aqui reabre o vão KPI × snapshot.
            while (txIndex < txs.length && this.toDateKey(txs[txIndex].date) < day) {
                const tx = txs[txIndex];
                const delta = tx.type === 'SELL' ? -tx.quantity : tx.quantity;
                qty[tx.ticker] = addQty(qty[tx.ticker] || 0, delta);
                if (qty[tx.ticker] < QUANTITY_EPSILON) qty[tx.ticker] = 0;
                txIndex++;
            }
            for (const div of dividendDateMap.get(day)) {
                if (qty[div.ticker] > 0) {
                    const value = qty[div.ticker] * div.amount * dividendFx(div.ticker, day);
                    total = safeAdd(total, value);
                    byTicker[div.ticker] = safeAdd(byTicker[div.ticker] || 0, value);
                    if (sinceDayKey && day > sinceDayKey) {
                        sinceTotal = safeAdd(sinceTotal, value);
                        sinceByTicker[div.ticker] = safeAdd(sinceByTicker[div.ticker] || 0, value);
                    }
                    // Oficial quando existe; senão a estimativa única do serviço.
                    const payKey = this.toDateKey(this.resolvePaymentDate({ date: day, paymentDate: div.paymentDate }).date);
                    if (payKey <= throughDayKey) paid = safeAdd(paid, value);
                }
            }
        }

        for (const ticker of Object.keys(byTicker)) byTicker[ticker] = safeCurrency(byTicker[ticker]);
        for (const ticker of Object.keys(sinceByTicker)) sinceByTicker[ticker] = safeCurrency(sinceByTicker[ticker]);
        const safeTotal = safeCurrency(total);
        const safePaid = safeCurrency(paid);
        // `pending` é derivado da subtração, nunca somado em paralelo: garante que as
        // duas parcelas fechem o total exibido mesmo com arredondamento de centavo.
        return {
            total: safeTotal,
            paid: safePaid,
            pending: safeCurrency(safeTotal - safePaid),
            byTicker,
            sinceTotal: safeCurrency(sinceTotal),
            sinceByTicker,
        };
    },

    /** Indexa todos os proventos dos tickers por data (chave toDateKey). */
    async _loadDividendDateMap(uniqueTickers) {
        const allDividends = await DividendEvent.find({ ticker: { $in: uniqueTickers } }).sort({ date: 1 });
        const dividendDateMap = new Map();
        // Deduplica por identidade canônica (ticker+ex-date+type) — o mesmo
        // provento de 2 fontes não deve dobrar accumulatedDividends.
        const seen = new Set();
        allDividends.forEach(div => {
            const dKey = this.toDateKey(div.date);
            const canonKey = this.dividendIdentity(div.ticker, div.date, div.type);
            if (seen.has(canonKey)) return;
            seen.add(canonKey);
            if (!dividendDateMap.has(dKey)) dividendDateMap.set(dKey, []);
            dividendDateMap.get(dKey).push(div);
        });
        return dividendDateMap;
    },

    /**
     * Fatores diários do CDI. Devolve o Map de fatores acumulados da série SELIC
     * (também usado como flag de dia útil em `_accrueDailyFixedIncome`) e um
     * fallback prefixado por ano para datas sem série no banco.
     */
    async _loadCdiFactors(startDate, today, currentCdiRate) {
        const dbIndices = await EconomicIndex.find({
            series: 'SELIC',
            date: { $gte: startDate }
        }).lean();

        const dailyFactorsMap = new Map();
        dbIndices.forEach(idx => {
            const key = this.toDateKey(idx.date);
            if (key) dailyFactorsMap.set(key, idx.accumulatedFactor);
        });

        const cdiFactorsCacheFallback = {};
        const currentYear = today.getFullYear();
        for (let y = startDate.getFullYear(); y <= currentYear; y++) {
            let rate = HISTORICAL_CDI_RATES[y] || 10.0;
            if (y === currentYear) rate = currentCdiRate;
            cdiFactorsCacheFallback[y] = Math.pow(1 + (rate / 100), 1/252);
        }

        return { dailyFactorsMap, cdiFactorsCacheFallback };
    },

    /**
     * Aplica as transações cujo dia <= cursor (ver utils/rebuildDayTransactions.js),
     * mutando `portfolio` e `fixedIncomeState` in-place. Devolve o novo `txIndex` e
     * o fluxo de caixa ajustado do dia (para o Modified Dietz).
     */
    _applyDayTransactions(ctx) {
        const { treasuryPricing = EMPTY_TREASURY_PRICING } = ctx;
        return applyDayTransactions({ ...ctx, treasuryPricing }, (priceMap, dayKey) => this.findPriceInMap(priceMap, dayKey));
    },

    /**
     * Atualiza o valor da renda fixa do dia (mutando `fixedIncomeState`).
     *
     * Título público com série de PU é MARCADO A MERCADO: o valor do dia é
     * recalculado do zero pela razão de PU sobre os lotes, e não composto a partir
     * do dia anterior. Recompor sobre o valor anterior propagaria para sempre
     * qualquer dia sem cotação.
     *
     * O resto (RF privada, título com cupom semestral, título fora da série)
     * segue no accrual, que só rende em dia útil. Antes usava !isWeekend, que
     * aplicava CDI também em FERIADOS (ex.: Corpus Christi) — divergindo do
     * KPI/benchmark (que usam countBusinessDays, pulando feriados).
     */
    _accrueDailyFixedIncome(ctx) {
        const { cursor, cursorIso, portfolio, fixedIncomeState, dailyFactorsMap, cdiDailyFactor, currentIpcaRate, currentSelicRate, currentCdiRate, cdiCurve = null } = ctx;
        const isMapFactor = dailyFactorsMap.has(cursorIso);
        const shouldApplyRates = isMapFactor || isBusinessDay(cursor);

        for (const ticker in fixedIncomeState) {
            const marked = fixedIncomeState[ticker];
            if (!marked.history || portfolio[ticker].qty <= 0 || marked.lots.length === 0) continue;
            // Vencido: resgatado ao par, o valor congela no PU do vencimento.
            const refIso = (marked.maturityIso && cursorIso > marked.maturityIso) ? marked.maturityIso : cursorIso;
            const value = markLotsToMarket(marked.lots, marked.history, refIso);
            // Dia sem PU publicado (feriado, buraco na fonte): mantém o último
            // valor, como o rebuild já faz com ação sem candle no dia.
            if (value !== null) marked.currentValue = value;
        }

        if (!shouldApplyRates) return;

        // Recalculado DO ZERO a partir dos lotes, como o ramo marcado a mercado logo
        // acima já fazia — e pela MESMA função que o KPI ao vivo e o snapshot diário
        // usam (`utils/fixedIncome.accrueLotsValue`).
        //
        // A composição incremental que morava aqui era uma segunda implementação da
        // mesma conta, e divergia em dois pontos: aplicava o fator no próprio dia da
        // compra (um dia útil de juros a mais em toda a série) e não congelava o
        // accrual no vencimento. Recompor a partir do valor do dia anterior também
        // propagava para sempre qualquer erro de um único dia.
        for (const ticker in fixedIncomeState) {
            if (portfolio[ticker].qty > 0 && !fixedIncomeState[ticker].history) {
                const state = fixedIncomeState[ticker];
                const endIso = (state.maturityIso && cursorIso > state.maturityIso)
                    ? state.maturityIso
                    : cursorIso;
                state.currentValue = accrueLotsValue(
                    state.lots.map((lot) => ({ date: `${lot.dateIso}T00:00:00.000Z`, principal: lot.cost })),
                    { fixedIncomeIndex: state.index, fixedIncomeSpread: state.spread, fixedIncomeRate: state.rate },
                    {
                        // CDI/Selic CORRENTES, iguais aos que o KPI ao vivo passa: a
                        // taxa de cada dia vem da curva, e este par serve só de
                        // recurso e de base do spread SELIC−CDI. Passar aqui o CDI
                        // do próprio dia faria o spread histórico sair diferente do
                        // que o card calcula, reabrindo o vão que a curva fecha.
                        cdiRate: currentCdiRate ?? annualRateFromDailyFactor(cdiDailyFactor) ?? DEFAULT_SELIC_FALLBACK,
                        selic: currentSelicRate,
                        ipca: currentIpcaRate,
                        endDate: new Date(`${endIso}T00:00:00.000Z`),
                        cdiCurve,
                    },
                );
            }
        }
    },

    /**
     * Marca a carteira a mercado no dia (atualizando `lastKnownPrices`). Devolve
     * patrimônio nominal/ajustado, total investido (a custo) e se há posição.
     * Renda fixa é marcada pelo valor acumulado; renda variável pelo preço do dia
     * com fallback ao último preço conhecido. Aritmética idêntica à original.
     */
    _markPortfolioToMarket(ctx) {
        const { cursorIso, portfolio, fixedIncomeState, assetMetadataMap, priceCacheMap, lastKnownPrices, usdRateForDay } = ctx;
        let totalEquityNominal = 0;
        let totalEquityAdjusted = 0;
        let totalInvested = 0;
        let hasPosition = false;

        for (const ticker in portfolio) {
            const pos = portfolio[ticker];
            if (pos.qty <= 0) continue;
            hasPosition = true;

            const meta = assetMetadataMap.get(ticker);
            // Câmbio do dia vale para MARCAR A MERCADO (patrimônio), nunca para o
            // custo: reconverter o custo faz o Valor Aplicado histórico oscilar
            // junto com o dólar e cancela o resultado cambial contra o patrimônio.
            const fxRate = isDollarizedAsset(meta) ? usdRateForDay : 1;

            // `?? ` protege contra portfolio montado por chamador antigo (sem o
            // acumulado em BRL): melhor cair no cálculo legado do que injetar NaN
            // num snapshot, que só estouraria lá na frente na validação do schema.
            totalInvested = safeAdd(totalInvested, pos.costBrl ?? (pos.cost * fxRate));

            let markClose = 0;
            let markAdjClose = 0;

            if (fixedIncomeState[ticker]) {
                // Renda fixa entra pelo TOTAL acumulado, com precisão integral —
                // como no snapshot diário (`computeEquityAt`). Reconstruir via
                // quantidade × (valor ÷ quantidade) só reintroduz resíduo de float.
                const val = fixedIncomeState[ticker].currentValue;
                totalEquityNominal += val * fxRate;
                totalEquityAdjusted += val * fxRate;
                continue;
            } else {
                const pMap = priceCacheMap.get(ticker);
                const pData = this.findPriceInMap(pMap, cursorIso);

                if (pData.close > 0) {
                    markClose = pData.close;
                    markAdjClose = pData.adjClose;
                    lastKnownPrices[ticker] = pData;
                } else {
                    markClose = lastKnownPrices[ticker]?.close || (pos.cost / pos.qty);
                    markAdjClose = lastKnownPrices[ticker]?.adjClose || markClose;
                }
            }

            // Regra 7: mesma aritmética segura do snapshot diário (`computeEquityAt`:
            // safeValue → câmbio → centavos, por ativo). Com `qty × preço × câmbio`
            // em float cru o rebuild e o job diário divergiam no centavo, e todo
            // rebuild reescrevia o patrimônio histórico por arredondamento.
            totalEquityNominal = safeAdd(totalEquityNominal, safeCurrency(safeMult(safeValue(pos.qty, markClose), fxRate)));
            totalEquityAdjusted = safeAdd(totalEquityAdjusted, safeCurrency(safeMult(safeValue(pos.qty, markAdjClose), fxRate)));
        }

        return { totalEquityNominal, totalEquityAdjusted, totalInvested, hasPosition };
    },

    /** Substitui os snapshots da carteira pelos recém-calculados (em transação, em lotes). */
    async _persistSnapshots(userId, walletId, snapshots) {
        await runTransaction(async (session) => {
            await WalletSnapshot.deleteMany({ user: userId, wallet: walletId }).session(session);
            const CHUNK_SIZE = 5000;
            for (let i = 0; i < snapshots.length; i += CHUNK_SIZE) {
                await WalletSnapshot.insertMany(snapshots.slice(i, i + CHUNK_SIZE), { session });
            }
        });
    },

    /** Contexto do rebuild: posições, séries de preço, proventos, câmbio e PU (cada fonte num helper testável). */
    async _loadRebuildContext(userId, walletId, txs, rates) {
        const userAssets = await UserAsset.find({ user: userId, wallet: walletId });
        const assetMetadataMap = new Map(userAssets.map(ua => [ua.ticker, ua]));
        const requiredFrom = requiredFromByTicker(txs, assetMetadataMap);
        const uniqueTickers = [...new Set(txs.map(t => t.ticker))];
        const getUsdRateForDate = await this._loadUsdRateResolver(rates.currentUsdRate);
        // Regra 13: sem a taxa de que a carteira precisa, aborta (o histórico atual fica preservado).
        const missing = missingMacroRates(rates, { txs, userAssets, usdSeries: getUsdRateForDate.hasSeries === true });
        if (missing.length > 0) throw new Error(`Macro sem ${missing.join(' e ')}: o rebuild não grava taxa inventada no histórico.`);
        const priceCacheMap = await this._loadPriceCacheMap(uniqueTickers, assetMetadataMap, requiredFrom);
        const dividendDateMap = await this._loadDividendDateMap(uniqueTickers);
        // Mesma regra de moeda do acumulado (lançamento + posição): um ativo em
        // dólar já vendido não pode ser convertido lá e ficar em real aqui.
        const dividendFx = await this._dividendFxResolver(
            [...txs.filter(t => t.currency === 'USD'), ...userAssets],
            getUsdRateForDate,
        );
        // Séries de PU: o histórico precisa marcar o título público pela mesma
        // régua do KPI ao vivo e do snapshot, senão a curva de patrimônio dá um
        // degrau no dia em que os dois caminhos se encontram.
        const treasuryPricing = await loadTreasuryPricing(userAssets);
        return { assetMetadataMap, requiredFrom, getUsdRateForDate, priceCacheMap, dividendDateMap, dividendFx, treasuryPricing };
    },

    /**
     * Fail-closed: sem série que cubra a posição, ABORTA em vez de gravar
     * patrimônio marcado no custo. Os chamadores (walletController,
     * backfillUserGap) tratam o rebuild como best-effort — falhar aqui
     * preserva o histórico atual, que é sempre melhor que substituí-lo por
     * uma reta no preço de compra.
     */
    _assertPriceCoverage(ctx, { userId, walletId, allowSparseHistory }) {
        const coverageGaps = this.findPriceCoverageGaps(ctx.priceCacheMap, ctx.requiredFrom);
        if (coverageGaps.length === 0) return;
        logger.error('❌ [History] Rebuild abortado: série de preços não cobre a posição.', {
            source: 'rebuildUserHistory', userId: String(userId), walletId: String(walletId), gaps: coverageGaps,
        });
        if (!allowSparseHistory) {
            throw new Error(`Histórico de preços insuficiente para reconstruir a carteira: ${describeCoverageGaps(coverageGaps)}.`);
        }
    },

    /** Um dia do rebuild: proventos → movimentações → juros da RF → marcação → cota. */
    _rebuildDay(ctx, state, cursor) {
        const cursorIso = this.toDateKey(cursor);
        const cdiDailyFactor = cdiFactorForDay(ctx.dailyFactorsMap, ctx.cdiFactorsCacheFallback, cursor, cursorIso);

        // 1) Proventos do dia, sobre a posição de ANTES das movimentações do dia:
        //    no dia-ex quem compra não tem direito e quem vende tem (ver
        //    `accrueDividendsByTicker`). Por isso vem antes do passo 2 — na ordem
        //    inversa, compra no dia-ex recebia e venda no dia-ex perdia o provento.
        //    Além de acumular o total exibido, o caixa é creditado na cota como
        //    RENDA — senão a queda de preço do dia-ex vira prejuízo-fantasma
        //    (vazamento de proventos: o adjClose da fonte BR vem SEM ajuste, então a
        //    cota precisa do provento explícito).
        const dividendCash = dayDividendCash(ctx.dividendDateMap.get(cursorIso) || [], state.portfolio, ctx.dividendFx, cursorIso);
        state.accumulatedDividends += dividendCash;

        // 2) Movimentações do dia → posição + fluxo de caixa ajustado.
        const dayTx = this._applyDayTransactions({
            txs: ctx.txs, txIndex: state.txIndex, cursorIso, portfolio: state.portfolio, fixedIncomeState: state.fixedIncomeState,
            assetMetadataMap: ctx.assetMetadataMap, priceCacheMap: ctx.priceCacheMap, lastKnownPrices: state.lastKnownPrices,
            getUsdRateForDate: ctx.getUsdRateForDate, treasuryPricing: ctx.treasuryPricing,
        });
        state.txIndex = dayTx.txIndex;

        // 3) Juros da renda fixa do dia.
        this._accrueDailyFixedIncome({
            cursor, cursorIso, portfolio: state.portfolio, fixedIncomeState: state.fixedIncomeState,
            dailyFactorsMap: ctx.dailyFactorsMap, cdiDailyFactor, cdiCurve: ctx.cdiCurve, ...ctx.rates,
        });

        // 4) Marcação a mercado.
        const { totalEquityNominal, totalInvested, hasPosition } = this._markPortfolioToMarket({
            cursorIso, portfolio: state.portfolio, fixedIncomeState: state.fixedIncomeState, assetMetadataMap: ctx.assetMetadataMap,
            priceCacheMap: ctx.priceCacheMap, lastKnownPrices: state.lastKnownPrices, usdRateForDay: ctx.getUsdRateForDate(cursorIso),
        });

        // 5) Cota TWRR (Modified Dietz diário) em espaço NOMINAL + provento explícito.
        state.quota = nextQuota(state.quota, {
            previousEquity: state.previousEquity, equity: totalEquityNominal, flow: dayTx.dayFlowNominal, dividendCash,
        });

        if (isBusinessDay(cursor) && (hasPosition || totalInvested > 0 || state.accumulatedDividends > 0)) {
            state.snapshots.push(buildRebuildSnapshot({
                userId: ctx.userId, walletId: ctx.walletId, cursorIso, source: ctx.source, calculatedAt: ctx.calculatedAt,
                equity: totalEquityNominal, invested: totalInvested, dividends: state.accumulatedDividends, quota: state.quota,
            }));
        }
        state.previousEquity = totalEquityNominal;
    },

    async rebuildUserHistory(userId, walletId, options = {}) {
        const startTime = Date.now();
        const calculatedAt = new Date();
        const {
            dryRun = false,
            throughDayKey = null,
            source = 'REBUILD',
            // Escotilha explícita para scripts que ACEITAM histórico raso (ex.: papel
            // cuja série do provedor começa depois da 1ª compra). Nunca ligar nos
            // gatilhos automáticos do walletController/backfill: lá a falha precisa
            // preservar o histórico existente em vez de substituí-lo por uma ficção.
            allowSparseHistory = false,
        } = options;

        try {
            // Log de Auditoria Inicial
            if (!dryRun) {
                await AuditLog.create({
                    user: userId,
                    action: 'RECALC_QUOTA',
                    details: 'Início de reconstrução de histórico (Manual/Transaction Trigger)'
                });
            }

            const txs = await AssetTransaction.find({ user: userId, wallet: walletId }).sort({ date: 1 });
            if (txs.length === 0) {
                if (!dryRun) await WalletSnapshot.deleteMany({ user: userId, wallet: walletId });
                return [];
            }

            const rates = resolveRebuildRates(await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }));
            const loaded = await this._loadRebuildContext(userId, walletId, txs, rates);
            this._assertPriceCoverage(loaded, { userId, walletId, allowSparseHistory });

            const { startDate, today } = rebuildWindow(txs[0].date, throughDayKey, brazilDayKey(new Date()));
            const { dailyFactorsMap, cdiFactorsCacheFallback } = await this._loadCdiFactors(startDate, today, rates.currentCdiRate);
            // Curva histórica do CDI: a MESMA que o KPI ao vivo e o snapshot diário
            // consultam, para que os três caminhos rendam pela taxa vigente em cada dia.
            const cdiCurve = await loadCdiCurve({ since: startDate, currentRate: rates.currentCdiRate });

            const ctx = { ...loaded, txs, rates, dailyFactorsMap, cdiFactorsCacheFallback, cdiCurve, userId, walletId, source, calculatedAt };
            // Estado mutável acumulado ao longo do loop diário.
            const state = {
                snapshots: [], portfolio: {}, fixedIncomeState: {}, lastKnownPrices: {},
                accumulatedDividends: 0, quota: 100.0, previousEquity: 0, txIndex: 0,
            };
            for (const cursor = new Date(startDate); cursor <= today; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
                this._rebuildDay(ctx, state, cursor);
            }

            if (!dryRun) await this._persistSnapshots(userId, walletId, state.snapshots);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [History] Reconstrução V5 (Typed History) concluída em ${duration}s.`, {
                source: 'rebuildUserHistory', userId: String(userId), durationSec: Number(duration), snapshots: state.snapshots.length, dryRun,
            });
            return state.snapshots;

        } catch (error) {
            logger.error(`❌ [Engine] Erro Fatal no Rebuild: ${error.message}`);
            // Os chamadores fazem o rebuild em modo best-effort e já possuem seus
            // próprios catch/logs. Sem relançar aqui, eles registravam falso sucesso
            // e scripts de manutenção contabilizavam carteiras quebradas como OK.
            throw error;
        }
    },

    /**
     * Ingestão de proventos: busca o histórico de cada ticker e faz upsert em
     * DividendEvent (índice único ticker+date+type — o valor NÃO entra na chave;
     * ver DividendEvent.js). Cripto, renda fixa e caixa são ignorados.
     * `assets`: [{ ticker, type }].
     *
     * Esta é a fonte AUTORITATIVA, e ela atrasa 1-3 dias em relação à data-ex.
     * O crédito do dia é coberto por um provento provisório derivado do gap do
     * dia-ex (`utils/dividendGap.js`); aqui ele é promovido a oficial quando as
     * datas coincidem, ou removido quando a fonte publica a data deslocada.
     */
    async syncDividends(assets) {
        if (!Array.isArray(assets) || assets.length === 0) return { tickers: 0, events: 0, expirados: 0 };

        const seen = new Set();
        let tickerCount = 0;
        let eventCount = 0;

        for (const { ticker, type } of assets) {
            if (!ticker) continue;
            const key = ticker.toUpperCase();
            if (seen.has(key) || ['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) continue;
            seen.add(key);

            // ETF BR de acumulação não paga provento em dinheiro. Além de não
            // consultar a fonte, remove qualquer provisório antigo criado pelo
            // detector de gap antes desta proteção (caso real: IVVB11 em 02/09).
            if (type === 'ETF' && isAccumulatingBrEtf(key)) {
                const cleanup = await DividendEvent.deleteMany({ ticker: key, source: 'DERIVED' });
                if (cleanup.deletedCount > 0) {
                    logger.info('[Dividends] Provento provisório inválido removido de ETF de acumulação', {
                        ticker: key,
                        removidos: cleanup.deletedCount,
                    });
                }
                continue;
            }

            tickerCount++;

            const events = await externalMarketService.getDividendsHistory(ticker, type);
            const officialTimes = [];
            for (const ev of events) {
                // Upsert pela identidade canônica (ticker + ex-date dia + type),
                // SEM o valor: o mesmo provento de outra fonte (valor levemente
                // diferente) atualiza o registro existente em vez de inserir um
                // segundo — o que dobrava a soma. O valor mais recente prevalece.
                const evType = ev.type || 'DIVIDEND';
                const normDate = this.normalizeDividendDate(ev.date);
                const normAmount = this.roundDividendAmount(ev.amount);
                if (!(normAmount > 0)) continue;
                officialTimes.push(normDate.getTime());
                try {
                    const res = await DividendEvent.updateOne(
                        { ticker: key, date: normDate, type: evType },
                        {
                            $set: {
                                amount: normAmount,
                                // Carimba a procedência: se aqui havia um provisório
                                // derivado do gap (mesma data-ex), ele é PROMOVIDO a
                                // oficial e passa a valer o valor da fonte.
                                source: 'PROVIDER',
                                ...(ev.paymentDate ? { paymentDate: this.normalizeDividendDate(ev.paymentDate) } : {}),
                            },
                            $setOnInsert: { ticker: key, date: normDate, type: evType, currency: 'BRL' },
                        },
                        { upsert: true },
                    );
                    if (res.upsertedCount > 0) eventCount++;
                } catch {
                    // Corrida no índice único (evento já inserido) — ignora.
                }
            }

            // Reconciliação do provisório: o provento derivado do gap (ver
            // utils/dividendGap.js) usa como data-ex o dia em que o gap apareceu.
            // Quando a fonte publica o oficial com a data DESLOCADA em 1-2 dias, o
            // índice único não colapsa os dois e o mesmo pagamento passaria a ser
            // contado DUAS vezes. Todo provisório vizinho de um oficial é o mesmo
            // pagamento e vai embora; o que não tem oficial por perto fica, porque
            // é provento que a fonte simplesmente não publicou.
            if (officialTimes.length > 0) {
                const provisional = await DividendEvent.find({ ticker: key, source: 'DERIVED' }).select('date').lean();
                const orphanIds = provisional
                    .filter((p) => {
                        const t = new Date(p.date).getTime();
                        if (officialTimes.includes(t)) return false;
                        return officialTimes.some((o) => Math.abs(o - t) <= DERIVED_RECONCILE_WINDOW_MS);
                    })
                    .map((p) => p._id);
                if (orphanIds.length > 0) {
                    await DividendEvent.deleteMany({ _id: { $in: orphanIds } });
                    logger.info('[Dividends] Provisórios substituídos pelo oficial', { ticker: key, removidos: orphanIds.length });
                }
            }

            // Data de PAGAMENTO — quando o dinheiro cai na conta. O Yahoo não
            // publica, então vem do calendário da B3 (ver dividendPaymentDateService).
            // Roda DEPOIS da reconciliação de propósito: o provisório já virou
            // oficial aqui, e assim ele é datado no mesmo passe em vez de esperar o
            // sync do dia seguinte.
            //
            // Falha desta etapa não derruba o sync de proventos: sem data o evento
            // fica na estimativa, que é o comportamento que já existia. Deixar a
            // exceção subir trocaria uma degradação por uma parada.
            try {
                await fillPaymentDatesForTicker(key, type);
            } catch (error) {
                logger.warn('[Dividends] Falha ao buscar data de pagamento', { ticker: key, erro: error.message });
            }
        }

        const expirados = await this.expireUnconfirmedDerivedDividends();

        logger.info(`[Dividends] Sync concluído: ${eventCount} novos eventos em ${tickerCount} tickers.`);
        return { tickers: tickerCount, events: eventCount, expirados };
    },

    /**
     * O provisório tem PRAZO DE VALIDADE — e DUAS chances de ser confirmado.
     *
     * O provento derivado do gap é uma ponte sobre o atraso da fonte, medido em
     * 1 a 3 dias. Passada uma semana sem que ninguém confirme aquele pagamento, a
     * ponte não está atrasada: ela foi construída sobre um gap que não era provento
     * — barra de continuação em dia sem pregão, `previousClose` apontando uma sessão
     * mais atrás, resíduo de arredondamento. Sem esta expiração o provisório fica
     * para sempre: em 09/09/2026 havia 928 eventos DERIVED, 36% de todo o razão de
     * proventos, e nenhum caminho os retirava.
     *
     * CONFIRMAR NÃO É SÓ O YAHOO PUBLICAR. Medido no mesmo dia: dos 139 provisórios
     * de FII com data-ex em 01/09, o Yahoo publicou o oficial de quase nenhum, mas
     * a B3 datou o pagamento de 133 — com o valor batendo no centavo (HGLG11 1,17;
     * XPLG11 0,82; MXRF11 0,10). Renda de verdade que a nossa fonte de VALOR
     * simplesmente não conhece. Por isso `paymentDateSource` vale como confirmação:
     * ele só é escrito quando a B3 (ou o Fundamentus) publica um pagamento cujo
     * valor e cuja data-com casam com os nossos — ver `dividendPaymentDateService`.
     * Sem essa segunda porta, esta rotina apagaria 133 pagamentos reais.
     *
     * Só apaga o que a reconciliação de `syncDividends` já teve chance de promover
     * ou remover — por isso a janela de expiração é MAIOR que a de reconciliação.
     * O que some é exatamente o que NENHUMA das duas fontes reconheceu.
     */
    async expireUnconfirmedDerivedDividends(now = new Date()) {
        const limite = new Date(now.getTime() - DERIVED_EXPIRY_MS);
        const provisorios = await DividendEvent.find({
            source: 'DERIVED',
            date: { $lt: limite },
            paymentDateSource: { $in: [null, undefined] },
        }).select('ticker date').lean();
        if (provisorios.length === 0) return 0;

        const tickers = [...new Set(provisorios.map((p) => p.ticker))];
        const oficiais = await DividendEvent.find({
            ticker: { $in: tickers },
            source: { $ne: 'DERIVED' },
        }).select('ticker date').lean();

        const oficiaisPorTicker = new Map();
        for (const o of oficiais) {
            if (!oficiaisPorTicker.has(o.ticker)) oficiaisPorTicker.set(o.ticker, []);
            oficiaisPorTicker.get(o.ticker).push(new Date(o.date).getTime());
        }

        const orfaos = provisorios.filter((p) => {
            const t = new Date(p.date).getTime();
            const perto = (oficiaisPorTicker.get(p.ticker) || [])
                .some((o) => Math.abs(o - t) <= DERIVED_RECONCILE_WINDOW_MS);
            return !perto;
        });
        if (orfaos.length === 0) return 0;

        await DividendEvent.deleteMany({ _id: { $in: orfaos.map((o) => o._id) } });
        logger.info('[Dividends] Provisórios expirados sem confirmação da fonte', {
            removidos: orfaos.length,
            tickers: [...new Set(orfaos.map((o) => o.ticker))].slice(0, 20),
        });
        return orfaos.length;
    },

    /**
     * Run-rate mensal de proventos da carteira ("Média Mensal Est."), medido no
     * PRÓPRIO razão: Σ(provento por cota nos últimos 12 meses) × quantidade ÷ 12.
     *
     * Antes de 29/08/2026 a projeção vinha de `MarketAsset.dy × preço ÷ 12` — uma
     * fonte DIFERENTE da que alimenta o acumulado (`DividendEvent`). Duas fontes
     * para dois números que a UI exibe lado a lado, ambos lidos como "a renda desta
     * carteira", produzem contradição por construção: numa carteira real a projeção
     * prometia R$ 4,53/mês de BOVA11, um ETF de acumulação com ZERO eventos de
     * provento no razão — 39% da estimativa saía de renda que o acumulado jamais
     * poderia registrar. Medindo os dois no mesmo razão, eles só divergem por motivo
     * REAL (calendário de pagamento, mudança de posição), nunca por construção.
     *
     * Sem fallback para `dy`: ativo sem 12 meses de histórico projeta 0 e sobe
     * sozinho no primeiro pagamento. Subestimar é a direção fail-closed — a mesma
     * escolha da marcação de renda fixa (regra 9) —, enquanto o fallback reabriria
     * a porta exata que este defeito usou.
     *
     * O cap herdado de 25% a.a. continua, agora expresso sobre o valor de mercado da
     * posição (quantidade × último preço): segura provento extraordinário — dividendo de
     * evento único, JCP dobrado — que, tomado como recorrente, inflaria o run-rate. Sem
     * preço não há teto, e a renda medida no razão passa inteira: preço ausente é falha
     * de cotação, e ela não pode apagar provento que comprovadamente caiu na conta.
     *
     * `MarketAsset.dy` não participa mais deste cálculo em nenhum ponto.
     */
    _projectMonthlyIncome(relevantAssets, eventsMap, marketMap, fxNow = () => 1) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 1);

        let projectedMonthly = 0;
        for (const asset of relevantAssets) {
            if (!(asset.quantity > 0)) continue;

            // Mesma deduplicação por identidade canônica do acumulado: o mesmo provento
            // vindo de duas fontes não pode contar duas vezes no run-rate.
            const seen = new Set();
            let ttmPerShare = 0;
            for (const event of eventsMap.get(asset.ticker) || []) {
                if (this.normalizeDate(event.date) < cutoff) continue;
                const key = this.dividendIdentity(asset.ticker, event.date, event.type);
                if (seen.has(key)) continue;
                seen.add(key);
                ttmPerShare = safeAdd(ttmPerShare, event.amount);
            }
            if (!(ttmPerShare > 0)) continue;

            let annualIncome = safeMult(asset.quantity, ttmPerShare);
            const marketValue = safeMult(asset.quantity, marketMap.get(asset.ticker)?.lastPrice || 0);
            const ceiling = safeMult(marketValue, 0.25);
            if (ceiling > 0 && annualIncome > ceiling) annualIncome = ceiling;
            // Teto comparado na moeda nativa (renda e preço na mesma); só depois em reais.
            annualIncome = safeMult(annualIncome, fxNow(asset.ticker));

            projectedMonthly = safeAdd(projectedMonthly, safeDiv(annualIncome, 12));
        }
        return projectedMonthly;
    },

    // ... (Mantém o restante igual) ...
    async calculateUserDividends(userId, walletId) {
        // ... (Mantém inalterado)
        const assets = await UserAsset.find({ user: userId, wallet: walletId });
        const relevantAssets = assets.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
        const tickers = relevantAssets.map(a => a.ticker);

        if (tickers.length === 0) return { dividendMap: new Map(), provisioned: [], totalAllTime: 0, projectedMonthly: 0, yieldOnCost: [], receivedByTicker: {} };

        const marketInfos = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker dy lastPrice');
        const marketMap = new Map();
        marketInfos.forEach(m => marketMap.set(m.ticker, m));

        const allEvents = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: 1 });
        const eventsMap = new Map();
        allEvents.forEach(e => {
            if (!eventsMap.has(e.ticker)) eventsMap.set(e.ticker, []);
            eventsMap.get(e.ticker).push(e);
        });

        const dividendFx = await this._dividendFxResolver(relevantAssets);
        const todayKey = this.toDateKey(new Date());
        const projectedMonthly = this._projectMonthlyIncome(
            relevantAssets, eventsMap, marketMap, (ticker) => dividendFx(ticker, todayKey),
        );

        // `new ObjectId(undefined)` geraria um id ALEATÓRIO (não omite o filtro!),
        // então o campo só entra no $match quando walletId de fato foi passado.
        const firstTransactions = await AssetTransaction.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    ...(walletId ? { wallet: new mongoose.Types.ObjectId(walletId) } : {}),
                    ticker: { $in: tickers },
                    type: 'BUY',
                },
            },
            { $sort: { date: 1 } },
            { $group: { _id: "$ticker", firstBuyDate: { $first: "$date" } } }
        ]);

        // Chave de dia UTC (`toDateKey`), a mesma régua do accrual: a ex-date é
        // gravada à meia-noite UTC, e normalizá-la para a meia-noite LOCAL movia o
        // provento para o dia anterior num servidor em Brasília.
        const acquisitionMap = new Map();
        firstTransactions.forEach(tx => acquisitionMap.set(tx._id, this.toDateKey(tx.firstBuyDate)));

        const dividendMap = new Map();
        const provisioned = [];
        let totalAllTime = 0;
        // Yield on Cost: quanto cada ativo já pagou (líquido recebido, não provisionado)
        // nos últimos 12 meses em relação ao custo investido (UserAsset.totalCost).
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
        const receivedLast12MonthsByTicker = new Map();
        // Total recebido por ticker desde a compra (não provisionado) — usado
        // pela carteira para compor a Rentabilidade total (preço + proventos)
        // por ativo, distinguindo-a da Variação (só preço).
        const receivedAllTimeByTicker = new Map();

        for (const asset of relevantAssets) {
            const firstBuyDate = acquisitionMap.get(asset.ticker);
            const assetEvents = eventsMap.get(asset.ticker) || [];

            // Defesa em profundidade: mesmo antes do cleanup, deduplica por
            // identidade canônica (ticker + ex-date + type) para que o mesmo
            // provento vindo de 2 fontes (com valores levemente distintos) não
            // dobre a soma. O valor NÃO entra na chave (ver dividendIdentity).
            const seenEvents = new Set();

            for (const event of assetEvents) {
                // Compra NO dia-ex não dá direito ao provento (o papel já negocia
                // "ex"): só conta ex-date ESTRITAMENTE posterior à primeira compra.
                // Com `<` a compra no próprio dia-ex recebia — divergindo do accrual,
                // do rebuild e do snapshot, que usam a posição da véspera.
                if (!firstBuyDate || this.toDateKey(event.date) <= firstBuyDate) continue;

                const dedupeKey = this.dividendIdentity(asset.ticker, event.date, event.type);
                if (seenEvents.has(dedupeKey)) continue;
                seenEvents.add(dedupeKey);

                const totalValue = safeCurrency(safeMult(asset.quantity, event.amount) * dividendFx(asset.ticker, this.toDateKey(event.date)));

                if (totalValue > 0) {
                    const { date: pDate, isEstimated } = this.resolvePaymentDate(event);
                    const today = new Date();
                    const isFuture = pDate > today;

                    if (isFuture) {
                        // `isEstimatedDate` viaja até a tela: sem ele o card exibia
                        // ex+15 como se fosse data anunciada pelo emissor (caso real:
                        // GGRC11 pago em 09/09/2026 e exibido como "Agendado 16/09").
                        provisioned.push({
                            ticker: asset.ticker,
                            date: pDate,
                            amount: totalValue,
                            isProvisioned: true,
                            isEstimatedDate: isEstimated,
                        });
                    } else {
                        const monthKey = pDate.toISOString().substring(0, 7);
                        if (!dividendMap.has(monthKey)) dividendMap.set(monthKey, { total: 0, breakdown: [] });
                        const entry = dividendMap.get(monthKey);
                        entry.total = safeAdd(entry.total, totalValue);

                        const existingBreakdown = entry.breakdown.find(b => b.ticker === asset.ticker);
                        if (existingBreakdown) existingBreakdown.amount = safeAdd(existingBreakdown.amount, totalValue);
                        else entry.breakdown.push({ ticker: asset.ticker, amount: totalValue });

                        totalAllTime = safeAdd(totalAllTime, totalValue);
                        receivedAllTimeByTicker.set(asset.ticker, safeAdd(receivedAllTimeByTicker.get(asset.ticker) || 0, totalValue));

                        if (pDate >= twelveMonthsAgo) {
                            const prevReceived = receivedLast12MonthsByTicker.get(asset.ticker) || 0;
                            receivedLast12MonthsByTicker.set(asset.ticker, safeAdd(prevReceived, totalValue));
                        }
                    }
                }
            }
        }

        // Provisões em ordem de PAGAMENTO. O laço acima varre ativo por ativo, então
        // sem esta ordenação o card "Provisões Futuras" sai agrupado por ativo — e a
        // pergunta que ele responde ("o que cai primeiro?") fica ilegível justamente
        // em quem tem muitos pagadores. Empate resolvido pelo ticker, para a lista não
        // trocar de ordem entre dois carregamentos idênticos.
        provisioned.sort((a, b) => (a.date - b.date) || a.ticker.localeCompare(b.ticker));

        const yieldOnCost = relevantAssets
            .map((asset) => {
                const receivedLast12Months = receivedLast12MonthsByTicker.get(asset.ticker) || 0;
                // Custo em reais (câmbio das compras), na mesma moeda do recebido.
                const totalCost = positionCostBRL(asset, dividendFx(asset.ticker, todayKey)) || 0;
                return {
                    ticker: asset.ticker,
                    receivedLast12Months,
                    totalCost,
                    yocPercent: safeDiv(safeMult(receivedLast12Months, 100), totalCost),
                };
            })
            .filter((item) => item.receivedLast12Months > 0)
            .sort((a, b) => b.yocPercent - a.yocPercent);

        return {
            dividendMap, provisioned, totalAllTime, projectedMonthly, yieldOnCost,
            receivedByTicker: Object.fromEntries(receivedAllTimeByTicker),
        };
    },

    // walletId SEM default `null`: um filtro Mongoose {wallet: null} bateria
    // "wallet ausente ou null" — depois que o campo virar required, nenhum
    // documento real jamais terá isso, então cairia silenciosamente em zero
    // resultados. Deixado `undefined` quando omitido, o Mongoose IGNORA a chave
    // no filtro de find/findOne (comportamento seguro para chamadores legados
    // que ainda não passam walletId, ex. scripts de seed).
    async recalculatePosition(userId, ticker, forcedType = null, session = null, forcedCurrency = null, walletId) {
        // ... (Mantém inalterado)
        const query = AssetTransaction.find({ user: userId, wallet: walletId, ticker }).sort({ date: 1, createdAt: 1 });
        if (session) query.session(session);
        const transactions = await query;

        // A posição é buscada ANTES do laço (era depois) porque o custo em BRL
        // precisa saber a moeda nativa para resolver o câmbio de cada compra.
        let assetQuery = UserAsset.findOne({ user: userId, wallet: walletId, ticker });
        if (session) assetQuery.session(session);
        let asset = await assetQuery;

        let marketInfo = null;
        if (!asset && transactions.length > 0) {
            marketInfo = await MarketAsset.findOne({ ticker });
        }

        const nativeCurrency = resolveNativeCurrency(forcedCurrency, asset, marketInfo);
        const rateOf = await buildFxRateOf(nativeCurrency, (dollar) => this._loadUsdRateResolver(dollar));
        const insufficientBalance = () => txError(400, `Saldo insuficiente para ${ticker}: uma venda ficaria maior que a quantidade comprada até a data dela.`);
        const ledger = replayPositionLedger(transactions, { nativeCurrency, rateOf, insufficientBalance });
        await stampFxRates(ledger.fxToStamp, session, ticker);

        if (!asset) {
            if (transactions.length === 0) return null;
            asset = await createPositionAsset({ userId, walletId, ticker, forcedType, forcedCurrency, marketInfo, session });
        } else if (forcedType && asset.type !== forcedType) {
            asset.type = forcedType;
        }

        marketInfo = await healAllocationClass(asset, ticker, marketInfo);
        applyLedgerToAsset(asset, ledger);
        await refreshUsSubType(asset, ticker, marketInfo);

        await asset.save({ session });
        return asset;
    },

    async applyCorporateEvents(_ticker, _type) {
        return { processed: false, reason: "Feature disabled in optimization mode" };
    }
};
