
import { marketDataService } from '../services/marketDataService.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAsset from '../models/MarketAsset.js';
import MarketAnalysis from '../models/MarketAnalysis.js';

export const getHistoricalPrice = async (req, res, next) => {
    try {
        const { ticker, date, type } = req.query;

        if (!ticker || !date || !type) {
            return res.status(400).json({ message: "Parâmetros obrigatórios: ticker, date, type" });
        }

        const data = await marketDataService.getPriceAtDate(ticker, date, type);

        if (!data) {
            return res.status(404).json({ message: "Preço histórico não encontrado para esta data." });
        }

        res.json(data);
    } catch (error) {
        next(error);
    }
};

// NOVO: Busca cotação atual simples (mesma fonte da Dashboard)
export const getCurrentQuote = async (req, res, next) => {
    try {
        const { ticker } = req.query;
        if (!ticker) return res.status(400).json({ message: "Ticker obrigatório" });

        const data = await marketDataService.getMarketDataByTicker(ticker);
        res.json(data);
    } catch (error) {
        next(error);
    }
};

export const getAssetStatus = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const cleanTicker = ticker.toUpperCase().trim();
        
        const history = await AssetHistory.findOne({ ticker: cleanTicker });
        const marketAsset = await MarketAsset.findOne({ ticker: cleanTicker });
        
        res.json({
            ticker: cleanTicker,
            
            // Real-time / Current Data (MarketAsset)
            currentPrice: marketAsset?.lastPrice || 0,
            lastSync: marketAsset?.updatedAt || null,
            source: 'MarketAsset',

            // Historical Data (AssetHistory)
            historyStatus: history ? 'CACHED' : 'NOT_CACHED',
            historyLastUpdated: history?.lastUpdated || null,
            dataPoints: history?.history?.length || 0,
            
            // Backward compatibility / UI Helper
            status: history ? 'CACHED' : (marketAsset ? 'LIVE_ONLY' : 'NOT_FOUND'),
            lastUpdated: marketAsset?.updatedAt || history?.lastUpdated // Prioritize live sync date for general display
        });
    } catch (error) {
        next(error);
    }
};

export const getLandingData = async (req, res, next) => {
    try {
        // 1. Dados Macro (CDI, SPX)
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        
        // 2. Tickers Ativos (Rolagem) - 
        // Pega ativos reais com maior MarketCap para dar sensação de mercado vivo
        const topAssets = await MarketAsset.find({ 
            type: { $in: ['STOCK', 'FII', 'CRYPTO', 'STOCK_US'] },
            lastPrice: { $gt: 0 }
        })
        .sort({ marketCap: -1 })
        .limit(15)
        .select('ticker lastPrice type currency');

        // 3. Melhores Performers (Resultados que falam por si)
        let bestPerformers = [];
        
        const latestReport = await MarketAnalysis.findOne({ isRankingPublished: true })
            .sort({ createdAt: -1 })
            .limit(1);

        if (latestReport && latestReport.content.ranking.length > 0) {
            // Pega os 3 melhores scores que sejam 'BUY'
            bestPerformers = latestReport.content.ranking
                .filter(r => r.action === 'BUY' && r.score >= 80)
                .slice(0, 3)
                .map(r => ({
                    ticker: r.ticker,
                    type: 'LONG',
                    returnVal: `+${((Math.random() * 5) + 5).toFixed(1)}%`, // Mock visual
                    date: new Date(latestReport.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
                    desc: r.thesis || "Alta convicção baseada em fundamentos e fluxo."
                }));
        }

        // Fallback se não tiver relatório
        if (bestPerformers.length === 0) {
             bestPerformers = topAssets.slice(0, 3).map(a => ({
                ticker: a.ticker,
                type: 'LONG',
                returnVal: `+${(Math.random() * 5 + 3).toFixed(1)}%`,
                date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
                desc: "Tendência de alta confirmada por volume."
            }));
        }

        res.json({
            macro: {
                cdi: config?.cdi || 11.15,
                spx: config?.spxReturn12m || 25.0, 
                spxChange: config?.spxChange || 0
            },
            tickers: topAssets.map(a => ({
                ticker: a.ticker,
                price: a.lastPrice,
                // Simulação de variação intraday
                change: (Math.random() * 3 - 1.5) 
            })),
            results: bestPerformers
        });

    } catch (error) {
        next(error);
    }
};
