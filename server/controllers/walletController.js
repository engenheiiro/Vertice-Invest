
import mongoose from 'mongoose';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent } from '../utils/mathUtils.js';
import logger from '../config/logger.js';

export const getWalletData = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        const activeAssets = userAssets.filter(a => a.quantity > 0.000001);
        const closedAssets = userAssets.filter(a => a.quantity <= 0.000001);

        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0 },
                meta: { usdRate: 5.75 }
            });
        }

        const liveTickers = activeAssets.filter(a => a.type !== 'FIXED_INCOME' && a.type !== 'CASH').map(a => a.ticker);
        
        // Refresh rápido de cotações em background
        if (liveTickers.length > 0) {
            marketDataService.refreshQuotesBatch(liveTickers).catch(() => {});
        }

        // Busca dados de mercado incluindo a variação do dia (change)
        const dbAssets = await MarketAsset.find({ ticker: { $in: liveTickers } }).select('ticker sector name lastPrice change');
        const assetMap = new Map();
        dbAssets.forEach(a => {
            assetMap.set(a.ticker, {
                price: a.lastPrice,
                change: a.change || 0, // Variação % do dia real
                sector: a.sector,
                name: a.name
            });
        });

        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = safeFloat(config?.dollar || 5.75);
        const usdChange = safeFloat(config?.dollarChange || 0);
        const currentCdi = safeFloat(config?.cdi || 11.15); 

        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        
        // Cálculo de Lucro Realizado (Ativos fechados)
        let totalRealizedProfit = closedAssets.reduce((acc, curr) => {
            const isDollarized = curr.currency === 'USD' || curr.type === 'STOCK_US' || curr.type === 'CRYPTO';
            const mult = isDollarized ? usdRate : 1;
            const profitInBrl = safeMult((curr.realizedProfit || 0), mult);
            return safeAdd(acc, profitInBrl);
        }, 0);

        const processedAssets = activeAssets.map(asset => {
            let currentPrice = 0;
            let dayChangePct = 0; 
            const isDollarized = asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO';
            const currencyMultiplier = isDollarized ? usdRate : 1;

            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                // Lógica de Renda Fixa: Juros Compostos Diários
                const rawRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : (asset.type === 'CASH' ? 100 : 10.0);
                let dailyRate = 0;

                if (rawRate > 30) { 
                    const cdiFactor = safeDiv(rawRate, 100); 
                    const dailyCdi = Math.pow(1 + (currentCdi / 100), 1 / 252) - 1;
                    dailyRate = dailyCdi * cdiFactor;
                } else {
                    dailyRate = Math.pow(1 + (rawRate / 100), 1 / 252) - 1;
                }

                dayChangePct = dailyRate * 100;

                // Cálculo do Preço Atual Baseado no Tempo
                const startDate = new Date(asset.startDate || asset.createdAt || new Date());
                const now = new Date();
                const diffTime = Math.max(0, now - startDate);
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const businessDays = Math.floor(diffDays * 5 / 7);
                const compoundFactor = Math.pow(1 + dailyRate, businessDays);
                
                if (asset.type === 'CASH') {
                    // Para CAIXA, o preço unitário é virtualmente 1 + juros, mas a quantidade é o valor monetário.
                    const totalVal = safeMult(asset.totalCost, compoundFactor);
                    currentPrice = asset.quantity > 0 ? safeDiv(totalVal, asset.quantity) : 1;
                } else {
                    const totalProjected = safeMult(asset.totalCost, compoundFactor);
                    currentPrice = asset.quantity > 0 ? safeDiv(totalProjected, asset.quantity) : 0;
                }

            } else {
                // Renda Variável: Usa dados reais do banco (Sync Yahoo)
                const cached = assetMap.get(asset.ticker);
                if (cached && cached.price > 0) {
                    currentPrice = safeFloat(Number(cached.price));
                    dayChangePct = safeFloat(Number(cached.change)); // Variação real do dia
                } else {
                    currentPrice = safeFloat(asset.averagePrice); 
                    dayChangePct = 0;
                }
            }
            
            const totalValueBr = safeMult(safeMult(asset.quantity, currentPrice), currencyMultiplier);
            const totalCostBr = safeMult(asset.totalCost, currencyMultiplier);
            
            // Cálculo da Variação Financeira do Dia (R$)
            let combinedChangePct = dayChangePct;
            if (isDollarized) {
                combinedChangePct = dayChangePct + usdChange; 
            }

            const dayChangeValueBr = safeMult(totalValueBr, safeDiv(combinedChangePct, 100));

            totalEquity = safeAdd(totalEquity, totalValueBr);
            totalInvested = safeAdd(totalInvested, totalCostBr);
            totalDayVariation = safeAdd(totalDayVariation, dayChangeValueBr);

            const unrealizedProfitBr = safeSub(totalValueBr, totalCostBr);
            const realizedProfitBr = safeMult((asset.realizedProfit || 0), currencyMultiplier);
            const positionTotalResult = safeAdd(unrealizedProfitBr, realizedProfitBr);
            
            let profitPercent = 0;
            if (totalCostBr > 0) {
                profitPercent = calculatePercent(positionTotalResult, totalCostBr); 
            }

            return {
                id: asset._id,
                ticker: asset.ticker,
                name: assetMap.get(asset.ticker)?.name || asset.ticker,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: asset.quantity > 0 ? safeDiv(asset.totalCost, asset.quantity) : 0,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: safeCurrency(totalValueBr), 
                totalCost: safeCurrency(totalCostBr),
                profit: safeCurrency(positionTotalResult),
                profitPercent: safeFloat(profitPercent),
                sector: assetMap.get(asset.ticker)?.sector || 'Geral',
                dayChangePct: safeFloat(combinedChangePct)
            };
        });

        const currentUnrealized = safeSub(totalEquity, totalInvested);
        const totalResult = safeAdd(currentUnrealized, totalRealizedProfit);
        const { totalAllTime } = await financialService.calculateUserDividends(userId);

        const safeTotalEquity = safeCurrency(totalEquity);
        const safeTotalInvested = safeCurrency(totalInvested);
        const safeTotalResult = safeCurrency(totalResult);
        const safeTotalDayVariation = safeCurrency(totalDayVariation);

        let totalResultPercent = 0;
        if (safeTotalInvested > 0) {
            totalResultPercent = safeMult(safeDiv(safeTotalResult, safeTotalInvested), 100);
        }

        let dayVariationPercent = 0;
        if (safeTotalEquity > 0) {
            dayVariationPercent = safeMult(safeDiv(safeTotalDayVariation, safeTotalEquity), 100);
        }

        // Auto-Repair Check na rota principal (leve)
        const lastSnapshot = await WalletSnapshot.findOne({ user: userId }).sort({ date: -1 });
        if (totalEquity > 1000) {
            if (!lastSnapshot || lastSnapshot.totalEquity < (totalEquity * 0.1)) {
                financialService.rebuildUserHistory(userId).catch(e => logger.error(`Falha no AutoRepair: ${e.message}`));
            }
        }

        res.json({
            assets: processedAssets,
            kpis: {
                totalEquity: safeTotalEquity,
                totalInvested: safeTotalInvested,
                totalResult: safeTotalResult, 
                totalResultPercent: totalResultPercent,
                dayVariation: safeTotalDayVariation,
                dayVariationPercent: dayVariationPercent,
                totalDividends: safeCurrency(totalAllTime)
            },
            meta: { usdRate, lastUpdate: new Date() }
        });
    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { ticker, type, quantity, currency, date, fixedIncomeRate } = req.body;
        const rawPrice = req.body.price !== undefined ? req.body.price : req.body.averagePrice;
        const userId = req.user.id;
        
        if (!ticker) throw new Error("Ticker obrigatório.");

        const cleanTicker = ticker.toUpperCase().trim();
        const numQty = safeFloat(parseFloat(quantity));
        const numPrice = safeFloat(parseFloat(rawPrice));
        
        // Data Handling: Garante que a data seja salva corretamente sem fuso horário
        const transactionDate = date ? new Date(date) : new Date();
        if (date) {
            // Ajusta para meio-dia para evitar problemas de fuso (-3h)
            const parts = date.split('-');
            transactionDate.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            transactionDate.setHours(12, 0, 0, 0); 
        }

        if (isNaN(numQty) || isNaN(numPrice)) throw new Error("Valores inválidos.");

        // Validação de Venda
        if (numQty < 0) {
            const currentAsset = await UserAsset.findOne({ user: userId, ticker: cleanTicker }).session(session);
            const currentQty = currentAsset ? currentAsset.quantity : 0;
            if (Math.abs(numQty) > currentQty) {
                throw new Error(`Saldo insuficiente. Você possui ${currentQty}, tentou vender ${Math.abs(numQty)}.`);
            }
        }

        const txType = numQty >= 0 ? 'BUY' : 'SELL';
        const absQty = Math.abs(numQty);
        const txTotalValue = safeMult(absQty, numPrice);
        
        const newTx = new AssetTransaction({
            user: userId,
            ticker: cleanTicker,
            type: txType,
            quantity: absQty,
            price: numPrice,
            totalValue: txTotalValue,
            date: transactionDate,
            notes: 'Inserção Manual'
        });
        await newTx.save({ session }); 

        // Cria MarketAsset se não existir
        if (type !== 'FIXED_INCOME' && type !== 'CASH') {
            try {
                const existingInGlobal = await MarketAsset.findOne({ ticker: cleanTicker });
                if (!existingInGlobal) {
                    await MarketAsset.create({
                        ticker: cleanTicker,
                        name: req.body.name || cleanTicker,
                        type: type,
                        currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL'),
                        sector: 'Outros',
                        lastPrice: numPrice
                    });
                }
                marketDataService.refreshQuotesBatch([cleanTicker]).catch(() => {});
            } catch (globalErr) {}
        }

        // Recalcula Posição e PM
        const updatedAsset = await financialService.recalculatePosition(userId, cleanTicker, type, session);
        
        // Ajustes Renda Fixa
        if (updatedAsset && type === 'FIXED_INCOME') {
            updatedAsset.fixedIncomeRate = fixedIncomeRate || updatedAsset.fixedIncomeRate || 10.0;
            if (!updatedAsset.startDate || (updatedAsset.quantity === absQty && txType === 'BUY')) { 
                updatedAsset.startDate = transactionDate;
            }
            await updatedAsset.save({ session });
        }

        await session.commitTransaction();
        session.endSession();

        // Reconstroi histórico em background
        financialService.rebuildUserHistory(userId).catch(err => logger.error(`Erro rebuild history: ${err.message}`));
        
        res.status(201).json(updatedAsset || { message: "Transação registrada." });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        logger.error(`Erro Transaction Add: ${error.message}`);
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ message: error.message });
        }
        next(error);
    }
};

export const deleteTransaction = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { id } = req.params;
        const tx = await AssetTransaction.findOne({ _id: id, user: req.user.id }).session(session);
        if (!tx) throw new Error("Transação não encontrada.");
        
        const ticker = tx.ticker;

        await AssetTransaction.deleteOne({ _id: id }).session(session);
        await financialService.recalculatePosition(req.user.id, ticker, null, session);
        
        await session.commitTransaction();
        session.endSession();

        financialService.rebuildUserHistory(req.user.id).catch(err => logger.error(`Erro rebuild (delete): ${err.message}`));

        res.json({ message: "Transação removida." });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = { user: req.user.id, ticker: ticker.toUpperCase() };

        const totalItems = await AssetTransaction.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            transactions,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                hasMore: page < totalPages
            }
        });
    } catch (error) { next(error); }
};

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]); 
        
        const regex = new RegExp(query, 'i');
        const tickerRegex = new RegExp(`^${query}`, 'i');
        
        const marketAssets = await MarketAsset.find({ 
            $or: [{ ticker: tickerRegex }, { name: regex }] 
        }).select('ticker name lastPrice type').limit(5);
        
        const results = marketAssets.map(a => ({ 
            ticker: a.ticker, 
            name: a.name, 
            price: a.lastPrice, 
            type: a.type 
        }));

        return res.json(results.slice(0, 10)); 
    } catch (error) { next(error); }
};

export const removeAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const asset = await UserAsset.findOne({ _id: id, user: req.user.id });
        if (asset) {
            await AssetTransaction.deleteMany({ user: req.user.id, ticker: asset.ticker });
            await UserAsset.deleteOne({ _id: id });
            financialService.rebuildUserHistory(req.user.id).catch(()=>{});
        }
        res.json({ message: "Ativo removido." });
    } catch (error) { next(error); }
};

export const resetWallet = async (req, res, next) => {
    try {
        await UserAsset.deleteMany({ user: req.user.id });
        await AssetTransaction.deleteMany({ user: req.user.id });
        await WalletSnapshot.deleteMany({ user: req.user.id });
        res.json({ message: "Carteira resetada." });
    } catch (error) { next(error); }
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        const snapshotCount = await WalletSnapshot.countDocuments({ user: userId });
        if (snapshotCount === 0) {
            const txCount = await AssetTransaction.countDocuments({ user: userId });
            if (txCount > 0) {
                await financialService.rebuildUserHistory(userId);
            }
        }

        const snapshots = await WalletSnapshot.find({ user: userId }).sort({ date: 1 }).limit(365);
        res.json(snapshots);
    } catch (error) { next(error); }
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { dividendMap, provisioned, totalAllTime } = await financialService.calculateUserDividends(userId);

        const history = Array.from(dividendMap.entries())
            .map(([month, data]) => ({ 
                month, 
                value: safeCurrency(data.total),
                breakdown: data.breakdown || [] 
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

        res.json({
            history, 
            provisioned: provisioned.sort((a, b) => new Date(a.date) - new Date(b.date)),
            totalAllTime: safeCurrency(totalAllTime)
        });

    } catch (error) {
        logger.error(`Erro Dividendos: ${error.message}`);
        next(error);
    }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filterType = req.query.filterType; 
        const skip = (page - 1) * limit;
        const userId = req.user.id;

        const cashAssets = await UserAsset.find({ user: userId, type: 'CASH' }).select('ticker');
        const cashTickers = cashAssets.map(a => a.ticker);
        if (!cashTickers.includes('RESERVA')) cashTickers.push('RESERVA');

        let query = { user: userId };

        if (filterType === 'CASH') {
            query.ticker = { $in: cashTickers };
        } else if (filterType === 'TRADE') {
            query.ticker = { $nin: cashTickers };
        }

        const totalItems = await AssetTransaction.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        const transactions = await AssetTransaction.find(query)
            .sort({ date: -1, createdAt: -1 }) 
            .skip(skip)
            .limit(limit);

        res.json({
            transactions: transactions.map(tx => ({
                ...tx.toObject(),
                isCashOp: cashTickers.includes(tx.ticker)
            })),
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                hasMore: page < totalPages
            }
        });
    } catch (error) {
        logger.error(`Erro CashFlow: ${error.message}`);
        next(error);
    }
};

// --- MÉTODO DE PERFORMANCE BLINDADO (LIVE INJECTION + STALE CHECK) ---
export const getWalletPerformance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        let history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        
        // CHECK DE FRESCOR (Stale Data Check)
        // Se o último snapshot tiver mais de 24 horas, força rebuild para garantir granularidade.
        const lastSnap = history.length > 0 ? history[history.length - 1] : null;
        const now = new Date();
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        const isStale = !lastSnap || (now.getTime() - new Date(lastSnap.date).getTime() > oneDayMs);
        const hasAssets = await UserAsset.exists({ user: userId, quantity: { $gt: 0 } });

        if ((hasAssets && history.length === 0) || (hasAssets && isStale)) {
             logger.info(`🔄 [Performance] Histórico obsoleto ou ausente para user ${userId}. Iniciando Rebuild...`);
             await financialService.rebuildUserHistory(userId);
             // Recarrega após rebuild
             history = await WalletSnapshot.find({ user: userId }).sort({ date: 1 });
        }

        // 2. Cálculo do "Live Head" (Hoje Agora)
        // Isso garante que o gráfico termine no valor REAL ATUAL, ignorando snapshots desatualizados
        const userAssets = await UserAsset.find({ user: userId });
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = safeFloat(config?.dollar || 5.75);
        
        const liveTickers = userAssets.map(a => a.ticker);
        const dbAssets = await MarketAsset.find({ ticker: { $in: liveTickers } }).select('ticker lastPrice');
        const priceMap = new Map();
        dbAssets.forEach(a => priceMap.set(a.ticker, a.lastPrice));

        let liveEquity = 0;
        let liveInvested = 0;

        for (const asset of userAssets) {
            const mult = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;
            let price = 0;

            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                price = asset.quantity > 0 ? (asset.totalCost / asset.quantity) : 1;
            } else {
                price = priceMap.get(asset.ticker) || asset.totalCost / asset.quantity || 0;
            }

            liveEquity += (asset.quantity * price * mult);
            liveInvested += (asset.totalCost * mult);
        }

        // 3. Mesclagem Inteligente
        const todayStr = new Date().toISOString().split('T')[0];
        
        const finalHistory = history.map(h => ({
            date: h.date.toISOString().split('T')[0],
            equity: h.totalEquity,
            invested: h.totalInvested
        }));

        if (finalHistory.length > 0 && finalHistory[finalHistory.length - 1].date === todayStr) {
            finalHistory.pop();
        }

        if (liveEquity > 0 || liveInvested > 0) {
            finalHistory.push({
                date: todayStr,
                equity: liveEquity,
                invested: liveInvested
            });
        }

        // 4. Benchmarking
        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP'); 
        if (ibovHistory) {
            ibovHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
        }
        const cdiDaily = Math.pow(1 + 0.115, 1/252) - 1; 

        if (finalHistory.length === 0) return res.json([]);

        const result = finalHistory.map((point, index) => {
            const dateStr = point.date;
            
            const walletPerf = point.invested > 0 
                ? ((point.equity - point.invested) / point.invested) * 100 
                : 0;
            
            const startIbovVal = financialService.findClosestValue(ibovHistory, finalHistory[0].date);
            const startIbov = startIbovVal || 100000;
            
            let currentIbovVal = 0;
            if (index === finalHistory.length - 1 && ibovHistory && ibovHistory.length > 0) {
                 currentIbovVal = ibovHistory[ibovHistory.length - 1].close;
            } else {
                 currentIbovVal = financialService.findClosestValue(ibovHistory, dateStr);
            }
            
            const currentIbov = currentIbovVal || startIbov;
            const ibovPerf = ((currentIbov - startIbov) / startIbov) * 100;

            const daysDiff = Math.floor((new Date(point.date) - new Date(finalHistory[0].date)) / (1000 * 60 * 60 * 24));
            const businessDays = Math.max(0, Math.floor(daysDiff * 5 / 7));
            const cdiPerf = (Math.pow(1 + cdiDaily, businessDays) - 1) * 100;

            return {
                date: dateStr,
                wallet: safeFloat(walletPerf),
                cdi: safeFloat(cdiPerf),
                ibov: safeFloat(ibovPerf)
            };
        });

        res.json(result);

    } catch (error) {
        logger.error(`Erro Performance: ${error.message}`);
        next(error);
    }
};
