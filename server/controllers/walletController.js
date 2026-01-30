
import UserAsset from '../models/UserAsset.js';
import MarketAsset from '../models/MarketAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';

const USD_RATE_MOCK = 5.75;

export const getWalletData = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userAssets = await UserAsset.find({ user: userId });
        
        const activeAssets = userAssets.filter(a => a.quantity > 0.000001);
        const closedAssets = userAssets.filter(a => a.quantity <= 0.000001);

        if (userAssets.length === 0) {
            return res.json({ 
                assets: [], 
                kpis: { totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0 } 
            });
        }

        const tickers = activeAssets.map(a => a.ticker);
        const marketAssets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker sector');
        const staticInfoMap = new Map();
        marketAssets.forEach(ma => staticInfoMap.set(ma.ticker, ma.sector));

        // Filtra tickers que precisam de cotação externa (exclui Renda Fixa e Caixa)
        const activeMarketAssets = activeAssets.filter(a => a.type !== 'FIXED_INCOME' && a.type !== 'CASH');
        const uniqueTickers = [...new Set(activeMarketAssets.map(a => marketDataService.normalizeSymbol(a.ticker, a.type)))];
        
        const priceMap = new Map();
        await Promise.all(uniqueTickers.map(async (symbol) => {
            const data = await marketDataService.getMarketDataByTicker(symbol);
            priceMap.set(symbol, data);
        }));

        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        let totalRealizedProfit = closedAssets.reduce((acc, curr) => acc + (curr.realizedProfit || 0), 0);

        const processedAssets = activeAssets.map(asset => {
            let currentPrice = 0;
            let dayChange = 0;
            const multiplier = asset.currency === 'USD' ? USD_RATE_MOCK : 1;

            // LÓGICA DE PRECIFICAÇÃO
            if (asset.type === 'CASH') {
                currentPrice = 1;
                dayChange = 0;
            } 
            else if (asset.type === 'FIXED_INCOME') {
                // Cálculo de Rentabilidade Automática (Juros Compostos Pro-Rata)
                const investedAmount = asset.totalCost; // Valor aplicado
                // Se a taxa não foi informada, usa 10% como fallback razoável
                const rate = asset.fixedIncomeRate || 10.0; 
                const startDate = new Date(asset.startDate || asset.createdAt || new Date());
                const now = new Date();
                
                // Diferença em dias corridos
                const diffTime = Math.max(0, now.getTime() - startDate.getTime());
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
                
                // Montante = Capital * (1 + taxa)^(dias/365)
                const factor = Math.pow(1 + (rate / 100), diffDays / 365);
                const currentTotalValue = investedAmount * factor;
                
                // Em Renda Fixa, se quantidade é 1 (padrão), preço = valor total. Se não, divide.
                currentPrice = asset.quantity > 0 ? currentTotalValue / asset.quantity : 0;
                
                // Variação do Dia: Aproximação (Taxa Diária * Valor Ontem)
                // Taxa Diária = (1 + TaxaAnual)^(1/365) - 1
                const dailyRate = Math.pow(1 + (rate/100), 1/365) - 1;
                dayChange = currentTotalValue * dailyRate; 
            } 
            else {
                // Ativos de Mercado (Ações, FIIs, Crypto)
                const symbol = marketDataService.normalizeSymbol(asset.ticker, asset.type);
                const marketInfo = priceMap.get(symbol) || { price: 0, change: 0, name: asset.ticker };
                currentPrice = marketInfo.price || 0;
                
                // Se preço vier 0 da API, usa o preço médio para não zerar a carteira visualmente
                if (currentPrice === 0 && asset.averagePrice > 0) currentPrice = asset.averagePrice;

                const equity = asset.quantity * currentPrice * multiplier;
                dayChange = equity * (marketInfo.change / 100);
            }
            
            // Cálculo de Posição
            const equity = asset.quantity * currentPrice * multiplier;
            const invested = asset.totalCost * multiplier;
            
            totalEquity += equity;
            totalInvested += invested;
            totalDayVariation += isNaN(dayChange) ? 0 : dayChange;

            const unrealizedProfit = equity - invested;
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
                name: asset.type === 'FIXED_INCOME' ? asset.ticker : (priceMap.get(asset.ticker)?.name || asset.ticker),
                type: asset.type,
                quantity: asset.quantity,
                averagePrice: asset.quantity > 0 ? asset.totalCost / asset.quantity : 0,
                currentPrice: currentPrice,
                currency: asset.currency,
                totalValue: equity,
                profit: positionTotalResult,
                profitPercent: profitPercent,
                sector: sector,
                // Passa a taxa para o front saber se está rendendo
                fixedIncomeRate: asset.fixedIncomeRate 
            };
        });

        const currentUnrealized = totalEquity - totalInvested;
        const totalResult = currentUnrealized + totalRealizedProfit;
        
        res.json({
            assets: processedAssets,
            kpis: {
                totalEquity,
                totalInvested,
                totalResult, 
                totalResultPercent: totalInvested > 0 ? (totalResult / totalInvested) * 100 : 0,
                dayVariation: totalDayVariation,
                dayVariationPercent: totalEquity > 0 ? (totalDayVariation / totalEquity) * 100 : 0,
                totalDividends: 0 // Placeholder por enquanto
            }
        });

    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]); 

        const regex = new RegExp(query, 'i');
        const tickerRegex = new RegExp(`^${query}`, 'i');
        let results = [];

        // 1. Busca em MarketAssets (Ações, FIIs, Crypto)
        const marketAssets = await MarketAsset.find({ 
            $or: [
                { ticker: tickerRegex },
                { name: regex }
            ]
        })
        .select('ticker name lastPrice type')
        .limit(5);
        
        results = marketAssets.map(a => ({
            ticker: a.ticker,
            name: a.name,
            price: a.lastPrice,
            type: a.type
        }));

        // 2. Busca em TreasuryBonds (Tesouro Direto)
        if (/tesouro|ipca|selic|prefixado|renda|bonds/i.test(query)) {
            const bonds = await TreasuryBond.find({
                title: regex
            }).limit(5);

            const bondResults = bonds.map(b => ({
                ticker: b.title,
                name: "Tesouro Direto",
                price: b.minInvestment, 
                type: 'FIXED_INCOME',
                rate: b.rate 
            }));
            results = [...results, ...bondResults];
        }

        // 3. Injeção de Produtos Populares (CDBs, Cofrinhos)
        const popularFixed = [
            { ticker: "CDB BANCO INTER", name: "CDB Liquidez Diária", type: 'FIXED_INCOME', rate: 11.15 },
            { ticker: "COFRINHO NUBANK", name: "RDB Resgate Imediato", type: 'FIXED_INCOME', rate: 11.15 },
            { ticker: "CAIXINHA NUBANK", name: "Renda Fixa Nubank", type: 'FIXED_INCOME', rate: 11.15 },
            { ticker: "CDB XP", name: "CDB XP Investimentos", type: 'FIXED_INCOME', rate: 11.50 },
            { ticker: "LCI ITAÚ", name: "Isento de IR", type: 'FIXED_INCOME', rate: 9.80 },
            { ticker: "LCA BB", name: "Banco do Brasil Agro", type: 'FIXED_INCOME', rate: 9.50 },
            { ticker: "CDB C6 BANK", name: "CDB C6", type: 'FIXED_INCOME', rate: 11.20 },
            { ticker: "TESOURO SELIC 2029", name: "Tesouro Direto", type: 'FIXED_INCOME', rate: 11.40 },
            { ticker: "TESOURO IPCA+ 2035", name: "Tesouro Direto", type: 'FIXED_INCOME', rate: 6.20 },
            { ticker: "CDB BTG PACTUAL", name: "CDB BTG", type: 'FIXED_INCOME', rate: 11.25 }
        ];

        const matchedFixed = popularFixed.filter(p => 
            p.ticker.match(regex) || p.name.match(regex)
        );

        results = [...results, ...matchedFixed];

        return res.json(results.slice(0, 12));
    } catch (error) {
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    try {
        const { ticker, type, quantity, currency, date, fixedIncomeRate } = req.body;
        const rawPrice = req.body.price !== undefined ? req.body.price : req.body.averagePrice;
        const userId = req.user.id;
        
        logger.info(`📝 [Transação] Iniciando. User: ${userId}, Ticker: ${ticker}, Qty: ${quantity}`);

        if (!ticker) return res.status(400).json({ message: "Ticker obrigatório." });

        const cleanTicker = ticker.toUpperCase().trim();
        const numQty = parseFloat(quantity);
        const numPrice = parseFloat(rawPrice);

        if (isNaN(numQty) || isNaN(numPrice)) {
            return res.status(400).json({ message: "Valores inválidos." });
        }

        let asset = await UserAsset.findOne({ user: userId, ticker: cleanTicker });

        const transactionDate = date ? new Date(date) : new Date();

        if (asset) {
            if (numQty < 0) {
                // Venda
                const sellQty = Math.abs(numQty);
                if (sellQty > asset.quantity + 0.000001) {
                    return res.status(400).json({ message: "Quantidade insuficiente para venda." });
                }

                const currentAvgPrice = asset.quantity > 0 ? asset.totalCost / asset.quantity : 0;
                const costOfSoldShares = sellQty * currentAvgPrice;
                const saleValue = sellQty * numPrice;
                const profit = saleValue - costOfSoldShares;

                asset.quantity -= sellQty;
                asset.totalCost -= costOfSoldShares;
                asset.realizedProfit = (asset.realizedProfit || 0) + profit;

                if (asset.quantity <= 0.000001) {
                    asset.quantity = 0;
                    asset.totalCost = 0; 
                }
            } else {
                // Compra / Aporte
                asset.quantity += numQty;
                asset.totalCost += (numQty * numPrice);
                
                // Se for Renda Fixa, atualiza a taxa
                if (type === 'FIXED_INCOME' && fixedIncomeRate) {
                    asset.fixedIncomeRate = fixedIncomeRate; 
                }
            }
            asset.updatedAt = Date.now();
            await asset.save();
        } else {
            if (numQty < 0) return res.status(400).json({ message: "Não é possível vender ativo inexistente." });

            asset = new UserAsset({
                user: userId,
                ticker: cleanTicker,
                type,
                quantity: numQty,
                totalCost: numQty * numPrice,
                currency: currency || (type === 'STOCK_US' ? 'USD' : 'BRL'),
                realizedProfit: 0,
                // Dados Específicos RF
                startDate: transactionDate,
                fixedIncomeRate: fixedIncomeRate || 0
            });
            await asset.save();
        }

        // Se não for RF nem Caixa, cria MarketAsset se não existir
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
            } catch (globalErr) {
                logger.warn(`⚠️ [MarketAsset] Erro não-bloqueante ao criar: ${globalErr.message}`);
            }
        }

        res.status(201).json(asset);
    } catch (error) {
        logger.error(`🔥 [Transação] ERRO: ${error.message}`);
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

export const resetWallet = async (req, res, next) => {
    try {
        await UserAsset.deleteMany({ user: req.user.id });
        await WalletSnapshot.deleteMany({ user: req.user.id });
        logger.info(`🗑️ Carteira resetada para usuário ${req.user.id}`);
        res.json({ message: "Carteira resetada com sucesso." });
    } catch (error) {
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
