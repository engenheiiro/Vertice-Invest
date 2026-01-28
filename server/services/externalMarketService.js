
import YahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';

// Instancia a classe conforme exigido na versão 3.x
const yahooFinance = new YahooFinance();

// Biblioteca Yahoo Finance pode ser instável, isolamos aqui.
export const externalMarketService = {
    
    // Busca Preço de Criptos e Stocks Internacionais em lote
    async getQuotes(tickers) {
        if (!tickers || tickers.length === 0) return [];
        
        // Mapeia tickers internos para Yahoo (ex: BTC -> BTC-USD)
        const yahooTickers = tickers.map(t => {
            if (t === 'BTC') return 'BTC-USD';
            if (t === 'ETH') return 'ETH-USD';
            if (t === 'SOL') return 'SOL-USD';
            if (t === 'USDT') return 'USDT-USD';
            // Stocks US geralmente são diretas (AAPL, NVDA)
            return t; 
        });

        try {
            const results = await yahooFinance.quote(yahooTickers);
            
            // Normaliza retorno
            const normalized = Array.isArray(results) ? results : [results];
            
            return normalized.map(item => {
                let symbol = item.symbol;
                // Remove sufixo -USD para bater com nosso DB interno
                if (symbol.endsWith('-USD')) symbol = symbol.replace('-USD', '');
                
                return {
                    ticker: symbol,
                    price: item.regularMarketPrice,
                    change: item.regularMarketChangePercent,
                    name: item.longName || item.shortName
                };
            });

        } catch (error) {
            logger.error(`❌ Erro Yahoo Finance (Batch): ${error.message}`);
            // Retorna array vazio para não quebrar o fluxo principal
            return [];
        }
    },

    // Busca índices globais para Dashboard
    async getGlobalIndices() {
        try {
            const quotes = await yahooFinance.quote(['^BVSP', '^GSPC', '^IXIC']); // Ibov, S&P, Nasdaq
            const result = {};
            
            const find = (s) => (Array.isArray(quotes) ? quotes : [quotes]).find(q => q.symbol === s);
            
            const ibov = find('^BVSP');
            if (ibov) result.ibov = { value: ibov.regularMarketPrice, change: ibov.regularMarketChangePercent };
            
            const spx = find('^GSPC');
            if (spx) result.spx = { value: spx.regularMarketPrice, change: spx.regularMarketChangePercent };

            return result;
        } catch (error) {
            // Silencioso, pois é apenas decorativo
            return {};
        }
    }
};
