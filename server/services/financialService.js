
import mongoose from 'mongoose';
import { runTransaction } from '../utils/dbTransaction.js';
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
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculateDailyDietz, safeQuantity, addQty, subQty, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import { HISTORICAL_CDI_RATES } from '../config/financialConstants.js';
import { isBusinessDay, toDateKey as toDateKeyUtil, startOfDay } from '../utils/dateUtils.js';
import { classifyUsAsset } from '../utils/usClassification.js';
import { isGoldTicker } from '../utils/goldClassification.js';
import { isDollarized as isDollarizedAsset, resolveTransactionCurrency } from '../utils/assetCurrency.js';
import logger from '../config/logger.js';
import { dropUntradableCandles, historyStorageKey } from '../utils/assetHistory.js';
import { brazilDayKey, isTwrrReturnAnomalous, isValidDayKey, snapshotInstantForDay } from '../utils/walletSnapshot.js';
import { resolveAllocationClass } from '../utils/assetAllocation.js';
import { loadUsdRateResolver, effectiveFxRate } from '../utils/fxRate.js';
import { markLotsToMarket, findTreasuryPu, accrueLotsValue } from '../utils/fixedIncome.js';
import { loadCdiCurve, annualRateFromDailyFactor } from '../utils/cdiCurve.js';
import { loadTreasuryPricing, EMPTY_TREASURY_PRICING } from './treasuryPriceService.js';

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
        const d = new Date(date);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    },

    roundDividendAmount(amount) {
        return Math.round((Number(amount) || 0) * 1e6) / 1e6;
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
     */
    async accrueDividendsByTicker(userId, walletId, throughDayKey, options = {}) {
        const txs = options.transactions
            || await AssetTransaction.find({ user: userId, wallet: walletId }).sort({ date: 1 });
        if (!txs || txs.length === 0) return { total: 0, paid: 0, pending: 0, byTicker: {} };

        const dividendDateMap = options.dividendDateMap
            || await this._loadDividendDateMap([...new Set(txs.map(t => t.ticker))]);

        const days = [...dividendDateMap.keys()].filter(d => d <= throughDayKey).sort();
        const qty = {};
        const byTicker = {};
        let txIndex = 0;
        let total = 0;
        let paid = 0;

        for (const day of days) {
            // Mesma ordem do rebuild: transações do dia ANTES dos proventos do dia.
            while (txIndex < txs.length && this.toDateKey(txs[txIndex].date) <= day) {
                const tx = txs[txIndex];
                const delta = tx.type === 'SELL' ? -tx.quantity : tx.quantity;
                qty[tx.ticker] = addQty(qty[tx.ticker] || 0, delta);
                if (qty[tx.ticker] < QUANTITY_EPSILON) qty[tx.ticker] = 0;
                txIndex++;
            }
            for (const div of dividendDateMap.get(day)) {
                if (qty[div.ticker] > 0) {
                    const value = qty[div.ticker] * div.amount;
                    total = safeAdd(total, value);
                    byTicker[div.ticker] = safeAdd(byTicker[div.ticker] || 0, value);
                    // Sem paymentDate, a mesma convenção do resto do serviço: ex + 15d.
                    const payKey = this.toDateKey(div.paymentDate || new Date(new Date(day).getTime() + 15 * 86400000));
                    if (payKey <= throughDayKey) paid = safeAdd(paid, value);
                }
            }
        }

        for (const ticker of Object.keys(byTicker)) byTicker[ticker] = safeCurrency(byTicker[ticker]);
        const safeTotal = safeCurrency(total);
        const safePaid = safeCurrency(paid);
        // `pending` é derivado da subtração, nunca somado em paralelo: garante que as
        // duas parcelas fechem o total exibido mesmo com arredondamento de centavo.
        return { total: safeTotal, paid: safePaid, pending: safeCurrency(safeTotal - safePaid), byTicker };
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
     * Aplica as transações cujo dia <= cursor, mutando `portfolio` e
     * `fixedIncomeState` in-place. Devolve o novo `txIndex` e o fluxo de caixa
     * ajustado do dia (para o Modified Dietz). A aritmética é idêntica à original.
     */
    _applyDayTransactions(ctx) {
        const {
            txs, cursorIso, portfolio, fixedIncomeState,
            assetMetadataMap, priceCacheMap, lastKnownPrices, getUsdRateForDate,
            treasuryPricing = EMPTY_TREASURY_PRICING,
        } = ctx;
        let txIndex = ctx.txIndex;
        let dayFlowAdjusted = 0;
        let dayFlowNominal = 0;

        while (txIndex < txs.length) {
            const tx = txs[txIndex];
            const txDateIso = this.toDateKey(tx.date);
            if (txDateIso > cursorIso) break;

            if (!portfolio[tx.ticker]) {
                // cost = moeda nativa; costBrl = mesmo custo com o câmbio de cada
                // compra congelado (é ele que alimenta o Valor Aplicado histórico).
                portfolio[tx.ticker] = { qty: 0, cost: 0, costBrl: 0 };
                const meta = assetMetadataMap.get(tx.ticker);
                if (meta && (meta.type === 'FIXED_INCOME' || meta.type === 'CASH')) {
                    fixedIncomeState[tx.ticker] = {
                        currentValue: 0,
                        rate: meta.fixedIncomeRate > 0 ? meta.fixedIncomeRate : (meta.type === 'CASH' ? 100 : 10),
                        index: meta.fixedIncomeIndex || null,
                        spread: meta.fixedIncomeSpread || 0,
                        // Marcação a mercado: série de PU do título público (null =
                        // segue na curva) + lotes em `{dateIso, cost}` para a razão
                        // de PU, que é o que torna a marcação independente de como
                        // quantidade e preço foram cadastrados.
                        history: treasuryPricing.historyFor(meta),
                        maturityIso: meta.maturityDate ? this.toDateKey(meta.maturityDate) : null,
                        lots: [],
                    };
                }
            }

            let txAdjPrice = tx.price;
            let trueAdjustedFlow = tx.totalValue; // Fluxo ajustado real
            const meta = assetMetadataMap.get(tx.ticker);
            const isFixed = meta?.type === 'FIXED_INCOME' || meta?.type === 'CASH';
            const txIsDollarized = resolveTransactionCurrency(tx, meta) === 'USD';
            // Câmbio do PRÓPRIO lançamento (carimbado na compra; senão reconstruído
            // pela data dele). Antes usava o câmbio do dia do CURSOR, que difere da
            // data real quando o lançamento cai em fim de semana/feriado e é
            // processado no pregão seguinte.
            const txUsdRate = txIsDollarized ? effectiveFxRate(tx, 'USD', getUsdRateForDate) : 1;
            if (!Number.isFinite(Number(txUsdRate)) || Number(txUsdRate) <= 0) {
                throw new RangeError(`Câmbio USD/BRL inválido para ${cursorIso}: ${txUsdRate}`);
            }

            if (!isFixed) {
                const pMap = priceCacheMap.get(tx.ticker);
                const pData = this.findPriceInMap(pMap, cursorIso);
                if (pData.adjClose > 0) {
                    txAdjPrice = pData.adjClose;
                    if (pData.close > 0) {
                        const ratio = pData.adjClose / pData.close;
                        trueAdjustedFlow = tx.totalValue * ratio;
                    } else {
                        trueAdjustedFlow = tx.quantity * txAdjPrice;
                    }
                }
            }

            if (tx.type === 'BUY') {
                portfolio[tx.ticker].qty += tx.quantity;
                portfolio[tx.ticker].cost += tx.totalValue;
                portfolio[tx.ticker].costBrl += tx.totalValue * txUsdRate;
                if (isFixed) {
                    if (!fixedIncomeState[tx.ticker]) {
                        fixedIncomeState[tx.ticker] = {
                            currentValue: 0,
                            rate: meta?.fixedIncomeRate || 100,
                            index: meta?.fixedIncomeIndex || null,
                            spread: meta?.fixedIncomeSpread || 0,
                            history: meta ? treasuryPricing.historyFor(meta) : null,
                            maturityIso: meta?.maturityDate ? this.toDateKey(meta.maturityDate) : null,
                            lots: [],
                        };
                    }
                    const state = fixedIncomeState[tx.ticker];
                    state.currentValue += tx.totalValue;
                    state.lots.push({ dateIso: txDateIso, cost: tx.totalValue });
                    // `currentValue` acima é só o valor de partida do dia da compra:
                    // a partir daqui quem manda são os LOTES, recompostos do zero a
                    // cada dia por `accrueLotsValue`. É de lá que vem a regra de que a
                    // aplicação não rende no próprio dia — `countBusinessDays` conta
                    // os dias ESTRITAMENTE depois da compra.
                    //
                    // Compra anterior ao início da série: o título é abandonado pela
                    // marcação de vez, em vez de marcar só parte dos lotes. Metade
                    // marcada e metade na curva seria um número sem régua.
                    if (state.history && !findTreasuryPu(state.history, txDateIso)) state.history = null;
                }
                dayFlowAdjusted += trueAdjustedFlow * txUsdRate;
                dayFlowNominal += tx.totalValue * txUsdRate;

                if (!lastKnownPrices[tx.ticker]) lastKnownPrices[tx.ticker] = { close: tx.price, adjClose: txAdjPrice };

            } else if (tx.type === 'SELL') {
                const qtyBefore = portfolio[tx.ticker].qty;
                const currentAvg = qtyBefore > 0 ? portfolio[tx.ticker].cost / qtyBefore : 0;
                // Baixa proporcional em BRL — a venda não reprecifica o câmbio das
                // compras que ficaram (mesma regra de recalculatePosition).
                const soldFraction = qtyBefore > 0 ? tx.quantity / qtyBefore : 0;
                portfolio[tx.ticker].qty -= tx.quantity;
                portfolio[tx.ticker].cost -= (tx.quantity * currentAvg);
                portfolio[tx.ticker].costBrl -= portfolio[tx.ticker].costBrl * soldFraction;
                if (isFixed) {
                    const state = fixedIncomeState[tx.ticker];
                    state.currentValue = Math.max(0, state.currentValue - tx.totalValue);
                    // Resgate parcial baixa os lotes na mesma proporção da posição
                    // (mesma regra do custo acima) — a marcação continua sobre o que
                    // ficou, sem reprecificar as compras remanescentes.
                    if (soldFraction > 0) {
                        const remaining = Math.max(0, 1 - soldFraction);
                        state.lots = state.lots.map((lot) => ({ ...lot, cost: lot.cost * remaining }));
                    }
                }
                dayFlowAdjusted -= trueAdjustedFlow * txUsdRate;
                dayFlowNominal -= tx.totalValue * txUsdRate;
            }

            if (portfolio[tx.ticker].qty < QUANTITY_EPSILON) {
                portfolio[tx.ticker].qty = 0;
                portfolio[tx.ticker].cost = 0;
                portfolio[tx.ticker].costBrl = 0;
                if (fixedIncomeState[tx.ticker]) {
                    fixedIncomeState[tx.ticker].currentValue = 0;
                    fixedIncomeState[tx.ticker].lots = [];
                }
            }
            txIndex++;
        }

        return { txIndex, dayFlowAdjusted, dayFlowNominal };
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
            totalInvested += pos.costBrl ?? (pos.cost * fxRate);

            let markClose = 0;
            let markAdjClose = 0;

            if (fixedIncomeState[ticker]) {
                const val = fixedIncomeState[ticker].currentValue;
                const unitPrice = val / pos.qty;
                markClose = unitPrice;
                markAdjClose = unitPrice;
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

            totalEquityNominal += pos.qty * markClose * fxRate;
            totalEquityAdjusted += pos.qty * markAdjClose * fxRate;
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

            const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const currentCdiRate = sysConfig?.cdi || DEFAULT_SELIC_FALLBACK;
            const currentIpcaRate = (sysConfig?.ipca && sysConfig.ipca > 0) ? sysConfig.ipca : 4.5;
            const currentSelicRate = (sysConfig?.selic && sysConfig.selic > 0) ? sysConfig.selic : undefined;
            const currentUsdRate = sysConfig?.dollar || 5.75;

            const uniqueTickers = [...new Set(txs.map(t => t.ticker))];

            const assetMetadataMap = new Map();
            const userAssets = await UserAsset.find({ user: userId, wallet: walletId });
            userAssets.forEach(ua => assetMetadataMap.set(ua.ticker, ua));

            // Primeiro dia em que cada ticker entrou na carteira — é a profundidade
            // de série que o rebuild exige para marcar a mercado sem inventar preço.
            const requiredFromByTicker = new Map();
            for (const tx of txs) {
                const meta = assetMetadataMap.get(tx.ticker);
                if (meta?.type === 'FIXED_INCOME' || meta?.type === 'CASH' || tx.ticker === 'RESERVA') continue;
                const dayKey = this.toDateKey(tx.date);
                const known = requiredFromByTicker.get(tx.ticker);
                if (!known || dayKey < known) requiredFromByTicker.set(tx.ticker, dayKey);
            }

            // Carregamento de contexto (cada fonte isolada num helper testável).
            const getUsdRateForDate = await this._loadUsdRateResolver(currentUsdRate);
            const priceCacheMap = await this._loadPriceCacheMap(uniqueTickers, assetMetadataMap, requiredFromByTicker);
            const dividendDateMap = await this._loadDividendDateMap(uniqueTickers);
            // Séries de PU: o histórico precisa marcar o título público pela mesma
            // régua do KPI ao vivo e do snapshot, senão a curva de patrimônio dá um
            // degrau no dia em que os dois caminhos se encontram.
            const treasuryPricing = await loadTreasuryPricing(userAssets);

            // Fail-closed: sem série que cubra a posição, ABORTA em vez de gravar
            // patrimônio marcado no custo. Os chamadores (walletController,
            // backfillUserGap) tratam o rebuild como best-effort — falhar aqui
            // preserva o histórico atual, que é sempre melhor que substituí-lo por
            // uma reta no preço de compra.
            const coverageGaps = this.findPriceCoverageGaps(priceCacheMap, requiredFromByTicker);
            if (coverageGaps.length > 0) {
                const detail = coverageGaps
                    .map(g => `${g.ticker} (posição desde ${g.requiredFrom}, série desde ${g.availableFrom || 'nenhuma'})`)
                    .join('; ');
                logger.error('❌ [History] Rebuild abortado: série de preços não cobre a posição.', {
                    source: 'rebuildUserHistory', userId: String(userId), walletId: String(walletId), gaps: coverageGaps,
                });
                if (!allowSparseHistory) {
                    throw new Error(`Histórico de preços insuficiente para reconstruir a carteira: ${detail}.`);
                }
            }

            // Rebuild nunca antecipa o snapshot do dia corrente. O cron das 23:59
            // é o único dono desse fechamento; durante o dia, KPI/gráfico usam o
            // ponto live com os fluxos pendentes.
            const currentDayKey = brazilDayKey(new Date());
            const defaultEnd = new Date(`${currentDayKey}T12:00:00.000Z`);
            defaultEnd.setUTCDate(defaultEnd.getUTCDate() - 1);
            const endDayKey = throughDayKey || defaultEnd.toISOString().slice(0, 10);
            const startDate = new Date(`${this.toDateKey(txs[0].date)}T12:00:00.000Z`);
            const today = new Date(`${endDayKey}T12:00:00.000Z`);

            const { dailyFactorsMap, cdiFactorsCacheFallback } = await this._loadCdiFactors(startDate, today, currentCdiRate);
            // Curva histórica do CDI: a MESMA que o KPI ao vivo e o snapshot diário
            // consultam, para que os três caminhos rendam pela taxa vigente em cada dia.
            const cdiCurve = await loadCdiCurve({ since: startDate, currentRate: currentCdiRate });

            // Estado mutável acumulado ao longo do loop diário.
            const snapshots = [];
            const portfolio = {};
            const fixedIncomeState = {};
            const lastKnownPrices = {};
            let accumulatedDividends = 0;
            let currentQuota = 100.0;
            let previousEquityNominal = 0;
            let txIndex = 0;

            let cursor = new Date(startDate);
            while (cursor <= today) {
                const cursorIso = this.toDateKey(cursor);
                let cdiDailyFactor = dailyFactorsMap.get(cursorIso);
                if (!cdiDailyFactor) {
                    cdiDailyFactor = cdiFactorsCacheFallback[cursor.getFullYear()] || 1.0003;
                }

                // 1) Movimentações do dia → posição + fluxo de caixa ajustado.
                const dayTx = this._applyDayTransactions({
                    txs, txIndex, cursorIso, portfolio, fixedIncomeState,
                    assetMetadataMap, priceCacheMap, lastKnownPrices, getUsdRateForDate,
                    treasuryPricing,
                });
                txIndex = dayTx.txIndex;
                const dayFlowNominal = dayTx.dayFlowNominal;

                // 2) Proventos do dia (sobre a posição já atualizada). Além de
                //    acumular o total exibido, o caixa recebido HOJE é creditado na
                //    cota como RENDA — senão a queda de preço do dia-ex vira
                //    prejuízo-fantasma (vazamento de proventos: o adjClose da fonte
                //    BR vem SEM ajuste, então a cota precisa do provento explícito).
                const dayDividends = dividendDateMap.get(cursorIso) || [];
                let dayDividendCash = 0;
                for (const div of dayDividends) {
                    if (portfolio[div.ticker] && portfolio[div.ticker].qty > 0) {
                        dayDividendCash += (portfolio[div.ticker].qty * div.amount);
                    }
                }
                accumulatedDividends += dayDividendCash;

                // 3) Juros da renda fixa do dia.
                this._accrueDailyFixedIncome({
                    cursor, cursorIso, portfolio, fixedIncomeState,
                    dailyFactorsMap, cdiDailyFactor, currentIpcaRate, currentSelicRate, currentCdiRate, cdiCurve,
                });

                // 4) Marcação a mercado.
                const usdRateForDay = getUsdRateForDate(cursorIso);
                const { totalEquityNominal, totalInvested, hasPosition } =
                    this._markPortfolioToMarket({
                        cursorIso, portfolio, fixedIncomeState, assetMetadataMap,
                        priceCacheMap, lastKnownPrices, usdRateForDay,
                    });

                // 5) Cota TWRR (Modified Dietz diário) em espaço NOMINAL + provento
                //    explícito — mesma metodologia do snapshot diário (schedulerService).
                if (previousEquityNominal > 0 || dayFlowNominal > 0 || dayDividendCash > 0) {
                    const dailyReturn = calculateDailyDietz(previousEquityNominal, totalEquityNominal, dayFlowNominal, dayDividendCash);

                    // Proteção contra spikes absurdos (ex: dados sujos)
                    if (!isTwrrReturnAnomalous(dailyReturn)) {
                        currentQuota = currentQuota * (1 + dailyReturn);
                    }
                }

                if (isBusinessDay(cursor) && (hasPosition || totalInvested > 0 || accumulatedDividends > 0)) {
                    snapshots.push({
                        user: userId,
                        wallet: walletId,
                        date: snapshotInstantForDay(cursorIso),
                        dayKey: cursorIso,
                        source,
                        calculationVersion: 5,
                        calculatedAt,
                        totalEquity: safeCurrency(totalEquityNominal),
                        totalInvested: safeCurrency(totalInvested),
                        totalDividends: safeCurrency(accumulatedDividends),
                        profit: safeCurrency(totalEquityNominal - totalInvested + accumulatedDividends),
                        profitPercent: safeFloat(totalInvested > 0 ? ((totalEquityNominal - totalInvested + accumulatedDividends) / totalInvested) * 100 : 0),
                        quotaPrice: safeFloat(currentQuota)
                    });
                }

                previousEquityNominal = totalEquityNominal;
                cursor.setUTCDate(cursor.getUTCDate() + 1);
            }

            if (!dryRun) await this._persistSnapshots(userId, walletId, snapshots);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [History] Reconstrução V5 (Typed History) concluída em ${duration}s.`, {
                source: 'rebuildUserHistory', userId: String(userId), durationSec: Number(duration), snapshots: snapshots.length, dryRun,
            });
            return snapshots;

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
     */
    async syncDividends(assets) {
        if (!Array.isArray(assets) || assets.length === 0) return { tickers: 0, events: 0 };

        const seen = new Set();
        let tickerCount = 0;
        let eventCount = 0;

        for (const { ticker, type } of assets) {
            if (!ticker) continue;
            const key = ticker.toUpperCase();
            if (seen.has(key) || ['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) continue;
            seen.add(key);
            tickerCount++;

            const events = await externalMarketService.getDividendsHistory(ticker, type);
            for (const ev of events) {
                // Upsert pela identidade canônica (ticker + ex-date dia + type),
                // SEM o valor: o mesmo provento de outra fonte (valor levemente
                // diferente) atualiza o registro existente em vez de inserir um
                // segundo — o que dobrava a soma. O valor mais recente prevalece.
                const evType = ev.type || 'DIVIDEND';
                const normDate = this.normalizeDividendDate(ev.date);
                const normAmount = this.roundDividendAmount(ev.amount);
                if (!(normAmount > 0)) continue;
                try {
                    const res = await DividendEvent.updateOne(
                        { ticker: key, date: normDate, type: evType },
                        {
                            $set: {
                                amount: normAmount,
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
        }

        logger.info(`[Dividends] Sync concluído: ${eventCount} novos eventos em ${tickerCount} tickers.`);
        return { tickers: tickerCount, events: eventCount };
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
    _projectMonthlyIncome(relevantAssets, eventsMap, marketMap) {
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

        const projectedMonthly = this._projectMonthlyIncome(relevantAssets, eventsMap, marketMap);

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

        const acquisitionMap = new Map();
        firstTransactions.forEach(tx => acquisitionMap.set(tx._id, this.normalizeDate(tx.firstBuyDate)));

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
                const eventDateNormalized = this.normalizeDate(event.date);
                if (!firstBuyDate || eventDateNormalized < firstBuyDate) continue;

                const dedupeKey = this.dividendIdentity(asset.ticker, event.date, event.type);
                if (seenEvents.has(dedupeKey)) continue;
                seenEvents.add(dedupeKey);

                const totalValue = safeMult(asset.quantity, event.amount);

                if (totalValue > 0) {
                    const pDate = event.paymentDate || new Date(new Date(event.date).setDate(event.date.getDate() + 15));
                    const today = new Date();
                    const isFuture = pDate > today;

                    if (isFuture) {
                        provisioned.push({ ticker: asset.ticker, date: pDate, amount: totalValue, isProvisioned: true });
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

        const yieldOnCost = relevantAssets
            .map((asset) => {
                const receivedLast12Months = receivedLast12MonthsByTicker.get(asset.ticker) || 0;
                const totalCost = asset.totalCost || 0;
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

        // Mesma precedência de moeda usada na criação da posição (cadastro
        // explícito > MarketAsset > BRL), só que resolvida antes por necessidade.
        const nativeCurrency = forcedCurrency || asset?.currency || marketInfo?.currency || 'BRL';
        let usdRateForDate = null;
        if (nativeCurrency === 'USD') {
            // A cotação corrente entra como âncora para lançamentos posteriores ao
            // último candle da série (compra de hoje, p.ex.).
            const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).select('dollar').lean().catch(() => null);
            usdRateForDate = await this._loadUsdRateResolver(macro?.dollar);
        }
        const rateOf = (tx) => (nativeCurrency === 'USD' ? effectiveFxRate(tx, 'USD', usdRateForDate) : 1);

        let quantity = 0;
        let totalCost = 0;
        let realizedProfit = 0;
        let fifoRealizedProfit = 0; // NOVO: Lucro Realizado FIFO
        let taxLots = [];
        let firstBuyDate = null;
        // Espelho em BRL de totalCost/realizedProfit: mesma base de preço médio,
        // cada lançamento convertido pelo câmbio do PRÓPRIO dia. Só assim o
        // resultado cambial aparece (em vez de se cancelar contra o saldo).
        let totalCostBrl = 0;
        let realizedProfitBrl = 0;
        const fxToStamp = [];

        for (const tx of transactions) {
            // Quantidade em 8 casas (cripto); valor monetário continua em 2/4 casas.
            const txQty = safeQuantity(tx.quantity);
            const txPrice = safeFloat(tx.price);
            const txTotal = safeCurrency(txQty * txPrice);
            const txFx = rateOf(tx);
            const txTotalBrl = safeCurrency(txTotal * txFx);
            // Carimba o câmbio nos lançamentos legados EM DÓLAR (auto-heal): a
            // partir daí o custo em reais não depende mais da reconstrução
            // histórica. Posição em real não é carimbada — gravar "1" em todo
            // lançamento do país inteiro seria escrita pura sem informação.
            if (nativeCurrency === 'USD' && !(Number(tx.fxRate) > 0)) {
                fxToStamp.push({ id: tx._id, fxRate: txFx });
            }

            if (tx.type === 'BUY') {
                quantity = addQty(quantity, txQty);
                totalCost = safeAdd(totalCost, txTotal);
                totalCostBrl = safeAdd(totalCostBrl, txTotalBrl);
                taxLots.push({ quantity: txQty, price: txPrice, date: tx.date, fxRate: txFx });
                if (!firstBuyDate) firstBuyDate = tx.date;
            } else if (tx.type === 'SELL') {
                const currentAvg = quantity > 0 ? safeFloat(totalCost / quantity) : 0;
                const costOfSoldShares = safeCurrency(txQty * currentAvg);
                const profit = safeSub(txTotal, costOfSoldShares);
                // Baixa proporcional do custo em BRL — preserva o câmbio médio das
                // compras remanescentes (a venda não reprecifica o que ficou).
                const costOfSoldSharesBrl = quantity > 0
                    ? safeCurrency(totalCostBrl * (txQty / quantity))
                    : 0;

                realizedProfit = safeAdd(realizedProfit, profit);
                realizedProfitBrl = safeAdd(realizedProfitBrl, safeSub(txTotalBrl, costOfSoldSharesBrl));
                quantity = subQty(quantity, txQty);
                totalCost = safeSub(totalCost, costOfSoldShares);
                totalCostBrl = safeSub(totalCostBrl, costOfSoldSharesBrl);

                let remainingToSell = txQty;
                let fifoCostOfSoldShares = 0; // NOVO

                while (remainingToSell > QUANTITY_EPSILON && taxLots.length > 0) {
                    const oldestLot = taxLots[0];
                    if (oldestLot.quantity > remainingToSell) {
                        fifoCostOfSoldShares = safeAdd(fifoCostOfSoldShares, safeCurrency(remainingToSell * oldestLot.price));
                        oldestLot.quantity = subQty(oldestLot.quantity, remainingToSell);
                        remainingToSell = 0;
                    } else {
                        fifoCostOfSoldShares = safeAdd(fifoCostOfSoldShares, safeCurrency(oldestLot.quantity * oldestLot.price));
                        remainingToSell = subQty(remainingToSell, oldestLot.quantity);
                        taxLots.shift();
                    }
                }

                const fifoProfit = safeSub(txTotal, fifoCostOfSoldShares);
                fifoRealizedProfit = safeAdd(fifoRealizedProfit, fifoProfit);
            }
        }

        if (taxLots.length > 500) {
            const lotsToMerge = taxLots.slice(0, 100);
            const keptLots = taxLots.slice(100);
            let mergedQty = 0;
            let mergedCost = 0;
            let mergedCostBrl = 0;

            lotsToMerge.forEach(l => {
                mergedQty = addQty(mergedQty, l.quantity);
                mergedCost = safeAdd(mergedCost, safeCurrency(l.quantity * l.price));
                mergedCostBrl = safeAdd(mergedCostBrl, safeCurrency(l.quantity * l.price * (l.fxRate || 1)));
            });

            const mergedPrice = mergedQty > 0 ? safeFloat(mergedCost / mergedQty) : 0;
            // Câmbio médio ponderado pelo custo — mantém o lote consolidado com o
            // mesmo valor em reais que os lotes originais somavam.
            const mergedFx = mergedCost > 0 ? safeFloat(mergedCostBrl / mergedCost) : 1;

            taxLots = [{
                date: lotsToMerge[lotsToMerge.length - 1].date,
                quantity: mergedQty,
                price: mergedPrice,
                fxRate: mergedFx,
                _id: false
            }, ...keptLots];
        }

        if (quantity < -QUANTITY_EPSILON) throw new Error(`Saldo insuficiente para ${ticker}.`);
        if (quantity <= QUANTITY_EPSILON) { quantity = 0; totalCost = 0; totalCostBrl = 0; taxLots = []; }

        // Persistência do carimbo de câmbio: fora do laço, em uma escrita só, e
        // best-effort — falhar aqui não pode derrubar o recálculo da posição
        // (o valor já foi reconstruído em memória e o próximo recalc tenta de novo).
        if (fxToStamp.length > 0) {
            try {
                await AssetTransaction.bulkWrite(
                    fxToStamp.map(({ id, fxRate }) => ({
                        updateOne: { filter: { _id: id }, update: { $set: { fxRate } } },
                    })),
                    session ? { session } : {},
                );
            } catch (err) {
                logger.warn(`[FX] Falha ao carimbar câmbio em ${ticker}: ${err.message}`);
            }
        }

        if (!asset) {
            if (transactions.length > 0) {
                // marketInfo já foi buscado acima (a moeda dele decide o câmbio).
                // Ouro não é mais classe própria na carteira: entra como ETF lastreado
                // (GLD/IAU/GOLD11…). Se o usuário não escolheu o tipo explicitamente
                // (forcedType), instrumentos de ouro caem na classe ETF.
                const goldDefault = isGoldTicker(ticker) ? 'ETF' : null;
                asset = new UserAsset({
                    user: userId, wallet: walletId, ticker,
                    type: forcedType || goldDefault || marketInfo?.type || 'STOCK',
                    // Moeda explícita do cadastro tem prioridade (ETF nacional R$ vs
                    // internacional US$); senão herda do MarketAsset; senão BRL.
                    currency: forcedCurrency || marketInfo?.currency || 'BRL',
                    allocationClass: resolveAllocationClass({
                        ticker,
                        type: forcedType || goldDefault || marketInfo?.type || 'STOCK',
                        allocationClass: marketInfo?.allocationClass,
                        sector: marketInfo?.sector,
                    }),
                });

                // Rede de segurança: ticker sem registro de mercado (ex.: ETF nacional
                // fora da lista curada, ou ativo digitado direto) ganha um stub para o
                // refresh de cotações ter um documento para atualizar — senão ficaria
                // com preço 0 no total da carteira. Caixa/Renda Fixa não têm cotação.
                if (!marketInfo && !['CASH', 'FIXED_INCOME'].includes(asset.type)) {
                    await MarketAsset.updateOne(
                        { ticker },
                        { $setOnInsert: { ticker, name: asset.name || ticker, type: asset.type, currency: asset.currency || 'BRL', allocationClass: asset.allocationClass || null, isActive: true } },
                        { upsert: true, session }
                    ).catch(() => {});
                }
            } else { return null; }
        } else if (forcedType && asset.type !== forcedType) {
            asset.type = forcedType;
        }

        // Self-heal idempotente de posições anteriores ao campo allocationClass.
        // O MarketAsset prevalece; a lista curada/ticker e o setor são fallbacks.
        if (!marketInfo && (asset.type === 'ETF' || !asset.allocationClass)) {
            marketInfo = await MarketAsset.findOne({ ticker })
                .select('sector currency name type allocationClass')
                .lean()
                .catch(() => null);
        }
        asset.allocationClass = resolveAllocationClass({
            ticker,
            type: asset.type,
            allocationClass: marketInfo?.allocationClass || asset.allocationClass,
            sector: marketInfo?.sector,
        });

        asset.quantity = quantity;
        asset.totalCost = safeCurrency(totalCost);
        asset.realizedProfit = safeCurrency(realizedProfit);
        asset.fifoRealizedProfit = safeCurrency(fifoRealizedProfit); // NOVO
        asset.taxLots = taxLots;
        // Custo/realizado em BRL com o câmbio de cada lançamento congelado.
        asset.totalCostBrl = safeCurrency(totalCostBrl);
        asset.realizedProfitBrl = safeCurrency(realizedProfitBrl);
        asset.updatedAt = new Date();
        
        if (firstBuyDate && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
            asset.startDate = firstBuyDate;
        }

        // Exterior: auto-classifica o sub-tipo (Stocks/ETF/REIT/Dólar) quando o
        // usuário não definiu manualmente. Override manual permanece intocado.
        if (asset.type === 'STOCK_US') {
            if (!asset.usSubTypeManual) {
                if (!marketInfo) {
                    marketInfo = await MarketAsset.findOne({ ticker }).select('sector currency name').lean().catch(() => null);
                }
                asset.usSubType = classifyUsAsset({
                    ticker,
                    sector: marketInfo?.sector,
                    type: asset.type,
                    currency: asset.currency || marketInfo?.currency,
                    name: asset.name || marketInfo?.name,
                });
            }
        } else if (asset.usSubType) {
            // Mudou de classe: o sub-tipo de Exterior deixa de fazer sentido.
            asset.usSubType = null;
            asset.usSubTypeManual = false;
        }

        await asset.save({ session });
        return asset;
    },

    async applyCorporateEvents(_ticker, _type) {
        return { processed: false, reason: "Feature disabled in optimization mode" };
    }
};
