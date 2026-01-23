import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';

const USD_RATE_MOCK = 5.65;

export const getWalletData = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        
        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0 } 
            });
        }

        const uniqueTickers = [...new Set(userAssets.map(a => marketDataService.normalizeSymbol(a.ticker, a.type)))];
        const priceMap = new Map();

        await Promise.all(uniqueTickers.map(async (symbol) => {
            const data = await marketDataService.getMarketDataByTicker(symbol);
            priceMap.set(symbol, data);
        }));

        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;

        const processedAssets = userAssets.map(asset => {
            const symbol = marketDataService.normalizeSymbol(asset.ticker, asset.type);
            const marketInfo = priceMap.get(symbol) || { price: 0, change: 0, name: asset.ticker };
            
            const multiplier = asset.currency === 'USD' ? USD_RATE_MOCK : 1;
            const currentPrice = marketInfo.price;
            const avgPrice = asset.quantity > 0 ? asset.totalCost / asset.quantity : 0;
            
            const equity = asset.quantity * currentPrice * multiplier;
            const invested = asset.totalCost * multiplier;
            
            totalEquity += equity;
            totalInvested += invested;

            const dayChange = equity * (marketInfo.change / 100);
            totalDayVariation += isNaN(dayChange) ? 0 : dayChange;

            const profit = equity - invested;
            const profitPercent = invested > 0 ? (profit / invested) * 100 : 0;

            return {
                id: asset._id,
                ticker: asset.ticker,
                name: marketInfo.name,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: avgPrice,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: equity,
                profit: profit,
                profitPercent: profitPercent
            };
        });

        const totalResult = totalEquity - totalInvested;
        
        res.json({
            assets: processedAssets,
            kpis: {
                totalEquity,
                totalInvested,
                totalResult,
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

export const addAssetTransaction = async (req, res, next) => {
    try {
        const { ticker, type, quantity, price, currency } = req.body;
        const userId = req.user.id;
        const cleanTicker = ticker.toUpperCase().trim();

        let asset = await UserAsset.findOne({ user: userId, ticker: cleanTicker });

        if (asset) {
            asset.quantity += Number(quantity);
            asset.totalCost += (Number(quantity) * Number(price));
            asset.updatedAt = Date.now();
            await asset.save();
        } else {
            asset = new UserAsset({
                user: userId,
                ticker: cleanTicker,
                type,
                quantity: Number(quantity),
                totalCost: (Number(quantity) * Number(price)),
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL')
            });
            await asset.save();
        }

        const existingInGlobal = await MarketAsset.findOne({ ticker: cleanTicker });
        if (!existingInGlobal) {
            await MarketAsset.create({
                ticker: cleanTicker,
                name: cleanTicker,
                type: type,
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL')
            });
        }

        res.status(201).json(asset);
    } catch (error) {
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