import YahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';

const yahoo = new YahooFinance({
    suppressNotices: ['yahooSurvey']
});

// Helper para extrair número seguro
const validateNumber = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const num = Number(typeof val === 'object' ? val.raw : val);
    return isNaN(num) ? 0 : num;
};

// Estratégia de Preço Inteligente (Smart Price v2)
const getSmartPrice = (quote) => {
    if (!quote) return 0;
    
    const regPrice = validateNumber(quote.regularMarketPrice);
    const prevClose = validateNumber(quote.regularMarketPreviousClose);
    const bid = validateNumber(quote.bid);
    const ask = validateNumber(quote.ask);

    // 1. Tenta preço regular
    if (regPrice > 0) return regPrice;

    // 2. Se regular for 0, tenta previousClose (comum em FIIs fora de hora)
    if (prevClose > 0) return prevClose;

    // 3. Tenta média de Bid/Ask
    if (bid > 0 && ask > 0) return (bid + ask) / 2;

    // 4. Fallback genérico
    if (validateNumber(quote.currentPrice) > 0) return validateNumber(quote.currentPrice);

    return 0;
};

// Divide array em pedaços para processamento em lote
const chunkArray = (array, size) => {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

export const marketDataService = {
    normalizeSymbol(ticker, type) {
        if (!ticker) return '';
        let t = ticker.toUpperCase().trim();
        
        // Correções manuais conhecidas
        if (t === 'GALG11') t = 'GARE11';

        // Cripto: Adiciona -USD se não tiver
        if (type === 'CRYPTO') {
            return t.includes('-') ? t : `${t}-USD`;
        }
        
        // Stocks US: Não usa sufixo, mas remove ^ se houver (índices)
        if (type === 'STOCK_US') {
            return t; 
        }

        // Ativos BR (Ações e FIIs): OBRIGATÓRIO ter .SA
        if (['STOCK', 'FII', 'BRASIL_10'].includes(type)) {
            if (!t.endsWith('.SA')) return `${t}.SA`;
        }
        
        return t;
    },

    async getMarketDataByTicker(symbol) {
        try {
            if (symbol.includes('RESERVA') || symbol.includes('SELIC') || symbol.includes('CASH')) {
                return { price: 1.0, change: 0, name: symbol };
            }
            const quote = await yahoo.quote(symbol);
            return {
                price: getSmartPrice(quote),
                change: validateNumber(quote.regularMarketChangePercent),
                name: quote.shortName || symbol
            };
        } catch (error) {
            return { price: 0, change: 0, name: symbol };
        }
    },

    async getMarketData(assetClass) {
        try {
            const filter = assetClass === 'BRASIL_10' 
                ? { type: { $in: ['STOCK', 'FII'] }, isActive: true } 
                : { type: assetClass, isActive: true };

            const assetsInDb = await MarketAsset.find(filter).limit(300);
            
            if (assetsInDb.length === 0) {
                logger.warn(`Nenhum ativo configurado para: ${assetClass}`);
                return [];
            }

            const results = [];
            
            // Processa em lotes de 5 para performance e estabilidade
            const batches = chunkArray(assetsInDb, 5); 

            for (const batch of batches) {
                const batchPromises = batch.map(async (asset) => {
                    const symbol = this.normalizeSymbol(asset.ticker, asset.type);
                    
                    // Pula ativos sintéticos
                    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') return null;

                    try {
                        // Tenta buscar cotação
                        const [quote, history] = await Promise.all([
                            yahoo.quote(symbol).catch(e => null),
                            yahoo.chart(symbol, { period1: '12mo', interval: '1mo' }).catch(e => null)
                        ]);

                        if (!quote) {
                            logger.warn(`⚠️ Yahoo não encontrou: ${symbol}`);
                            return null; 
                        }

                        const currentPrice = getSmartPrice(quote);

                        // Se preço for zero, tenta salvar com dados mínimos ou ignora
                        if (currentPrice === 0) {
                            logger.warn(`⚠️ Preço zerado para: ${symbol}`);
                        }

                        let data = {
                            ticker: asset.ticker, // Mantém ticker original (sem .SA) para o front
                            type: asset.type,
                            name: quote.shortName || quote.longName || asset.name,
                            sector: 'Outros',
                            price: currentPrice,
                            change: validateNumber(quote.regularMarketChangePercent),
                            history: history?.quotes || [],
                            metrics: {
                                dy: (validateNumber(quote.trailingAnnualDividendYield) * 100),
                                mktCap: validateNumber(quote.marketCap),
                                pl: 0, pvp: 0, roe: 0, roa: 0, eps: 0, bvps: 0,
                                revenueGrowth: 0, netMargin: 0,
                                debtToEquity: 0, currentRatio: 0,
                                grahamPrice: 0, bazinPrice: 0, altmanZScore: 0
                            }
                        };

                        // Busca dados financeiros estendidos para Ações e FIIs
                        if (['STOCK', 'STOCK_US', 'FII'].includes(asset.type)) {
                            try {
                                const summary = await yahoo.quoteSummary(symbol, { 
                                    modules: ['summaryProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] 
                                });

                                if (summary) {
                                    const p = summary.summaryProfile || {};
                                    const d = summary.summaryDetail || {};
                                    const s = summary.defaultKeyStatistics || {};
                                    const f = summary.financialData || {};

                                    data.sector = p.sector || p.industry || 'Outros';

                                    // Lógica robusta de DY (Dividend Yield)
                                    let dy = (validateNumber(d.dividendYield) * 100);
                                    if (dy === 0) dy = (validateNumber(d.trailingAnnualDividendYield) * 100);
                                    if (dy === 0 && d.trailingAnnualDividendRate > 0 && currentPrice > 0) {
                                        dy = (d.trailingAnnualDividendRate / currentPrice) * 100;
                                    }
                                    if (dy === 0) dy = data.metrics.dy; // Fallback do quote inicial

                                    // PL e PVP
                                    let pl = validateNumber(d.trailingPE || d.forwardPE);
                                    // Fallback manual para PL se necessário
                                    if (pl === 0 && validateNumber(s.trailingEps) > 0 && currentPrice > 0) {
                                        pl = currentPrice / s.trailingEps;
                                    }

                                    let pvp = validateNumber(d.priceToBook);
                                    // Fallback manual para PVP
                                    if (pvp === 0 && validateNumber(s.bookValue) > 0 && currentPrice > 0) {
                                        pvp = currentPrice / s.bookValue;
                                    }

                                    data.metrics = {
                                        ...data.metrics,
                                        pl: pl,
                                        pvp: pvp,
                                        dy: dy,
                                        roe: validateNumber(f.returnOnEquity) * 100,
                                        roa: validateNumber(f.returnOnAssets) * 100,
                                        eps: validateNumber(s.trailingEps),
                                        bvps: validateNumber(s.bookValue),
                                        debtToEquity: validateNumber(f.debtToEquity),
                                        currentRatio: validateNumber(f.currentRatio),
                                        revenueGrowth: validateNumber(f.revenueGrowth) * 100,
                                        netMargin: validateNumber(f.profitMargins) * 100
                                    };
                                }
                            } catch (e) {
                                // Falha silenciosa no summary, mantém dados básicos
                            }
                        }
                        return data;
                    } catch (err) {
                        logger.error(`[API Error] ${symbol}: ${err.message}`);
                        return null;
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults.filter(Boolean));

                // Delay suave para não tomar rate limit
                await new Promise(r => setTimeout(r, 1200));
            }
            
            return results;
        } catch (error) {
            logger.error(`Service Error: ${error.message}`);
            return [];
        }
    }
};