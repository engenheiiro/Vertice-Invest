
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
        
        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0 } 
            });
        }

        const tickers = userAssets.map(a => a.ticker);
        const marketAssets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker sector');
        const staticInfoMap = new Map();
        marketAssets.forEach(ma => staticInfoMap.set(ma.ticker, ma.sector));

        const uniqueTickers = [...new Set(userAssets.map(a => marketDataService.normalizeSymbol(a.ticker, a.type)))];
        const priceMap = new Map();

        // Busca dados de mercado em paralelo
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
            
            // Tratamento especial para CASH (Preço fixo ou unitário 1)
            const currentPrice = asset.type === 'CASH' ? 1 : (marketInfo.price || 0);
            const avgPrice = asset.quantity > 0 ? asset.totalCost / asset.quantity : 0;
            
            // Para CASH, o valor total é a quantidade (já que preço é 1)
            // Para outros, é qtd * preço
            const equity = asset.quantity * currentPrice * multiplier;
            const invested = asset.totalCost * multiplier;
            
            totalEquity += equity;
            totalInvested += invested;

            // Variação diária
            const dayChange = equity * (marketInfo.change / 100);
            totalDayVariation += isNaN(dayChange) ? 0 : dayChange;

            const profit = equity - invested;
            const profitPercent = invested > 0 ? (profit / invested) * 100 : 0;

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
                name: marketInfo.name || asset.ticker,
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: avgPrice,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: equity,
                profit: profit,
                profitPercent: profitPercent,
                sector: sector 
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

export const getWalletHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        // Busca snapshots dos últimos 12 meses
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
        const query = req.query.q?.toUpperCase();
        if (!query || query.length < 3) return res.json(null);

        const localAsset = await MarketAsset.findOne({ ticker: { $regex: `^${query}` } }).select('ticker name lastPrice');
        
        if (localAsset) {
            return res.json({
                ticker: localAsset.ticker,
                name: localAsset.name,
                price: localAsset.lastPrice
            });
        }
        return res.json(null);
    } catch (error) {
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    try {
        const { ticker, type, quantity, currency } = req.body;
        // Resiliência: Aceita 'price' OU 'averagePrice'
        const rawPrice = req.body.price !== undefined ? req.body.price : req.body.averagePrice;
        
        const userId = req.user.id;
        
        logger.info(`📝 [ADD_ASSET] Iniciando transação. User: ${userId}, Ticker: ${ticker}, Type: ${type}`);
        logger.debug(`📦 Payload recebido: ${JSON.stringify(req.body)}`);

        if (!ticker) {
            logger.warn("⚠️ Ticker não fornecido.");
            return res.status(400).json({ message: "Ticker obrigatório." });
        }

        const cleanTicker = ticker.toUpperCase().trim();
        
        // --- VALIDAÇÃO DE ENTRADA (Defesa contra NaN) ---
        const numQty = parseFloat(quantity);
        const numPrice = parseFloat(rawPrice);

        logger.debug(`🔢 Valores convertidos: Qty=${numQty}, Price=${numPrice}`);

        if (isNaN(numQty)) {
            logger.error(`❌ Quantidade inválida recebida: ${quantity}`);
            return res.status(400).json({ message: "Quantidade inválida." });
        }
        if (isNaN(numPrice)) {
            logger.error(`❌ Preço inválido recebido: ${rawPrice}`);
            return res.status(400).json({ message: "Preço inválido." });
        }

        let asset = await UserAsset.findOne({ user: userId, ticker: cleanTicker });

        if (asset) {
            logger.info(`🔄 Ativo existente encontrado. Atualizando posição.`);
            if (numQty < 0) {
                // Venda
                const oldAvgPrice = asset.totalCost / asset.quantity;
                const newQuantity = asset.quantity + numQty; // numQty é negativo
                
                if (newQuantity <= 0.000001) { // Margem de erro para float
                    logger.info(`🗑️ Venda total. Removendo ativo.`);
                    await UserAsset.findByIdAndDelete(asset._id);
                    return res.status(200).json({ message: "Posição zerada." });
                } else {
                    asset.quantity = newQuantity;
                    // Ao vender, o custo total diminui proporcionalmente ao preço médio original
                    const newTotalCost = newQuantity * oldAvgPrice;
                    
                    if (isNaN(newTotalCost)) {
                        logger.error(`❌ Erro matemático na venda. NewQty: ${newQuantity}, OldAvg: ${oldAvgPrice}`);
                        return res.status(400).json({ message: "Erro matemático ao processar venda." });
                    }
                    asset.totalCost = newTotalCost;
                }
            } else {
                // Compra
                asset.quantity += numQty;
                const costAddition = (numQty * numPrice);
                
                if (isNaN(costAddition)) {
                    logger.error(`❌ Erro matemático na compra. Qty: ${numQty}, Price: ${numPrice}`);
                    return res.status(400).json({ message: "Erro matemático no custo da transação." });
                }
                
                asset.totalCost += costAddition;
            }
            asset.updatedAt = Date.now();
            await asset.save();
            logger.info(`✅ Ativo atualizado com sucesso.`);
        } else {
            logger.info(`✨ Novo ativo. Criando registro.`);
            if (numQty < 0) return res.status(400).json({ message: "Não é possível vender ativo que não possui." });

            // Validação final de custo inicial
            const initialCost = numQty * numPrice;
            if (isNaN(initialCost)) {
                logger.error(`❌ Erro matemático custo inicial. Qty: ${numQty}, Price: ${numPrice}`);
                return res.status(400).json({ message: "Erro matemático ao criar ativo." });
            }

            asset = new UserAsset({
                user: userId,
                ticker: cleanTicker,
                type,
                quantity: numQty,
                totalCost: initialCost,
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL')
            });
            await asset.save();
            logger.info(`✅ Ativo criado com sucesso. ID: ${asset._id}`);
        }

        // Garante que o ativo exista na tabela global para cotações futuras
        try {
            const existingInGlobal = await MarketAsset.findOne({ ticker: cleanTicker });
            if (!existingInGlobal) {
                logger.info(`🌐 Criando MarketAsset global para: ${cleanTicker}`);
                await MarketAsset.create({
                    ticker: cleanTicker,
                    name: cleanTicker,
                    type: type,
                    currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL'),
                    sector: 'Outros',
                    lastPrice: numPrice
                });
            }
        } catch (globalErr) {
            logger.warn(`⚠️ Erro não-bloqueante ao criar MarketAsset: ${globalErr.message}`);
        }

        res.status(201).json(asset);
    } catch (error) {
        logger.error(`❌ Erro FATAL ao adicionar transação: ${error.message}`);
        logger.error(error.stack);
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
