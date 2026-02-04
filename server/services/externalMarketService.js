
import YahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';

// Instancia a classe com supressão de avisos
const yahooFinance = new YahooFinance({ 
    suppressNotices: ['yahooSurvey', 'ripHistorical'] 
});

export const externalMarketService = {
    
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

            // Heurística para B3 (Brasil): 
            // Se tem 4 letras + números (ex: PETR4, HGLG11) e não tem .SA, adiciona.
            const isB3Format = /^[A-Z]{4}\d{1,2}$/.test(cleanT);
            
            if (isB3Format && !cleanT.endsWith('.SA')) {
                return `${cleanT}.SA`;
            }

            return cleanT; 
        });

        try {
            const results = await yahooFinance.quote(yahooTickers);
            
            const validResults = Array.isArray(results) ? results : [results];
            
            return validResults.map(item => {
                let symbol = item.symbol;
                // Normaliza de volta para o padrão interno (remove sufixos)
                if (symbol.endsWith('.SA')) symbol = symbol.replace('.SA', '');
                if (symbol.endsWith('-USD')) symbol = symbol.replace('-USD', '');
                
                // Tenta pegar a variação de várias propriedades possíveis
                const changePct = item.regularMarketChangePercent || item.changePercent || 0;

                return {
                    ticker: symbol,
                    price: item.regularMarketPrice || item.price || 0,
                    change: changePct, // Mapeamento robusto
                    name: item.longName || item.shortName || symbol
                };
            });

        } catch (error) {
            logger.error(`❌ Erro Yahoo Finance (Batch): ${error.message}`);
            
            // Fallback: Se o batch falhar (ex: um ticker inválido derruba tudo), tenta um por um
            if (yahooTickers.length > 1) {
                logger.info("⚠️ Tentando fallback sequencial para tickers...");
                const fallbackResults = [];
                for (const t of yahooTickers) {
                    try {
                        const singleRes = await yahooFinance.quote(t);
                        let symbol = singleRes.symbol;
                        if (symbol.endsWith('.SA')) symbol = symbol.replace('.SA', '');
                        if (symbol.endsWith('-USD')) symbol = symbol.replace('-USD', '');
                        
                        const changePct = singleRes.regularMarketChangePercent || singleRes.changePercent || 0;

                        fallbackResults.push({
                            ticker: symbol,
                            price: singleRes.regularMarketPrice || singleRes.price || 0,
                            change: changePct,
                            name: singleRes.longName || singleRes.shortName || symbol
                        });
                    } catch (e) {
                        logger.warn(`Ticker inválido ou falha no fallback: ${t}`);
                    }
                }
                return fallbackResults;
            }
            
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
            
            // Usando chart() em vez de historical() devido à depreciação
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

    // --- NOVO: BUSCA DE SPLITS COM SUPORTE A FRACIONÁRIO ---
    async getSplitsHistory(ticker, type) {
        let symbol = ticker.trim().toUpperCase();
        
        // Tratamento de Fracionário (ex: PETR4F -> PETR4)
        if (symbol.length >= 5 && symbol.endsWith('F') && !isNaN(symbol[symbol.length - 2])) {
            symbol = symbol.slice(0, -1);
        }

        if ((type === 'STOCK' || type === 'FII') && !symbol.endsWith('.SA') && !symbol.startsWith('^')) {
             if (/^[A-Z]{4}\d{1,2}$/.test(symbol)) {
                symbol = `${symbol}.SA`;
            }
        } else if (type === 'STOCK_US') {
            // US Stocks não tem sufixo no Yahoo
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
                    // splitRatio vem como string "10:1" ou "1:10"
                    const parts = item.splitRatio.split(':');
                    const numerator = parseFloat(parts[0]);
                    const denominator = parseFloat(parts[1]);
                    
                    // Fator multiplicador da quantidade
                    // Ex: Split 10:1 (10 ações novas para 1 velha). Fator = 10.
                    // Inplit 1:10 (1 ação nova para 10 velhas). Fator = 0.1.
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
