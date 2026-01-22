import yahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';

// Suprime avisos de console da biblioteca
yahooFinance.suppressWarnings = true;
// Suprime especificamente o aviso de Survey que polui o log
yahooFinance.suppressNotices(['yahooSurvey']);

// Lista de ativos monitorados por classe para o Screener Inicial
const WATCHLIST = {
    'STOCK': ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'WEGE3.SA', 'BBAS3.SA', 'PRIO3.SA', 'RENT3.SA', 'BBDC4.SA', 'ELET3.SA', 'GGBR4.SA'],
    'FII': ['HGLG11.SA', 'KNRI11.SA', 'MXRF11.SA', 'XPML11.SA', 'VISC11.SA', 'BTLG11.SA', 'XPLG11.SA'],
    'STOCK_US': ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD'],
    'CRYPTO': ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    'FIXED': ['^IRX', '^TNX'], // Yields de Tesouro Americano como proxy de risco global
    'RESERVE': [] // Reserva não precisa de cotação externa
};

export const marketDataService = {
    /**
     * Busca dados técnicos e fundamentais para uma classe de ativos.
     * @param {string} assetClass 
     * @returns {Promise<Array>} Lista de objetos com dados financeiros
     */
    async getMarketData(assetClass) {
        const symbols = WATCHLIST[assetClass];
        
        if (!symbols || symbols.length === 0) {
            return []; // Retorna vazio se não houver watchlist (ex: RESERVA)
        }

        try {
            logger.info(`🔍 Buscando dados de mercado para ${assetClass} (${symbols.length} ativos)...`);
            
            // Na v2, .quote() aceita apenas uma string (simbolo único).
            // Usamos Promise.all para buscar todos em paralelo.
            const promises = symbols.map(async (symbol) => {
                try {
                    return await yahooFinance.quote(symbol, { 
                        fields: [
                            'symbol', 'shortName', 'regularMarketPrice', 'regularMarketChangePercent', 
                            'regularMarketVolume', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow',
                            'trailingPE', 'priceToBook', 'marketCap'
                        ] 
                    });
                } catch (err) {
                    // Falha silenciosa em um ativo específico não deve quebrar o lote inteiro
                    // logger.debug(`Falha ao buscar ${symbol}: ${err.message}`);
                    return null;
                }
            });

            // Aguarda todas as requisições e filtra os nulos (falhas)
            const results = await Promise.all(promises);
            const quotes = results.filter(q => q !== null);

            // Normaliza os dados para um formato limpo para a IA
            const cleanData = quotes.map(q => ({
                ticker: q.symbol.replace('.SA', ''),
                price: q.regularMarketPrice,
                change: q.regularMarketChangePercent ? `${q.regularMarketChangePercent.toFixed(2)}%` : '0%',
                vol: q.regularMarketVolume,
                pe: q.trailingPE ? q.trailingPE.toFixed(2) : 'N/A', // P/L
                pb: q.priceToBook ? q.priceToBook.toFixed(2) : 'N/A', // P/VP
                range52w: q.fiftyTwoWeekLow && q.fiftyTwoWeekHigh ? `${q.fiftyTwoWeekLow} - ${q.fiftyTwoWeekHigh}` : 'N/A'
            }));

            return cleanData;

        } catch (error) {
            logger.warn(`⚠️ Falha no MarketDataService (${assetClass}): ${error.message}`);
            // Em caso de falha geral no Yahoo, retornamos vazio para a IA usar apenas o Google Search
            return [];
        }
    }
};