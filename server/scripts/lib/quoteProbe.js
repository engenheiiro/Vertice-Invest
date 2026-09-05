/**
 * Probe AO VIVO de um ticker nas fontes gratuitas — base do diagnóstico e da
 * aposentadoria de papéis mortos.
 *
 * Por que existe: até ago/2026 a decisão "esse ticker morreu ou é lacuna de
 * fonte?" era tomada de memória (listas de corporate actions escritas à mão no
 * syncReporter). Memória envelhece: o set KNOWN_SOURCE_GAP de jul/2026 dizia que
 * BK/MMC/CTRA/FOLD/DAWN estavam vivos-mas-ausentes — BK/CTRA/FOLD/DAWN voltaram
 * sozinhos (era throttle) e MMC tinha trocado de ticker para MRSH. Nenhuma lista
 * estática acerta as duas coisas ao mesmo tempo.
 *
 * A regra aqui é medir, não lembrar: quote → chart → Google → busca por nome.
 * A busca por nome é o que separa "trocou de símbolo" (sucessor aparece) de
 * "saiu da bolsa" (nada aparece).
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import YahooFinance from 'yahoo-finance2';
import { cryptoYahooSymbol } from '../../config/cryptoList.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const US_CLASS_DOT_RE = /^[A-Z]{1,4}\.[A-Z]$/;
const toYahooSymbol = (s) => (US_CLASS_DOT_RE.test(s) ? s.replace('.', '-') : s);

const GOOGLE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Tipos negociados na B3 (sufixo .SA no Yahoo, :BVMF no Google). */
const isB3Type = (type) => type === 'STOCK' || type === 'FII' || type === 'ETF';

/**
 * Ticker do banco → símbolo do provedor, com o MESMO tradutor da produção.
 *
 * Cripto perguntava pelo ticker cru (`MATIC`, `BTC`), símbolo que não existe no
 * Yahoo. Nenhuma cripto teria preço no probe, e o veredito de TODAS seria "morto"
 * — uma varredura sem `--tickers` aposentaria o universo de cripto inteiro por um
 * defeito de tradução. Dava a resposta certa em MATIC e RNDR (que morreram mesmo)
 * pelo motivo errado, que é a pior forma de acertar.
 */
export const yahooSymbolFor = (ticker, type) => {
    if (isB3Type(type)) return `${ticker}.SA`;
    if (type === 'CRYPTO') return cryptoYahooSymbol(ticker) || `${ticker}-USD`;
    return toYahooSymbol(ticker);
};

async function probeGoogle(ticker, exchange) {
    try {
        const res = await axios.get(`https://www.google.com/finance/quote/${ticker}${exchange}`, {
            headers: {
                'User-Agent': GOOGLE_UA,
                'Accept-Language': 'pt-BR,pt;q=0.9',
                Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+000',
            },
            timeout: 8000,
            maxRedirects: 5,
        });
        const $ = cheerio.load(res.data);
        const txt = $('.N6SYTe').first().text() || $('[data-last-price]').attr('data-last-price') || '';
        if (!txt) return null;
        const clean = txt.replace(/[^\d.,]/g, '');
        let v;
        if (clean.includes(',') && !clean.includes('.')) v = parseFloat(clean.replace(',', '.'));
        else if (clean.includes('.') && clean.includes(',')) {
            v = clean.lastIndexOf(',') > clean.lastIndexOf('.')
                ? parseFloat(clean.replace(/\./g, '').replace(',', '.'))
                : parseFloat(clean.replace(/,/g, ''));
        } else v = parseFloat(clean);
        return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
        return null;
    }
}

/**
 * Idade máxima do último negócio DATADO para o papel contar como vivo.
 *
 * 10 dias não é número novo: é o mesmo `RETIRE_RECENT_CANDLE_DAYS` que a
 * aposentadoria automática já usa em `marketDataService` para dizer "candle
 * recente = papel vivo". Duas réguas diferentes para a mesma pergunta fariam o
 * script e o cron discordarem sobre o mesmo ticker.
 */
export const PROBE_FRESH_DAYS = 10;

/**
 * Lookback do candle. LARGO de propósito, e isso não contradiz a janela acima:
 * é ele que DATA a morte. Com 10 dias de lookback um papel extinto em agosto
 * volta "sem candle", indistinguível de provedor fora do ar; com 45, o probe
 * consegue dizer *quando* parou — e a régua de vida decide depois, com o número
 * na mão. Encurtar o que se OLHA joga fora exatamente a evidência que condena.
 */
const CHART_LOOKBACK_DAYS = 45;

const asDate = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Consulta as fontes na mesma ordem do sync (Yahoo quote → Yahoo chart → Google)
 * e ainda a busca por nome, que revela sucessor em troca de ticker.
 * @param {{ticker:string, type:string, name?:string}} asset
 */
export async function probeTicker(asset) {
    const bare = asset.ticker;
    const ySym = yahooSymbolFor(bare, asset.type);
    const out = {
        ticker: bare, type: asset.type, ySym,
        yQuote: null, yQuoteAt: null, yChart: null, chartMetaAt: null,
        google: null, googleEx: null, search: [],
    };

    try {
        const q = await yahooFinance.quote(ySym, {}, { validateResult: false });
        const p = q?.regularMarketPrice ?? q?.postMarketPrice ?? null;
        if (p > 0) {
            out.yQuote = p;
            out.yQuoteAt = asDate(q?.regularMarketTime);
        }
    } catch { /* ausência de resposta É o dado que interessa */ }

    if (!out.yQuote) {
        try {
            const c = await yahooFinance.chart(ySym, { period1: new Date(Date.now() - CHART_LOOKBACK_DAYS * 86400000), interval: '1d' });
            const last = [...(c?.quotes || [])].reverse().find((k) => k.close > 0);
            if (last) out.yChart = { close: last.close, date: asDate(last.date) };
            // O `meta` continua vindo mesmo com ZERO candles, e é a datação mais
            // direta que existe: para AVB, EQR e EA (mortos em 05/09/2026) ele
            // devolvia 14/08, 17/08 e 04/08 enquanto `quotes` vinha vazio. Sem
            // ler isto, "nenhum candle" e "provedor fora" ficam iguais.
            out.chartMetaAt = asDate(c?.meta?.regularMarketTime);
        } catch { /* idem */ }
    }

    if (!out.yQuote && !out.yChart) {
        // O fallback do sync fixa :NASDAQ para todo papel US; aqui varremos as
        // bolsas para não confundir "bolsa errada na URL" com "papel morto".
        const exchanges = isB3Type(asset.type) ? [':BVMF'] : [':NASDAQ', ':NYSE', ':NYSEAMERICAN'];
        for (const ex of exchanges) {
            const g = await probeGoogle(bare, ex);
            if (g) { out.google = g; out.googleEx = ex; break; }
        }
    }

    try {
        const term = asset.name && asset.name !== bare ? asset.name : bare;
        const s = await yahooFinance.search(term, { quotesCount: 6, newsCount: 0 }, { validateResult: false });
        out.search = (s?.quotes || [])
            .filter((q) => q.symbol)
            .map((q) => ({ symbol: q.symbol, name: q.shortname || q.longname || '', exch: q.exchDisp || '' }));
    } catch { /* idem */ }

    return out;
}

/** Preço encontrado em QUALQUER fonte. Não basta: ver `probeProvesTrading`. */
export const probeHasPrice = (p) => Boolean(p.yQuote || p.yChart || p.google);

/**
 * Último negócio que alguma fonte conseguiu DATAR — `null` quando nenhuma datou.
 *
 * A distinção entre `null` e "muito antigo" é a que sustenta todo o resto: o
 * scraping do Google não diz de que sessão é o preço, então dele nunca sai
 * condenação. Só o Yahoo data, e por três caminhos (a cotação, o `meta` do chart
 * e o próprio candle) — vale o mais recente dos três.
 */
export const probeLastTradeAt = (p) => {
    const candidatos = [p?.yQuoteAt, p?.chartMetaAt, p?.yChart?.date].filter(Boolean).map((d) => new Date(d));
    if (!candidatos.length) return null;
    return new Date(Math.max(...candidatos.map((d) => d.getTime())));
};

/** Dias desde o último negócio datado; `null` se nenhuma fonte datou. */
export const probeDaysSinceTrade = (p) => {
    const at = probeLastTradeAt(p);
    return at ? Math.floor((Date.now() - at.getTime()) / 86400000) : null;
};

/**
 * O preço encontrado PROVA que o papel negocia?
 *
 * Preço sozinho não prova: o `meta` do Yahoo devolve a última cotação conhecida
 * de um símbolo extinto por tempo indeterminado, e o Google faz o mesmo com a
 * página. Em 05/09/2026 essa confusão dava o veredito exatamente invertido —
 * AVB, EQR e EA tinham virado VMRK (fusão) ou fechado capital, e os três saíam
 * do probe como "✅ RECUPERA — falha transitória; reativa sozinho".
 *
 * Fail-safe para o lado de PRESERVAR: sem datação nenhuma, não há prova de morte,
 * e o papel fica. A baixa exige evidência positiva, não ausência dela.
 */
export const probeProvesTrading = (p, { freshDays = PROBE_FRESH_DAYS } = {}) => {
    if (!probeHasPrice(p)) return false;
    const idade = probeDaysSinceTrade(p);
    if (idade === null) return true; // ninguém datou → não dá para condenar
    return idade <= freshDays;
};

/**
 * Traduz o probe em veredito operacional.
 * RECOVERS = volta sozinho no próximo sync; o resto é candidato a aposentadoria.
 */
export function classifyProbe(asset, p, { freshDays = PROBE_FRESH_DAYS } = {}) {
    const idade = probeDaysSinceTrade(p);

    if (probeProvesTrading(p, { freshDays })) {
        const src = p.yQuote ? 'Yahoo quote' : p.yChart ? 'Yahoo chart' : `Google${p.googleEx}`;
        const quando = idade === null ? 'sem data de sessão' : `último negócio há ${idade}d`;
        return { code: 'RECOVERS', label: `✅ RECUPERA via ${src} — falha transitória; reativa sozinho (${quando})` };
    }

    if (probeHasPrice(p)) {
        // Tem preço, mas o preço é lembrança. O sucessor, quando a busca o
        // conhece, é a informação mais útil da linha — vai junto.
        const sugestao = p.search.length
            ? ` · busca por nome sugere: ${p.search.slice(0, 3).map((s) => `${s.symbol}(${s.exch})`).join(', ')}`
            : '';
        return {
            code: 'STALE_ECHO',
            label: `🔁 ECO — as fontes servem preço, mas o último negócio foi há ${idade}d (> ${freshDays}d)${sugestao}`,
        };
    }
    const exact = p.search.find(
        (s) => s.symbol.toUpperCase() === p.ySym.toUpperCase() || s.symbol.toUpperCase() === asset.ticker,
    );
    if (exact) {
        return { code: 'SEARCH_ONLY', label: `🔍 símbolo existe na busca (${exact.symbol} · ${exact.exch}) mas nenhuma fonte serve preço` };
    }
    if (p.search.length) {
        const top = p.search.slice(0, 3).map((s) => `${s.symbol}(${s.exch})`).join(', ');
        return { code: 'SUCCESSOR', label: `🔁 símbolo sumiu das fontes; busca por nome sugere: ${top}` };
    }
    return { code: 'DEAD', label: '⛔ MORTO — sem quote, sem chart, sem Google e sem resultado de busca' };
}
