import yahooFinanceModule from 'yahoo-finance2';
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';

let yahoo;
try {
    const config = { suppressNotices: ['yahooSurvey'] };
    if (yahooFinanceModule.YahooFinance) {
        yahoo = new yahooFinanceModule.YahooFinance(config);
    } else if (typeof yahooFinanceModule === 'function') {
        yahoo = new yahooFinanceModule(config);
    } else {
        yahoo = yahooFinanceModule.default || yahooFinanceModule;
        if (yahoo && typeof yahoo.setGlobalConfig === 'function') {
             yahoo.setGlobalConfig({ ...config, validation: { logErrors: false } });
        }
    }
} catch (e) {
    yahoo = yahooFinanceModule.default;
}

const extractVal = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && val !== null && 'raw' in val) {
        return typeof val.raw === 'number' && !isNaN(val.raw) ? val.raw : null;
    }
    if (typeof val === 'number') return isNaN(val) ? null : val;
    return null;
};

const B3_SECTOR_CORRECTIONS = {
    'MXRF11': 'Papel', 'KNIP11': 'Papel', 'CPTS11': 'Papel', 'IRDM11': 'Papel',
    'HGLG11': 'Logística', 'BTLG11': 'Logística', 'XPLG11': 'Logística',
    'XPML11': 'Shopping', 'VISC11': 'Shopping', 'HGBS11': 'Shopping',
    'KNRI11': 'Híbrido', 'ALZR11': 'Híbrido', 'HGRU11': 'Renda Urbana',
    'ITSA4': 'Holding', 'BBSE3': 'Seguros', 'CXSE3': 'Seguros',
    'TAEE11': 'Energia', 'EGIE3': 'Energia', 'TRPL4': 'Energia'
};

export const marketDataService = {
    normalizeSymbol(ticker, type) {
        if (!ticker) return '';
        let t = ticker.toUpperCase().trim();
        if (type === 'CRYPTO') return t.includes('-') ? t : `${t}-USD`;
        if (type === 'STOCK_US') return t;
        return t.endsWith('.SA') ? t : `${t}.SA`;
    },

    async getMarketData(assetClass) {
        try {
            const filter = assetClass === 'BRASIL_10' 
                ? { type: { $in: ['STOCK', 'FII'] }, isActive: true } 
                : { type: assetClass, isActive: true };

            const assetsInDb = await MarketAsset.find(filter).limit(150);
            const results = [];
            
            for (const asset of assetsInDb) {
                const symbol = this.normalizeSymbol(asset.ticker, asset.type);
                try {
                    const summary = await yahoo.quoteSummary(symbol, { 
                        modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] 
                    }).catch(() => null);

                    if (!summary) continue;

                    const p = summary.price || {};
                    const sd = summary.summaryDetail || {};
                    const ks = summary.defaultKeyStatistics || {};
                    const fd = summary.financialData || {};

                    const currentPrice = extractVal(p.regularMarketPrice) || extractVal(sd.previousClose) || 0;
                    if (currentPrice <= 0) continue;

                    const divRate = extractVal(sd.dividendRate) || extractVal(ks.trailingAnnualDividendRate);
                    let dy = divRate ? (divRate / currentPrice) * 100 : extractVal(sd.dividendYield) * 100 || 0;

                    results.push({
                        ticker: asset.ticker,
                        type: asset.type,
                        name: p.shortName || asset.name,
                        sector: B3_SECTOR_CORRECTIONS[asset.ticker] || asset.sector || 'Geral',
                        price: currentPrice,
                        change: extractVal(p.regularMarketChangePercent) * 100 || 0,
                        metrics: {
                            dy,
                            pl: extractVal(sd.trailingPE) || extractVal(ks.forwardPE),
                            pvp: extractVal(sd.priceToBook) || extractVal(ks.priceToBook),
                            roe: extractVal(fd.returnOnEquity) * 100,
                            netMargin: extractVal(fd.profitMargins) * 100,
                            // Dados para ROIC / LTV
                            totalDebt: extractVal(fd.totalDebt),
                            totalCash: extractVal(fd.totalCash),
                            totalAssets: extractVal(ks.totalAssets),
                            mktCap: extractVal(sd.marketCap),
                            avgLiquidity: extractVal(sd.averageVolume) * currentPrice || 0,
                            eps: extractVal(ks.trailingEps),
                            bvps: extractVal(ks.bookValue)
                        }
                    });
                } catch (err) {
                    logger.error(`Erro ao processar ${symbol}: ${err.message}`);
                }
                await new Promise(r => setTimeout(r, 50));
            }
            return results;
        } catch (error) {
            logger.error(`Erro crítico no MarketDataService: ${error.message}`);
            return [];
        }
    }
};