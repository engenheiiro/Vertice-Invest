
import YahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';

// Instancia a classe conforme exigido na versão 3.x
// Nota: Em algumas versões, o default export já é a instância. 
// Se der erro de construtor, mudar para: import yahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

export const externalMarketService = {
    
    // Busca Preço de Criptos e Stocks Internacionais em lote (Cotação Atual)
    async getQuotes(tickers) {
        if (!tickers || tickers.length === 0) return [];
        
        const yahooTickers = tickers.map(t => {
            if (t === 'BTC') return 'BTC-USD';
            if (t === 'ETH') return 'ETH-USD';
            if (t === 'SOL') return 'SOL-USD';
            if (t === 'USDT') return 'USDT-USD';
            return t; 
        });

        try {
            const results = await yahooFinance.quote(yahooTickers);
            const normalized = Array.isArray(results) ? results : [results];
            
            return normalized.map(item => {
                let symbol = item.symbol;
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

    // --- NOVA FUNÇÃO: Busca Histórico Completo ---
    async getFullHistory(ticker, type) {
        let symbol = ticker;
        
        // Adaptação de sufixos para o Yahoo Finance
        if (type === 'STOCK' || type === 'FII') symbol = `${ticker}.SA`;
        else if (type === 'CRYPTO') symbol = `${ticker}-USD`;
        // STOCK_US assume ticker direto (ex: AAPL, NVDA)

        try {
            // period1: '2000-01-01' garante histórico longo suficiente para qualquer usuário.
            // Definimos explicitamente period2 e interval para evitar erros de validação de schema da lib.
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

            const queryOptions = { 
                period1: '2000-01-01',
                period2: todayStr,
                interval: '1d'
            };
            
            const result = await yahooFinance.historical(symbol, queryOptions);

            if (!result || !Array.isArray(result)) return null;

            // Mapeia para formato leve
            return result.map(day => ({
                date: day.date.toISOString().split('T')[0], // YYYY-MM-DD
                close: day.close,
                adjClose: day.adjClose || day.close
            }));

        } catch (error) {
            logger.warn(`⚠️ Falha ao buscar histórico de ${symbol}: ${error.message}`);
            return null;
        }
    }
};
