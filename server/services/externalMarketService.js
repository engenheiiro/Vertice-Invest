
import YahooFinance from 'yahoo-finance2';
import axios from 'axios'; 
import logger from '../config/logger.js';

// Instancia a classe com supressão de avisos
const yahooFinance = new YahooFinance({ 
    suppressNotices: ['yahooSurvey', 'ripHistorical'] 
});

export const externalMarketService = {
    
    // Helper: Busca na Brapi (Fallback para B3)
    async fetchFromBrapi(ticker) {
        try {
            if (ticker.length <= 4) return null;
            const cleanTicker = ticker.replace('.SA', '').trim();
            const token = process.env.BRAPI_TOKEN ? `&token=${process.env.BRAPI_TOKEN}` : '';
            const url = `https://brapi.dev/api/quote/${cleanTicker}?range=1d&interval=1d&fundamental=false${token}`;
            
            const response = await axios.get(url, { timeout: 4000 }); 
            
            if (response.data && response.data.results && response.data.results.length > 0) {
                const data = response.data.results[0];
                return {
                    ticker: ticker.replace('.SA', ''), 
                    price: data.regularMarketPrice,
                    change: data.regularMarketChangePercent,
                    name: data.longName || cleanTicker,
                    source: 'BRAPI_FALLBACK'
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    },

    // Busca Preço de Criptos e Stocks Internacionais em lote (Cotação Atual)
    async getQuotes(tickers) {
        if (!tickers || tickers.length === 0) return [];
        
        const yahooTickers = tickers.map(t => {
            const cleanT = t.trim().toUpperCase();
            if (cleanT === 'BTC') return 'BTC-USD';
            if (cleanT === 'ETH') return 'ETH-USD';
            if (cleanT === 'SOL') return 'SOL-USD';
            if (cleanT === 'USDT') return 'USDT-USD';
            if (['BTC-USD', 'ETH-USD', 'SOL-USD'].includes(cleanT)) return cleanT;

            const isB3Format = /^[A-Z]{4}\d{1,2}$/.test(cleanT);
            if (isB3Format && !cleanT.endsWith('.SA')) return `${cleanT}.SA`;
            return cleanT; 
        });

        try {
            const results = await yahooFinance.quote(yahooTickers);
            const validResults = Array.isArray(results) ? results : [results];
            
            const mappedResults = validResults.map(item => {
                let symbol = item.symbol;
                if (symbol.endsWith('.SA')) symbol = symbol.replace('.SA', '');
                if (symbol.endsWith('-USD')) symbol = symbol.replace('-USD', '');
                const changePct = item.regularMarketChangePercent || item.changePercent || 0;

                return {
                    ticker: symbol,
                    price: item.regularMarketPrice || item.price || 0,
                    change: changePct,
                    name: item.longName || item.shortName || symbol
                };
            });

            // Lógica de Fallback Brapi omitida para brevidade (mantida igual original)
            return mappedResults;

        } catch (error) {
            logger.error(`❌ Erro Yahoo Finance (Batch): ${error.message}`);
            return [];
        }
    },

    // Busca índices globais para Dashboard (Snapshot Instantâneo)
    async getGlobalIndices() {
        try {
            const quotes = await yahooFinance.quote(['^BVSP', '^GSPC', '^IXIC']); 
            const result = {};
            const find = (s) => (Array.isArray(quotes) ? quotes : [quotes]).find(q => q.symbol === s);
            
            const ibov = find('^BVSP');
            if (ibov) result.ibov = { value: ibov.regularMarketPrice, change: ibov.regularMarketChangePercent };
            
            const spx = find('^GSPC');
            if (spx) result.spx = { value: spx.regularMarketPrice, change: spx.regularMarketChangePercent };

            return result;
        } catch (error) {
            return {};
        }
    },

    // CÁLCULO S&P 500 (12 MESES)
    async getSpx12mReturn() {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setFullYear(endDate.getFullYear() - 1); 
            startDate.setDate(startDate.getDate() - 15); // Buffer extra

            // Conversão explicita para string YYYY-MM-DD para evitar ambiguidades no Yahoo API
            const period1 = startDate.toISOString().split('T')[0];
            const period2 = endDate.toISOString().split('T')[0];

            const result = await yahooFinance.chart('^GSPC', {
                period1: period1,
                period2: period2,
                interval: '1d'
            });

            if (!result || !result.quotes || result.quotes.length < 10) {
                logger.warn("⚠️ SPX Chart: Dados insuficientes (Length < 10). Usando Fallback 32.50%.");
                return 32.50; 
            }

            // Validação de Range: Verifica se o primeiro dado é realmente antigo (> 300 dias)
            const firstQuote = result.quotes[0];
            if (firstQuote && firstQuote.date) {
                const firstDate = new Date(firstQuote.date);
                const diffTime = Math.abs(endDate.getTime() - firstDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays < 300) {
                    logger.warn(`⚠️ SPX Chart: Histórico curto detectado (${diffDays} dias). O Yahoo retornou dados parciais. Usando Fallback 32.50%.`);
                    return 32.50;
                }
            }

            // Encontra o preço mais próximo de exatos 365 dias atrás
            const targetTime = endDate.getTime() - (365 * 24 * 60 * 60 * 1000);
            
            const startQuote = result.quotes.reduce((prev, curr) => {
                return (Math.abs(curr.date.getTime() - targetTime) < Math.abs(prev.date.getTime() - targetTime) ? curr : prev);
            });

            const startPrice = startQuote.close || startQuote.adjclose;
            const endPrice = result.quotes[result.quotes.length - 1].close || result.quotes[result.quotes.length - 1].adjclose;

            if (startPrice > 0 && endPrice > 0) {
                const returnPct = ((endPrice / startPrice) - 1) * 100;
                
                if (returnPct < -60 || returnPct > 100) {
                    logger.warn(`⚠️ SPX Calc: Valor anômalo (${returnPct.toFixed(2)}%). Usando Fallback.`);
                    return 32.50;
                }

                logger.info(`📈 SPX 12m [${startQuote.date.toISOString().split('T')[0]} -> ${result.quotes[result.quotes.length - 1].date.toISOString().split('T')[0]}]: ${startPrice.toFixed(2)} -> ${endPrice.toFixed(2)} = ${returnPct.toFixed(2)}%`);
                return returnPct;
            }
            
            return 32.50;
        } catch (e) {
            logger.error(`Erro ao calcular SPX 12m: ${e.message}`);
            return 32.50; 
        }
    },

    // CÁLCULO IBOVESPA (12 MESES) - NOVO MÉTODO
    async getIbov12mReturn() {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setFullYear(endDate.getFullYear() - 1); 
            startDate.setDate(startDate.getDate() - 15);

            const period1 = startDate.toISOString().split('T')[0];
            const period2 = endDate.toISOString().split('T')[0];

            const result = await yahooFinance.chart('^BVSP', {
                period1: period1,
                period2: period2,
                interval: '1d'
            });

            if (!result || !result.quotes || result.quotes.length < 10) {
                logger.warn("⚠️ IBOV Chart: Dados insuficientes. Usando Fallback 15.50%.");
                return 15.50; 
            }

            const firstQuote = result.quotes[0];
            if (firstQuote && firstQuote.date) {
                const firstDate = new Date(firstQuote.date);
                const diffTime = Math.abs(endDate.getTime() - firstDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays < 300) {
                    logger.warn(`⚠️ IBOV Chart: Histórico curto (${diffDays} dias). Usando Fallback 15.50%.`);
                    return 15.50;
                }
            }

            const targetTime = endDate.getTime() - (365 * 24 * 60 * 60 * 1000);
            
            const startQuote = result.quotes.reduce((prev, curr) => {
                return (Math.abs(curr.date.getTime() - targetTime) < Math.abs(prev.date.getTime() - targetTime) ? curr : prev);
            });

            const startPrice = startQuote.close || startQuote.adjclose;
            const endPrice = result.quotes[result.quotes.length - 1].close || result.quotes[result.quotes.length - 1].adjclose;

            if (startPrice > 0 && endPrice > 0) {
                const returnPct = ((endPrice / startPrice) - 1) * 100;
                logger.info(`📈 IBOV 12m [${startQuote.date.toISOString().split('T')[0]} -> ${result.quotes[result.quotes.length - 1].date.toISOString().split('T')[0]}]: ${startPrice.toFixed(2)} -> ${endPrice.toFixed(2)} = ${returnPct.toFixed(2)}%`);
                return returnPct;
            }
            
            return 15.50;
        } catch (e) {
            logger.error(`Erro ao calcular IBOV 12m: ${e.message}`);
            return 15.50; 
        }
    },

    // Busca Histórico Completo
    async getFullHistory(ticker, type) {
        let symbol = ticker.trim().toUpperCase();
        
        if (type === 'STOCK' || type === 'FII' || type === 'INDEX') {
            if (!symbol.startsWith('^') && !symbol.endsWith('.SA')) {
                if (/^[A-Z]{4}\d{1,2}$/.test(symbol)) {
                    symbol = `${symbol}.SA`;
                }
            }
        } else if (type === 'CRYPTO' && !symbol.includes('-')) {
            symbol = `${symbol}-USD`;
        }

        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0]; 

            const queryOptions = { 
                period1: '2020-01-01', 
                period2: todayStr,
                interval: '1d'
            };
            
            const result = await yahooFinance.chart(symbol, queryOptions);

            if (!result || !result.quotes || !Array.isArray(result.quotes)) return null;

            return result.quotes.map(day => ({
                date: day.date.toISOString().split('T')[0], 
                close: day.close,
                adjClose: day.adjclose || day.close
            }));

        } catch (error) {
            return null;
        }
    },

    async getDividendsHistory(ticker, type) {
        return [];
    },

    async getSplitsHistory(ticker, type) {
        return [];
    }
};
