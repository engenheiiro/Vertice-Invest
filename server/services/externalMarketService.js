
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
            // Se o ticker tiver 3 caracteres ou menos, provavelmente é lixo ou não suportado pela Brapi Free
            if (ticker.length <= 4) return null;

            // Remove o .SA para a Brapi
            const cleanTicker = ticker.replace('.SA', '').trim();
            
            // Usa token se disponível (Recomendado para evitar 401/429)
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
            // Silencioso em caso de falha no fallback
            return null;
        }
    },

    // Busca Preço de Criptos e Stocks Internacionais em lote (Cotação Atual)
    async getQuotes(tickers) {
        if (!tickers || tickers.length === 0) return [];
        
        const yahooTickers = tickers.map(t => {
            const cleanT = t.trim().toUpperCase();
            
            // Mapeamento Cripto
            if (cleanT === 'BTC') return 'BTC-USD';
            if (cleanT === 'ETH') return 'ETH-USD';
            if (cleanT === 'SOL') return 'SOL-USD';
            if (cleanT === 'USDT') return 'USDT-USD';
            if (['BTC-USD', 'ETH-USD', 'SOL-USD'].includes(cleanT)) return cleanT;

            // Heurística para B3 (Brasil)
            const isB3Format = /^[A-Z]{4}\d{1,2}$/.test(cleanT);
            
            if (isB3Format && !cleanT.endsWith('.SA')) {
                return `${cleanT}.SA`;
            }

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

            // --- LÓGICA DE FALLBACK ---
            const foundTickers = new Set(mappedResults.map(r => r.ticker));
            const originalTickers = tickers.map(t => t.toUpperCase().trim());
            
            const missingOrZero = originalTickers.filter(t => {
                const found = mappedResults.find(r => r.ticker === t);
                return !found || found.price === 0;
            });

            // Tenta buscar na Brapi apenas os B3 faltantes
            if (missingOrZero.length > 0) {
                const b3Missing = missingOrZero.filter(t => /^[A-Z]{4}\d{1,2}$/.test(t));
                
                if (b3Missing.length > 0) {
                    // Log Agrupado para não spammar (INFO em vez de WARN se for tentar recuperar)
                    logger.debug(`⚠️ Yahoo falhou para [${b3Missing.length} ativos]. Tentando Brapi...`);
                    
                    const fallbackPromises = b3Missing.map(t => this.fetchFromBrapi(`${t}.SA`));
                    const fallbackResults = await Promise.all(fallbackPromises);
                    
                    let recoveredCount = 0;
                    fallbackResults.forEach(res => {
                        if (res) {
                            const existingIdx = mappedResults.findIndex(r => r.ticker === res.ticker);
                            if (existingIdx > -1) mappedResults.splice(existingIdx, 1);
                            
                            mappedResults.push(res);
                            recoveredCount++;
                        }
                    });
                    if (recoveredCount > 0) {
                        logger.info(`✅ Brapi recuperou ${recoveredCount} ativos.`);
                    }
                }
            }

            return mappedResults;

        } catch (error) {
            logger.error(`❌ Erro Yahoo Finance (Batch): ${error.message}`);
            return [];
        }
    },

    // Busca índices globais para Dashboard
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
        // ... (Mantido igual)
        let symbol = ticker.trim().toUpperCase();
        if ((type === 'STOCK' || type === 'FII') && !symbol.endsWith('.SA') && !symbol.startsWith('^')) {
             if (/^[A-Z]{4}\d{1,2}$/.test(symbol)) {
                symbol = `${symbol}.SA`;
            }
        }
        
        try {
            const queryOptions = { 
                period1: '2020-01-01', 
                period2: new Date().toISOString().split('T')[0],
                interval: '1d',
                events: 'dividends'
            };

            const result = await yahooFinance.historical(symbol, queryOptions);
            
            if (!result || !Array.isArray(result)) return [];

            return result
                .filter(item => item.dividends)
                .map(item => ({
                    date: item.date, 
                    amount: item.dividends
                }));

        } catch (error) {
            return [];
        }
    },

    async getSplitsHistory(ticker, type) {
        // ... (Mantido igual)
        let symbol = ticker.trim().toUpperCase();
        if (symbol.length >= 5 && symbol.endsWith('F') && !isNaN(symbol[symbol.length - 2])) {
            symbol = symbol.slice(0, -1);
        }

        if ((type === 'STOCK' || type === 'FII') && !symbol.endsWith('.SA') && !symbol.startsWith('^')) {
             if (/^[A-Z]{4}\d{1,2}$/.test(symbol)) {
                symbol = `${symbol}.SA`;
            }
        } 

        try {
            const queryOptions = { 
                period1: '2010-01-01', 
                period2: new Date().toISOString().split('T')[0],
                interval: '1d',
                events: 'split'
            };

            const result = await yahooFinance.historical(symbol, queryOptions);
            
            if (!result || !Array.isArray(result)) return [];

            return result
                .filter(item => item.splitRatio)
                .map(item => {
                    const parts = item.splitRatio.split(':');
                    const numerator = parseFloat(parts[0]);
                    const denominator = parseFloat(parts[1]);
                    const factor = numerator / denominator;

                    return {
                        date: item.date,
                        factor: factor,
                        ratio: item.splitRatio
                    };
                });

        } catch (error) {
            logger.warn(`Erro ao buscar splits para ${ticker}: ${error.message}`);
            return [];
        }
    }
};
