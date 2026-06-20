
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
import logger from '../config/logger.js';

export const financialService = {
    
    // (6.10) Delegam ao utilitário único de datas (utils/dateUtils.js) — mantidos
    // como métodos para preservar todos os call sites internos (this.toDateKey).
    toDateKey(date) {
        return toDateKeyUtil(date);
    },

    normalizeDate(date) {
        return startOfDay(date);
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
        if (priceMap.has(dateStr)) return priceMap.get(dateStr);
        const targetDate = new Date(dateStr);
        for (let i = 1; i <= 5; i++) {
            const prevDate = new Date(targetDate);
            prevDate.setDate(targetDate.getDate() - i);
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
        // G1 FIX: Load historical USD/BRL rates for per-date conversion
        const usdHistoryDoc = await AssetHistory.findOne({ ticker: 'USD-BRL' }).lean();
        const usdRateByDate = new Map();
        if (usdHistoryDoc?.history) {
            usdHistoryDoc.history.forEach(h => {
                if (h.date && (h.close || h.adjClose) > 0) {
                    usdRateByDate.set(h.date, h.adjClose || h.close);
                }
            });
        }
        // Série ordenada (asc) para busca da taxa histórica mais próxima — evita
        // cair na taxa ATUAL para datas passadas com gaps > 7 dias (P&L histórico).
        const usdSorted = [...usdRateByDate.entries()]
            .map(([d, r]) => [new Date(d).getTime(), r])
            .filter(([t]) => !Number.isNaN(t))
            .sort((a, b) => a[0] - b[0]);

        return (dateStr) => {
            if (usdRateByDate.has(dateStr)) return usdRateByDate.get(dateStr);
            if (usdSorted.length === 0) return currentUsdRate; // sem histórico: último recurso
            const targetMs = new Date(dateStr).getTime();
            // taxa mais recente em data <= alvo (busca binária)
            let lo = 0, hi = usdSorted.length - 1, best = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (usdSorted[mid][0] <= targetMs) { best = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            // alvo anterior a todo o histórico → usa a 1ª taxa conhecida (não a atual)
            return best >= 0 ? usdSorted[best][1] : usdSorted[0][1];
        };
    },

    /**
     * Monta o cache de preços (Map ticker → Map data→{close,adjClose}) para os
     * tickers de renda variável. Faz fallback para externalMarketService quando
     * o histórico local é curto, persistindo o resultado em AssetHistory.
     */
    async _loadPriceCacheMap(uniqueTickers, assetMetadataMap) {
        const priceCacheMap = new Map();

        await Promise.all(uniqueTickers.map(async (ticker) => {
            const assetMeta = assetMetadataMap.get(ticker);
            if (assetMeta?.type === 'FIXED_INCOME' || assetMeta?.type === 'CASH' || ticker === 'RESERVA') return;

            try {
                const searchTicker = this.normalizeTickerForHistory(ticker);
                let history = await marketDataService.getBenchmarkHistory(ticker);

                if (!history || history.length < 5) {
                    const info = await MarketAsset.findOne({ ticker });
                    const type = info?.type || 'STOCK';
                    try {
                        const extHistory = await externalMarketService.getFullHistory(searchTicker, type);
                        if (extHistory && extHistory.length > 0) {
                            await AssetHistory.updateOne(
                                { ticker: ticker.toUpperCase() },
                                { history: extHistory, lastUpdated: new Date() },
                                { upsert: true }
                            );
                            history = extHistory;
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

    /** Indexa todos os proventos dos tickers por data (chave toDateKey). */
    async _loadDividendDateMap(uniqueTickers) {
        const allDividends = await DividendEvent.find({ ticker: { $in: uniqueTickers } }).sort({ date: 1 });
        const dividendDateMap = new Map();
        allDividends.forEach(div => {
            const dKey = this.toDateKey(div.date);
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
        } = ctx;
        let txIndex = ctx.txIndex;
        let dayFlowAdjusted = 0;

        while (txIndex < txs.length) {
            const tx = txs[txIndex];
            const txDateIso = this.toDateKey(tx.date);
            if (txDateIso > cursorIso) break;

            if (!portfolio[tx.ticker]) {
                portfolio[tx.ticker] = { qty: 0, cost: 0 };
                const meta = assetMetadataMap.get(tx.ticker);
                if (meta && (meta.type === 'FIXED_INCOME' || meta.type === 'CASH')) {
                    fixedIncomeState[tx.ticker] = {
                        currentValue: 0,
                        rate: meta.fixedIncomeRate > 0 ? meta.fixedIncomeRate : (meta.type === 'CASH' ? 100 : 10),
                        index: meta.fixedIncomeIndex || null,
                        spread: meta.fixedIncomeSpread || 0,
                    };
                }
            }

            let txAdjPrice = tx.price;
            let trueAdjustedFlow = tx.totalValue; // Fluxo ajustado real
            const meta = assetMetadataMap.get(tx.ticker);
            const isFixed = meta?.type === 'FIXED_INCOME' || meta?.type === 'CASH';
            const txIsDollarized = meta?.type === 'STOCK_US' || meta?.type === 'CRYPTO' || meta?.currency === 'USD';
            const txUsdRate = txIsDollarized ? getUsdRateForDate(cursorIso) : 1;

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
                if (isFixed) {
                    if (!fixedIncomeState[tx.ticker]) fixedIncomeState[tx.ticker] = { currentValue: 0, rate: meta?.fixedIncomeRate || 100, index: meta?.fixedIncomeIndex || null, spread: meta?.fixedIncomeSpread || 0 };
                    fixedIncomeState[tx.ticker].currentValue += tx.totalValue;
                }
                dayFlowAdjusted += trueAdjustedFlow * txUsdRate;

                if (!lastKnownPrices[tx.ticker]) lastKnownPrices[tx.ticker] = { close: tx.price, adjClose: txAdjPrice };

            } else if (tx.type === 'SELL') {
                const currentAvg = portfolio[tx.ticker].qty > 0 ? portfolio[tx.ticker].cost / portfolio[tx.ticker].qty : 0;
                portfolio[tx.ticker].qty -= tx.quantity;
                portfolio[tx.ticker].cost -= (tx.quantity * currentAvg);
                if (isFixed) {
                    fixedIncomeState[tx.ticker].currentValue = Math.max(0, fixedIncomeState[tx.ticker].currentValue - tx.totalValue);
                }
                dayFlowAdjusted -= trueAdjustedFlow * txUsdRate;
            }

            if (portfolio[tx.ticker].qty < QUANTITY_EPSILON) {
                portfolio[tx.ticker].qty = 0;
                portfolio[tx.ticker].cost = 0;
                if (fixedIncomeState[tx.ticker]) fixedIncomeState[tx.ticker].currentValue = 0;
            }
            txIndex++;
        }

        return { txIndex, dayFlowAdjusted };
    },

    /**
     * Acumula juros da renda fixa do dia (mutando `fixedIncomeState`). Renda fixa
     * só rende em dia útil. Antes usava !isWeekend, que aplicava CDI também em
     * FERIADOS (ex.: Corpus Christi) — divergindo do KPI/benchmark (que usam
     * countBusinessDays, pulando feriados).
     */
    _accrueDailyFixedIncome(ctx) {
        const { cursor, cursorIso, portfolio, fixedIncomeState, dailyFactorsMap, cdiDailyFactor, currentIpcaRate } = ctx;
        const isMapFactor = dailyFactorsMap.has(cursorIso);
        const shouldApplyRates = isMapFactor || isBusinessDay(cursor);
        if (!shouldApplyRates) return;

        for (const ticker in fixedIncomeState) {
            if (portfolio[ticker].qty > 0) {
                const state = fixedIncomeState[ticker];
                let dailyFactor = 1;
                // Indexados (Selic/CDI/IPCA): índice + spread. Selic usa o CDI
                // histórico do dia + gap SELIC-CDI (~0,10) + spread; IPCA usa o
                // IPCA corrente + spread (sem série diária no rebuild).
                if (state.index === 'SELIC' || state.index === 'CDI') {
                    const extraAnnual = (state.index === 'SELIC' ? 0.10 : 0) + (state.spread || 0);
                    dailyFactor = cdiDailyFactor * Math.pow(1 + (extraAnnual / 100), 1/252);
                } else if (state.index === 'IPCA') {
                    dailyFactor = Math.pow(1 + ((currentIpcaRate + (state.spread || 0)) / 100), 1/252);
                } else if (state.rate > 50) {
                    // Legado: > 50 = % do CDI (ex: 110 = 110% CDI); <= 50 = prefixada a.a.
                    dailyFactor = 1 + ((cdiDailyFactor - 1) * (state.rate / 100));
                } else {
                    dailyFactor = Math.pow(1 + (state.rate / 100), 1/252);
                }

                state.currentValue *= dailyFactor;
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
            const isDollarized = meta?.type === 'STOCK_US' || meta?.type === 'CRYPTO' || meta?.currency === 'USD';
            const fxRate = isDollarized ? usdRateForDay : 1;

            totalInvested += pos.cost * fxRate;

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

    /** Substitui os snapshots do usuário pelos recém-calculados (em transação, em lotes). */
    async _persistSnapshots(userId, snapshots) {
        if (snapshots.length === 0) return;
        await runTransaction(async (session) => {
            await WalletSnapshot.deleteMany({ user: userId }).session(session);
            const CHUNK_SIZE = 5000;
            for (let i = 0; i < snapshots.length; i += CHUNK_SIZE) {
                await WalletSnapshot.insertMany(snapshots.slice(i, i + CHUNK_SIZE), { session });
            }
        });
    },

    async rebuildUserHistory(userId) {
        const startTime = Date.now();

        try {
            // Log de Auditoria Inicial
            await AuditLog.create({
                user: userId,
                action: 'RECALC_QUOTA',
                details: 'Início de reconstrução de histórico (Manual/Transaction Trigger)'
            });

            const txs = await AssetTransaction.find({ user: userId }).sort({ date: 1 });
            if (txs.length === 0) {
                await WalletSnapshot.deleteMany({ user: userId });
                return;
            }

            const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            const currentCdiRate = sysConfig?.cdi || DEFAULT_SELIC_FALLBACK;
            const currentIpcaRate = (sysConfig?.ipca && sysConfig.ipca > 0) ? sysConfig.ipca : 4.5;
            const currentUsdRate = sysConfig?.dollar || 5.75;

            const uniqueTickers = [...new Set(txs.map(t => t.ticker))];

            const assetMetadataMap = new Map();
            const userAssets = await UserAsset.find({ user: userId });
            userAssets.forEach(ua => assetMetadataMap.set(ua.ticker, ua));

            // Carregamento de contexto (cada fonte isolada num helper testável).
            const getUsdRateForDate = await this._loadUsdRateResolver(currentUsdRate);
            const priceCacheMap = await this._loadPriceCacheMap(uniqueTickers, assetMetadataMap);
            const dividendDateMap = await this._loadDividendDateMap(uniqueTickers);

            const startDate = new Date(txs[0].date);
            startDate.setHours(12, 0, 0, 0);
            const today = new Date();
            today.setHours(12, 0, 0, 0);

            const { dailyFactorsMap, cdiFactorsCacheFallback } = await this._loadCdiFactors(startDate, today, currentCdiRate);

            // Estado mutável acumulado ao longo do loop diário.
            const snapshots = [];
            const portfolio = {};
            const fixedIncomeState = {};
            const lastKnownPrices = {};
            let accumulatedDividends = 0;
            let currentQuota = 100.0;
            let previousEquityAdjusted = 0;
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
                });
                txIndex = dayTx.txIndex;
                const dayFlowAdjusted = dayTx.dayFlowAdjusted;

                // 2) Proventos do dia (sobre a posição já atualizada).
                const dayDividends = dividendDateMap.get(cursorIso) || [];
                for (const div of dayDividends) {
                    if (portfolio[div.ticker] && portfolio[div.ticker].qty > 0) {
                        accumulatedDividends += (portfolio[div.ticker].qty * div.amount);
                    }
                }

                // 3) Juros da renda fixa do dia.
                this._accrueDailyFixedIncome({
                    cursor, cursorIso, portfolio, fixedIncomeState,
                    dailyFactorsMap, cdiDailyFactor, currentIpcaRate,
                });

                // 4) Marcação a mercado.
                const usdRateForDay = getUsdRateForDate(cursorIso);
                const { totalEquityNominal, totalEquityAdjusted, totalInvested, hasPosition } =
                    this._markPortfolioToMarket({
                        cursorIso, portfolio, fixedIncomeState, assetMetadataMap,
                        priceCacheMap, lastKnownPrices, usdRateForDay,
                    });

                // 5) Cota TWRR (Modified Dietz diário).
                if (previousEquityAdjusted > 0 || dayFlowAdjusted > 0) {
                    const dailyReturn = calculateDailyDietz(previousEquityAdjusted, totalEquityAdjusted, dayFlowAdjusted);

                    // Proteção contra spikes absurdos (ex: dados sujos)
                    if (dailyReturn > -0.5 && dailyReturn < 0.5) {
                        currentQuota = currentQuota * (1 + dailyReturn);
                    }
                }

                if (hasPosition || totalInvested > 0 || accumulatedDividends > 0) {
                    snapshots.push({
                        user: userId,
                        date: new Date(cursor),
                        totalEquity: safeCurrency(totalEquityNominal),
                        totalInvested: safeCurrency(totalInvested),
                        totalDividends: safeCurrency(accumulatedDividends),
                        profit: safeCurrency(totalEquityNominal - totalInvested),
                        profitPercent: safeFloat(totalInvested > 0 ? ((totalEquityNominal - totalInvested) / totalInvested) * 100 : 0),
                        quotaPrice: safeFloat(currentQuota)
                    });
                }

                previousEquityAdjusted = totalEquityAdjusted;
                cursor.setDate(cursor.getDate() + 1);
            }

            await this._persistSnapshots(userId, snapshots);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`✅ [History] Reconstrução V4.7 (Precision) concluída em ${duration}s.`, {
                source: 'rebuildUserHistory', userId: String(userId), durationSec: Number(duration), snapshots: snapshots.length,
            });

        } catch (error) {
            logger.error(`❌ [Engine] Erro Fatal no Rebuild: ${error.message}`);
        }
    },

    /**
     * Ingestão de proventos: busca o histórico de cada ticker e faz upsert em
     * DividendEvent (índice único ticker+date+amount evita duplicar). Cripto,
     * renda fixa e caixa são ignorados. `assets`: [{ ticker, type }].
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
                try {
                    const res = await DividendEvent.updateOne(
                        { ticker: key, date: ev.date, amount: ev.amount },
                        { $setOnInsert: { ticker: key, date: ev.date, amount: ev.amount, type: 'DIVIDEND', currency: 'BRL' } },
                        { upsert: true },
                    );
                    if (res.upsertedCount > 0) eventCount++;
                } catch (e) {
                    // Corrida no índice único (evento já inserido) — ignora.
                }
            }
        }

        logger.info(`[Dividends] Sync concluído: ${eventCount} novos eventos em ${tickerCount} tickers.`);
        return { tickers: tickerCount, events: eventCount };
    },

    // ... (Mantém o restante igual) ...
    async calculateUserDividends(userId) {
        // ... (Mantém inalterado)
        const assets = await UserAsset.find({ user: userId });
        const relevantAssets = assets.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
        const tickers = relevantAssets.map(a => a.ticker);

        if (tickers.length === 0) return { dividendMap: new Map(), provisioned: [], totalAllTime: 0, projectedMonthly: 0 };

        const marketInfos = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker dy lastPrice');
        const marketMap = new Map();
        marketInfos.forEach(m => marketMap.set(m.ticker, m));

        let projectedMonthly = 0;
        relevantAssets.forEach(asset => {
            const mInfo = marketMap.get(asset.ticker);
            if (mInfo && mInfo.dy > 0) {
                // CORREÇÃO: Cap de Yield para Projeção Mensal
                // Evita que dividendos extraordinários (ex: > 25% a.a.) distorçam a média mensal projetada.
                const safeDy = Math.min(mInfo.dy, 25);
                
                const annualIncome = (asset.quantity * mInfo.lastPrice) * (safeDy / 100);
                projectedMonthly += (annualIncome / 12);
            }
        });

        const allEvents = await DividendEvent.find({ ticker: { $in: tickers } }).sort({ date: 1 });
        const eventsMap = new Map();
        allEvents.forEach(e => {
            if (!eventsMap.has(e.ticker)) eventsMap.set(e.ticker, []);
            eventsMap.get(e.ticker).push(e);
        });

        const firstTransactions = await AssetTransaction.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), ticker: { $in: tickers }, type: 'BUY' } },
            { $sort: { date: 1 } },
            { $group: { _id: "$ticker", firstBuyDate: { $first: "$date" } } }
        ]);

        const acquisitionMap = new Map();
        firstTransactions.forEach(tx => acquisitionMap.set(tx._id, this.normalizeDate(tx.firstBuyDate)));

        const dividendMap = new Map();
        const provisioned = [];
        let totalAllTime = 0;

        for (const asset of relevantAssets) {
            const firstBuyDate = acquisitionMap.get(asset.ticker);
            const assetEvents = eventsMap.get(asset.ticker) || [];

            for (const event of assetEvents) {
                const eventDateNormalized = this.normalizeDate(event.date);
                if (!firstBuyDate || eventDateNormalized < firstBuyDate) continue;

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
                    }
                }
            }
        }

        return { dividendMap, provisioned, totalAllTime, projectedMonthly };
    },

    async recalculatePosition(userId, ticker, forcedType = null, session = null) {
        // ... (Mantém inalterado)
        const query = AssetTransaction.find({ user: userId, ticker }).sort({ date: 1, createdAt: 1 });
        if (session) query.session(session);
        const transactions = await query;
        
        let quantity = 0;
        let totalCost = 0; 
        let realizedProfit = 0;
        let fifoRealizedProfit = 0; // NOVO: Lucro Realizado FIFO
        let taxLots = []; 
        let firstBuyDate = null;

        for (const tx of transactions) {
            // Quantidade em 8 casas (cripto); valor monetário continua em 2/4 casas.
            const txQty = safeQuantity(tx.quantity);
            const txPrice = safeFloat(tx.price);
            const txTotal = safeCurrency(txQty * txPrice);

            if (tx.type === 'BUY') {
                quantity = addQty(quantity, txQty);
                totalCost = safeAdd(totalCost, txTotal);
                taxLots.push({ quantity: txQty, price: txPrice, date: tx.date });
                if (!firstBuyDate) firstBuyDate = tx.date;
            } else if (tx.type === 'SELL') {
                const currentAvg = quantity > 0 ? safeFloat(totalCost / quantity) : 0;
                const costOfSoldShares = safeCurrency(txQty * currentAvg);
                const profit = safeSub(txTotal, costOfSoldShares);

                realizedProfit = safeAdd(realizedProfit, profit);
                quantity = subQty(quantity, txQty);
                totalCost = safeSub(totalCost, costOfSoldShares);

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
            
            lotsToMerge.forEach(l => {
                mergedQty = addQty(mergedQty, l.quantity);
                mergedCost = safeAdd(mergedCost, safeCurrency(l.quantity * l.price));
            });

            const mergedPrice = mergedQty > 0 ? safeFloat(mergedCost / mergedQty) : 0;
            
            taxLots = [{
                date: lotsToMerge[lotsToMerge.length - 1].date,
                quantity: mergedQty,
                price: mergedPrice,
                _id: false
            }, ...keptLots];
        }

        if (quantity < -QUANTITY_EPSILON) throw new Error(`Saldo insuficiente para ${ticker}.`);
        if (quantity <= QUANTITY_EPSILON) { quantity = 0; totalCost = 0; taxLots = []; }

        let assetQuery = UserAsset.findOne({ user: userId, ticker });
        if (session) assetQuery.session(session);
        let asset = await assetQuery;

        if (!asset) {
            if (transactions.length > 0) {
                const marketInfo = await MarketAsset.findOne({ ticker });
                asset = new UserAsset({
                    user: userId, ticker,
                    type: forcedType || marketInfo?.type || 'STOCK',
                    currency: marketInfo?.currency || 'BRL'
                });
            } else { return null; }
        } else if (forcedType && asset.type !== forcedType) {
            asset.type = forcedType;
        }

        asset.quantity = quantity;
        asset.totalCost = safeCurrency(totalCost); 
        asset.realizedProfit = safeCurrency(realizedProfit);
        asset.fifoRealizedProfit = safeCurrency(fifoRealizedProfit); // NOVO
        asset.taxLots = taxLots;
        asset.updatedAt = new Date();
        
        if (firstBuyDate && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
            asset.startDate = firstBuyDate;
        }

        await asset.save({ session }); 
        return asset;
    },

    async applyCorporateEvents(ticker, type) {
        return { processed: false, reason: "Feature disabled in optimization mode" };
    }
};
