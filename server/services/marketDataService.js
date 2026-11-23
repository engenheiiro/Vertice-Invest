
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import FundamentalSnapshot from '../models/FundamentalSnapshot.js';
import { externalMarketService } from './externalMarketService.js';
import { reitSegmentPT } from '../utils/reitSegment.js';
import { summarizeTrackRecord } from '../utils/trackRecord.js';
// (M9) Janela de cache e fallback de Selic centralizados em financialConstants.
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { getTunablesSync } from './configService.js'; // (I13) tunables editáveis pelo admin
import { historyStorageKey, mergeCandleSeries } from '../utils/assetHistory.js';
import { brazilDateKey } from '../utils/dateUtils.js';
import { isBrBusinessDay } from '../utils/walletSnapshot.js';
import { loadLatestCloseBefore } from '../utils/dayCloses.js';
import { recordCacheAccess } from '../utils/performanceMetrics.js';
import {
    judgeQuote, contestsChange, resolveContestedChange,
    needsOwnAnchor, arbitrateStoredJump, applyStoredJumpArbitration,
} from '../utils/quoteSanity.js';
import { recordSuspectQuote } from '../utils/sourceHealth.js';
import { sessionDateKey } from './marketData/sessionDate.js';
import {
    needsNameHeal, healAssetName, respondFromCache, historyFallbackClose,
    fillPrimaryQuotes, loadFallbackHistories, fillHistoryFallbacks,
} from './marketData/priceLookup.js';
import { selectExDateCandidates, findGapHits, writeDerivedDividends } from './marketData/exDateDividends.js';
import {
    RETIRE_AFTER_INACTIVE_DAYS, RETIRE_RECENT_CANDLE_DAYS, daysSince,
    pastQuarantine, keepRegularMarket, dropStillTrading, retirementOps, logRetired,
} from './marketData/assetRetirement.js';

/** Hora cheia no relógio de Brasília, independente do fuso do processo. */
const brazilHour = (date = new Date()) => Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(date),
);

/** Abertura do pregão da B3 (BRT). Antes disso, volume zero é o estado normal do mundo. */
const B3_OPEN_HOUR_BRT = 10;

/**
 * VOLUME ZERO É PROVA DE PAPEL PARADO — OU SÓ DE PREGÃO QUE AINDA NÃO ABRIU?
 *
 * A mesma resposta da fonte (sessão datada, volume 0) significa duas coisas
 * opostas conforme a hora: às 06h de um dia útil ela vale para TODO papel da B3,
 * porque ninguém negociou nada ainda; às 18h ela vale só para o papel que passou
 * o pregão inteiro sem negócio — que é o sinal que `isNoTradeQuote` existe para
 * mostrar. Sem separar as duas, o log de um `npm run dev` de manhã abria com 14
 * ativos "sem negócio" (BOVA11, PETR4, ITSA4…) num alerta que não descreve
 * defeito nenhum, e o alerta que descreve some no meio.
 *
 * Dia sem pregão (fim de semana, feriado) cai no mesmo balde: a barra de
 * continuação do Yahoo data o dia, mas não houve sessão para negociar.
 *
 * E a sessão de um dia útil PASSADO também, enquanto nenhum pregão começou
 * depois dela: fora do pregão o endpoint de cotação ZERA `regularMarketVolume`
 * da última sessão. Medido em 22/11/2026 (domingo, depois do feriado de 20/11):
 * PETR4, MGLU3 e CMIG4 vieram datados de 19/11 com volume 0, enquanto o candle
 * do mesmo dia trazia 60 milhões de papéis negociados só em MGLU3 — e o sync de
 * domingo recusou ~450 ativos vivos e somou uma falha a cada um. Nessa janela o
 * vivo e o morto respondem igual; o volume só volta a separar os dois quando o
 * pregão seguinte abre.
 */
export const isExpectedNoTrade = (sessionKey, now = new Date()) => {
    if (!sessionKey) return false;
    if (!isBrBusinessDay(sessionKey)) return true;
    const todayKey = brazilDateKey(now);
    if (sessionKey === todayKey) return brazilHour(now) < B3_OPEN_HOUR_BRT;
    if (sessionKey > todayKey) return false;
    // Primeiro pregão depois da sessão datada. Se ainda não começou, não houve
    // como a fonte ter visto negócio novo — o zero não prova nada.
    const next = new Date(`${sessionKey}T12:00:00Z`);
    for (let i = 0; i < 15; i++) {
        next.setUTCDate(next.getUTCDate() + 1);
        const key = next.toISOString().slice(0, 10);
        if (!isBrBusinessDay(key)) continue;
        if (key > todayKey) return true;
        return key === todayKey && brazilHour(now) < B3_OPEN_HOUR_BRT;
    }
    return false;
};

const MAX_FAILURES_BEFORE_BLACKLIST = 10;
// (Robustez) Ativos grandes/líquidos ganham prazo extra antes da desativação
// automática: falha de cotação neles costuma ser problema de integração (provedor
// fora do ar, símbolo mudou), não delisting. Evita que uma janela de instabilidade
// do Yahoo derrube blue chips (PETR4, VALE3...) do ranking, como já ocorreu.
const LARGE_ASSET_MARKETCAP = 1_000_000_000; // R$ 1B
const LARGE_ASSET_LIQUIDITY = 1_000_000;     // R$ 1M/dia
// ...mas a proteção tem PRAZO. Sem teto ela era permanente, e um ativo que deixou
// de existir ficava ativo para sempre com o último preço congelado — a auditoria
// de ago/2026 achou 9 ativos grandes assim, entre eles NEOE3 e BK, parados de 26
// a 134 dias e ainda elegíveis para ranking. Instabilidade real de provedor dura
// dias (o caso B3SA3 que motivou a guarda); 45 dias distintos de falha não é mais
// lacuna de fonte, é ativo que sumiu. O sinal correto continua sendo o painel de
// Saúde, que acusa o congelamento antes deste teto ser atingido.
const LARGE_ASSET_FAILURE_CAP = 45;
// Quarentena e régua de candle recente da aposentadoria: ver
// marketData/assetRetirement.js (RETIRE_AFTER_INACTIVE_DAYS, RETIRE_RECENT_CANDLE_DAYS).
// "MORREU" E "NUNCA NEGOCIOU AQUI" TÊM A MESMA APARÊNCIA DEPOIS DO FATO.
//
// Zero negócio há meses descreve os dois: o fundo liquidado e o FII de oferta
// restrita que negocia 1 a 9 vezes por semestre sem estar morto (FTCE11 tem
// R$ 3,9 bi de patrimônio e um negócio em seis meses). Em 05/09/2026 o dono
// conferiu 26 desses a dedo, aposentou 7 com prova externa (informe, comunicado,
// falência) e manteve 19 justamente por isso — a automação não pode desfazer
// aquela triagem sozinha.
//
// A segunda evidência que faltava está na nossa própria série: quem MORREU teve
// mercado antes de parar; quem nunca teve mercado nunca o teve. Medido em
// 07/09/2026, nas 120 sessões até o último negócio de cada um — HGPO11
// (liquidado) 120/120, ITSA4 (vivo) 120/120, e todos os 18 de oferta restrita
// entre 1% e 18%. O corte de 50% cai no meio de um vão enorme.
//
// Janela curta demais não julga nada: AERO11 tem dois negócios no começo da
// série e 100% de um denominador de dois. Sem sessões suficientes, o papel sai
// do automático e vai para a triagem a dedo (`retireDeadTickers.js`), que mede
// o pregão da B3 em vez de inferir da nossa série.
const REGULAR_MARKET_WINDOW = 120;
const REGULAR_MARKET_MIN_SESSIONS = 60;
const REGULAR_MARKET_MIN_RATIO = 0.5;
// Single-flight por processo: uma tela com vários consumidores do mesmo ticker
// não dispara várias renovações enquanto o primeiro refresh ainda está em voo.
const interactiveRefreshes = new Map();

/** Uma data-chave de pregão bem formada ('YYYY-MM-DD'). */
const DAY_KEY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Idade, em dias, de uma data-chave de PREGÃO. Ao meio-dia UTC para o resultado
 * não depender do fuso de quem pergunta.
 */
const daysSinceDayKey = (dayKey) => (
    DAY_KEY_RE.test(String(dayKey || ''))
        ? daysSince(new Date(String(dayKey) + 'T12:00:00.000Z'))
        : null
);

/** Valor ausente/zerado vira `null` — a UI mostra vazio em vez de número inventado. */
const nullIfAbsent = (value) => (Number.isFinite(value) && value !== 0 ? value : null);

const FALLBACK_MACRO = {
    selic: { value: DEFAULT_SELIC_FALLBACK },
    cdi: { value: Math.max(0, DEFAULT_SELIC_FALLBACK - 0.10) },
    ipca: { value: 4.50 },
    riskFree: { value: DEFAULT_SELIC_FALLBACK },
    ntnbLong: { value: 6.30 },
    // Taxas têm fallback declarado (o scoring precisa de uma taxa livre de risco
    // para existir); PREÇO não tem — índice e moeda ficam nulos e a tela mostra
    // vazio, porque não há valor honesto a inventar para uma cotação.
    ibov: { value: null, change: 0 },
    usd: { value: null, change: 0 },
    spx: { value: null, change: 0 },
    btc: { value: null, change: 0 },
    ratesStale: true,
    ratesSources: { selic: 'fallback', ipca: 'fallback' },
    ratesUpdatedAt: null,
    currenciesStale: true,
    currenciesSources: null,
    currenciesUpdatedAt: null,
    lastUpdated: new Date()
};

// --- refreshQuotesBatch, em passos (mesma ordem de leitura, juízo e escrita) ---

// Quem entra na fila de cotação. Aposentado ou desativado fica fora, mesmo com
// force. Lia só `isActive`, apostando que os dois campos andam juntos — e eles
// não andam: em 04/09/2026 havia 12 ativos com isBlacklisted=true e
// isActive=true, e IGBR3/BLUT4 desciam Yahoo → Google → Brapi a cada 15 minutos
// para falhar nos três, para sempre. `isBlacklisted` é o estado TERMINAL: ele
// decide sozinho.
const selectTickersToRefresh = (cleanTickers, assetMap, force, threshold) => {
    const toUpdate = [];
    cleanTickers.forEach(ticker => {
        const asset = assetMap.get(ticker);
        if (asset && (asset.isBlacklisted || !asset.isActive)) return;
        if (force) {
            toUpdate.push(ticker);
        } else {
            const isStale = !asset || !asset.updatedAt || asset.updatedAt < threshold;
            if (isStale || !asset || asset.lastPrice === 0) {
                toUpdate.push(ticker);
            }
        }
    });
    return toUpdate;
};

// Cotação com preço que NÃO vale como pregão: eco do preço gravado (fonte sem
// data de sessão), sessão velha demais, ou sessão datada sem negócio. Nenhuma
// vira sucesso — o ativo segue envelhecendo, que é o correto. null = vale.
const rejectionOf = (service, quote, currentAsset) => {
    if (service.isEchoQuote(quote, currentAsset)) return 'echo';
    if (service.isStaleSessionQuote(quote)) return 'stale';
    if (service.isNoTradeQuote(quote)) return 'noTrade';
    return null;
};

// Julgamento de MAGNITUDE, depois dos de presença e idade. Roda contra o preço
// que AINDA está no banco (a gravação vem depois, no bulkWrite).
const judgeIncomingQuote = (quote, currentAsset, now) => judgeQuote({
    type: currentAsset?.type || null,
    price: quote.price,
    previousClose: quote.previousClose,
    change: quote.change,
    storedPrice: currentAsset?.lastPrice,
    storedPriceDate: currentAsset?.priceDate || null,
    storedPriceSource: currentAsset?.priceSource || null,
    now,
});

// STOCK_US/ETF: liquidez em VALOR (moeda/dia = volume × preço), consistente com
// a liquidez financeira dos ativos BR e com o sync de fundamentos US. Evita
// penalizar ativos caros de baixo giro de papéis no scoringEngine.
const applyMarketSizeFields = (payload, quote, currentAsset, newPrice) => {
    if (!(currentAsset && (currentAsset.type === 'CRYPTO' || currentAsset.type === 'STOCK_US' || currentAsset.type === 'ETF'))) return;
    if (quote.marketCap) payload.marketCap = quote.marketCap;
    if (quote.volume) {
        payload.liquidity = (currentAsset.type === 'STOCK_US' || currentAsset.type === 'ETF')
            ? quote.volume * newPrice
            : quote.volume;
    }
};

// Enriquece o nome real (Yahoo longName/shortName) quando o atual está vazio ou
// é o próprio ticker. Não sobrescreve um nome já bom (ex.: override curado).
const applyRealName = (payload, quote, ticker, currentAsset) => {
    const realName = (quote.name || '').trim();
    if (!realName || realName.toUpperCase() === ticker.toUpperCase()) return;
    const currentName = (currentAsset?.name || '').trim();
    if (!currentName || currentName.toUpperCase() === ticker.toUpperCase()) {
        payload.name = realName;
    }
};

const buildQuotePayload = (quote, ticker, currentAsset, now) => {
    const newPrice = quote.price;
    const payload = {
        lastPrice: newPrice,
        change: quote.change || 0,
        // Data da sessão anda SEMPRE junto do change: gravar um sem o outro é
        // como o cache volta a mentir sobre a idade do dado.
        priceDate: sessionDateKey(quote.marketTime),
        // QUEM trouxe este preço. `lastPrice` tem cinco escritores e até
        // 07/09/2026 nenhum assinava: RBRL11 passou o fim de semana valendo 58,45
        // — o preço do RBHG11 — e a apuração não tinha como nomear a fonte.
        priceSource: quote.source || 'YAHOO',
        previousClose: Number(quote.previousClose) > 0 ? Number(quote.previousClose) : 0,
        updatedAt: now,
        isActive: true,
        failCount: 0, // Reset do contador de falhas em caso de sucesso
        lastFailDate: null
    };
    applyMarketSizeFields(payload, quote, currentAsset, newPrice);
    applyRealName(payload, quote, ticker, currentAsset);
    return payload;
};

// Cotação com achado do juiz, com a referência ao payload. A âncora do nosso
// candle é buscada DEPOIS do laço (uma agregação por sessão, não uma consulta
// por cotação), e é ela que diz se o suspeito é o preço novo ou o guardado.
const toJudgedEntry = (ticker, quote, currentAsset, achados, payload) => ({
    ticker,
    type: currentAsset?.type || null,
    source: quote.source || null,
    sessionDate: payload.priceDate,
    price: quote.price,
    storedPrice: currentAsset?.lastPrice ?? null,
    achados,
    payload,
});

// Passada única pelas cotações: separa sucesso dos não-sucessos e monta as
// gravações. Suspeita de magnitude NÃO é falha: o preço é gravado do mesmo
// jeito (grupamento e desdobramento têm a assinatura de um erro de fonte), e
// só passa a aparecer NOMEADO no painel de Saúde. Variação contestada fica com
// o preço da fonte e tem o par (change, previousClose) reancorado depois.
const collectQuoteResults = (service, quotes, assetMap, now) => {
    const r = {
        operations: [], successfulTickers: new Set(),
        echoedTickers: [], staleTickers: [], noTradeTickers: [], julgados: [], contestados: [],
    };
    for (const quote of quotes) {
        const ticker = service.normalizeSymbol(quote.ticker);
        const currentAsset = assetMap.get(ticker);
        if (!(quote.price && quote.price > 0)) continue;

        const rejection = rejectionOf(service, quote, currentAsset);
        if (rejection === 'echo') {
            r.echoedTickers.push(ticker);
            continue;
        }
        if (rejection) {
            (rejection === 'stale' ? r.staleTickers : r.noTradeTickers).push(`${ticker}@${sessionDateKey(quote.marketTime)}`);
            continue;
        }
        r.successfulTickers.add(ticker);

        const achados = judgeIncomingQuote(quote, currentAsset, now);
        const updatePayload = buildQuotePayload(quote, ticker, currentAsset, now);
        if (achados.length > 0) {
            r.julgados.push(toJudgedEntry(ticker, quote, currentAsset, achados, updatePayload));
            if (contestsChange(achados)) r.contestados.push(r.julgados.at(-1));
        }
        r.operations.push({ updateOne: { filter: { ticker: ticker }, update: { $set: updatePayload } } });
    }
    return r;
};

// Uma agregação por SESSÃO (na prática, uma só): o candle anterior vem da mesma
// fonte que o snapshot diário usa para marcar patrimônio (`dayCloses.js`).
const loadOwnAnchors = async (precisamDeAncora) => {
    const porSessao = new Map();
    for (const c of precisamDeAncora) {
        if (!c.sessionDate) continue; // sem sessão não há "antes de"
        if (!porSessao.has(c.sessionDate)) porSessao.set(c.sessionDate, []);
        porSessao.get(c.sessionDate).push(c);
    }
    for (const [sessao, itens] of porSessao) {
        try {
            const closes = await loadLatestCloseBefore(itens, sessao);
            for (const item of itens) {
                const achado = closes.get(historyStorageKey(item.ticker, item.type));
                item.ownClose = achado?.close ?? null;
                item.ownCloseDate = achado?.date ?? null;
            }
        } catch (err) {
            // A âncora é um LUXO comparada à cotação: sem o candle, a variação
            // contestada cai em zero (o veredito seguro), o desempate não
            // acontece, e o lote inteiro de preços segue para o banco.
            logger.warn(`[MarketData] Sem âncora para reancorar variação (${sessao}): ${err.message}`);
        }
    }
};

// --- O NOSSO CANDLE COMO ÁRBITRO DO QUE A FONTE AFIRMOU ---
// O preço da fonte fica; o par variação/fechamento-anterior, não (XPIN11 estava
// gravado com +108% contra a nossa série parada em 62,04). A mesma âncora
// responde, no salto contra o banco, QUEM estava errado.
const anchorJudgedQuotes = async (julgados) => {
    const precisamDeAncora = julgados.filter((j) => needsOwnAnchor(j.achados));
    if (precisamDeAncora.length === 0) return;
    await loadOwnAnchors(precisamDeAncora);
    for (const j of precisamDeAncora) {
        const veredito = arbitrateStoredJump({ type: j.type, price: j.price, storedPrice: j.storedPrice, ownClose: j.ownClose });
        if (veredito) {
            j.achados = applyStoredJumpArbitration(j.achados, { verdict: veredito, ownClose: j.ownClose, ownCloseDate: j.ownCloseDate });
        }
    }
};

// O painel só é alimentado AGORA, com os achados já arbitrados: é a diferença
// entre "RBRL11 saltou 26%" e "o 58,45 guardado é que era do RBHG11".
const publishSuspects = (julgados) => julgados.map((j) => {
    recordSuspectQuote({ subject: j.ticker, type: j.type, source: j.source, price: j.price, findings: j.achados });
    return `${j.ticker} (${j.achados[0].detail})`;
});

const reanchorContested = (contestados) => {
    if (contestados.length === 0) return;
    for (const c of contestados) {
        const { change, previousClose } = resolveContestedChange({ price: c.price, ownClose: c.ownClose });
        c.payload.change = change;
        c.payload.previousClose = previousClose;
    }
    logger.warn(
        `🧭 [MarketData] ${contestados.length} variação(ões) reancorada(s) no nosso fechamento `
        + `(a fonte se contradisse): ${contestados.map((c) => `${c.ticker}→${c.payload.change.toFixed(2)}%`).join(', ')}`,
        { reanchored: contestados.map((c) => c.ticker) },
    );
};

// --- BLACKLIST DINÂMICA (DETECTAR FALHAS) ---
// Pedidos que NÃO voltaram com preço válido ganham failCount (regra única em
// buildQuoteFailureOps). "Sem negócio" fora do pregão é INCONCLUSIVO (ver
// isExpectedNoTrade): nada é gravado, mas também não conta falha — senão todo
// fim de semana e feriado somava uma falha a cada papel vivo da B3.
const failedQuoteAssets = (toUpdate, { successfulTickers, noTradeTickers }, assetMap, now) => {
    const inconclusiveTickers = new Set(
        noTradeTickers
            .filter((e) => isExpectedNoTrade(e.split('@')[1], now))
            .map((e) => e.split('@')[0]),
    );
    return toUpdate
        .filter(t => !successfulTickers.has(t) && !inconclusiveTickers.has(t))
        .map(t => assetMap.get(t));
};

// Sem negócio só é ALERTA num pregão que houve e já começou (isExpectedNoTrade).
// O resto — madrugada, feriado, fim de semana — vai para debug: auditável no
// arquivo, sem gastar a atenção de quem lê o terminal.
const logNoTradeQuotes = (noTradeTickers, now) => {
    if (noTradeTickers.length === 0) return;
    const esperados = noTradeTickers.filter((e) => isExpectedNoTrade(e.split('@')[1], now));
    const alertaveis = noTradeTickers.filter((e) => !isExpectedNoTrade(e.split('@')[1], now));
    if (alertaveis.length > 0) {
        logger.warn(
            `🈳 [MarketData] ${alertaveis.length} ativo(s) com sessão datada mas SEM negócio `
            + `(volume zero) — não gravada como preço: ${alertaveis.join(', ')}`,
            { noTrade: alertaveis },
        );
    }
    if (esperados.length > 0) {
        logger.debug(
            `🈳 [MarketData] ${esperados.length} ativo(s) sem negócio fora do pregão `
            + '(mercado fechado ou ainda não aberto) — nada gravado.',
            { noTradeExpected: esperados },
        );
    }
};

// Cada não-sucesso com nome próprio no log: eco (uma fonte RESPONDEU, com um
// número que não vale como pregão), sessão antiga (símbolo trocado se parece com
// isto), sem negócio, e suspeita — que não é falha: o preço FOI gravado.
const logQuoteAnomalies = ({ echoedTickers, staleTickers, noTradeTickers, suspectTickers, now }) => {
    if (echoedTickers.length > 0) {
        logger.warn(
            `🔁 [MarketData] ${echoedTickers.length} ativo(s) só ecoaram o preço já gravado (fonte sem data de sessão): ${echoedTickers.join(', ')}`,
            { echoed: echoedTickers },
        );
    }
    if (staleTickers.length > 0) {
        logger.warn(
            `🕰️ [MarketData] ${staleTickers.length} ativo(s) com cotação de sessão antiga (> ${RETIRE_RECENT_CANDLE_DAYS}d) — `
            + `não gravada como preço de hoje: ${staleTickers.join(', ')}`,
            { stale: staleTickers },
        );
    }
    logNoTradeQuotes(noTradeTickers, now);
    if (suspectTickers.length > 0) {
        logger.warn(
            `📈 [MarketData] ${suspectTickers.length} cotação(ões) fora da magnitude esperada `
            + `(gravadas; podem ser grupamento/desdobramento): ${suspectTickers.join(' | ')}`,
            { suspects: suspectTickers },
        );
    }
};

export const marketDataService = {
    normalizeSymbol(ticker) {
        if (!ticker) return '';
        return ticker.toUpperCase().trim().replace('.SA', '');
    },

    refreshQuoteInBackground(ticker) {
        const cleanTicker = this.normalizeSymbol(ticker);
        if (!cleanTicker) return Promise.resolve();
        const running = interactiveRefreshes.get(cleanTicker);
        if (running) return running;

        const refresh = this.refreshQuotesBatch([cleanTicker], true)
            .catch((error) => {
                logger.warn(`[MarketData] Refresh SWR falhou para ${cleanTicker}: ${error.message}`);
            })
            .finally(() => interactiveRefreshes.delete(cleanTicker));
        interactiveRefreshes.set(cleanTicker, refresh);
        return refresh;
    },

    async getMarketDataByTicker(ticker, { interactive = false } = {}) {
        try {
            const cleanTicker = this.normalizeSymbol(ticker);
            let asset = await MarketAsset.findOne({ ticker: cleanTicker });

            // Self-heal do nome: se o nome ainda for o próprio ticker (ações BR não
            // enriquecidas), busca o nome real no Yahoo via refresh e relê. Assim o
            // autofill de "Nome do Ativo" recebe o nome correto na hora.
            if (!interactive && needsNameHeal(asset, cleanTicker)) {
                asset = await healAssetName(this, cleanTicker, asset);
            }

            if (asset && asset.lastPrice > 0) return respondFromCache(this, asset, cleanTicker, interactive);

            const lastClose = await historyFallbackClose(cleanTicker, asset);
            if (interactive) this.refreshQuoteInBackground(cleanTicker);
            if (lastClose > 0) {
                recordCacheAccess('market-price', 'fallback');
                return {
                    price: lastClose,
                    change: 0,
                    name: ticker,
                    sector: 'Outros',
                    isFallback: true,
                    cacheStatus: 'STALE',
                    isStale: true,
                };
            }

            recordCacheAccess('market-price', 'miss');
            return { price: 0, change: 0, name: ticker, sector: 'Outros', cacheStatus: 'MISS', isStale: true };
        } catch {
            recordCacheAccess('market-price', 'error');
            return { price: 0, change: 0, name: ticker, sector: 'Outros' };
        }
    },

    /**
     * (5.8) Versão em LOTE de getMarketDataByTicker — resolve N tickers com no
     * máximo 2 queries (1 em MarketAsset + 1 fallback em AssetHistory para os que
     * não têm lastPrice), em vez do padrão N+1 (1 findOne por ativo). Cada ticker
     * resolve de forma independente: um ticker sem dado vira `{ price: 0, ... }`
     * e NUNCA derruba os demais ("cada uma por si" — 5.3).
     *
     * A chave do Map devolvido é o ticker ORIGINAL passado pelo chamador (para que
     * `map.get(asset.ticker)` funcione direto), enquanto a query usa o símbolo
     * normalizado. Não faz o self-heal de nome por item (caro, N requests) — isso
     * fica a cargo do refreshQuotesBatch já disparado antes do read.
     */
    async getMarketDataMap(tickers) {
        const map = new Map();
        if (!tickers || tickers.length === 0) return map;

        const pairs = tickers.map(t => ({ original: t, clean: this.normalizeSymbol(t) }));
        const cleanList = [...new Set(pairs.map(p => p.clean).filter(Boolean))];
        if (cleanList.length === 0) return map;

        try {
            const assets = await MarketAsset.find({ ticker: { $in: cleanList } })
                .select('ticker name sector type currency allocationClass lastPrice change priceDate previousClose dy');
            const byTicker = new Map(assets.map(a => [a.ticker, a]));
            const { primaryHits, missingKeys } = fillPrimaryQuotes(map, pairs, byTicker);
            const histByTicker = await loadFallbackHistories(missingKeys);
            const { fallbackHits, misses } = fillHistoryFallbacks(map, pairs, byTicker, histByTicker);
            recordCacheAccess('market-price', 'hit', primaryHits);
            recordCacheAccess('market-price', 'fallback', fallbackHits);
            recordCacheAccess('market-price', 'miss', misses);
        } catch (error) {
            recordCacheAccess('market-price', 'error', cleanList.length);
            logger.warn(`[MarketData] getMarketDataMap falhou: ${error.message}`);
            // Garante chave para todo ticker pedido mesmo em falha total de DB.
            for (const { original } of pairs) {
                if (!map.has(original)) map.set(original, { price: 0, change: 0, name: original, sector: 'Outros' });
            }
        }

        return map;
    },

    /**
     * Refresh sob demanda de fundamentos (dy/lastPrice) de tickers específicos
     * — usado pelo self-heal do Cofre de Dividendos quando a projeção está zerada
     * por falta de `dy`. Faz 1 request ao Fundamentus (mapa completo) e atualiza
     * só os tickers pedidos. Import dinâmico evita ciclo de dependência.
     */
    async refreshFundamentals(tickers) {
        if (!tickers || tickers.length === 0) return;
        const clean = [...new Set(tickers.map(t => this.normalizeSymbol(t)))];
        try {
            const { fundamentusService } = await import('./fundamentusService.js');
            const [stocksMap, fiiMap] = await Promise.all([
                fundamentusService.getStocksMap().catch(() => new Map()),
                fundamentusService.getFIIsMap().catch(() => new Map()),
            ]);
            const operations = [];
            for (const ticker of clean) {
                const data = stocksMap.get(ticker) || fiiMap.get(ticker);
                if (!data) continue;
                const set = { updatedAt: new Date() };
                if (Number(data.dy) >= 0) set.dy = Number(data.dy) || 0;
                // Sem `priceDate` junto, de propósito: o scraping não diz de que
                // sessão é o preço. A assinatura é o que permite ao juiz saber que
                // o par (preço, data) do banco veio de duas escritas diferentes.
                if (Number(data.price) > 0) {
                    set.lastPrice = Number(data.price);
                    set.priceSource = 'FUNDAMENTUS';
                }
                operations.push({ updateOne: { filter: { ticker }, update: { $set: set } } });
            }
            if (operations.length > 0) await MarketAsset.bulkWrite(operations);
            logger.info(`[Fundamentals] Refresh sob demanda: ${operations.length}/${clean.length} tickers.`);
        } catch (e) {
            logger.warn(`[Fundamentals] Refresh sob demanda falhou: ${e.message}`);
        }
    },

    /**
     * A COTAÇÃO PROVA QUE O PAPEL NEGOCIOU, OU SÓ REPETE O QUE JÁ SABÍAMOS?
     *
     * O scraping do Google Finance serve o último preço conhecido por tempo
     * indeterminado e não diz de que sessão ele é. Enquanto o papel negocia isso
     * é irrelevante — o número muda todo dia e o eco não existe. Quando o papel
     * morre, o mesmo scraping vira máquina de ressurreição: a gravação de sucesso
     * zera `failCount`, remarca `isActive` e empurra `updatedAt` para agora, e as
     * três juntas reiniciam TODOS os relógios que existem para dar baixa em
     * símbolo extinto (10 falhas → desativa, 45 → vence a proteção de porte,
     * 90 dias parado → aposenta).
     *
     * Medido em 05/09/2026: AVB e EQR viraram VMRK numa fusão e EA fechou capital.
     * EA e EQR, que o Google não pega, acumulavam falha e sairiam sozinhos em
     * outubro. AVB estava com `failCount: 0` e `updatedAt` de hoje servindo
     * US$ 184,06 de 14/08 ao ranking — imortal exatamente porque o socorro
     * funcionava.
     *
     * Sem carimbo de sessão, o único sinal honesto que sobra é o MOVIMENTO: preço
     * diferente do guardado é negócio novo; preço idêntico não prova nada. A régua
     * é frouxa de propósito para o lado seguro — papel vivo que feche duas sessões
     * no mesmo centavo perde um dia de contagem e o recupera no primeiro tique
     * seguinte, enquanto o morto repete o mesmo número para sempre. É o que mantém
     * B3SA3 (que só cota pelo Google e negocia ~28 mil vezes por dia) fora da baixa.
     *
     * Vale só para fonte SEM `marketTime`: Yahoo e Brapi datam a sessão, e ali quem
     * responde pela idade do dado é `priceDate`.
     */
    isEchoQuote(quote, currentAsset) {
        if (!quote || quote.marketTime) return false;
        const stored = Number(currentAsset?.lastPrice);
        if (!(stored > 0)) return false; // sem base de comparação: é dado novo
        return Number(quote.price) === stored;
    },

    /**
     * A COTAÇÃO É DE UMA SESSÃO VELHA DEMAIS PARA VALER COMO PREÇO DE HOJE?
     *
     * Irmã do `isEchoQuote`, para o caso em que a fonte DATA a resposta. Aí não há
     * eco a detectar: o provedor diz, com todas as letras, de que sessão é aquele
     * número — e nós gravávamos assim mesmo, com `updatedAt` de agora e
     * `failCount` zerado, como se fosse do pregão de hoje.
     *
     * O levantamento de 05/09/2026 achou 18 ativos ATIVOS nessa condição, com
     * sessões de 10 a 1.635 dias atrás. `priceDate` já expunha todos desde
     * 01/09; ninguém lia o campo para este fim.
     *
     * 10 dias é a mesma régua de `RETIRE_RECENT_CANDLE_DAYS` (aposentadoria
     * automática) e de `PROBE_FRESH_DAYS` (probe de baixa) — três lugares
     * respondendo "esse papel ainda negocia?" com números diferentes seria a
     * receita para eles discordarem sobre o mesmo ticker. A folga cobre feriado
     * prolongado da B3 e papel de baixa liquidez que passa alguns pregões sem
     * negócio; não cobre símbolo trocado, que é o que se quer pegar.
     */
    isStaleSessionQuote(quote) {
        if (!quote?.marketTime) return false; // sem data, quem responde é isEchoQuote
        const t = new Date(quote.marketTime).getTime();
        if (Number.isNaN(t)) return false;
        return (Date.now() - t) / 86400000 > RETIRE_RECENT_CANDLE_DAYS;
    },

    /**
     * A FONTE DATOU A SESSÃO — MAS ALGUÉM NEGOCIOU NELA?
     *
     * Terceira irmã de `isEchoQuote` e `isStaleSessionQuote`, e a que fecha o
     * buraco que as duas deixavam aberto: a fonte RESPONDE, DATA a resposta com
     * a sessão da véspera, e mesmo assim não está falando de pregão nenhum.
     *
     * Levantamento de 07/09/2026: 19 ativos ATIVOS, todos com `failCount: 0` e
     * `updatedAt` de minutos atrás, sem um único negócio há 30 dias ou mais —
     * AERO11 parou em 28/01 e seguia sendo cotado sete meses depois. O Yahoo
     * publica a barra do símbolo extinto com `regularMarketVolume: 0` a cada
     * pregão, às vezes com variação inventada em cima (BIPD11 chegou com +1,4%
     * sem negociar desde março) e às vezes com preço diferente do que está
     * gravado (SPMO11). Ou seja: nem a data, nem o movimento, nem a comparação
     * com o banco separam o vivo do morto aqui. O volume separa.
     *
     * Zero é o único valor que acusa. Volume AUSENTE é "não sei" — o Google não
     * publica o campo — e "não sei" não pode matar papel vivo. Medido contra 45
     * papéis da B3 que negociaram na última sessão: zero falsos positivos; nas
     * outras classes (cripto, EUA, ETF) o volume vem sempre.
     *
     * Consequência, junto com as irmãs: o papel não vira sucesso, envelhece
     * 1 falha/dia e sai pela porta de sempre (10 falhas → inativo; 90 dias sem
     * pregão → aposentadoria). Papel vivo que passe um pregão sem negócio perde
     * um dia de contagem e o recupera no primeiro negócio seguinte — a mesma
     * frouxidão deliberada do `isEchoQuote`, pelo mesmo motivo.
     */
    isNoTradeQuote(quote) {
        if (!quote?.marketTime) return false; // sem data, quem responde é isEchoQuote
        return quote.volume === 0;
    },

    // Regra ÚNICA da blacklist dinâmica por falha de cotação. Recebe os docs de
    // ativos (com failCount/lastFailDate/marketCap/liquidity) e o conjunto de
    // tickers que cotaram com sucesso; devolve os bulkOps de failCount/desativação.
    // Gate de 1 falha/dia (lastFailDate) + proteção de blue chips (ativos grandes/
    // líquidos seguem contando falhas para alerta, mas nunca são desativados).
    // Reusada pelo refreshQuotesBatch (BR) e pelo path Exterior/Cripto do syncService.
    buildQuoteFailureOps(assets, successfulTickers) {
        const ops = [];
        // Dia de Brasília, não UTC: com a data UTC o dia virava às 21:00 BRT, e uma
        // instabilidade de 20:45 a 21:15 contava como duas das falhas que desativam.
        const todayKey = brazilDateKey();
        for (const asset of assets) {
            if (!asset || successfulTickers.has(asset.ticker)) continue;
            const lastFailKey = asset.lastFailDate ? brazilDateKey(new Date(asset.lastFailDate)) : null;
            if (lastFailKey === todayKey) continue; // já contabilizou falha hoje
            const currentFail = Number.isFinite(asset.failCount) ? asset.failCount : 0;
            const newFailCount = Math.min(currentFail + 1, 999);
            const isLargeAsset = (asset.marketCap || 0) >= LARGE_ASSET_MARKETCAP || (asset.liquidity || 0) >= LARGE_ASSET_LIQUIDITY;
            // A proteção de porte adia a desativação, não a cancela.
            const protectedBySize = isLargeAsset && newFailCount < LARGE_ASSET_FAILURE_CAP;
            const shouldDeactivate = newFailCount >= MAX_FAILURES_BEFORE_BLACKLIST && !protectedBySize;
            const updatePayload = { failCount: newFailCount, lastFailDate: new Date() };
            if (shouldDeactivate) updatePayload.isActive = false;
            ops.push({ updateOne: { filter: { ticker: asset.ticker }, update: { $set: updatePayload } } });
        }
        return ops;
    },

    /**
     * Registra proventos PROVISÓRIOS detectados pelo gap do dia-ex.
     *
     * Roda no sync de cotações porque o sinal só existe DURANTE a sessão do
     * dia-ex: o `previousClose` da cotação vem ajustado pelo provento enquanto
     * o nosso candle da véspera continua bruto. Na sessão seguinte os dois já
     * concordam e o gap some para sempre — perder a janela é perder o dado.
     * Por isso o gancho fica no caminho quente (toda atualização de cotação é
     * uma nova chance de capturar) e não num cron, que erraria o dia se falhasse.
     *
     * Nunca derruba o sync de cotações: qualquer falha aqui é logada e engolida.
     *
     * @returns {Promise<number>} eventos provisórios gravados
     */
    async detectExDateDividends(quotes, assetMap) {
        try {
            const todayBr = brazilDateKey(new Date());
            const candidates = selectExDateCandidates((t) => this.normalizeSymbol(t), quotes, assetMap, todayBr);
            if (candidates.length === 0) return 0;
            const hits = await findGapHits(candidates, todayBr);
            if (hits.length === 0) return 0;
            return await writeDerivedDividends(hits, todayBr);
        } catch (error) {
            logger.warn(`[Dividends] Detecção de provento por gap falhou: ${error.message}`);
            return 0;
        }
    },

    async refreshQuotesBatch(tickers, force = false) {
        if (!tickers || tickers.length === 0) return;

        const cleanTickers = [...new Set(tickers.map(t => this.normalizeSymbol(t)))];
        const now = new Date();
        // (I13) Janela de cache editável em runtime (fallback p/ default do M9).
        const cacheMinutes = getTunablesSync().marketCacheMinutes;
        const threshold = new Date(now.getTime() - cacheMinutes * 60 * 1000);

        try {
            // `priceDate` entra no select por causa do juiz de magnitude: comparar
            // o preço novo com o guardado só faz sentido sabendo de que sessão o
            // guardado é (ver STORED_PRICE_MAX_AGE_DAYS em utils/quoteSanity).
            const dbAssets = await MarketAsset.find({ ticker: { $in: cleanTickers } }).select('ticker name type updatedAt lastPrice priceDate priceSource change isActive isBlacklisted failCount lastFailDate marketCap liquidity');
            const assetMap = new Map();
            dbAssets.forEach(a => assetMap.set(a.ticker, a));

            const toUpdate = selectTickersToRefresh(cleanTickers, assetMap, force, threshold);
            if (toUpdate.length === 0) return;

            // O tipo vai junto: sem ele, sigla disputada (STX é Stacks na cripto e
            // Seagate na NASDAQ) faz o provedor responder sobre outro ativo.
            const quotes = await externalMarketService.getQuotes(toUpdate, {
                typeByTicker: new Map([...assetMap].map(([t, a]) => [t, a?.type || null])),
            });

            const results = collectQuoteResults(this, quotes, assetMap, now);
            await anchorJudgedQuotes(results.julgados);
            const suspectTickers = publishSuspects(results.julgados);
            reanchorContested(results.contestados);
            const failedAssets = failedQuoteAssets(toUpdate, results, assetMap, now);
            results.operations.push(...this.buildQuoteFailureOps(failedAssets, results.successfulTickers));
            logQuoteAnomalies({ ...results, suspectTickers, now });

            if (results.operations.length > 0) {
                await MarketAsset.bulkWrite(results.operations);
            }

            // Provento do dia-ex: só detectável DURANTE a sessão em que o gap
            // existe. Depois do bulkWrite para não atrasar a gravação da cotação.
            // Cotação com variação contestada fica de FORA: o sinal de provento é
            // a distância entre o `previousClose` da fonte e o nosso candle bruto,
            // e é esse `previousClose` que acabou de ser desqualificado (com
            // XPIN11 o gap viraria um "provento" de R$ 32,22 por cota).
            const contestadoSet = new Set(results.contestados.map((c) => c.ticker));
            await this.detectExDateDividends(
                contestadoSet.size > 0
                    ? quotes.filter((q) => !contestadoSet.has(this.normalizeSymbol(q.ticker)))
                    : quotes,
                assetMap,
            );

        } catch (error) {
            logger.error(`❌ [MarketData] Falha: ${error.message}`);
        }
    },

    /**
     * Série guardada de um ticker, re-buscada quando o cache passa de 12h.
     *
     * O nome mente por herança: nasceu para o `^BVSP` do beta, mas hoje é o
     * carregador de série de `financialService._loadPriceCacheMap` (TODO ticker em
     * carteira, no rebuild) e do motor da Carteira Recomendada. Quem mexer aqui
     * está mexendo no patrimônio.
     *
     * GRAVA MESCLANDO, e nunca por substituição. Até 06/09/2026 esta era a ÚLTIMA
     * escrita de `AssetHistory` do sistema que fazia `historyEntry.history = o que
     * a fonte devolveu`; todas as outras já passavam por `mergeCandleSeries` (o
     * worker, o caminho da carteira, o reparo de cripto). E a substituição é
     * exatamente o que transforma uma degradação passageira da fonte em perda
     * permanente: em 22/08/2026 o Yahoo passou a devolver UM candle para o HSRE11
     * e os 623 guardados foram embora.
     *
     * O dano aqui seria pior que naquele caso, porque este é o caminho do rebuild:
     * `_loadPriceCacheMap` exige que a série alcance o primeiro dia da posição, e
     * série encurtada faz o rebuild marcar TODO o período anterior pelo preço de
     * compra — TWRR e Sharpe falsos, sem erro nenhum na tela.
     *
     * Sem teto de pontos (`maxPoints: Infinity`) de propósito: o cap de 400 do
     * worker existe para o universo de pesquisa, e aplicá-lo aqui encurtaria
     * justamente a profundidade de que o rebuild depende — hoje 1.664 candles
     * desde 02/01/2020 nos tickers em carteira, que é o piso do `period1` de
     * `getFullHistory`. O `type` entra pelo filtro de dia sem pregão: esta escrita
     * não tinha barreira nenhuma contra candle de sábado, e candle em dia sem
     * pregão congela a série inteira — `isHistoryStale` só olha a data do último.
     */
    async getBenchmarkHistory(ticker = '^BVSP', type = 'INDEX') {
        let historyEntry = null;
        try {
            const cleanTicker = this.normalizeSymbol(ticker);
            const normalizedType = String(type || 'INDEX').trim().toUpperCase();
            const storageKey = historyStorageKey(cleanTicker, normalizedType);
            historyEntry = await AssetHistory.findOne({ ticker: storageKey });
            const now = new Date();
            const cacheLimit = new Date(now.getTime() - 12 * 60 * 60 * 1000);

            if (!historyEntry || historyEntry.lastUpdated < cacheLimit) {
                let externalHistory = null;
                try {
                    externalHistory = await externalMarketService.getFullHistory(cleanTicker, normalizedType);
                } catch (error) {
                    logger.warn(`[MarketData] Histórico externo indisponível para ${storageKey}; usando cache stale: ${error.message}`);
                }
                
                if (externalHistory && externalHistory.length > 0) {
                    if (historyEntry) {
                        historyEntry.history = mergeCandleSeries(
                            historyEntry.history, externalHistory,
                            { maxPoints: Infinity, type: normalizedType, now },
                        );
                        historyEntry.lastUpdated = now;
                        await historyEntry.save();
                    } else {
                        historyEntry = await AssetHistory.create({
                            ticker: storageKey,
                            // Série nova não tem o que perder, mas tem o que recusar:
                            // o filtro de dia sem pregão vale nos dois caminhos.
                            history: mergeCandleSeries(
                                [], externalHistory,
                                { maxPoints: Infinity, type: normalizedType, now },
                            ),
                            lastUpdated: now
                        });
                    }
                }
            }
            return historyEntry ? historyEntry.history : null;
        } catch {
            return historyEntry?.history || null;
        }
    },

    async getPriceAtDate(ticker, dateStr, type) {
        const cleanTicker = this.normalizeSymbol(ticker);
        const normalizedType = String(type || 'INDEX').trim().toUpperCase();
        const storageKey = historyStorageKey(cleanTicker, normalizedType);
        try {
            let historyEntry = await AssetHistory.findOne({ ticker: storageKey });
            if (!historyEntry) {
                const externalHistory = await externalMarketService.getFullHistory(cleanTicker, normalizedType);
                if (externalHistory && externalHistory.length > 0) {
                    historyEntry = await AssetHistory.create({
                        ticker: storageKey,
                        history: externalHistory,
                        lastUpdated: new Date()
                    });
                } else {
                    return null;
                }
            }
            const dayData = historyEntry.history.find(h => h.date === dateStr);
            if (dayData && dayData.close > 0) {
                return {
                    price: dayData.close,
                    adjustedPrice: dayData.adjClose,
                    source: 'history_cache'
                };
            }
            const targetDate = new Date(dateStr);
            const sortedHistory = [...historyEntry.history].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const closest = sortedHistory.find(h => new Date(h.date) <= targetDate);
            if (closest && closest.close > 0) {
                return {
                    price: closest.close,
                    adjustedPrice: closest.adjClose,
                    source: 'history_approx',
                    foundDate: closest.date
                };
            }
            return null;
        } catch {
            return null;
        }
    },

    async getMacroIndicators() {
        try {
            const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            if (config) {
                return {
                    selic: { value: config.selic },
                    cdi: { value: config.cdi },
                    ipca: { value: config.ipca },
                    riskFree: { value: config.riskFree },
                    ntnbLong: { value: config.ntnbLong },
                    // Sem número inventado: `null` = "não temos o valor", e quem
                    // exibe mostra vazio. Os antigos `|| 5.75` / `|| 90000` faziam
                    // um dólar fictício passar por cotação na tela do usuário.
                    usd: { value: nullIfAbsent(config.dollar), change: config.dollarChange || 0 },
                    ibov: { value: nullIfAbsent(config.ibov), change: config.ibovChange || 0 },
                    spx: { value: nullIfAbsent(config.spx), change: config.spxChange || 0 },
                    btc: { value: nullIfAbsent(config.btc), change: config.btcChange || 0 },
                    // Frescor do bloco de MOEDAS. Separado de `lastUpdated`, que
                    // avança a cada run do cron mesmo com a fonte de câmbio fora.
                    currenciesStale: !!config.currenciesStale,
                    currenciesSources: config.currenciesSources || null,
                    currenciesUpdatedAt: config.currenciesUpdatedAt || null,
                    // Observabilidade: ratesSources informa a fonte efetiva de cada taxa
                    // ('BCB' | 'BrasilAPI' | 'IBGE' | 'fallback'); ratesStale=true se alguma caiu
                    // no fallback hardcoded. ratesUpdatedAt = último fetch 100% real.
                    ratesStale: !!config.ratesStale,
                    ratesSources: (config.ratesSources && (config.ratesSources.selic || config.ratesSources.ipca)) ? config.ratesSources : null,
                    ratesUpdatedAt: config.ratesUpdatedAt || null,
                    lastUpdated: config.lastUpdated
                };
            }
            return FALLBACK_MACRO;
        } catch {
            return FALLBACK_MACRO;
        }
    },

    // --- MELHORIA CRÍTICA 4: Reativação automática de ativos inativos ---
    // Tenta reativar ativos marcados como isActive=false buscando cotação fresca.
    // Se a cotação voltar, reseta failCount e reativa. Se não, mantém inativo.
    async tryReactivateAssets() {
        try {
            // isBlacklisted é estado TERMINAL: tira do sync E do loop de reativação.
            // Sem este filtro, ativos deslistados (SGEN, IPG, EURP11, BDRX11…) seguiam
            // sendo re-cotados todo run — falhavam, disparavam 404 na brapi (abrindo o
            // breaker e starvando os vivos) e poluíam os warnings apesar da blacklist.
            // `lastPrice` entra no select porque é a base de comparação do eco:
            // sem ele, isEchoQuote não tem contra o que comparar e deixa passar.
            // `priceDate` entra por causa do relógio da aposentadoria: é uma das
            // duas testemunhas de pregão (ver `lastTradeAgeByTicker`).
            const inactiveAssets = await MarketAsset.find({ isActive: false, isBlacklisted: false }).select('ticker failCount type marketCap updatedAt lastPrice priceDate');
            if (inactiveAssets.length === 0) {
                logger.info(`✅ [Reativação] Nenhum ativo inativo para verificar.`);
                return { reactivated: 0, stillInactive: 0, retired: 0 };
            }

            logger.info(`🔄 [Reativação] Verificando ${inactiveAssets.length} ativos inativos...`);
            const tickers = inactiveAssets.map(a => a.ticker);
            const quotes = await externalMarketService.getQuotes(tickers, {
                typeByTicker: new Map(inactiveAssets.map((a) => [a.ticker, a.type || null])),
            });

            const operations = [];
            let reactivatedCount = 0;
            const reactivatedTickers = [];
            const echoedTickers = [];
            const inactiveMap = new Map(inactiveAssets.map(a => [a.ticker, a]));

            for (const quote of quotes) {
                if (quote.price && quote.price > 0) {
                    // O eco tem que ser barrado AQUI também, e este é o ponto que
                    // mais importa: sem isto, o ativo que a contagem de falhas
                    // acabou de desativar volta a ativo no ciclo seguinte com o
                    // mesmo preço congelado, e a quarentena de 90 dias nunca chega
                    // ao fim — o relógio reinicia a cada volta.
                    if (this.isEchoQuote(quote, inactiveMap.get(this.normalizeSymbol(quote.ticker)))
                        || this.isStaleSessionQuote(quote)) {
                        echoedTickers.push(this.normalizeSymbol(quote.ticker));
                        continue;
                    }
                    operations.push({
                        updateOne: {
                            filter: { ticker: this.normalizeSymbol(quote.ticker) },
                            update: { $set: { isActive: true, failCount: 0, lastFailDate: null, lastPrice: quote.price, change: quote.change || 0, priceDate: sessionDateKey(quote.marketTime), priceSource: quote.source || 'YAHOO', updatedAt: new Date() } }
                        }
                    });
                    reactivatedCount++;
                    reactivatedTickers.push(quote.ticker);
                }
            }

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
                logger.info(`✅ [Reativação] ${reactivatedCount} ativos reativados: ${reactivatedTickers.join(', ')}`);
            }
            if (echoedTickers.length > 0) {
                logger.warn(
                    `🔁 [Reativação] ${echoedTickers.length} ativo(s) NÃO reativados: a fonte só devolveu o preço já gravado, sem data de sessão: ${echoedTickers.join(', ')}`,
                    { echoed: echoedTickers },
                );
            }

            const successSet = new Set(reactivatedTickers.map(t => this.normalizeSymbol(t)));
            const stillInactive = inactiveAssets.filter(a => !successSet.has(a.ticker));

            // Aposentadoria automática: quem passou a quarentena inteira sem cotar em
            // nenhuma fonte sai do loop (isBlacklisted = estado terminal). É o que
            // drena a lista sozinha — antes ela só crescia, e o mesmo warn se repetia
            // indefinidamente. Ticker detido por usuário nunca é aposentado no
            // automático: ali a baixa muda o que o dono vê na carteira, então é
            // decisão a dedo (server/scripts/retireDeadTickers.js).
            const retired = await this.retireStaleInactiveAssets(stillInactive);
            const retiredSet = new Set(retired);

            // Alerta para ativos grandes que continuam inativos (e ainda em quarentena)
            const importantStillInactive = stillInactive.filter(a => (a.marketCap || 0) > 1000000000 && !retiredSet.has(a.ticker));
            if (importantStillInactive.length > 0) {
                const detail = importantStillInactive
                    .map(a => `${a.ticker} (${daysSinceDayKey(a.priceDate) ?? daysSince(a.updatedAt) ?? '?'}d)`)
                    .join(', ');
                logger.warn(`⚠️ [Reativação] Ativos grandes ainda inativos (aposentam em ${RETIRE_AFTER_INACTIVE_DAYS}d sem cotação): ${detail}`);
            }

            return { reactivated: reactivatedCount, stillInactive: stillInactive.length, retired: retired.length };
        } catch (error) {
            logger.error(`❌ [Reativação] Falha: ${error.message}`);
            return { reactivated: 0, stillInactive: 0, retired: 0 };
        }
    },

    // Aposenta (isBlacklisted, terminal) os inativos que atravessaram a quarentena
    // inteira sem voltar a cotar. Chamada pelo tryReactivateAssets logo após a
    // tentativa de reativação — ou seja, só chega aqui quem acabou de falhar mais
    // uma vez, com todos os fallbacks (Google/Brapi) já esgotados no getQuotes.
    // Devolve os tickers aposentados.
    /**
     * ── QUANDO ESTE PAPEL PROVOU, PELA ÚLTIMA VEZ, QUE NEGOCIA? ─────────────────
     *
     * O relógio da aposentadoria media `updatedAt`, e `updatedAt` é — nas palavras
     * do próprio modelo — *quando NÓS perguntamos*. Qualquer rotina que toque o
     * documento por outro motivo (backfill de setor, de logo, de fundamento)
     * reinicia o relógio da morte de um papel extinto.
     *
     * Medido em 07/09/2026: PTNT3 e PTNT4 (Pettenati) não negociam desde 26 e
     * 27/05 — 104 dias, cada um com UM único candle na série, `priceDate` nulo e
     * `failCount` no teto. Uma escrita de 29/07 tinha empurrado o `updatedAt`, e
     * com ele os dois marcavam 40 dias de quarentena em vez de 104: a baixa só
     * aconteceria no fim de outubro, e voltaria a ser adiada a cada toque.
     *
     * A prova honesta de pregão é a data da ÚLTIMA SESSÃO conhecida, e ela tem
     * duas testemunhas independentes, as duas nossas:
     *   - o último candle com fechamento > 0 na série (`AssetHistory`);
     *   - `priceDate`, o dia da sessão que veio junto da última cotação DATADA.
     * Vale a mais recente das duas — uma pode faltar sem que o papel esteja morto.
     *
     * Sem nenhuma das duas resta `updatedAt`, e aí ele é a resposta certa por ser
     * a única: ativo recém-criado, que nunca cotou e nunca teve série, não pode
     * ser aposentado no primeiro dia nem virar imortal. É também onde cai o fundo
     * que listou e nunca negociou — série cheia de barras sem volume e nenhum
     * pregão para datar. Ele fica de fora da baixa automática, que é o lado
     * seguro: "nunca provou que negocia" não é o mesmo que "parou de negociar".
     *
     * Uma consulta para o lote inteiro; a série não é hidratada (só a data máxima
     * é projetada), porque puxar ~400 candles de cada inativo seria caro à toa.
     *
     * @param {Array<{ticker: string, type: string, priceDate?: string, updatedAt?: Date}>} assets
     * @returns {Promise<Map<string, {days: number|null, basis: string}>>} ticker → idade
     */
    async lastTradeAgeByTicker(assets) {
        const lista = assets || [];
        const idade = new Map();
        if (lista.length === 0) return idade;

        const porChave = new Map();
        for (const a of lista) {
            const chave = historyStorageKey(a.ticker, a.type);
            if (!chave) continue;
            if (!porChave.has(chave)) porChave.set(chave, []);
            porChave.get(chave).push(a.ticker);
        }

        let candlePorChave = new Map();
        let coberturaPorChave = new Map();
        try {
            const rows = await AssetHistory.aggregate([
                { $match: { ticker: { $in: [...porChave.keys()] } } },
                {
                    $project: {
                        ticker: 1,
                        lastDate: {
                            $max: {
                                $map: {
                                    input: {
                                        $filter: {
                                            input: { $ifNull: ['$history', []] },
                                            as: 'h',
                                            // Candle com fechamento E com negócio. A barra de
                                            // continuação do símbolo extinto entra na nossa série
                                            // como qualquer outra (fechamento repetido, volume 0) e,
                                            // contada como sessão, reiniciava este relógio todo dia:
                                            // HGPO11 tinha 73 delas em cima do último pregão real
                                            // (25/05/2026) e aparecia com 1 dia de idade.
                                            //
                                            // Volume ausente (série antiga, antes do campo) conta
                                            // como sessão — fail-closed: sem prova de morte, ninguém
                                            // é aposentado.
                                            cond: {
                                                $and: [
                                                    { $gt: ['$$h.close', 0] },
                                                    { $ne: [{ $ifNull: ['$$h.volume', 1] }, 0] },
                                                ],
                                            },
                                        },
                                    },
                                    as: 'h',
                                    in: '$$h.date',
                                },
                            },
                        },
                        // Último candle de QUALQUER espécie — inclusive a barra de
                        // continuação. Não é prova de pregão; é prova de que a nossa
                        // série tem opinião sobre aquele período (ver o desempate das
                        // testemunhas, abaixo).
                        lastAnyDate: {
                            $max: {
                                $map: {
                                    input: {
                                        $filter: {
                                            input: { $ifNull: ['$history', []] },
                                            as: 'h',
                                            cond: { $gt: ['$$h.close', 0] },
                                        },
                                    },
                                    as: 'h',
                                    in: '$$h.date',
                                },
                            },
                        },
                    },
                },
            ]);
            candlePorChave = new Map(rows.map((r) => [r.ticker, r.lastDate]));
            coberturaPorChave = new Map(rows.map((r) => [r.ticker, r.lastAnyDate]));
        } catch (error) {
            // Fail-CLOSED: sem a série não há prova de morte, e a ausência da
            // consulta não pode virar sentença. Todo mundo fica com idade nula e
            // ninguém é aposentado nesta rodada.
            logger.warn(`[Reativação] Última sessão indisponível (${error.message}); nenhuma baixa automática nesta rodada.`);
            return idade;
        }

        for (const a of lista) {
            const chave = historyStorageKey(a.ticker, a.type);
            const candle = daysSinceDayKey(candlePorChave.get(chave));
            const quote = daysSinceDayKey(a.priceDate);

            // TESTEMUNHA QUE COBRE O PERÍODO REFUTA A QUE SÓ O ATRAVESSA.
            //
            // "A mais recente das duas" era certo enquanto as duas eram honestas.
            // Só que `priceDate` é exatamente o campo que o eco de volume zero
            // forjava: em 07/09/2026, 19 ativos sem um único negócio há 30 dias ou
            // mais carregavam `priceDate` da véspera, gravado por uma barra em que
            // ninguém negociou. Barrar a gravação nova (ver `isNoTradeQuote`) não
            // apaga o carimbo velho — e ele sozinho adiaria a baixa em mais 90 dias.
            //
            // Quando a nossa série TEM candle no dia da cotação ou depois dele, ela
            // já respondeu sobre aquele período: se não houve negócio ali, não houve.
            // A cotação só fala quando a série está calada (ativo sem série, ou série
            // atrasada em relação à cotação) — e aí ela volta a ser a única prova, que
            // é como PTNT3/PTNT4 chegaram aqui.
            const cobertura = coberturaPorChave.get(chave) || null;
            const serieCobreACotacao = Boolean(cobertura) && Boolean(a.priceDate) && cobertura >= a.priceDate;

            const candidatos = [
                candle === null ? null : { days: candle, basis: 'último candle' },
                (quote === null || serieCobreACotacao) ? null : { days: quote, basis: 'última cotação datada' },
            ].filter(Boolean);

            if (candidatos.length === 0) {
                idade.set(a.ticker, { days: daysSince(a.updatedAt), basis: 'sem sessão conhecida' });
                continue;
            }
            // A mais RECENTE das provas restantes: basta uma testemunha para o papel
            // estar vivo.
            idade.set(a.ticker, candidatos.reduce((m, c) => (c.days < m.days ? c : m)));
        }
        return idade;
    },

    /**
     * ── ESTE PAPEL CHEGOU A TER MERCADO? ───────────────────────────────────────
     *
     * Lê a nossa série e devolve, por ticker, a densidade de pregões com negócio
     * na janela de `REGULAR_MARKET_WINDOW` sessões que TERMINA no último negócio
     * conhecido — não nas últimas 120 sessões do calendário, que para um papel
     * morto seriam todas vazias por definição e não distinguiriam nada.
     *
     * `regular: false` não é veredito de vida: é "esta evidência não serve para
     * dar baixa neste papel". Ver a nota nas constantes.
     *
     * @param {Array<{ticker: string, type: string}>} assets
     * @returns {Promise<Map<string, {regular: boolean, traded: number, sessions: number}>>}
     */
    async hadRegularMarketByTicker(assets) {
        const out = new Map();
        const lista = assets || [];
        if (lista.length === 0) return out;

        const chavePorTicker = new Map(lista.map((a) => [a.ticker, historyStorageKey(a.ticker, a.type)]));
        const rows = await AssetHistory
            .find({ ticker: { $in: [...new Set([...chavePorTicker.values()].filter(Boolean))] } })
            .select('ticker history')
            .lean();
        const serie = new Map(rows.map((r) => [r.ticker, r.history || []]));

        for (const a of lista) {
            const hist = (serie.get(chavePorTicker.get(a.ticker)) || []).filter((c) => c?.close > 0);
            // Volume ausente conta como negócio, pela mesma razão de sempre: série
            // antiga não tinha o campo, e "não sei" não pode virar prova de morte.
            const negociou = hist.map((c) => c?.volume !== 0);
            const ultimo = negociou.lastIndexOf(true);
            if (ultimo < 0) {
                out.set(a.ticker, { regular: false, traded: 0, sessions: hist.length });
                continue;
            }
            const janela = negociou.slice(Math.max(0, ultimo - (REGULAR_MARKET_WINDOW - 1)), ultimo + 1);
            const traded = janela.filter(Boolean).length;
            out.set(a.ticker, {
                regular: janela.length >= REGULAR_MARKET_MIN_SESSIONS
                    && traded / janela.length >= REGULAR_MARKET_MIN_RATIO,
                traded,
                sessions: janela.length,
            });
        }
        return out;
    },

    async retireStaleInactiveAssets(stillInactive) {
        const comFalhas = (stillInactive || []).filter(a =>
            (a.failCount || 0) >= MAX_FAILURES_BEFORE_BLACKLIST,
        );
        if (comFalhas.length === 0) return [];

        const idades = await this.lastTradeAgeByTicker(comFalhas);
        const eligible = pastQuarantine(comFalhas, idades);
        if (eligible.length === 0) return [];

        // Detido em carteira → fora do automático (a baixa muda a tela do dono).
        const heldTickers = await UserAsset.distinct('ticker', { ticker: { $in: eligible.map(a => a.ticker) } });
        const held = new Set(heldTickers);
        const candidates = eligible.filter(a => !held.has(a.ticker));
        if (candidates.length === 0) return [];

        // Nunca teve mercado regular → triagem a dedo (ver REGULAR_MARKET_MIN_RATIO).
        const comMercado = await keepRegularMarket(this, candidates);
        if (!comMercado || comMercado.length === 0) return [];

        const targets = await dropStillTrading(comMercado);
        if (targets.length === 0) return [];

        await MarketAsset.bulkWrite(retirementOps(targets, idades, new Date()));
        logRetired(targets, idades, held);
        return targets.map(a => a.ticker);
    },

    async getMarketData(assetClass) {
        const typeFilter = researchTypeFilter(assetClass);
        if (!typeFilter) return [];

        // Sem filtro de liquidez aqui — scoringEngine.js gera DiscardLog para tickers insuficientes
        const dbAssets = await MarketAsset.find({
            ...typeFilter,
            isIgnored: false,
            isBlacklisted: false,
            isActive: true,
        });
        const trackByTicker = await loadTrackRecords(dbAssets);
        const results = dbAssets.map((asset) => toResearchAsset(asset, trackByTicker));

        if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
            return deduplicateAssets(results);
        }
        return results;
    }
};

// Universo de cada classe do ranking. BRASIL_10 = STOCK+FII; ETF (unificada) =
// ETFs nacionais (type 'ETF') + internacionais (STOCK_US com usSubType 'ETF'/'GOLD'
// — ouro é investido via ETF, PR8); REIT = só REITs individuais do Exterior;
// STOCK_US (Exterior) = ações puras (sem REIT/ETF/GOLD/DOLLAR, que têm rankings
// próprios); STOCK/FII/CRYPTO = direto. null = classe fora do ranking.
const researchTypeFilter = (assetClass) => {
    switch (assetClass) {
    case 'BRASIL_10': return { type: { $in: ['STOCK', 'FII'] } };
    case 'ETF': return { $or: [{ type: 'ETF' }, { type: 'STOCK_US', usSubType: { $in: ['ETF', 'GOLD'] } }] };
    case 'REIT': return { type: 'STOCK_US', usSubType: 'REIT' };
    // $nin também casa usSubType ausente/null → tratado como ação (STOCK).
    case 'STOCK_US': return { type: 'STOCK_US', usSubType: { $nin: ['REIT', 'ETF', 'GOLD', 'DOLLAR'] } };
    case 'STOCK':
    case 'FII':
    case 'CRYPTO': return { type: { $in: [assetClass] } };
    default: return null;
    }
};

// (Fase 3) Série temporal de fundamentos (track record) em um único find, resumida
// por ticker. Vazio/insuficiente → summarizeTrackRecord = null → o scoringEngine
// não aplica bônus (dimensão DORMENTE até a série acumular).
const loadTrackRecords = async (dbAssets) => {
    try {
        const snaps = await FundamentalSnapshot
            .find({ ticker: { $in: dbAssets.map(a => a.ticker) } })
            .select('ticker history').lean();
        return new Map(snaps.map(s => [s.ticker, summarizeTrackRecord(s.history)]));
    } catch (e) {
        logger.warn(`[MarketData] Falha ao carregar track record: ${e.message}`);
        return new Map();
    }
};

// Distinguir dado ausente de dado ruim: nestes campos 0 = quase certamente dado
// não coletado (nunca são exatamente 0 na prática). dy, dívida e payout têm 0
// legítimo (não paga, não deve, não distribui) e nunca são marcados.
const ZERO_MEANS_MISSING = ['pl', 'marketCap', 'roe', 'netMargin', 'revenueGrowth', 'evEbitda', 'beta'];
const FUNDAMENTAL_FIELDS = ['pl', 'marketCap', 'roe', 'netMargin', 'revenueGrowth', 'evEbitda'];
// Métricas numéricas em que ausência vira 0, na ordem em que o item sempre saiu.
// Financials LTM (netRevenue…patrimLiq) preenchem o modal "Financials (LTM)";
// FFO do FII é 0 quando a fonte não publicou, e vpCota alimenta o VP do preço justo
// em calculateIntrinsicValue (sem ele, fallback price/pvp).
const ZERO_DEFAULT_METRICS = [
    'pl', 'roe', 'roic', 'netMargin', 'evEbitda', 'revenueGrowth', 'debtToEquity', 'netDebt', 'payout',
    'netRevenue', 'netIncome', 'totalAssets', 'patrimLiq', 'vacancy', 'capRate', 'qtdImoveis',
    'ffoYield', 'vpCota', 'ffoCota', 'volatility', 'beta', 'sma200', 'ema50',
];

const missingFlagsOf = (asset) => ({
    ...Object.fromEntries(ZERO_MEANS_MISSING.map((f) => [f, !asset[f] || asset[f] === 0])),
    dy: false,
    debtToEquity: false,
    payout: false,
});

const buildResearchMetrics = (asset, trackByTicker) => {
    const _missing = missingFlagsOf(asset);
    // Completude dos dados fundamentalistas (0–100%)
    const missingCount = FUNDAMENTAL_FIELDS.filter(f => _missing[f]).length;
    const dataCompleteness = Math.round(((FUNDAMENTAL_FIELDS.length - missingCount) / FUNDAMENTAL_FIELDS.length) * 100);
    // Dias desde a última atualização de fundamentais
    const _staleDays = asset.lastFundamentalsDate
        ? Math.floor((Date.now() - new Date(asset.lastFundamentalsDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;
    return {
        ticker: asset.ticker,
        price: asset.lastPrice,
        dy: asset.dy || 0,
        pvp: asset.pvp || asset.p_vp || 0,
        marketCap: asset.marketCap || 0,
        avgLiquidity: asset.avgLiquidity || asset.liquidity || 0,
        ...Object.fromEntries(ZERO_DEFAULT_METRICS.map((f) => [f, asset[f] || 0])),
        // Passados para o scoringEngine identificar isPapel e setor
        sector: asset.sector,
        fiiSubType: asset.fiiSubType || null,
        // Flags de qualidade de dados
        _missing,
        _staleDays,
        dataCompleteness,
        // (Fase 3) Resumo de track record ou null quando não há série suficiente.
        trackRecord: trackByTicker.get(asset.ticker) || null,
        structural: { quality: 50, valuation: 50, risk: 50 },
    };
};

// REITs do Exterior: setor de EXIBIÇÃO vira o sub-segmento fino (Varejo,
// Industrial/Logística, Saúde…) p/ diversificar o donut — o `sector` no banco
// segue "Real Estate" (classificação intacta).
const displaySectorOf = (asset) => (
    asset.type === 'STOCK_US' && asset.usSubType === 'REIT' ? reitSegmentPT(asset.industry) : asset.sector
);

const plainSectorMetrics = (sectorMetrics) => (
    sectorMetrics?.toObject ? sectorMetrics.toObject() : (sectorMetrics || {})
);

const toResearchAsset = (asset, trackByTicker) => ({
    ticker: asset.ticker,
    type: asset.type,
    allocationClass: asset.allocationClass || null,
    currency: asset.currency || (asset.type === 'STOCK_US' ? 'USD' : 'BRL'),
    name: asset.name || asset.ticker,
    sector: displaySectorOf(asset),
    // Metadados da calibração buy-and-hold STOCK. Permanecem no topo para não
    // contaminar `metrics` com dados de proveniência.
    stockArchetype: asset.stockArchetype || null,
    sectorMetrics: plainSectorMetrics(asset.sectorMetrics),
    fiiSubType: asset.fiiSubType || null,
    usSubType: asset.usSubType || null,
    price: asset.lastPrice || 0,
    dbFlags: { isBlacklisted: asset.isBlacklisted, isTier1: asset.isTier1 },
    metrics: buildResearchMetrics(asset, trackByTicker),
});

const deduplicateAssets = (assets) => {
    const grouped = {};
    assets.forEach(asset => {
        let root = asset.ticker.substring(0, 4);
        if (!grouped[root]) {
            grouped[root] = asset;
        } else {
            if (asset.metrics.avgLiquidity > grouped[root].metrics.avgLiquidity) {
                grouped[root] = asset;
            }
        }
    });
    return Object.values(grouped);
};
