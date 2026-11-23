// Passos de detectExDateDividends (provento PROVISÓRIO pelo gap do dia-ex).
// A data de PAGAMENTO nunca é tocada aqui (regra 11): só a data-ex e o valor
// derivado, sempre com `source: 'DERIVED'`.
import logger from '../../config/logger.js';
import DividendEvent from '../../models/DividendEvent.js';
import { historyStorageKey } from '../../utils/assetHistory.js';
import { loadLatestCloseBefore } from '../../utils/dayCloses.js';
import { deriveDividendFromGap } from '../../utils/dividendGap.js';
import { isAccumulatingBrEtf } from '../../config/brEtfList.js';
import { sessionDateKey } from './sessionDate.js';

const NEAR_DAYS_MS = 4 * 86400000;

const isProvider = (ev) => (ev.source || 'PROVIDER') === 'PROVIDER';

const gapParams = (c, prev, todayBr) => ({
    type: c.type,
    rawPrevClose: prev.close,
    adjustedPrevClose: c.adjusted,
    priceDate: todayBr,
    rawPrevCloseDate: prev.date,
    sessionVolume: c.volume,
});

/**
 * 1. Só cotações da sessão de HOJE. Um quote de ontem compararia o
 *    previousClose de anteontem com o candle da véspera — sem sentido.
 */
export const selectExDateCandidates = (normalize, quotes, assetMap, todayBr) => {
    const candidates = [];
    for (const quote of quotes || []) {
        const ticker = normalize(quote.ticker);
        const asset = assetMap.get(ticker);
        const adjusted = Number(quote.previousClose);
        if (!asset || !(adjusted > 0)) continue;
        // ETFs brasileiros curados são de acumulação: os rendimentos
        // ficam na cota e nunca podem virar crédito em DividendEvent.
        if (asset.type === 'ETF' && isAccumulatingBrEtf(ticker)) continue;
        if (sessionDateKey(quote.marketTime) !== todayBr) continue;
        candidates.push({ ticker, type: asset.type, adjusted, volume: quote.volume });
    }
    return candidates;
};

/**
 * 2. Passada barata: sem histórico de proventos. Na esmagadora maioria dos
 *    dias TODO gap é zero e a detecção sai aqui, sem tocar em DividendEvent —
 *    é o que mantém o custo no caminho quente irrisório.
 */
export const findGapHits = async (candidates, todayBr) => {
    const closes = await loadLatestCloseBefore(candidates, todayBr);
    const hits = [];
    for (const c of candidates) {
        const prev = closes.get(historyStorageKey(c.ticker, c.type));
        if (!prev) continue;
        if (deriveDividendFromGap(gapParams(c, prev, todayBr))) hits.push({ ...c, prev });
    }
    return hits;
};

const loadKnownEventsByTicker = async (tickers) => {
    const known = await DividendEvent.find({ ticker: { $in: tickers } })
        .select('ticker date amount source').sort({ date: -1 }).lean();
    const byTicker = new Map();
    for (const ev of known) {
        if (!byTicker.has(ev.ticker)) byTicker.set(ev.ticker, []);
        byTicker.get(ev.ticker).push(ev);
    }
    return byTicker;
};

const exDateUtcOf = (todayBr) => {
    const [ty, tm, td] = todayBr.split('-').map(Number);
    return new Date(Date.UTC(ty, tm - 1, td));
};

// Evento OFICIAL perto da data-ex derivada: a fonte já publicou (ou publicou
// com a data deslocada em 1-2 dias). Não inventar um segundo.
const hasOfficialNearby = (events, exDateUtc) => events.some((ev) => isProvider(ev)
    && Math.abs(new Date(ev.date).getTime() - exDateUtc.getTime()) <= NEAR_DAYS_MS);

const writeDerived = async (hit, exDateUtc, todayBr, derived) => {
    await DividendEvent.updateOne(
        { ticker: hit.ticker, date: exDateUtc, type: 'DIVIDEND' },
        {
            $set: { amount: derived.amount, source: 'DERIVED' },
            $setOnInsert: { ticker: hit.ticker, date: exDateUtc, type: 'DIVIDEND', currency: 'BRL' },
        },
        { upsert: true },
    );
    logger.info('[Dividends] Provento provisório detectado pelo gap do dia-ex', {
        ticker: hit.ticker,
        exDate: todayBr,
        amount: derived.amount,
        rawPrevClose: hit.prev.close,
        adjustedPrevClose: hit.adjusted,
    });
};

/**
 * 3. Só agora vale consultar o histórico, para (a) não pisar num evento
 *    oficial já publicado e (b) aplicar a trava de plausibilidade.
 */
export const writeDerivedDividends = async (hits, todayBr) => {
    const byTicker = await loadKnownEventsByTicker(hits.map((h) => h.ticker));
    const exDateUtc = exDateUtcOf(todayBr);
    let written = 0;
    for (const hit of hits) {
        const events = byTicker.get(hit.ticker) || [];
        if (hasOfficialNearby(events, exDateUtc)) continue;
        const knownAmounts = events.filter(isProvider).slice(0, 12).map((ev) => Number(ev.amount));
        const derived = deriveDividendFromGap({ ...gapParams(hit, hit.prev, todayBr), knownAmounts });
        if (!derived) continue;
        await writeDerived(hit, exDateUtc, todayBr, derived);
        written++;
    }
    return written;
};
