
import YahooFinance from 'yahoo-finance2';
import axios from 'axios';
import * as cheerio from 'cheerio'; // Necessário para o scraping
import logger from '../config/logger.js';
import { createCircuitBreaker, withRetry } from '../utils/resilience.js'; // (I4)
import { recordIngestionError } from './errorLogService.js';
import { measurePerformance } from '../utils/performanceMetrics.js';
import { trackSource, recordEscalation } from '../utils/sourceHealth.js';

// Instancia a classe com supressão de avisos
const yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey', 'ripHistorical']
});

// (I4) Circuit breakers por provedor. Quando um serviço cai, paramos de bater
// nele a cada ticker do lote (fast-fail) até o cooldown — acelera o batch e
// reduz pressão sobre o terceiro. Limiares mais altos no Google porque ele é
// chamado por-ticker (mais ruído tolerável antes de abrir).
// Cooldown do Yahoo bem mais longo que os demais: quando a Yahoo rate-limita o
// endpoint de crumb (datacenter IP), insistir a cada 30s só prolonga o bloqueio.
// 2min dá tempo de Yahoo "esfriar" e ainda recupera bem dentro da cadência dos crons.
const yahooBreaker = createCircuitBreaker({ name: 'yahoo', failureThreshold: 4, cooldownMs: 120_000 });

// Teto da chamada de câmbio. Curto de propósito: quem espera por ela é o
// macro-sync inteiro, e há duas fontes atrás na cadeia — desistir rápido e cair
// para a próxima vale mais que insistir numa resposta que já atrasou.
const CURRENCY_TIMEOUT_MS = 8000;
const googleBreaker = createCircuitBreaker({ name: 'google-finance', failureThreshold: 8, cooldownMs: 60_000 });
const brapiBreaker = createCircuitBreaker({ name: 'brapi', failureThreshold: 5, cooldownMs: 60_000 });
// Sinaliza UMA vez por processo o 429 de cota mensal esgotada da brapi. Sem isto o
// report só mostra "breaker aberto após N falhas" (opaco) e leva a diagnosticar
// tickers BR como "deslistados" quando o fallback está apenas sem cota do plano free.
let brapiQuotaWarned = false;
// Breaker dedicado a proventos: não reaproveita o `yahooBreaker` de cotações
// (chamado em lote, alta frequência) para que falhas de uma responsabilidade
// não abram o circuito da outra. Sem fallback de terceiro provedor — o Brapi
// não inclui o módulo `dividends` no plano de token atual do projeto.
const yahooDividendsBreaker = createCircuitBreaker({ name: 'yahoo-dividends', failureThreshold: 4, cooldownMs: 120_000 });

// Configuração para Scraping Google Finance
const GOOGLE_FINANCE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Ações com classe (ex.: BRK.B, BF.B) usam PONTO no ticker canônico (DB/S&P list),
// mas o Yahoo Finance exige HÍFEN (BRK-B). Sem essa conversão o Yahoo responde
// "No data found / delisted" e o ativo nunca recebe cotação/histórico/fundamentos.
const US_CLASS_DOT_RE = /^[A-Z]{1,4}\.[A-Z]$/;   // BRK.B, BF.B (não casa PETR4.SA)
const US_CLASS_DASH_RE = /^[A-Z]{1,4}-[A-Z]$/;   // BRK-B (não casa BTC-USD)
// Formato de ticker B3: raiz de 4 chars + 1-2 dígitos. A raiz normalmente é toda de
// letras (PETR4, HGLG11), MAS há exceções com dígito na raiz — notadamente B3SA3 (a
// própria B3). A regex antiga `^[A-Z]{4}\d{1,2}$` exigia 4 LETRAS e rejeitava B3SA3,
// que então não recebia sufixo .SA (Yahoo falhava) nem a bolsa :BVMF (Google ia p/
// :NASDAQ e voltava vazio) — a bolsa ficou 70 dias sem cotação por causa disso.
const B3_TICKER_RE = /^[A-Z][A-Z0-9]{3}\d{1,2}$/; // B3SA3, PETR4, HGLG11 (não casa BRK.B/BTC-USD/AAPL)
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

            // Lógica B3 — aceita TANTO o formato Yahoo (PETR4.SA) quanto o ticker cru
            // do banco (PETR4). Sem o segundo ramo, o ticker cru caía no ramo US e
            // recebia ':NASDAQ', fazendo o Google devolver página vazia: era a causa
            // de "Recuperados 0/N via Google/Brapi" quando o Yahoo estava fora — o
            // fallback de B3 nunca chegava à bolsa certa (:BVMF).
            if (ticker.endsWith('.SA')) {
                googleTicker = ticker.replace('.SA', '');
                exchange = ':BVMF';
            }
            else if (B3_TICKER_RE.test(ticker)) {
                googleTicker = ticker;
                exchange = ':BVMF';
            }
            // Lógica Crypto
            else if (ticker.endsWith('-USD')) {
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
            // Cookie de consentimento: sem ele o Google responde 302→página de consent
            // (0 byte) a partir de IP de datacenter — o fallback devolvia null p/ TUDO,
            // derrubava blue-chips como B3SA3 e abria o circuit breaker. Accept-Language
            // pt-BR ancora o formato de preço BR. maxRedirects segue o novo 302 para
            // /finance/beta/quote/. Timeout 6s tolera o hop extra + latência do datacenter.
            const response = await trackSource('google.finance', () => googleBreaker.exec(
                () => axios.get(url, {
                    headers: {
                        'User-Agent': GOOGLE_FINANCE_UA,
                        'Accept-Language': 'pt-BR,pt;q=0.9',
                        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+000',
                    },
                    timeout: 6000,
                    maxRedirects: 5,
                }),
            ), { isEmpty: (r) => !r?.data });

            const $ = cheerio.load(response.data);
            
            // Seletor da classe de preço (Isso muda periodicamente, precisa de manutenção)
            // .YMlKec.fxKbKc parou de existir; preço atual fica em .N6SYTe (container
            // único da cotação principal — confirmado verificando que não aparece em
            // tabelas de índices/sidebar, que reciclam o mesmo atributo jsname="Pdsbrc").
            let priceText = $('.N6SYTe').first().text();

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
        } catch {
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
            // validateStatus deixa o 404 "ticker não encontrado" RESOLVER em vez de
            // lançar: um ticker morto (EURP11, BDRX11…) é condição de DADO, não de
            // saúde do serviço. Sem isso, cada 404 vira recordFailure() e ≥5 tickers
            // mortos no lote ABREM o breaker, starvando os vivos que vêm depois
            // (BPAN4/CPLE5/JPSA3 ficavam presos inativos por meses). 429/5xx/timeout
            // ainda lançam → o breaker segue protegendo contra queda real da brapi.
            const response = await trackSource('brapi', () => brapiBreaker.exec(() => axios.get(url, {
                timeout: 4000,
                validateStatus: (s) => s === 200 || s === 404,
            })), { isEmpty: (r) => !(r?.data?.results?.length > 0) });
            
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
                    // Mesma datação da sessão do caminho principal (ver Yahoo).
                    marketTime: data.regularMarketTime || null,
                    previousClose: data.regularMarketPreviousClose || null,
                    // Volume p/ liquidez de ETFs B3 (.SA): o Yahoo costuma devolver 0 aqui.
                    volume: data.regularMarketVolume || 0,
                    name: data.longName || cleanTicker,
                    source: 'BRAPI_FALLBACK'
                };
            }
            return null;
        } catch (error) {
            // 429 = cota da brapi esgotada (plano free: 15k req/mês). É condição
            // operacional, não delisting: torna explícito no log (uma vez) para o
            // report apontar a causa real da indisponibilidade do fallback BR.
            if (error?.response?.status === 429 && !brapiQuotaWarned) {
                brapiQuotaWarned = true;
                const msg = error.response?.data?.message || 'limite de requisições atingido';
                logger.warn(`🔻 [brapi] HTTP 429 — cota do plano esgotada: ${msg} Fallback BR indisponível até o reset.`);
                // Também no painel de Saúde: a cota estourada derruba o ÚLTIMO elo do
                // fallback BR e só aparecia como uma linha de log, que ninguém relê.
                // Enquanto está esgotada, qualquer falha de Yahoo+Google vira ativo sem
                // preço sem que nada explique por quê.
                recordIngestionError('brapi', new Error(`Cota mensal esgotada: ${msg}`), 'BRAPI_QUOTA_EXHAUSTED');
            }
            return null;
        }
    },

    // Helper: Google Finance e, se for B3, Brapi como última tentativa. Usado tanto
    // na falha parcial (alguns tickers do lote) quanto na falha total do Yahoo.
    //
    // Cada passagem por aqui é uma ESCALADA: o Yahoo não trouxe o preço deste
    // ativo e a cadeia desceu um degrau. Registrar o caminho (quem foi tentado,
    // quem entregou) é o que permite ao painel responder "quais ativos chegaram
    // na Brapi?" — pergunta que a contagem de chamadas nunca responde, porque
    // ela não sabe de ticker: 24 falhas podem ser 24 ativos ou o mesmo ativo
    // morto tentado 24 vezes, e as duas coisas pedem ações opostas.
    async recoverQuote(ticker, { reason = 'O Yahoo não trouxe o preço deste ativo' } = {}) {
        // A principal entra na lista mesmo tendo falhado: sem o primeiro elo, o
        // caminho não diz de onde o ativo veio parar aqui.
        const tried = ['yahoo.quotes', 'google.finance'];
        // Ticker que SEMPRE falha no Yahoo não é notícia — marcá-lo separa o ruído
        // permanente da escalada nova, que é a que merece o olho.
        const expected = PREFER_GOOGLE_TICKERS.has(ticker);
        const registrar = (resolvedBy) => recordEscalation({
            chain: 'quotes', subject: ticker, tried, resolvedBy, reason, expected,
        });

        const googleData = await this.fetchFromGoogleFinance(ticker);
        if (googleData) {
            logger.info(`✅ [Fallback] Google Finance recuperou cotação para ${ticker}: ${googleData.price}`);
            registrar('google.finance');
            return googleData;
        }
        if (B3_TICKER_RE.test(ticker)) {
            tried.push('brapi');
            const brapiData = await this.fetchFromBrapi(ticker + '.SA');
            if (brapiData) {
                logger.info(`✅ [Fallback] Brapi recuperou cotação para ${ticker}: ${brapiData.price}`);
                registrar('brapi');
                return brapiData;
            }
        }
        // `null` em resolvedBy é o registro mais valioso do ledger: ativo que a
        // cadeia inteira não conseguiu precificar.
        registrar(null);
        return null;
    },

    // Busca Preço de Criptos e Stocks Internacionais em lote (Cotação Atual)
    async getQuotes(tickers) {
        if (!tickers || tickers.length === 0) return [];

        // Guarda defensiva: descarta tickers vazios/whitespace/não-string antes do
        // batch. Um doc com ticker '' vazava para o Yahoo e aparecia como falha
        // fantasma no log (ex.: "[... HOLX,, MMC ...]").
        tickers = tickers.filter(t => typeof t === 'string' && t.trim().length > 0);
        if (tickers.length === 0) return [];

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

            const isB3Format = B3_TICKER_RE.test(cleanT);
            if (isB3Format && !cleanT.endsWith('.SA')) return `${cleanT}.SA`;
            // Ação com classe (BRK.B) → formato do Yahoo (BRK-B).
            return toYahooSymbol(cleanT);
        });

        try {
            // TENTATIVA 1: YAHOO FINANCE (Principal)
            // validateResult: false suprime erros de schema para tickers com dados parciais (ex: BRK.B, BF.B)
            // (I4) 1 retry com backoff para falha transitória, sob circuit breaker.
            // Circuito aberto → lança e cai no catch (Protocolo de Emergência Google).
            // Sem retry em 429/crumb: é rate-limit de IP, repetir em 300ms não ajuda
            // e só soma mais uma tacada no endpoint já bloqueado.
            const results = await measurePerformance('external', 'YAHOO quote-batch', () => trackSource('yahoo.quotes', () =>
                yahooBreaker.exec(() => withRetry(
                    () => yahooFinance.quote(yahooTickers, {}, { validateResult: false }),
                    { retries: 1, baseDelayMs: 300, shouldRetry: (err) => !/429|crumb/i.test(err?.message || '') },
                ))));
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
                    // Instante do último negócio da SESSÃO regular. É o que permite
                    // datar a variação: sem ele, quem lê a cotação não distingue
                    // "fechou +1,19% hoje" de "fechou +1,19% ontem e ninguém abriu
                    // o mercado ainda". O provedor já mandava; nós descartávamos.
                    marketTime: item.regularMarketTime || null,
                    // Fechamento do dia anterior. Para AÇÃO é redundante com o
                    // change; para CRIPTO não é: ali o change do Yahoo são 24h
                    // CORRIDAS (janela deslizante), e só o previousClose define o
                    // "desde o fechamento de ontem" que o resto da carteira usa.
                    previousClose: item.regularMarketPreviousClose || null,
                    marketCap: item.marketCap || 0,
                    volume: item.regularMarketVolume || item.volume || 0,
                    name: item.longName || item.shortName || symbol,
                    source: 'YAHOO'
                };
            });

            // Verifica quais tickers falharam no Yahoo (não retornaram ou preço zero).
            // successTickers guarda a forma CANÔNICA (fromYahooSymbol: BRK-B→BRK.B), então
            // a entrada também é normalizada — senão um ticker de classe gravado com hífen
            // (BF-B) nunca casaria com "BF.B" e viraria falha-fantasma que aciona o Google
            // Finance à toa (a cotação do Yahoo já veio correta).
            const successTickers = new Set(mappedResults.filter(r => r.price > 0).map(r => r.ticker));
            const failedTickers = tickers.filter(t => !successTickers.has(fromYahooSymbol(t)));

            // TENTATIVA 2: GOOGLE FINANCE (Fallback para falhas)
            if (failedTickers.length > 0) {
                const unexpectedFails = failedTickers.filter(t => !PREFER_GOOGLE_TICKERS.has(t));
                if (unexpectedFails.length > 0) {
                    logger.debug(`[MarketService] Yahoo falhou para ${unexpectedFails.length} ativos: [${unexpectedFails.join(', ')}]. Tentando Google Finance Fallback...`);
                }

                // (MEM) Concorrência limitada: cada scrape carrega uma árvore cheerio
                // pesada. Promise.all sem teto mantinha todas em memória de uma vez.
                const fallbackRaw = await mapWithConcurrency(failedTickers, GOOGLE_FALLBACK_CONCURRENCY, (ticker) => this.recoverQuote(ticker));

                // O warn é do RESULTADO da cadeia, não da primeira tentativa. Avisar
                // logo que o Yahoo falhou fazia o report repetir todo run três linhas
                // de "Yahoo falhou..." que o Google/Brapi recuperavam segundos depois
                // (NGRD3, HSRE11, EA/AVB/EQR em 30/08/2026) — ruído que empurrava o
                // veredito para "SUCESSO COM AVISOS" sem nada a fazer a respeito.
                // (mapWithConcurrency preserva a ordem, então o índice casa o ticker.)
                const unrecovered = failedTickers.filter((t, i) => !fallbackRaw[i] && !PREFER_GOOGLE_TICKERS.has(t));
                if (unrecovered.length > 0) {
                    logger.warn(`⚠️ [MarketService] Sem cotação em nenhuma fonte (Yahoo/Google/Brapi) para ${unrecovered.length} ativos: [${unrecovered.join(', ')}]`);
                }

                const fallbackResults = fallbackRaw.filter(Boolean);
                return [...mappedResults, ...fallbackResults];
            }

            return mappedResults;

        } catch (error) {
            // "fetch failed" do undici embrulha a causa real (ENOTFOUND/ECONNRESET/
            // 429/crumb). Sem expor error.cause, o log do servidor não distingue
            // "rede caiu" de "Yahoo rate-limitou o IP do datacenter" — diagnóstico cego.
            const cause = error?.cause ? ` | causa: ${error.cause.code || error.cause.message || error.cause}` : '';
            logger.error(`❌ Erro Crítico Yahoo Finance (Batch): ${error.message}${cause}`);
            // Se o Yahoo caiu completamente, tenta Google (e Brapi p/ B3) um por um
            logger.warn("⚠️ Ativando Protocolo de Emergência: Fallback Total Google Finance.");

            // (MEM) Mesmo no modo de emergência usamos pool limitado em vez de varrer
            // o lote inteiro: protege o heap (árvores cheerio) quando o Yahoo cai e
            // TODOS os tickers caem no scraping de uma vez.
            const emergencyRaw = await mapWithConcurrency(tickers, GOOGLE_FALLBACK_CONCURRENCY, (t) => this.recoverQuote(t, { reason: 'O Yahoo caiu e o lote inteiro foi para a reserva' }));
            const emergencyResults = emergencyRaw.filter(Boolean);
            logger.info(`✅ [Emergência] Recuperados ${emergencyResults.length}/${tickers.length} ativos via Google/Brapi.`);
            return emergencyResults;
        }
    },

    // Busca índices globais para Dashboard (Snapshot Instantâneo)
    async getGlobalIndices() {
        try {
            const quotes = await measurePerformance('external', 'YAHOO global-indices', () => trackSource('yahoo.indices', () =>
                yahooFinance.quote(['^BVSP', '^GSPC', '^IXIC'])));
            const result = {};
            const find = (s) => (Array.isArray(quotes) ? quotes : [quotes]).find(q => q.symbol === s);
            
            const ibov = find('^BVSP');
            if (ibov) result.ibov = { value: ibov.regularMarketPrice, change: ibov.regularMarketChangePercent };
            
            const spx = find('^GSPC');
            if (spx) result.spx = { value: spx.regularMarketPrice, change: spx.regularMarketChangePercent };

            return result;
        } catch {
            return {};
        }
    },

    /**
     * USD/BRL e BTC/USD — fonte primária do bloco de moedas do macro desde
     * 05/09/2026 (a ordem da cadeia mora em `CURRENCY_SOURCES`, no macroDataService).
     *
     * Em cripto, `regularMarketChangePercent` são as últimas 24h CORRIDAS, não o
     * fechamento anterior; a segunda fonte da cadeia mede contra o fechamento.
     * Quem consome trata a diferença como aceitável — o alternativo é exibir o
     * câmbio de ontem como se fosse o de hoje, que foi o defeito de 04/09/2026.
     */
    async getCurrencyQuotes() {
        try {
            const quotes = await measurePerformance('external', 'YAHOO currencies', () => trackSource('yahoo.currencies', () => withRetry(
                () => yahooFinance.quote(['BRL=X', 'BTC-USD'], {}, {
                    validateResult: false,
                    // Sem teto explícito, a chamada pendurava até o timeout do
                    // socket: as execuções do macro-sync em 04/09/2026 iam de 3s
                    // para 21s quando esta falhava, e o resto da rotina esperava
                    // junto. 8s é folgado para uma resposta que normalmente leva ~1s.
                    fetchOptions: { signal: AbortSignal.timeout(CURRENCY_TIMEOUT_MS) },
                }),
                // Mesma política do lote de cotações: uma retentativa curta para
                // falha transitória, NENHUMA em 429/crumb — rate-limit de IP não
                // melhora em 300ms, e insistir só prolonga o bloqueio. Sem breaker
                // dedicado porque isto roda uma vez a cada 15 min: não há martelo
                // a interromper, e reaproveitar o `yahooBreaker` do lote deixaria
                // uma falha de câmbio abrir o circuito da sincronização inteira.
                { retries: 1, baseDelayMs: 300, shouldRetry: (err) => !/429|crumb/i.test(err?.message || '') },
            )));
            const list = Array.isArray(quotes) ? quotes : [quotes];
            const find = (s) => list.find(q => q.symbol === s);
            const result = {};

            const usd = find('BRL=X');
            if (usd?.regularMarketPrice > 0) {
                result.usd = { value: usd.regularMarketPrice, change: usd.regularMarketChangePercent || 0 };
            }

            const btc = find('BTC-USD');
            if (btc?.regularMarketPrice > 0) {
                result.btc = { value: btc.regularMarketPrice, change: btc.regularMarketChangePercent || 0 };
            }

            return result;
        } catch (error) {
            logger.warn(`⚠️ [Câmbio] Yahoo não devolveu moedas: ${error.message}`);
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

            const result = await measurePerformance('external', 'YAHOO chart-spx', () =>
                yahooFinance.chart('^GSPC', {
                    period1: period1,
                    period2: period2,
                    interval: '1d'
                }, { validateResult: false }));

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

            const result = await measurePerformance('external', 'YAHOO chart-ibov', () =>
                yahooFinance.chart('^BVSP', {
                    period1: period1,
                    period2: period2,
                    interval: '1d'
                }, { validateResult: false }));

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

    /**
     * Histórico diário COM as lacunas da fonte explicitadas.
     *
     * O Yahoo devolve uma linha por pregão do período pedido; quando não tem o
     * dado daquele dia, a linha vem com `close`/`open`/`adjclose`/`volume` TODOS
     * nulos em vez de simplesmente não existir. Não é hipótese: em 27/08/2026 os
     * 7 ETFs da B3 (BOVA11, IVVB11, BOVV11, DIVO11, ECOO11, GOLD11, LAFI11)
     * receberam a linha nula enquanto 1.234 séries de ações e FIIs vieram
     * normais — buraco do provedor, restrito a uma classe.
     *
     * `getFullHistory` descarta essas linhas, e está certo: candle sem preço não
     * é candle, e gravá-lo criaria um buraco que a mescla seguinte trataria como
     * preenchido. Mas o descarte apaga a diferença entre "a fonte publicou o dia
     * VAZIO" (não vem mais candle, é definitivo) e "a fonte ainda NÃO publicou o
     * dia" (chega mais tarde) — e é essa diferença que decide se o alarme de
     * candle em carteira é defeito nosso ou lacuna de terceiro. Quem precisa
     * DIAGNOSTICAR a ausência usa esta variante; o resto do sistema, que só quer
     * a série, segue no `getFullHistory`.
     *
     * @returns {Promise<{candles: Array, emptyDates: string[]}|null>} null = falha ou payload inválido
     */
    async getFullHistoryDetailed(ticker, type, throughDayStr = null) {
        let symbol = ticker.trim().toUpperCase();

        if (type === 'STOCK' || type === 'FII' || type === 'INDEX' || type === 'ETF') {
            // ETF cobre nacionais (BOVA11/IVVB11 → .SA) e internacionais (VOO/QQQ →
            // sem sufixo). O regex B3 garante o .SA só para o formato brasileiro.
            if (!symbol.startsWith('^') && !symbol.endsWith('.SA')) {
                if (B3_TICKER_RE.test(symbol)) {
                    symbol = `${symbol}.SA`;
                }
            }
        } else if (type === 'CRYPTO' && !symbol.includes('-')) {
            symbol = `${symbol}-USD`;
        } else if (type === 'STOCK_US') {
            // US stocks vão quase sem ajuste (AAPL, MSFT). Exceção: ações com classe
            // (BRK.B) precisam do hífen do Yahoo (BRK-B), senão "No data found".
            symbol = toYahooSymbol(symbol);
        }
        // For USD-BRL exchange rate history
        if (symbol === 'USD-BRL') {
            symbol = 'BRL=X';
        }

        try {
            // O Yahoo trata `period2` como limite EXCLUSIVO. Passar o próprio
            // dia desejado cortava justamente o candle que o chamador queria:
            // no worker das 18:30, `period2=hoje` terminava sempre em D-1. No
            // snapshot das 23:59 isso parecia funcionar por acidente porque o
            // servidor já estava no dia seguinte em UTC. A janela agora declara
            // explicitamente o último dia INCLUSIVO e avança uma data civil.
            const through = /^\d{4}-\d{2}-\d{2}$/.test(String(throughDayStr || ''))
                ? throughDayStr
                : new Date().toISOString().split('T')[0];
            const exclusiveEnd = new Date(`${through}T12:00:00.000Z`);
            exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

            const queryOptions = {
                period1: '2020-01-01',
                period2: exclusiveEnd.toISOString().split('T')[0],
                interval: '1d'
            };

            // validateResult:false silencia os avisos verbosos da lib quando o Yahoo
            // devolve meta incompleto (currency null / sem regularMarketPrice) — payload
            // de quotes ainda vem íntegro e já filtramos close>0 abaixo.
            const result = await measurePerformance('external', 'YAHOO chart-history', () => trackSource('yahoo.history', () =>
                yahooFinance.chart(symbol, queryOptions, { validateResult: false })));

            if (!result || !result.quotes || !Array.isArray(result.quotes)) return null;

            const candles = [];
            const emptyDates = [];
            for (const day of result.quotes) {
                if (!day?.date) continue;
                const date = day.date.toISOString().split('T')[0];
                // FORA DA JANELA PEDIDA NÃO ENTRA. O Yahoo respeita `period2` no
                // passado, mas devolve de carona o candle EM ANDAMENTO da sessão
                // viva — um preço de meio de pregão com data de fechamento. Quem
                // pedia a série "até D" recebia D+1 parcial e o gravava: em
                // 04/09/2026, às 10:25 e 11:25, as 17 séries da carteira ficaram
                // com o preço da manhã no lugar do fechamento do dia.
                //
                // O estrago não é cosmético e não se conserta sozinho:
                // `loadClosesForDay` lê candle existente COMO fechamento do dia,
                // então o snapshot das 23:59 marcaria o patrimônio pelo preço da
                // manhã, e a varredura de lacuna nunca voltaria lá — o dia não
                // está FALTANDO, está errado. A janela é contrato, e vale aqui
                // para todos os chamadores.
                if (date > through) continue;
                if (day.close > 0) {
                    candles.push({
                        date,
                        close: day.close,
                        adjClose: day.adjclose || day.close,
                        volume: day.volume || 0
                    });
                } else {
                    emptyDates.push(date);
                }
            }
            return { candles, emptyDates };

        } catch (error) {
            if (type === 'STOCK_US') {
                logger.warn(`[getFullHistory] Falha ao buscar histórico de ${ticker} (STOCK_US): ${error.message}`);
            }
            return null;
        }
    },

    // Busca Histórico Completo. Contrato inalterado (array de candles, ou null em
    // falha) — as lacunas da fonte ficam em `getFullHistoryDetailed`, para quem
    // precisa delas.
    async getFullHistory(ticker, type) {
        const detailed = await this.getFullHistoryDetailed(ticker, type);
        return detailed ? detailed.candles : null;
    },

    // Busca o histórico de proventos (dividendos/JCP) via Yahoo Finance.
    // Retorna [{ date: Date (ex-date), amount: number por cota }] ordenado por data.
    // (I4) Retry com backoff para falhas transitórias (rede/timeout) + circuit
    // breaker dedicado: depois de falhas consecutivas, fast-fail sem martelar o
    // Yahoo até o cooldown. Sem fallback de terceiro provedor — ver nota no topo
    // do arquivo (Brapi não inclui o módulo `dividends` no plano de token atual).
    async getDividendsHistory(ticker, type) {
        // Cripto, renda fixa e caixa não pagam proventos.
        if (['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) return [];

        let symbol = ticker.trim().toUpperCase();
        // B3 (ações/FIIs/ETFs nacionais) precisam do sufixo .SA; STOCK_US e ETFs
        // internacionais (sem formato B3) vão como está.
        if ((type === 'STOCK' || type === 'FII' || type === 'ETF') && !symbol.endsWith('.SA') && B3_TICKER_RE.test(symbol)) {
            symbol = `${symbol}.SA`;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const result = await measurePerformance('external', 'YAHOO chart-dividends', () =>
                yahooDividendsBreaker.exec(() => withRetry(
                    () => yahooFinance.chart(symbol, {
                        period1: '2018-01-01',
                        period2: today,
                        interval: '1d',
                        events: 'dividends',
                    }, { validateResult: false }),
                    {
                        retries: 2,
                        baseDelayMs: 300,
                        // "No data found"/"delisted": o ticker não existe no Yahoo —
                        // repetir não ajuda. Demais erros (timeout/rede) são tratados
                        // como transitórios e re-tentados.
                        shouldRetry: (err) => !/no data found|delisted/i.test(err?.message || ''),
                    },
                )));

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

    async getSplitsHistory(_ticker, _type) {
        return [];
    }
};
