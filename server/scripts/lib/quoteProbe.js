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

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const US_CLASS_DOT_RE = /^[A-Z]{1,4}\.[A-Z]$/;
const toYahooSymbol = (s) => (US_CLASS_DOT_RE.test(s) ? s.replace('.', '-') : s);

const GOOGLE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Tipos negociados na B3 (sufixo .SA no Yahoo, :BVMF no Google). */
const isB3Type = (type) => type === 'STOCK' || type === 'FII' || type === 'ETF';

export const yahooSymbolFor = (ticker, type) => (isB3Type(type) ? `${ticker}.SA` : toYahooSymbol(ticker));

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
 * Consulta as fontes na mesma ordem do sync (Yahoo quote → Yahoo chart → Google)
 * e ainda a busca por nome, que revela sucessor em troca de ticker.
 * @param {{ticker:string, type:string, name?:string}} asset
 */
export async function probeTicker(asset) {
    const bare = asset.ticker;
    const ySym = yahooSymbolFor(bare, asset.type);
    const out = { ticker: bare, type: asset.type, ySym, yQuote: null, yChart: null, google: null, googleEx: null, search: [] };

    try {
        const q = await yahooFinance.quote(ySym, {}, { validateResult: false });
        const p = q?.regularMarketPrice ?? q?.postMarketPrice ?? null;
        if (p > 0) out.yQuote = p;
    } catch { /* ausência de resposta É o dado que interessa */ }

    if (!out.yQuote) {
        try {
            const c = await yahooFinance.chart(ySym, { period1: new Date(Date.now() - 45 * 86400000), interval: '1d' });
            const last = [...(c?.quotes || [])].reverse().find((k) => k.close > 0);
            if (last) out.yChart = { close: last.close, date: last.date };
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

/** Preço encontrado em QUALQUER fonte — o único critério que impede aposentar. */
export const probeHasPrice = (p) => Boolean(p.yQuote || p.yChart || p.google);

/**
 * Traduz o probe em veredito operacional.
 * RECOVERS = volta sozinho no próximo sync; DEAD = candidato a aposentadoria.
 */
export function classifyProbe(asset, p) {
    if (probeHasPrice(p)) {
        const src = p.yQuote ? 'Yahoo quote' : p.yChart ? 'Yahoo chart' : `Google${p.googleEx}`;
        return { code: 'RECOVERS', label: `✅ RECUPERA via ${src} — falha transitória; reativa sozinho` };
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
