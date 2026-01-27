
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

        // Busca dados estáticos (Setor) do MarketAsset
        const tickers = userAssets.map(a => a.ticker);
        const marketAssets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker sector');
        const staticInfoMap = new Map();
        marketAssets.forEach(ma => staticInfoMap.set(ma.ticker, ma.sector));

        // Busca cotações atuais
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

            // Determina setor com fallback
            let sector = staticInfoMap.get(asset.ticker);
            if (!sector) {
                if (asset.type === 'FII') sector = 'FII Genérico';
                else if (asset.type === 'STOCK') sector = 'Ações Diversas';
                else if (asset.type === 'CRYPTO') sector = 'Criptoativos';
                else if (asset.type === 'CASH') sector = 'Caixa';
                else sector = 'Outros';
            }

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
                profitPercent: profitPercent,
                sector: sector // Novo campo adicionado
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

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.toUpperCase();
        if (!query || query.length < 3) return res.json(null);

        // Tenta encontrar no banco de dados local primeiro (que foi populado via Seed)
        const localAsset = await MarketAsset.findOne({ ticker: { $regex: `^${query}` } }).select('ticker name lastPrice');
        
        if (localAsset) {
            return res.json({
                ticker: localAsset.ticker,
                name: localAsset.name,
                price: localAsset.lastPrice
            });
        }

        // Se não encontrar, retorna null (Front vai deixar digitar manual)
        return res.json(null);
    } catch (error) {
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    try {
        const { ticker, type, quantity, price, currency } = req.body;
        const userId = req.user.id;
        const cleanTicker = ticker.toUpperCase().trim();
        const numQty = Number(quantity);
        const numPrice = Number(price);

        let asset = await UserAsset.findOne({ user: userId, ticker: cleanTicker });

        if (asset) {
            // Se for venda (quantidade negativa), reduz o custo total proporcionalmente
            if (numQty < 0) {
                // Preço Médio Antigo
                const oldAvgPrice = asset.totalCost / asset.quantity;
                
                // Reduz quantidade
                const newQuantity = asset.quantity + numQty;
                
                // Reduz Custo Total proporcionalmente à quantidade vendida (Mantém PM igual na venda)
                // Custo Total Novo = Quantidade Nova * Preço Médio Antigo
                // Venda não altera preço médio, apenas realiza lucro/prejuizo (que é calculado na hora da exibição)
                if (newQuantity <= 0) {
                    // Zerou posição
                    await UserAsset.findByIdAndDelete(asset._id);
                    return res.status(200).json({ message: "Posição zerada." });
                } else {
                    asset.quantity = newQuantity;
                    asset.totalCost = newQuantity * oldAvgPrice;
                }
            } else {
                // Compra: Aumenta quantidade e Custo Total (Preço Médio muda)
                asset.quantity += numQty;
                asset.totalCost += (numQty * numPrice);
            }
            
            asset.updatedAt = Date.now();
            await asset.save();
        } else {
            // Nova posição (apenas compra permitida para iniciar)
            if (numQty < 0) return res.status(400).json({ message: "Não é possível vender ativo que não possui." });

            asset = new UserAsset({
                user: userId,
                ticker: cleanTicker,
                type,
                quantity: numQty,
                totalCost: (numQty * numPrice),
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL')
            });
            await asset.save();
        }

        // Atualiza base global se não existir
        const existingInGlobal = await MarketAsset.findOne({ ticker: cleanTicker });
        if (!existingInGlobal) {
            await MarketAsset.create({
                ticker: cleanTicker,
                name: cleanTicker,
                type: type,
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL'),
                sector: 'Outros',
                lastPrice: numPrice // Salva o preço da transação como referência inicial
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
