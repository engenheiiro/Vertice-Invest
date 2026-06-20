
import YahooFinance from 'yahoo-finance2';
import axios from 'axios';
import * as cheerio from 'cheerio'; // Necessário para o scraping
import logger from '../config/logger.js';
import { createCircuitBreaker, withRetry } from '../utils/resilience.js'; // (I4)

// Instancia a classe com supressão de avisos
const yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey', 'ripHistorical']
});

// (I4) Circuit breakers por provedor. Quando um serviço cai, paramos de bater
// nele a cada ticker do lote (fast-fail) até o cooldown — acelera o batch e
// reduz pressão sobre o terceiro. Limiares mais altos no Google porque ele é
// chamado por-ticker (mais ruído tolerável antes de abrir).
const yahooBreaker = createCircuitBreaker({ name: 'yahoo', failureThreshold: 4, cooldownMs: 30_000 });
const googleBreaker = createCircuitBreaker({ name: 'google-finance', failureThreshold: 8, cooldownMs: 60_000 });
const brapiBreaker = createCircuitBreaker({ name: 'brapi', failureThreshold: 5, cooldownMs: 60_000 });

// Configuração para Scraping Google Finance
const GOOGLE_FINANCE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Ações com classe (ex.: BRK.B, BF.B) usam PONTO no ticker canônico (DB/S&P list),
// mas o Yahoo Finance exige HÍFEN (BRK-B). Sem essa conversão o Yahoo responde
// "No data found / delisted" e o ativo nunca recebe cotação/histórico/fundamentos.
const US_CLASS_DOT_RE = /^[A-Z]{1,4}\.[A-Z]$/;   // BRK.B, BF.B (não casa PETR4.SA)
const US_CLASS_DASH_RE = /^[A-Z]{1,4}-[A-Z]$/;   // BRK-B (não casa BTC-USD)
// Ticker canônico (DB) → símbolo aceito pelo Yahoo.
export const toYahooSymbol = (sym) => (US_CLASS_DOT_RE.test(sym) ? sym.replace('.', '-') : sym);
// Símbolo do Yahoo → ticker canônico (DB), revertendo só a classe US (preserva BTC-USD).
export const fromYahooSymbol = (sym) => (US_CLASS_DASH_RE.test(sym) ? sym.replace('-', '.') : sym);

// Tickers que falham consistentemente no Yahoo Finance mas são recuperados pelo Google.
// Listados aqui para eliminar ruído de warn no log — o fallback já os trata corretamente.
const PREFER_GOOGLE_TICKERS = new Set(['B3SA3', 'CVBI11', 'MALL11', 'QAGR11', 'RRCI11', 'RVBI11']);

// (MEM) Limite de scrapes simultâneos do Google Finance. Cada cheerio.load() de
// uma página do Google constrói uma árvore DOM de vários MB; sem este teto, um
// Promise.all do universo inteiro mantinha N árvores na memória de uma vez e
// estourava o heap em instâncias de 512 MB. Pool pequeno = pico de memória limitado.
const GOOGLE_FALLBACK_CONCURRENCY = 4;

/**
 * (MEM) Executa `worker` sobre `items` com no máximo `limit` tarefas simultâneas,
 * preservando a ordem dos resultados. Substitui `Promise.all(items.map(...))`
 * quando cada tarefa aloca muita memória (scraping/parse de HTML).
 */
const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;
    const runner = async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index], index);
        }
    };
    const pool = Array.from({ length: Math.min(limit, items.length) }, runner);
    await Promise.all(pool);
    return results;
};

export const externalMarketService = {
    
    // Helper: Scraper do Google Finance (Fallback Secundário)
    async fetchFromGoogleFinance(ticker) {
        try {
            // Mapeamento de Tickers (Yahoo -> Google Finance Format)
            let googleTicker = ticker;
            let exchange = '';

            // Lógica B3
            if (ticker.endsWith('.SA')) {
                googleTicker = ticker.replace('.SA', '');
                exchange = ':BVMF';
            } 
            // Lógica Crypto
            else if (ticker.endsWith('-USD')) {
                googleTicker = ticker.replace('-USD', '-USD'); // Google costuma usar USD
                exchange = ''; // Crypto geralmente é global no Google
            } 
            // Lógica US Stock (Simplificada, assume NASDAQ/NYSE se não tiver sufixo)
            else if (!ticker.includes('.')) {
                // Tenta NASDAQ por padrão para tech, mas isso é falível sem saber a bolsa exata.
                // O Google Finance é inteligente com buscas, mas a URL direta precisa da bolsa.
                // Fallback genérico: Tenta sem bolsa na URL de busca se falhar
                exchange = ':NASDAQ'; 
            }

            const url = `https://www.google.com/finance/quote/${googleTicker}${exchange}`;

            // (I4) Via circuit breaker: se o Google estiver fora, fast-fail (null)
            // sem esperar o timeout em cada ticker do lote.
            const response = await googleBreaker.exec(
                () => axios.get(url, {
                    headers: { 'User-Agent': GOOGLE_FINANCE_UA },
                    timeout: 3000 // Timeout curto para não travar o fluxo
                }),
            );

            const $ = cheerio.load(response.data);
            
            // Seletor da classe de preço (Isso muda periodicamente, precisa de manutenção)
            // Classe comum em 2024/2025: .YMlKec.fxKbKc
            let priceText = $('.YMlKec.fxKbKc').first().text();
            
            // Fallback seletor genérico via atributo data
            if (!priceText) {
                priceText = $('[data-last-price]').attr('data-last-price');
            }

            if (priceText) {
                // Limpeza: "R$ 34,50" -> 34.50 | "$12,345.00" -> 12345.00
                const cleanPrice = priceText.replace(/[^\d.,]/g, '');
                // Detecta formato BR (vírgula decimal) vs US (ponto decimal)
                let finalPrice = 0;
                
                if (cleanPrice.includes(',') && !cleanPrice.includes('.')) {
                    // Formato BR puro: 34,50
                    finalPrice = parseFloat(cleanPrice.replace(',', '.'));
                } else if (cleanPrice.includes('.') && cleanPrice.includes(',')) {
                    // Formato misto: 1.234,56 (BR) ou 1,234.56 (US)
                    // Assume BR se a vírgula for o último separador
                    if (cleanPrice.lastIndexOf(',') > cleanPrice.lastIndexOf('.')) {
                        finalPrice = parseFloat(cleanPrice.replace(/\./g, '').replace(',', '.'));
                    } else {
                        finalPrice = parseFloat(cleanPrice.replace(/,/g, ''));
                    }
                } else {
                    // Formato simples 34.50
                    finalPrice = parseFloat(cleanPrice);
                }

                if (!isNaN(finalPrice) && finalPrice > 0) {
                    // Extrai variação (Opcional, seletor .JwB6zf)
                    let change = 0;
                    const changeText = $('.JwB6zf').first().text(); // Ex: 1.25%
                    if (changeText) {
                        change = parseFloat(changeText.replace('%', '').replace(',', '.').replace('+', ''));
                        if (changeText.includes('-') || $('.JwB6zf').hasClass('P2hktc')) { // Classe vermelha do google
                             // Ajuste de sinal se necessário
                        }
                    }

                    return {
                        ticker: ticker.replace('.SA', ''),
                        price: finalPrice,
                        change: change,
                        name: googleTicker, // Nome provisório
                        source: 'GOOGLE_FINANCE_FALLBACK'
                    };
                }
            }
            return null;
        } catch (error) {
            // Silencioso no nível de função, quem chama decide o log
            return null;
        }
    },

    // Helper: Busca na Brapi (Fallback Terciário)
    async fetchFromBrapi(ticker) {
        try {
            if (ticker.length <= 4) return null;
            const cleanTicker = ticker.replace('.SA', '').trim();
            const token = process.env.BRAPI_TOKEN ? `&token=${process.env.BRAPI_TOKEN}` : '';
            const url = `https://brapi.dev/api/quote/${cleanTicker}?range=1d&interval=1d&fundamental=false${token}`;

            // (I4) Brapi via circuit breaker — fast-fail quando o serviço cai.
            const response = await brapiBreaker.exec(() => axios.get(url, { timeout: 4000 }));
            
            if (response.data && response.data.results && response.data.results.length > 0) {
                const data = response.data.results[0];
                // Preço ausente/zero não é recuperação: a Brapi às vezes devolve
                // regularMarketPrice = 0 para tickers ilíquidos/suspensos. Tratar como
                // falha evita gravar lastPrice=0 e logar "recuperou cotação: 0".
                if (!(data.regularMarketPrice > 0)) return null;
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
            
            // If it's a known crypto list or looks like a crypto (not B3 format, no dot, length 3-4)
            // Actually, we don't know the type here. But we can check if it's in our default crypto list
            const knownCryptos = [
                'BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'USDC', 'XRP', 'DOGE', 'TON', 'ADA',
                'SHIB', 'AVAX', 'TRX', 'DOT', 'BCH', 'LINK', 'MATIC', 'NEAR', 'LTC', 'ICP',
                'LEO', 'DAI', 'UNI', 'APT', 'STX', 'ETC', 'MNT', 'FIL', 'RNDR', 'ARB',
                'XMR', 'OKB', 'IMX', 'KAS', 'XLM', 'INJ', 'VET', 'FDUSD', 'OP', 'GRT',
                'TAO', 'THETA', 'MKR', 'CRO', 'FET', 'LDO', 'ALGO', 'RUNE', 'AAVE', 'BSV'
            ];
            if (knownCryptos.includes(cleanT)) return `${cleanT}-USD`;
            if (cleanT.endsWith('-USD')) return cleanT;

            const isB3Format = /^[A-Z]{4}\d{1,2}$/.test(cleanT);
            if (isB3Format && !cleanT.endsWith('.SA')) return `${cleanT}.SA`;
            // Ação com classe (BRK.B) → formato do Yahoo (BRK-B).
            return toYahooSymbol(cleanT);
        });

        try {
            // TENTATIVA 1: YAHOO FINANCE (Principal)
            // validateResult: false suprime erros de schema para tickers com dados parciais (ex: BRK.B, BF.B)
            // (I4) 1 retry com backoff para falha transitória, sob circuit breaker.
            // Circuito aberto → lança e cai no catch (Protocolo de Emergência Google).
            const results = await yahooBreaker.exec(() => withRetry(
                () => yahooFinance.quote(yahooTickers, {}, { validateResult: false }),
                { retries: 1, baseDelayMs: 300 },
            ));
            const validResults = Array.isArray(results) ? results : [results];
            
            const mappedResults = validResults.map(item => {
                let symbol = item.symbol;
                if (symbol.endsWith('.SA')) symbol = symbol.replace('.SA', '');
                if (symbol.endsWith('-USD')) symbol = symbol.replace('-USD', '');
                else symbol = fromYahooSymbol(symbol); // BRK-B → BRK.B (canônico no DB)
                const changePct = item.regularMarketChangePercent || item.changePercent || 0;

                return {
                    ticker: symbol,
                    price: item.regularMarketPrice || item.price || 0,
                    change: changePct,
                    marketCap: item.marketCap || 0,
                    volume: item.regularMarketVolume || item.volume || 0,
                    name: item.longName || item.shortName || symbol,
                    source: 'YAHOO'
                };
            });

            // Verifica quais tickers falharam no Yahoo (não retornaram ou preço zero)
            const successTickers = new Set(mappedResults.filter(r => r.price > 0).map(r => r.ticker));
            const failedTickers = tickers.filter(t => !successTickers.has(t));

            // TENTATIVA 2: GOOGLE FINANCE (Fallback para falhas)
            if (failedTickers.length > 0) {
                const unexpectedFails = failedTickers.filter(t => !PREFER_GOOGLE_TICKERS.has(t));
                if (unexpectedFails.length > 0) {
                    logger.warn(`⚠️ [MarketService] Yahoo falhou para ${unexpectedFails.length} ativos: [${unexpectedFails.join(', ')}]. Tentando Google Finance Fallback...`);
                }
                
                // (MEM) Concorrência limitada: cada scrape carrega uma árvore cheerio
                // pesada. Promise.all sem teto mantinha todas em memória de uma vez.
                const fallbackRaw = await mapWithConcurrency(failedTickers, GOOGLE_FALLBACK_CONCURRENCY, async (ticker) => {
                    const googleData = await this.fetchFromGoogleFinance(ticker);
                    if (googleData) {
                        logger.info(`✅ [Fallback] Google Finance recuperou cotação para ${ticker}: ${googleData.price}`);
                        return googleData;
                    } else {
                        // TENTATIVA 3: BRAPI (Se for B3)
                        if (/^[A-Z]{4}\d{1,2}$/.test(ticker)) {
                             const brapiData = await this.fetchFromBrapi(ticker + '.SA');
                             if (brapiData) {
                                 logger.info(`✅ [Fallback] Brapi recuperou cotação para ${ticker}: ${brapiData.price}`);
                                 return brapiData;
                             }
                        }
                    }
                    return null;
                });

                const fallbackResults = fallbackRaw.filter(Boolean);
                return [...mappedResults, ...fallbackResults];
            }

            return mappedResults;

        } catch (error) {
            logger.error(`❌ Erro Crítico Yahoo Finance (Batch): ${error.message}`);
            // Se o Yahoo caiu completamente, tenta Google um por um (lento mas resiliente)
            logger.warn("⚠️ Ativando Protocolo de Emergência: Fallback Total Google Finance.");

            // (MEM) Mesmo no modo de emergência usamos pool limitado em vez de varrer
            // o lote inteiro: protege o heap (árvores cheerio) quando o Yahoo cai e
            // TODOS os tickers caem no scraping de uma vez.
            const emergencyRaw = await mapWithConcurrency(tickers, GOOGLE_FALLBACK_CONCURRENCY, (t) => this.fetchFromGoogleFinance(t));
            return emergencyRaw.filter(Boolean);
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
            }, { validateResult: false });

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

                logger.debug(`📈 SPX 12m [${startQuote.date.toISOString().split('T')[0]} -> ${result.quotes[result.quotes.length - 1].date.toISOString().split('T')[0]}]: ${startPrice.toFixed(2)} -> ${endPrice.toFixed(2)} = ${returnPct.toFixed(2)}%`);
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
            }, { validateResult: false });

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
                logger.debug(`📈 IBOV 12m [${startQuote.date.toISOString().split('T')[0]} -> ${result.quotes[result.quotes.length - 1].date.toISOString().split('T')[0]}]: ${startPrice.toFixed(2)} -> ${endPrice.toFixed(2)} = ${returnPct.toFixed(2)}%`);
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
        } else if (type === 'STOCK_US') {
            // US stocks vão quase sem ajuste (AAPL, MSFT). Exceção: ações com classe
            // (BRK.B) precisam do hífen do Yahoo (BRK-B), senão "No data found".
            symbol = toYahooSymbol(symbol);
            logger.debug(`[getFullHistory] STOCK_US: ${symbol}`);
        }
        // For USD-BRL exchange rate history
        if (symbol === 'USD-BRL') {
            symbol = 'BRL=X';
        }

        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            const queryOptions = {
                period1: '2020-01-01',
                period2: todayStr,
                interval: '1d'
            };

            // validateResult:false silencia os avisos verbosos da lib quando o Yahoo
            // devolve meta incompleto (currency null / sem regularMarketPrice) — payload
            // de quotes ainda vem íntegro e já filtramos close>0 abaixo.
            const result = await yahooFinance.chart(symbol, queryOptions, { validateResult: false });

            if (!result || !result.quotes || !Array.isArray(result.quotes)) return null;

            return result.quotes
                .filter(day => day.close > 0)
                .map(day => ({
                    date: day.date.toISOString().split('T')[0],
                    close: day.close,
                    adjClose: day.adjclose || day.close,
                    volume: day.volume || 0
                }));

        } catch (error) {
            if (type === 'STOCK_US') {
                logger.warn(`[getFullHistory] Falha ao buscar histórico de ${ticker} (STOCK_US): ${error.message}`);
            }
            return null;
        }
    },

    // Busca o histórico de proventos (dividendos/JCP) via Yahoo Finance.
    // Retorna [{ date: Date (ex-date), amount: number por cota }] ordenado por data.
    async getDividendsHistory(ticker, type) {
        // Cripto, renda fixa e caixa não pagam proventos.
        if (['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) return [];

        let symbol = ticker.trim().toUpperCase();
        // B3 (ações/FIIs) precisam do sufixo .SA; STOCK_US vai como está.
        if ((type === 'STOCK' || type === 'FII') && !symbol.endsWith('.SA') && /^[A-Z]{4}\d{1,2}$/.test(symbol)) {
            symbol = `${symbol}.SA`;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const result = await yahooFinance.chart(symbol, {
                period1: '2018-01-01',
                period2: today,
                interval: '1d',
                events: 'dividends',
            }, { validateResult: false });

            const divs = result?.events?.dividends || [];
            return divs
                .filter((d) => d && d.amount > 0 && d.date)
                .map((d) => ({ date: new Date(d.date), amount: d.amount }))
                .sort((a, b) => a.date - b.date);
        } catch (error) {
            logger.warn(`[Dividends] Falha ao buscar proventos de ${ticker}: ${error.message}`);
            return [];
        }
    },

    async getSplitsHistory(ticker, type) {
        return [];
    }
};
