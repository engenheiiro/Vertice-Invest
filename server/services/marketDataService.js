
import { createRequire } from 'module';
import logger from '../config/logger.js';

const require = createRequire(import.meta.url);

// --- CONFIGURAÇÃO ROBUSTA YAHOO FINANCE ---
let yf;

try {
    const pkg = require('yahoo-finance2');
    
    // Tenta obter a instância correta (commonjs vs esm vs default export)
    // Em versões recentes, pkg.default costuma ser a instância principal configurada
    if (pkg.default) {
        yf = pkg.default;
    } else {
        yf = pkg;
    }

    // Configuração Defensiva
    if (yf) {
        // Tenta suprimir validação apenas se o método existir (evita crash)
        if (typeof yf.setGlobalConfig === 'function') {
            try {
                yf.setGlobalConfig({ 
                    validation: { logErrors: false }, // Desliga logs de erro de schema
                    queue: { concurrency: 2, timeout: 60000 } // Aumenta um pouco a concorrência
                });
            } catch (configErr) {
                logger.debug("YahooFinance: setGlobalConfig falhou, usando padrão.");
            }
        }
        
        // Propriedade comum para suprimir avisos
        if ('suppressWarnings' in yf) {
            yf.suppressWarnings = true;
        }
        
        logger.info("✅ YahooFinance: Driver de dados inicializado.");
    } else {
        throw new Error("Módulo yahoo-finance2 não carregou corretamente.");
    }

} catch (e) {
    logger.error(`❌ [DATA SYSTEM] Erro fatal no MarketData: ${e.message}`);
}

const validateNumber = (val) => {
    if (val === null || val === undefined) return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

// --- WATCHLIST (Curadoria de Ativos) ---
const WATCHLIST = {
    'STOCK': [
        'PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'WEGE3.SA', 'BBAS3.SA', 'PRIO3.SA', 'RENT3.SA', 'BBDC4.SA',
        'SUZB3.SA', 'HAPV3.SA', 'BPAC11.SA', 'JBSS3.SA', 'VIVT3.SA', 'CMIG4.SA', 'RDOR3.SA', 'EQTL3.SA',
        'SBSP3.SA', 'CSAN3.SA', 'B3SA3.SA', 'ABEV3.SA', 'TOTS3.SA', 'EMBR3.SA', 'CSNA3.SA', 'LREN3.SA',
        'MGLU3.SA', 'ASAI3.SA', 'VBBR3.SA', 'CCRO3.SA', 'KLBN11.SA', 'TAEE11.SA', 'ALUP11.SA', 'BBSE3.SA'
    ],
    'FII': [
        'HGLG11.SA', 'KNRI11.SA', 'MXRF11.SA', 'XPML11.SA', 'VISC11.SA', 'BTLG11.SA', 'XPLG11.SA',
        'HGRU11.SA', 'KNCR11.SA', 'IRDM11.SA', 'CPTS11.SA', 'TRXF11.SA', 'ALZR11.SA', 'BRCO11.SA',
        'HGBS11.SA', 'KNIP11.SA', 'VGHF11.SA', 'RECR11.SA', 'TGAR11.SA', 'XPCI11.SA', 'BCFF11.SA'
    ],
    'STOCK_US': [
        'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'JPM', 'V', 'NFLX', 'KO',
        'PEP', 'DIS', 'BRK-B', 'JNJ', 'PG', 'XOM', 'LLY', 'AVGO', 'COST', 'HD', 'WMT'
    ],
    'CRYPTO': [
        'BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'LINK-USD'
    ]
};

const MACRO_INDICES = [
    { symbol: '^BVSP', name: 'IBOVESPA' },
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: 'BRL=X', name: 'USD/BRL' }
];

const calculateGrahamPrice = (eps, bvps) => {
    if (eps <= 0 || bvps <= 0) return 0;
    return Math.sqrt(22.5 * eps * bvps);
};

export const marketDataService = {
    async getMacroContext() {
        if (!yf) return [];
        try {
            const promises = MACRO_INDICES.map(async (idx) => {
                try {
                    const q = await yf.quote(idx.symbol);
                    return { 
                        name: idx.name, 
                        price: validateNumber(q.regularMarketPrice), 
                        change: validateNumber(q.regularMarketChangePercent) 
                    };
                } catch { return null; }
            });
            return (await Promise.all(promises)).filter(r => r !== null);
        } catch { return []; }
    },

    async getMarketData(assetClass) {
        if (!yf) throw new Error("YahooFinance indisponível.");

        const symbols = WATCHLIST[assetClass];
        if (!symbols || symbols.length === 0) return [];

        let fallbackCount = 0;

        try {
            logger.info(`🔎 [DATA] Coletando ${assetClass} (${symbols.length} ativos)...`);
            
            const dataPromises = symbols.map(async (symbol) => {
                try {
                    // 1. Tenta dados completos (modules)
                    // Usamos apenas modulos essenciais para reduzir chance de erro
                    const summary = await yf.quoteSummary(symbol, {
                        modules: ['price', 'financialData', 'defaultKeyStatistics', 'summaryDetail']
                    });
                    
                    if (!summary.price?.regularMarketPrice) throw new Error("Preço ausente");
                    
                    return { symbol, ...summary, source: 'deep' };

                } catch (deepError) {
                    fallbackCount++;
                    try {
                        // 2. Fallback para cotação simples (quote)
                        const basic = await yf.quote(symbol);
                        if (!basic?.regularMarketPrice) return null;
                        
                        return { 
                            symbol, 
                            price: basic, 
                            financialData: {}, 
                            defaultKeyStatistics: {}, 
                            summaryDetail: {},
                            source: 'basic' 
                        };
                    } catch {
                        return null; // Falha silenciosa no ativo individual
                    }
                }
            });

            const results = (await Promise.all(dataPromises)).filter(r => r !== null);
            
            if (results.length === 0) throw new Error(`Falha total de coleta em ${assetClass}`);

            logger.info(`✅ [DATA] ${assetClass}: ${results.length}/${symbols.length} coletados (Basic: ${fallbackCount})`);

            // Normalização e Limpeza
            return results.map(data => {
                const price = data.price || {};
                const financial = data.financialData || {};
                const stats = data.defaultKeyStatistics || {};
                const detail = data.summaryDetail || {};

                const currentPrice = validateNumber(price.regularMarketPrice);
                const eps = validateNumber(stats.trailingEps);
                const bvps = validateNumber(stats.bookValue);
                const roe = validateNumber(financial.returnOnEquity);
                const grossMargins = validateNumber(financial.grossMargins);
                
                let grahamPrice = 0;
                let upsideGraham = 0;
                if ((assetClass === 'STOCK' || assetClass === 'STOCK_US') && eps > 0 && bvps > 0) {
                    grahamPrice = calculateGrahamPrice(eps, bvps);
                    if (grahamPrice > 0) upsideGraham = ((grahamPrice - currentPrice) / currentPrice) * 100;
                }

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
                        qualityScore: ((roe * 100) + (grossMargins * 100)).toFixed(0),
                        isDeepData: data.source === 'deep'
                    }
                };
            }).sort((a, b) => b.metrics.mktCap - a.metrics.mktCap);

        } catch (error) {
            logger.error(`❌ [DATA ERROR] ${error.message}`);
            throw error;
        }
    }
};
