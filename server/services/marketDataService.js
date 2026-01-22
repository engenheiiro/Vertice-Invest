
import yahooFinance from 'yahoo-finance2';
import logger from '../config/logger.js';

// Configuração da Biblioteca
yahooFinance.suppressWarnings = true;
yahooFinance.suppressNotices(['yahooSurvey']);

// Helper de Validação Numérica Estrita
const validateNumber = (val) => {
    if (val === null || val === undefined) return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

// --- WATCHLIST EXPANDIDA (Top Liquidez + Relevância) ---
const WATCHLIST = {
    'STOCK': [
        'PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'WEGE3.SA', 'BBAS3.SA', 'PRIO3.SA', 'RENT3.SA', 'BBDC4.SA', 'ELET3.SA', 'GGBR4.SA',
        'SUZB3.SA', 'HAPV3.SA', 'BPAC11.SA', 'JBSS3.SA', 'RAIL3.SA', 'VIVT3.SA', 'CMIG4.SA', 'RDOR3.SA', 'EQTL3.SA', 'RADL3.SA',
        'SBSP3.SA', 'CSAN3.SA', 'CPLE6.SA', 'TIMS3.SA', 'B3SA3.SA', 'ABEV3.SA', 'TOTS3.SA', 'EMBR3.SA', 'CMIN3.SA', 'CSNA3.SA',
        'LREN3.SA', 'MGLU3.SA', 'ASAI3.SA', 'VBBR3.SA', 'CCRO3.SA', 'UGPA3.SA', 'KLBN11.SA', 'TAEE11.SA', 'ALUP11.SA', 'BBSE3.SA',
        'SANB11.SA', 'VAMO3.SA', 'RECV3.SA', 'GOAU4.SA', 'ENEV3.SA', 'CRFB3.SA', 'AZUL4.SA', 'NTCO3.SA'
    ],
    'FII': [
        'HGLG11.SA', 'KNRI11.SA', 'MXRF11.SA', 'XPML11.SA', 'VISC11.SA', 'BTLG11.SA', 'XPLG11.SA', 'HGRU11.SA', 'KNCR11.SA', 'IRDM11.SA',
        'CPTS11.SA', 'TRXF11.SA', 'ALZR11.SA', 'BRCO11.SA', 'HGBS11.SA', 'KNIP11.SA', 'VGHF11.SA', 'RECR11.SA', 'TGAR11.SA', 'XPCI11.SA',
        'BCFF11.SA', 'HFOF11.SA', 'PVBI11.SA', 'JSRE11.SA', 'RBRR11.SA', 'MALL11.SA', 'VILG11.SA', 'LVBI11.SA', 'RBRP11.SA', 'XPIN11.SA',
        'VRTA11.SA', 'RBRF11.SA', 'HCTR11.SA', 'DEVA11.SA', 'RECT11.SA', 'BRCR11.SA', 'KNHY11.SA', 'CVBI11.SA', 'MCCI11.SA', 'VGIP11.SA'
    ],
    'STOCK_US': [
        'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'JPM', 'V', 'NFLX', 'KO', 'PEP', 'DIS', 'BRK-B',
        'JNJ', 'PG', 'XOM', 'CVX', 'LLY', 'AVGO', 'COST', 'HD', 'WMT', 'MA', 'MRK', 'ABBV', 'CRM', 'ORCL', 'ACN',
        'MCD', 'LIN', 'ADBE', 'IBM', 'QCOM', 'TXN', 'GE', 'CAT', 'UBER', 'INTC', 'VZ', 'T', 'NKE', 'BA'
    ],
    'CRYPTO': [
        'BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'LINK-USD', 'AVAX-USD', 'DOT-USD',
        'MATIC-USD', 'UNI-USD', 'LTC-USD', 'BCH-USD', 'ATOM-USD', 'XLM-USD', 'ICP-USD', 'NEAR-USD', 'APT-USD', 'FIL-USD'
    ]
};

const MACRO_INDICES = [
    { symbol: '^BVSP', name: 'IBOVESPA' },
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: 'BRL=X', name: 'USD/BRL' },
    { symbol: 'CL=F', name: 'Petróleo WTI' },
    { symbol: '^TNX', name: 'Treasury 10Y' }
];

const calculateGrahamPrice = (eps, bvps) => {
    if (eps <= 0 || bvps <= 0) return 0;
    return Math.sqrt(22.5 * eps * bvps);
};

export const marketDataService = {
    async getMacroContext() {
        try {
            logger.info("🌍 [MACRO] Coletando indicadores globais...");
            const promises = MACRO_INDICES.map(async (idx) => {
                try {
                    const q = await yahooFinance.quote(idx.symbol);
                    return { 
                        name: idx.name, 
                        price: validateNumber(q.regularMarketPrice), 
                        change: validateNumber(q.regularMarketChangePercent) 
                    };
                } catch (e) { return null; }
            });
            const results = await Promise.all(promises);
            return results.filter(r => r !== null);
        } catch (e) { return []; }
    },

    async getMarketData(assetClass) {
        const symbols = WATCHLIST[assetClass];
        if (!symbols || symbols.length === 0) return [];

        const startTime = Date.now();
        let fallbackCount = 0;
        let failCount = 0;

        try {
            logger.info(`🔎 [DATA] Iniciando coleta para ${assetClass} (${symbols.length} ativos)...`);
            
            // Passo 1: Tentar pegar dados ricos (quoteSummary) em batch
            const dataPromises = symbols.map(async (symbol) => {
                try {
                    // Tenta pegar dados profundos primeiro
                    const summary = await yahooFinance.quoteSummary(symbol, {
                        modules: ['price', 'financialData', 'defaultKeyStatistics', 'summaryDetail']
                    });
                    
                    // Validação preliminar: Se não tem preço, o dado é inútil
                    if (!summary.price || !summary.price.regularMarketPrice) {
                        throw new Error("Dados de preço ausentes");
                    }
                    
                    return { symbol, ...summary, source: 'deep' };
                } catch (deepError) {
                    // FALLBACK: Se falhar (comum em ativos BR), pega dados básicos (quote)
                    fallbackCount++;
                    try {
                        const basic = await yahooFinance.quote(symbol);
                        if (!basic || !basic.regularMarketPrice) throw new Error("Price not found");
                        
                        return { 
                            symbol, 
                            price: basic, 
                            financialData: {}, 
                            defaultKeyStatistics: {}, 
                            summaryDetail: {},
                            source: 'basic' 
                        };
                    } catch (basicError) {
                        failCount++;
                        return null; // Ativo morto
                    }
                }
            });

            const results = (await Promise.all(dataPromises)).filter(r => r !== null);
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            if (failCount > 0 || fallbackCount > 0) {
                logger.warn(`⚠️ [DATA] ${assetClass} finalizado em ${duration}s | ✅ ${results.length} | 🟡 Fallback: ${fallbackCount} | ❌ Falhas: ${failCount}`);
            } else {
                logger.info(`✅ [DATA] ${assetClass} coletado 100% perfeito em ${duration}s.`);
            }

            // Passo 2: Normalização e Validação dos Dados
            const cleanData = results.map(data => {
                const price = data.price || {};
                const financial = data.financialData || {};
                const stats = data.defaultKeyStatistics || {};
                const detail = data.summaryDetail || {};

                // Validação de Campos Críticos
                const currentPrice = validateNumber(price.regularMarketPrice);
                const eps = validateNumber(stats.trailingEps);
                const bvps = validateNumber(stats.bookValue);
                const roe = validateNumber(financial.returnOnEquity);
                const grossMargins = validateNumber(financial.grossMargins);
                
                // Se preço for zero, ignora (será filtrado depois)
                if (currentPrice === 0) return null;

                // Cálculos Auxiliares
                let grahamPrice = 0;
                let upsideGraham = 0;
                if ((assetClass === 'STOCK' || assetClass === 'STOCK_US') && eps > 0 && bvps > 0) {
                    grahamPrice = calculateGrahamPrice(eps, bvps);
                    if (grahamPrice > 0) upsideGraham = ((grahamPrice - currentPrice) / currentPrice) * 100;
                }

                // Cálculo Simplificado de Quality (0-200)
                const qualityScore = (roe * 100) + (grossMargins * 100);

                return {
                    ticker: data.symbol.replace('.SA', ''),
                    name: price.shortName || data.symbol,
                    price: currentPrice,
                    change: validateNumber(price.regularMarketChangePercent).toFixed(2),
                    metrics: {
                        pl: validateNumber(detail.trailingPE),
                        pvp: validateNumber(detail.priceToBook),
                        dy: validateNumber(detail.dividendYield) * 100,
                        roe: roe * 100,
                        mktCap: validateNumber(price.marketCap)
                    },
                    analysis: {
                        grahamPrice: grahamPrice.toFixed(2),
                        upsideGraham: upsideGraham.toFixed(1),
                        qualityScore: qualityScore.toFixed(0),
                        isDeepData: data.source === 'deep'
                    }
                };
            }).filter(item => item !== null); // Remove itens nulos

            // Ordenar por liquidez (MarketCap)
            return cleanData.sort((a, b) => b.metrics.mktCap - a.metrics.mktCap);

        } catch (error) {
            logger.error(`🔥 [DATA FATAL] Erro crítico em ${assetClass}: ${error.message}`);
            return [];
        }
    }
};
