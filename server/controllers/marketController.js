
import { marketDataService } from '../services/marketDataService.js';
import { logoService } from '../services/logoService.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAsset from '../models/MarketAsset.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';

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

        // Leitura interativa: responde imediatamente com o último valor válido e,
        // se estiver antigo, renova em background (stale-while-revalidate).
        const data = await marketDataService.getMarketDataByTicker(ticker, { interactive: true });
        res.json(data);
    } catch (error) {
        next(error);
    }
};

/**
 * Serve a logo de um ativo a partir do cache no BD (busca-e-cacheia na 1ª vez).
 * Rota PÚBLICA: <img> não envia header Authorization. Quando não há logo, responde
 * 404 — o componente <AssetLogo> trata via onError e cai nas iniciais.
 */
export const getAssetLogo = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const { type } = req.query;
        // Aceita somente símbolos usados pelas fontes de logo (ex.: PETR4,
        // BTC-USD, BRK.B). Impede caminho/URL arbitrário antes da busca externa.
        const cleanTicker = String(ticker || '').trim().toUpperCase();
        if (!/^[A-Z0-9.-]{1,20}$/.test(cleanTicker)) return res.status(400).end();

        const allowedTypes = new Set(['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH']);
        const safeType = allowedTypes.has(String(type || '').toUpperCase())
            ? String(type).toUpperCase()
            : 'STOCK';

        const logo = await logoService.getOrFetch(cleanTicker, safeType);
        if (!logo) return res.status(404).end();

        const etag = `"${cleanTicker}-${safeType}-${logo.bytes}"`;
        // Logo é praticamente imutável → cache agressivo no navegador/CDN.
        res.set('Cache-Control', 'public, max-age=604800, immutable');
        res.set('ETag', etag);

        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        res.set('Content-Type', logo.contentType);
        return res.send(logo.data);
    } catch (error) {
        next(error);
    }
};

export const getAssetStatus = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const cleanTicker = ticker.toUpperCase().trim();
        
        const marketAsset = await MarketAsset.findOne({ ticker: cleanTicker });
        const history = await AssetHistory.findOne({
            ticker: historyStorageKey(cleanTicker, marketAsset?.type || 'INDEX')
        });
        
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

// Variação % entre o preço da publicação e o de agora, com sinal ("+3.2%"/"-1.4%").
// Nulo quando falta um dos dois preços: melhor nada do que um número inventado.
export const formatMeasuredReturn = (entryPrice, currentPrice) => {
    const entry = Number(entryPrice);
    const now = Number(currentPrice);
    if (!(entry > 0) || !(now > 0)) return null;
    const pct = ((now / entry) - 1) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
};

export const getLandingData = async (req, res, next) => {
    try {
        // 1. Dados Macro (CDI, SPX, IBOV)
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        
        // 2. Tickers Ativos (Rolagem)
        const topAssets = await MarketAsset.find({ 
            type: { $in: ['STOCK', 'FII', 'CRYPTO', 'STOCK_US'] },
            lastPrice: { $gt: 0 }
        })
        .sort({ marketCap: -1 })
        .limit(15)
        .select('ticker lastPrice change type currency');

        // 3. Melhores Performers
        let bestPerformers = [];
        
        const latestReport = await MarketAnalysis.findOne({ isRankingPublished: true })
            .sort({ createdAt: -1 })
            .limit(1);

        // Retorno MEDIDO: preço gravado no ranking publicado × cotação atual. Antes
        // era Math.random() (e, sem ranking, um "fallback" com tese inventada) —
        // número fabricado numa API pública de plataforma de investimento. Sem os
        // dois preços o campo sai nulo; sem ranking publicado, a lista sai vazia.
        if (latestReport && latestReport.content.ranking.length > 0) {
            const picks = latestReport.content.ranking
                .filter(r => r.action === 'BUY' && r.score >= 80)
                .slice(0, 3);
            const livePrices = new Map(
                (await MarketAsset.find({ ticker: { $in: picks.map(r => r.ticker) } })
                    .select('ticker lastPrice')
                    .lean())
                    .map(a => [a.ticker, a.lastPrice])
            );
            bestPerformers = picks.map(r => ({
                ticker: r.ticker,
                type: 'LONG',
                returnVal: formatMeasuredReturn(r.currentPrice, livePrices.get(r.ticker)),
                date: new Date(latestReport.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
                desc: r.thesis || "Alta convicção baseada em fundamentos e fluxo."
            }));
        }

        res.json({
            macro: {
                // Aqui usamos o cdiReturn12m para a performance histórica, se disponível
                cdi: config?.cdiReturn12m || config?.cdi || DEFAULT_SELIC_FALLBACK,
                spx: config?.spxReturn12m || 25.0, 
                ibov: config?.ibovReturn12m || 15.50, 
                spxChange: config?.spxChange || 0
            },
            tickers: topAssets.map(a => ({
                ticker: a.ticker,
                price: a.lastPrice,
                // `change` é a variação percentual retornada pelo provedor de cotações
                // e persistida em MarketAsset durante o sync de mercado.
                change: Number.isFinite(a.change) ? a.change : 0,
            })),
            results: bestPerformers
        });

    } catch (error) {
        next(error);
    }
};
