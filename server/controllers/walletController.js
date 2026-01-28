
import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';

const USD_RATE_MOCK = 5.75;

export const getWalletData = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        
        // Separa ativos ativos (qty > 0) de histórico (qty = 0)
        const activeAssets = userAssets.filter(a => a.quantity > 0.000001);
        const closedAssets = userAssets.filter(a => a.quantity <= 0.000001);

        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0 } 
            });
        }

        const tickers = activeAssets.map(a => a.ticker);
        const marketAssets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker sector');
        const staticInfoMap = new Map();
        marketAssets.forEach(ma => staticInfoMap.set(ma.ticker, ma.sector));

        const uniqueTickers = [...new Set(activeAssets.map(a => marketDataService.normalizeSymbol(a.ticker, a.type)))];
        const priceMap = new Map();

        // Busca dados de mercado em paralelo
        await Promise.all(uniqueTickers.map(async (symbol) => {
            const data = await marketDataService.getMarketDataByTicker(symbol);
            priceMap.set(symbol, data);
        }));

        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        
        // Calcula lucro realizado de posições fechadas
        let totalRealizedProfit = closedAssets.reduce((acc, curr) => acc + (curr.realizedProfit || 0), 0);

        const processedAssets = activeAssets.map(asset => {
            const symbol = marketDataService.normalizeSymbol(asset.ticker, asset.type);
            const marketInfo = priceMap.get(symbol) || { price: 0, change: 0, name: asset.ticker };
            
            const multiplier = asset.currency === 'USD' ? USD_RATE_MOCK : 1;
            
            const currentPrice = asset.type === 'CASH' ? 1 : (marketInfo.price || 0);
            const avgPrice = asset.quantity > 0 ? asset.totalCost / asset.quantity : 0;
            
            const equity = asset.quantity * currentPrice * multiplier;
            const invested = asset.totalCost * multiplier;
            
            totalEquity += equity;
            totalInvested += invested;

            const dayChange = equity * (marketInfo.change / 100);
            totalDayVariation += isNaN(dayChange) ? 0 : dayChange;

            // Lucro não realizado desta posição
            const unrealizedProfit = equity - invested;
            
            // Adiciona o lucro realizado parcial desta posição (se houver vendas parciais anteriores)
            const positionTotalResult = unrealizedProfit + (asset.realizedProfit || 0);
            const profitPercent = invested > 0 ? (positionTotalResult / invested) * 100 : 0;

            let sector = staticInfoMap.get(asset.ticker);
            if (!sector) {
                if (asset.type === 'FII') sector = 'FII Genérico';
                else if (asset.type === 'STOCK') sector = 'Ações Diversas';
                else if (asset.type === 'CRYPTO') sector = 'Criptoativos';
                else if (asset.type === 'CASH') sector = 'Caixa';
                else if (asset.type === 'FIXED_INCOME') sector = 'Renda Fixa';
                else sector = 'Outros';
            }

            return {
                id: asset._id,
                ticker: asset.ticker,
                name: marketInfo.name || asset.ticker,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: avgPrice,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: equity,
                profit: positionTotalResult,
                profitPercent: profitPercent,
                sector: sector 
            };
        });

        // Resultado Total = (Equity Atual - Custo Atual) + Lucro Realizado (de vendas totais ou parciais)
        // Nota: processedAssets já soma realizedProfit parcial. 
        // Precisamos somar o realizedProfit das posições FECHADAS (totalRealizedProfit).
        const currentUnrealized = totalEquity - totalInvested;
        const partialRealized = activeAssets.reduce((acc, curr) => acc + (curr.realizedProfit || 0), 0);
        
        const totalResult = currentUnrealized + partialRealized + totalRealizedProfit;
        
        res.json({
            assets: processedAssets,
            kpis: {
                totalEquity,
                totalInvested,
                totalResult, // Agora reflete o histórico correto
                totalResultPercent: totalInvested > 0 ? (totalResult / totalInvested) * 100 : 0,
                dayVariation: totalDayVariation,
                dayVariationPercent: totalEquity > 0 ? (totalDayVariation / totalEquity) * 100 : 0
            }
        });

    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const snapshots = await WalletSnapshot.find({ user: userId })
            .sort({ date: 1 })
            .limit(365);
        
        res.json(snapshots);
    } catch (error) {
        next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]); // Mínimo 2 chars para autocomplete fluido

        const regex = new RegExp(query, 'i');
        const tickerRegex = new RegExp(`^${query}`, 'i');

        // Busca LIMIT 5 para autocomplete rápido
        const assets = await MarketAsset.find({ 
            $or: [
                { ticker: tickerRegex },
                { name: regex }
            ]
        })
        .select('ticker name lastPrice type')
        .limit(5);
        
        const results = assets.map(a => ({
            ticker: a.ticker,
            name: a.name,
            price: a.lastPrice,
            type: a.type
        }));

        return res.json(results);
    } catch (error) {
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    try {
        const { ticker, type, quantity, currency } = req.body;
        const rawPrice = req.body.price !== undefined ? req.body.price : req.body.averagePrice;
        const userId = req.user.id;
        
        if (!ticker) return res.status(400).json({ message: "Ticker obrigatório." });

        const cleanTicker = ticker.toUpperCase().trim();
        const numQty = parseFloat(quantity);
        const numPrice = parseFloat(rawPrice);

        if (isNaN(numQty) || isNaN(numPrice)) {
            return res.status(400).json({ message: "Valores inválidos." });
        }

        let asset = await UserAsset.findOne({ user: userId, ticker: cleanTicker });

        if (asset) {
            if (numQty < 0) {
                // --- LÓGICA DE VENDA COM REALIZAÇÃO DE LUCRO ---
                const sellQty = Math.abs(numQty);
                
                if (sellQty > asset.quantity + 0.000001) {
                    return res.status(400).json({ message: "Quantidade insuficiente para venda." });
                }

                // Cálculo do Preço Médio Atual
                const currentAvgPrice = asset.totalCost / asset.quantity;
                
                // Custo proporcional das ações sendo vendidas
                const costOfSoldShares = sellQty * currentAvgPrice;
                
                // Valor da venda
                const saleValue = sellQty * numPrice;
                
                // Lucro desta transação
                const profit = saleValue - costOfSoldShares;

                // Atualiza Ativo
                asset.quantity -= sellQty;
                asset.totalCost -= costOfSoldShares;
                asset.realizedProfit = (asset.realizedProfit || 0) + profit;

                // Se quantidade for zero (ou muito próxima), mantemos o registro para histórico de lucro, mas zeramos custo/qty
                if (asset.quantity <= 0.000001) {
                    asset.quantity = 0;
                    asset.totalCost = 0; 
                    // realizedProfit é mantido!
                    logger.info(`📉 Posição zerada em ${cleanTicker}. Lucro realizado salvo.`);
                }

            } else {
                // --- COMPRA ---
                // Se o ativo estava zerado, ele "renasce", mantendo o histórico de realizedProfit antigo
                asset.quantity += numQty;
                asset.totalCost += (numQty * numPrice);
            }
            
            asset.updatedAt = Date.now();
            await asset.save();
        } else {
            // --- NOVO ATIVO ---
            if (numQty < 0) return res.status(400).json({ message: "Não é possível vender ativo inexistente." });

            asset = new UserAsset({
                user: userId,
                ticker: cleanTicker,
                type,
                quantity: numQty,
                totalCost: numQty * numPrice,
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL'),
                realizedProfit: 0
            });
            await asset.save();
        }

        // Garante existência na tabela global
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
        } catch (globalErr) {}

        res.status(201).json(asset);
    } catch (error) {
        logger.error(`Erro transaction: ${error.message}`);
        next(error);
    }
};

export const removeAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        await UserAsset.findOneAndDelete({ _id: id, user: req.user.id });
        res.json({ message: "Ativo removido." });
    } catch (error) {
        next(error);
    }
};
