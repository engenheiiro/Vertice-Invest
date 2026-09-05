
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
import DividendEvent from '../models/DividendEvent.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { brazilDateKey } from '../utils/dateUtils.js';
import { loadLatestCloseBefore } from '../utils/dayCloses.js';
import { deriveDividendFromGap } from '../utils/dividendGap.js';
import { isAccumulatingBrEtf } from '../config/brEtfList.js';
import { recordCacheAccess } from '../utils/performanceMetrics.js';
import { judgeQuote, contestsChange, resolveContestedChange } from '../utils/quoteSanity.js';
import { recordSuspectQuote } from '../utils/sourceHealth.js';

/**
 * Dia da SESSÃO a que a cotação pertence, no calendário brasileiro. É o carimbo
 * que separa "fechou +1,19% hoje" de "fechou +1,19% ontem": `updatedAt` responde
 * quando perguntamos ao provedor, nunca quando o negócio aconteceu.
 *
 * null quando a fonte não publica o horário (scraping do Google Finance, fallback
 * de histórico) — o consumidor decide o que fazer com a ausência, e o de hoje
 * (walletController) mantém o comportamento antigo em vez de zerar a variação.
 */
const sessionDateKey = (marketTime) => {
    if (!marketTime) return null;
    const d = new Date(marketTime);
    return Number.isNaN(d.getTime()) ? null : brazilDateKey(d);
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
// Quarentena antes da APOSENTADORIA automática. Ficar inativo não tem custo de
// dado (o upsert só grava sucesso), mas tem custo de ruído: o loop de reativação
// re-cota todo inativo a cada run, e um papel que saiu da bolsa reaparece para
// sempre no warn "Yahoo falhou para N ativos" — em ago/2026 eram 27 tickers, com
// mortos de até 192 dias (BPAN4, CPLE5, MMC, HOLX…), sem caminho de saída porque
// a única baixa possível era manual e a guarda de porte mandava todo papel grande
// para uma "revisão manual" que nunca acontecia. 90 dias sem cotar em NENHUMA
// fonte não é mais provedor engasgado: instabilidade real dura dias (caso B3SA3),
// e o loop de reativação já teria recuperado o papel em qualquer run desse período.
const RETIRE_AFTER_INACTIVE_DAYS = 90;
// Idade máxima do último candle para considerar que o papel ainda negocia (e,
// portanto, NÃO pode ser aposentado, por mais que o endpoint de cotação o ignore).
const RETIRE_RECENT_CANDLE_DAYS = 10;
// Single-flight por processo: uma tela com vários consumidores do mesmo ticker
// não dispara várias renovações enquanto o primeiro refresh ainda está em voo.
const interactiveRefreshes = new Map();

/** Dias inteiros desde `date` (null quando a data não existe). */
const daysSince = (date) => (date ? Math.floor((Date.now() - new Date(date).getTime()) / 86400000) : null);

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
            if (!interactive && asset && ['STOCK', 'FII', 'STOCK_US', 'ETF'].includes(asset.type)) {
                const nm = (asset.name || '').trim();
                if (!nm || nm.toUpperCase() === cleanTicker.toUpperCase()) {
                    try {
                        await this.refreshQuotesBatch([cleanTicker], true);
                        asset = await MarketAsset.findOne({ ticker: cleanTicker });
                    } catch { /* mantém o asset atual em caso de falha */ }
                }
            }

            if (asset && asset.lastPrice > 0) {
                const cacheMinutes = getTunablesSync().marketCacheMinutes;
                const staleBefore = Date.now() - cacheMinutes * 60 * 1000;
                const isStale = !asset.updatedAt || new Date(asset.updatedAt).getTime() < staleBefore;
                if (interactive && isStale) this.refreshQuoteInBackground(cleanTicker);
                recordCacheAccess('market-price', isStale ? 'stale' : 'hit');
                return {
                    price: asset.lastPrice,
                    change: asset.change || 0,
                    priceDate: asset.priceDate || null,
                    previousClose: asset.previousClose || 0,
                    name: asset.name,
                    sector: asset.sector,
                    dy: asset.dy || 0,
                    cacheStatus: isStale ? 'STALE' : 'HIT',
                    isStale,
                };
            }

            const historyKey = historyStorageKey(cleanTicker, asset?.type || 'INDEX');
            const history = await AssetHistory.findOne({ ticker: historyKey });
            if (history && history.history && history.history.length > 0) {
                const sorted = history.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const lastClose = sorted[0].close || sorted[0].adjClose;
                
                if (lastClose > 0) {
                    if (interactive) this.refreshQuoteInBackground(cleanTicker);
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
            }

            if (interactive) this.refreshQuoteInBackground(cleanTicker);
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
            let primaryHits = 0;
            let fallbackHits = 0;
            let misses = 0;
            const assets = await MarketAsset.find({ ticker: { $in: cleanList } })
                .select('ticker name sector type currency allocationClass lastPrice change priceDate previousClose dy');
            const byTicker = new Map(assets.map(a => [a.ticker, a]));

            const missingKeys = new Set();
            for (const { original, clean } of pairs) {
                const asset = byTicker.get(clean);
                if (asset && asset.lastPrice > 0) {
                    primaryHits += 1;
                    map.set(original, {
                        price: asset.lastPrice,
                        change: asset.change || 0,
                        priceDate: asset.priceDate || null,
                        previousClose: asset.previousClose || 0,
                        name: asset.name,
                        sector: asset.sector,
                        ...(asset.allocationClass ? { allocationClass: asset.allocationClass } : {}),
                        dy: asset.dy || 0,
                    });
                } else {
                    missingKeys.add(historyStorageKey(clean, asset?.type || 'INDEX'));
                }
            }

            // Fallback de histórico em UMA query (evita o N+1 de AssetHistory).
            let histByTicker = new Map();
            if (missingKeys.size > 0) {
                const histories = await AssetHistory.find({ ticker: { $in: [...missingKeys] } })
                    .select('ticker history');
                histByTicker = new Map(histories.map(h => [h.ticker, h]));
            }

            for (const { original, clean } of pairs) {
                if (map.has(original)) continue;
                const asset = byTicker.get(clean);
                const hist = histByTicker.get(historyStorageKey(clean, asset?.type || 'INDEX'));
                let resolved = {
                    price: 0, change: 0, name: original, sector: 'Outros',
                    ...(asset?.allocationClass ? { allocationClass: asset.allocationClass } : {}),
                };
                if (hist && Array.isArray(hist.history) && hist.history.length > 0) {
                    const sorted = [...hist.history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                    const lastClose = sorted[0].close || sorted[0].adjClose;
                    if (lastClose > 0) {
                        fallbackHits += 1;
                        resolved = {
                            price: lastClose, change: 0, name: original, sector: 'Outros',
                            ...(asset?.allocationClass ? { allocationClass: asset.allocationClass } : {}),
                            isFallback: true,
                        };
                    }
                }
                if (!resolved.isFallback) misses += 1;
                map.set(original, resolved);
            }
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
                if (Number(data.price) > 0) set.lastPrice = Number(data.price);
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

    // Regra ÚNICA da blacklist dinâmica por falha de cotação. Recebe os docs de
    // ativos (com failCount/lastFailDate/marketCap/liquidity) e o conjunto de
    // tickers que cotaram com sucesso; devolve os bulkOps de failCount/desativação.
    // Gate de 1 falha/dia (lastFailDate) + proteção de blue chips (ativos grandes/
    // líquidos seguem contando falhas para alerta, mas nunca são desativados).
    // Reusada pelo refreshQuotesBatch (BR) e pelo path Exterior/Cripto do syncService.
    buildQuoteFailureOps(assets, successfulTickers) {
        const ops = [];
        const todayKey = new Date().toISOString().slice(0, 10);
        for (const asset of assets) {
            if (!asset || successfulTickers.has(asset.ticker)) continue;
            const lastFailKey = asset.lastFailDate ? new Date(asset.lastFailDate).toISOString().slice(0, 10) : null;
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

            // 1. Só cotações da sessão de HOJE. Um quote de ontem compararia o
            //    previousClose de anteontem com o candle da véspera — sem sentido.
            const candidates = [];
            for (const quote of quotes || []) {
                const ticker = this.normalizeSymbol(quote.ticker);
                const asset = assetMap.get(ticker);
                const adjusted = Number(quote.previousClose);
                if (!asset || !(adjusted > 0)) continue;
                // ETFs brasileiros curados são de acumulação: os rendimentos
                // ficam na cota e nunca podem virar crédito em DividendEvent.
                if (asset.type === 'ETF' && isAccumulatingBrEtf(ticker)) continue;
                if (sessionDateKey(quote.marketTime) !== todayBr) continue;
                candidates.push({ ticker, type: asset.type, adjusted });
            }
            if (candidates.length === 0) return 0;

            // 2. Passada barata: sem histórico de proventos. Na esmagadora maioria
            //    dos dias TODO gap é zero e a função sai aqui, sem tocar em
            //    DividendEvent — é o que mantém o custo no caminho quente irrisório.
            const closes = await loadLatestCloseBefore(candidates, todayBr);
            const hits = [];
            for (const c of candidates) {
                const prev = closes.get(historyStorageKey(c.ticker, c.type));
                if (!prev) continue;
                const derived = deriveDividendFromGap({
                    type: c.type,
                    rawPrevClose: prev.close,
                    adjustedPrevClose: c.adjusted,
                    priceDate: todayBr,
                    rawPrevCloseDate: prev.date,
                });
                if (derived) hits.push({ ...c, prev });
            }
            if (hits.length === 0) return 0;

            // 3. Só agora vale consultar o histórico, para (a) não pisar num evento
            //    oficial já publicado e (b) aplicar a trava de plausibilidade.
            const tickers = hits.map((h) => h.ticker);
            const known = await DividendEvent.find({ ticker: { $in: tickers } })
                .select('ticker date amount source').sort({ date: -1 }).lean();

            const byTicker = new Map();
            for (const ev of known) {
                if (!byTicker.has(ev.ticker)) byTicker.set(ev.ticker, []);
                byTicker.get(ev.ticker).push(ev);
            }

            const [ty, tm, td] = todayBr.split('-').map(Number);
            const exDateUtc = new Date(Date.UTC(ty, tm - 1, td));
            const NEAR_DAYS_MS = 4 * 86400000;

            let written = 0;
            for (const hit of hits) {
                const events = byTicker.get(hit.ticker) || [];

                // Evento OFICIAL perto da data-ex derivada: a fonte já publicou (ou
                // publicou com a data deslocada em 1-2 dias). Não inventar um segundo.
                const officialNearby = events.some((ev) => (ev.source || 'PROVIDER') === 'PROVIDER'
                    && Math.abs(new Date(ev.date).getTime() - exDateUtc.getTime()) <= NEAR_DAYS_MS);
                if (officialNearby) continue;

                const knownAmounts = events
                    .filter((ev) => (ev.source || 'PROVIDER') === 'PROVIDER')
                    .slice(0, 12)
                    .map((ev) => Number(ev.amount));

                const derived = deriveDividendFromGap({
                    type: hit.type,
                    rawPrevClose: hit.prev.close,
                    adjustedPrevClose: hit.adjusted,
                    priceDate: todayBr,
                    rawPrevCloseDate: hit.prev.date,
                    knownAmounts,
                });
                if (!derived) continue;

                await DividendEvent.updateOne(
                    { ticker: hit.ticker, date: exDateUtc, type: 'DIVIDEND' },
                    {
                        $set: { amount: derived.amount, source: 'DERIVED' },
                        $setOnInsert: { ticker: hit.ticker, date: exDateUtc, type: 'DIVIDEND', currency: 'BRL' },
                    },
                    { upsert: true },
                );
                written++;
                logger.info('[Dividends] Provento provisório detectado pelo gap do dia-ex', {
                    ticker: hit.ticker,
                    exDate: todayBr,
                    amount: derived.amount,
                    rawPrevClose: hit.prev.close,
                    adjustedPrevClose: hit.adjusted,
                });
            }
            return written;
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
            const dbAssets = await MarketAsset.find({ ticker: { $in: cleanTickers } }).select('ticker name type updatedAt lastPrice priceDate change isActive isBlacklisted failCount lastFailDate marketCap liquidity');
            
            const toUpdate = [];
            const assetMap = new Map();
            
            dbAssets.forEach(a => assetMap.set(a.ticker, a));

            cleanTickers.forEach(ticker => {
                const asset = assetMap.get(ticker);
                
                // Aposentado ou desativado: fora da fila de cotação, mesmo com force.
                //
                // Lia só `isActive`, apostando que os dois campos andam juntos — e eles
                // não andam. Em 04/09/2026 havia 12 ativos com isBlacklisted=true e
                // isActive=true (blacklistados por caminhos antigos, que não desativavam),
                // e por causa disso IGBR3 e BLUT4 eram perguntados a cada 15 minutos,
                // desciam Yahoo → Google → Brapi e falhavam nos três, para sempre. Papel
                // aposentado gastando as três fontes é o oposto do que a blacklist existe
                // para fazer. `isBlacklisted` é o estado TERMINAL: ele decide sozinho.
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

            if (toUpdate.length === 0) return;

            // O tipo vai junto: sem ele, sigla disputada (STX é Stacks na cripto e
            // Seagate na NASDAQ) faz o provedor responder sobre outro ativo.
            const quotes = await externalMarketService.getQuotes(toUpdate, {
                typeByTicker: new Map([...assetMap].map(([t, a]) => [t, a?.type || null])),
            });
            const operations = [];
            
            // Set para controle de sucesso/falha
            const successfulTickers = new Set();
            // Preço que voltou sem sessão e sem movimento (ver isEchoQuote). Não é
            // sucesso nem erro de fonte: é ausência de prova de pregão.
            const echoedTickers = [];
            // Cotação datada de uma sessão velha demais (ver isStaleSessionQuote).
            const staleTickers = [];
            // Preço que chegou fora da magnitude esperada (ver utils/quoteSanity).
            // NÃO é caminho de falha: o preço é gravado do mesmo jeito, porque
            // grupamento e desdobramento têm a mesma assinatura de um erro de
            // fonte e barrar por magnitude congelaria o ativo para sempre. O que
            // muda é que ele passa a aparecer NOMEADO no painel de Saúde.
            const suspectTickers = [];
            // Ativos cuja VARIAÇÃO a fonte não sustenta. O preço segue sendo dela;
            // o par (change, previousClose) é reancorado no nosso próprio candle
            // logo depois do laço — ver `resolveContestedChange`.
            const contestados = [];

            for (const quote of quotes) {
                const ticker = this.normalizeSymbol(quote.ticker);
                const currentAsset = assetMap.get(ticker);

                let newPrice = quote.price;
                let newChange = quote.change || 0;

                if (newPrice && newPrice > 0) {
                    // Eco não entra em `successfulTickers`: cai no caminho de falha
                    // logo abaixo e o ativo segue envelhecendo, que é o correto.
                    // Nada é gravado — o valor é idêntico ao que já está no banco,
                    // e é justamente o `updatedAt` que não pode ser renovado.
                    if (this.isEchoQuote(quote, currentAsset)) {
                        echoedTickers.push(ticker);
                        continue;
                    }
                    // Sessão velha demais: a fonte respondeu e datou honestamente,
                    // e a data diz que isso não é preço de hoje. Mesmo destino do
                    // eco — não vira sucesso, e o ativo passa a envelhecer rumo à
                    // baixa em vez de parecer atualizado para sempre.
                    if (this.isStaleSessionQuote(quote)) {
                        staleTickers.push(`${ticker}@${sessionDateKey(quote.marketTime)}`);
                        continue;
                    }
                    successfulTickers.add(ticker);

                    // Julgamento de MAGNITUDE, depois dos de presença e idade.
                    // Roda contra o preço que AINDA está no banco (a gravação vem
                    // depois, no bulkWrite), que é justamente a régua que faltava.
                    const achados = judgeQuote({
                        type: currentAsset?.type || null,
                        price: newPrice,
                        previousClose: quote.previousClose,
                        change: quote.change,
                        storedPrice: currentAsset?.lastPrice,
                        storedPriceDate: currentAsset?.priceDate || null,
                        now,
                    });
                    if (achados.length > 0) {
                        recordSuspectQuote({
                            subject: ticker,
                            type: currentAsset?.type || null,
                            source: quote.source || null,
                            price: newPrice,
                            findings: achados,
                        });
                        suspectTickers.push(`${ticker} (${achados[0].detail})`);
                    }

                    const updatePayload = {
                        lastPrice: newPrice,
                        change: newChange, 
                        // Data da sessão anda SEMPRE junto do change: gravar um sem o
                        // outro é como o cache volta a mentir sobre a idade do dado.
                        priceDate: sessionDateKey(quote.marketTime),
                        previousClose: Number(quote.previousClose) > 0 ? Number(quote.previousClose) : 0,
                        updatedAt: now,
                        isActive: true,
                        failCount: 0, // Reset do contador de falhas em caso de sucesso
                        lastFailDate: null
                    };
                    
                    if (currentAsset && (currentAsset.type === 'CRYPTO' || currentAsset.type === 'STOCK_US' || currentAsset.type === 'ETF')) {
                        if (quote.marketCap) updatePayload.marketCap = quote.marketCap;
                        if (quote.volume) {
                            // STOCK_US/ETF: liquidez em VALOR (moeda/dia = volume × preço), consistente
                            // com a liquidez financeira dos ativos BR e com o sync de fundamentos US.
                            // Evita penalizar ativos caros de baixo giro de papéis no scoringEngine.
                            updatePayload.liquidity = (currentAsset.type === 'STOCK_US' || currentAsset.type === 'ETF')
                                ? quote.volume * newPrice
                                : quote.volume;
                        }
                    }

                    // Enriquece o nome real (Yahoo longName/shortName) quando o
                    // atual está vazio ou é o próprio ticker. Não sobrescreve um
                    // nome já bom (ex.: override curado).
                    const realName = (quote.name || '').trim();
                    if (realName && realName.toUpperCase() !== ticker.toUpperCase()) {
                        const currentName = (currentAsset?.name || '').trim();
                        if (!currentName || currentName.toUpperCase() === ticker.toUpperCase()) {
                            updatePayload.name = realName;
                        }
                    }

                    // A variação contestada é reancorada DEPOIS do laço, porque a
                    // âncora está no banco (`AssetHistory`) e ir lá por ativo, no
                    // meio do lote, custaria uma consulta por cotação suspeita. A
                    // referência ao payload é guardada aqui e o par é corrigido
                    // numa passada só, com uma agregação por sessão.
                    if (contestsChange(achados)) {
                        contestados.push({
                            ticker,
                            type: currentAsset?.type || null,
                            sessionDate: updatePayload.priceDate,
                            price: newPrice,
                            payload: updatePayload,
                        });
                    }

                    operations.push({
                        updateOne: {
                            filter: { ticker: ticker },
                            update: {
                                $set: updatePayload
                            }
                        }
                    });
                }
            }

            // --- VARIAÇÃO CONTESTADA: REANCORA NO NOSSO PRÓPRIO FECHAMENTO ---
            // O preço da fonte fica (ele é auditável contra o fechamento oficial
            // da B3 e passa); o par variação/fechamento-anterior, não. XPIN11
            // estava gravado com +108% e previousClose de 29,82 enquanto a nossa
            // série mostrava 62,04 parado havia semanas — número que a carteira
            // exibiria como "variação de hoje".
            //
            // Uma agregação por SESSÃO (na prática, uma só): o candle anterior
            // vem da mesma fonte que o snapshot diário usa para marcar patrimônio,
            // e usar outra aqui reintroduziria a divergência que `dayCloses.js`
            // existe para fechar.
            if (contestados.length > 0) {
                const porSessao = new Map();
                for (const c of contestados) {
                    if (!c.sessionDate) continue; // sem sessão não há "antes de"
                    if (!porSessao.has(c.sessionDate)) porSessao.set(c.sessionDate, []);
                    porSessao.get(c.sessionDate).push(c);
                }
                for (const [sessao, itens] of porSessao) {
                    try {
                        const closes = await loadLatestCloseBefore(itens, sessao);
                        for (const item of itens) {
                            item.ownClose = closes.get(historyStorageKey(item.ticker, item.type))?.close ?? null;
                        }
                    } catch (err) {
                        // A âncora é um LUXO comparada à cotação: sem o candle, a
                        // variação contestada cai em zero (que é o veredito seguro)
                        // e o lote inteiro de preços segue para o banco. Deixar a
                        // exceção subir custaria todas as cotações do lote por uma
                        // consulta acessória.
                        logger.warn(`[MarketData] Sem âncora para reancorar variação (${sessao}): ${err.message}`);
                    }
                }
                for (const c of contestados) {
                    const { change, previousClose } = resolveContestedChange({
                        price: c.price,
                        ownClose: c.ownClose,
                    });
                    c.payload.change = change;
                    c.payload.previousClose = previousClose;
                }
                logger.warn(
                    `🧭 [MarketData] ${contestados.length} variação(ões) reancorada(s) no nosso fechamento `
                    + `(a fonte se contradisse): ${contestados.map((c) => `${c.ticker}→${c.payload.change.toFixed(2)}%`).join(', ')}`,
                    { reanchored: contestados.map((c) => c.ticker) },
                );
            }

            // --- BLACKLIST DINÂMICA (DETECTAR FALHAS) ---
            // Tickers solicitados que NÃO retornaram preço válido ganham failCount
            // (gate de 1/dia, teto de 999, blue chips protegidas). Regra única em
            // buildQuoteFailureOps — ver comentário lá.
            const failedAssets = toUpdate
                .filter(t => !successfulTickers.has(t))
                .map(t => assetMap.get(t));
            operations.push(...this.buildQuoteFailureOps(failedAssets, successfulTickers));

            // O eco precisa aparecer com nome próprio no log: no report ele some
            // dentro de "falhou em todas as fontes", que é uma frase diferente —
            // aqui uma fonte RESPONDEU, com um número que não vale como pregão.
            if (echoedTickers.length > 0) {
                logger.warn(
                    `🔁 [MarketData] ${echoedTickers.length} ativo(s) só ecoaram o preço já gravado (fonte sem data de sessão): ${echoedTickers.join(', ')}`,
                    { echoed: echoedTickers },
                );
            }
            // Símbolo trocado se parece com isto: o preço chega, datado, e a data é
            // de meses atrás. O ticker vai com a sessão colada para o log responder
            // "desde quando" sem ninguém precisar abrir o banco.
            if (staleTickers.length > 0) {
                logger.warn(
                    `🕰️ [MarketData] ${staleTickers.length} ativo(s) com cotação de sessão antiga (> ${RETIRE_RECENT_CANDLE_DAYS}d) — não gravada como preço de hoje: ${staleTickers.join(', ')}`,
                    { stale: staleTickers },
                );
            }

            // Suspeita não é falha, e o log precisa dizer isso: o preço FOI
            // gravado. Sem a frase, quem lê a linha assume que o ativo ficou sem
            // cotação e vai procurar um defeito que não existe.
            if (suspectTickers.length > 0) {
                logger.warn(
                    `📈 [MarketData] ${suspectTickers.length} cotação(ões) fora da magnitude esperada `
                    + `(gravadas; podem ser grupamento/desdobramento): ${suspectTickers.join(' | ')}`,
                    { suspects: suspectTickers },
                );
            }

            if (operations.length > 0) {
                await MarketAsset.bulkWrite(operations);
            }

            // Provento do dia-ex: só detectável DURANTE a sessão em que o gap
            // existe. Depois do bulkWrite para não atrasar a gravação da cotação.
            //
            // Cotação com variação contestada fica de FORA: o sinal de provento é
            // justamente a distância entre o `previousClose` da fonte e o nosso
            // candle bruto — e é esse `previousClose` que acabou de ser
            // desqualificado. Com XPIN11 (fonte dizendo 29,82 contra o nosso
            // candle de 62,04) o gap viraria um "provento" de R$ 32,22 por cota.
            const contestadoSet = new Set(contestados.map((c) => c.ticker));
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
                        historyEntry.history = externalHistory;
                        historyEntry.lastUpdated = now;
                        await historyEntry.save();
                    } else {
                        historyEntry = await AssetHistory.create({
                            ticker: storageKey,
                            history: externalHistory,
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
            const inactiveAssets = await MarketAsset.find({ isActive: false, isBlacklisted: false }).select('ticker failCount type marketCap updatedAt lastPrice');
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
                            update: { $set: { isActive: true, failCount: 0, lastFailDate: null, lastPrice: quote.price, change: quote.change || 0, priceDate: sessionDateKey(quote.marketTime), updatedAt: new Date() } }
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
                    .map(a => `${a.ticker} (${daysSince(a.updatedAt) ?? '?'}d)`)
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
    async retireStaleInactiveAssets(stillInactive) {
        const eligible = (stillInactive || []).filter(a =>
            (a.failCount || 0) >= MAX_FAILURES_BEFORE_BLACKLIST
            && (daysSince(a.updatedAt) ?? 0) >= RETIRE_AFTER_INACTIVE_DAYS,
        );
        if (eligible.length === 0) return [];

        // Detido em carteira → fora do automático (a baixa muda a tela do dono).
        const heldTickers = await UserAsset.distinct('ticker', { ticker: { $in: eligible.map(a => a.ticker) } });
        const held = new Set(heldTickers);
        const candidates = eligible.filter(a => !held.has(a.ticker));
        if (candidates.length === 0) return [];

        // Última prova antes da baixa: o endpoint de cotação e o de histórico do
        // Yahoo não cobrem o mesmo conjunto de papéis — HGPO11 (FII ilíquido) não
        // devolve quote nenhum e mesmo assim tem candle de dois dias atrás. Candle
        // recente = papel vivo: mantém inativo (o quote é que não o serve) e NÃO
        // aposenta. Histórico sem resposta conta como ausência de prova de vida —
        // o papel já falhou cotação nos 90 dias da quarentena, a baixa é reversível
        // (`retireDeadTickers.js --undo`) e o log nomeia quem saiu.
        const targets = [];
        for (const a of candidates) {
            let candles = null;
            try {
                candles = await externalMarketService.getFullHistory(a.ticker, a.type);
            } catch { /* fonte fora → segue como "sem candle" e a baixa acontece */ }
            const last = Array.isArray(candles) ? [...candles].reverse().find(c => c?.close > 0) : null;
            const candleAge = last ? daysSince(last.date) : null;
            if (candleAge !== null && candleAge <= RETIRE_RECENT_CANDLE_DAYS) {
                logger.info(`↩️ [Reativação] ${a.ticker} segue negociando (candle de ${candleAge}d) — não aposenta, só não cota via quote.`);
                continue;
            }
            targets.push(a);
        }
        if (targets.length === 0) return [];

        const now = new Date();
        await MarketAsset.bulkWrite(targets.map(a => ({
            updateOne: {
                filter: { ticker: a.ticker, isBlacklisted: false },
                update: {
                    $set: {
                        isBlacklisted: true,
                        // isActive junto, sempre. Aqui o candidato JÁ vem inativo, então
                        // a linha é redundante no caminho feliz — e é exatamente por ser
                        // redundante que ela precisa existir: o estado terminal fica
                        // completo em uma escrita só, e não depende de quem chamou ter
                        // deixado o documento no estado certo.
                        isActive: false,
                        retiredAt: now,
                        retiredReason: `auto: ${daysSince(a.updatedAt)}d sem cotação em nenhuma fonte`,
                    },
                },
            },
        })));

        const detail = targets.map(a => `${a.ticker} (${daysSince(a.updatedAt)}d)`).join(', ');
        logger.info(
            `🪦 [Reativação] ${targets.length} ativo(s) aposentado(s) após ${RETIRE_AFTER_INACTIVE_DAYS}d sem cotação: ${detail}`,
            { retired: targets.map(a => a.ticker), quarantineDays: RETIRE_AFTER_INACTIVE_DAYS },
        );
        if (held.size > 0) {
            logger.warn(`⚠️ [Reativação] Sem cotação há ${RETIRE_AFTER_INACTIVE_DAYS}d+ mas detido(s) em carteira — decidir a dedo: ${[...held].join(', ')}`);
        }
        return targets.map(a => a.ticker);
    },

    async getMarketData(assetClass) {
        const isBrasil = assetClass === 'STOCK' || assetClass === 'FII' || assetClass === 'BRASIL_10';
        const isCrypto = assetClass === 'CRYPTO';
        const isStockUS = assetClass === 'STOCK_US';
        // Classe ETF (unificada): ETFs nacionais (type 'ETF') + internacionais
        // (STOCK_US com usSubType 'ETF'/'GOLD' — ouro é investido via ETF, PR8).
        const isEtf = assetClass === 'ETF';
        // Classe REIT (independente): REITs individuais do Exterior (STOCK_US/usSubType 'REIT').
        const isReit = assetClass === 'REIT';
        const results = [];

        if (isBrasil || isCrypto || isStockUS || isEtf || isReit) {
            // Filtro por tipo: BRASIL_10 = STOCK+FII; ETF = union BR+internacional(+ouro);
            // REIT = só REITs individuais; STOCK_US (Exterior) = ações puras (sem REIT/ETF/
            // GOLD/DOLLAR, que têm rankings/baldes próprios); demais = direto.
            let typeFilter;
            if (assetClass === 'BRASIL_10') {
                typeFilter = { type: { $in: ['STOCK', 'FII'] } };
            } else if (isEtf) {
                typeFilter = { $or: [{ type: 'ETF' }, { type: 'STOCK_US', usSubType: { $in: ['ETF', 'GOLD'] } }] };
            } else if (isReit) {
                typeFilter = { type: 'STOCK_US', usSubType: 'REIT' };
            } else if (isStockUS) {
                // $nin também casa usSubType ausente/null → tratado como ação (STOCK).
                typeFilter = { type: 'STOCK_US', usSubType: { $nin: ['REIT', 'ETF', 'GOLD', 'DOLLAR'] } };
            } else {
                typeFilter = { type: { $in: [assetClass] } };
            }

            // Sem filtro de liquidez aqui — scoringEngine.js gera DiscardLog para tickers insuficientes
            const extraFilter = {};

            const dbAssets = await MarketAsset.find({
                ...typeFilter,
                isIgnored: false,
                isBlacklisted: false,
                isActive: true,
                ...extraFilter
            });

            // (Fase 3) Carrega a série temporal de fundamentos (track record) em um único
            // find e resume por ticker. Vazio/insuficiente → summarizeTrackRecord = null →
            // o scoringEngine não aplica bônus (dimensão DORMENTE até a série acumular).
            let trackByTicker = new Map();
            try {
                const snaps = await FundamentalSnapshot
                    .find({ ticker: { $in: dbAssets.map(a => a.ticker) } })
                    .select('ticker history').lean();
                trackByTicker = new Map(snaps.map(s => [s.ticker, summarizeTrackRecord(s.history)]));
            } catch (e) {
                logger.warn(`[MarketData] Falha ao carregar track record: ${e.message}`);
            }

            for (const asset of dbAssets) {
                // Filtro de liquidez removido daqui e centralizado no scoringEngine.js para gerar DiscardLog

                // --- MELHORIA CRÍTICA 1: Distinguir dado ausente de dado ruim ---
                // Campos onde 0 = quase certamente dado não coletado (nunca são exatamente 0 na prática)
                const _missing = {
                    pl:            !asset.pl            || asset.pl === 0,
                    marketCap:     !asset.marketCap     || asset.marketCap === 0,
                    roe:           !asset.roe            || asset.roe === 0,
                    netMargin:     !asset.netMargin      || asset.netMargin === 0,
                    revenueGrowth: !asset.revenueGrowth  || asset.revenueGrowth === 0,
                    evEbitda:      !asset.evEbitda       || asset.evEbitda === 0,
                    beta:          !asset.beta           || asset.beta === 0,
                    // Campos com 0 legítimo — NÃO marcados como ausentes
                    dy:            false,   // Empresa pode não pagar dividendos
                    debtToEquity:  false,   // Empresa pode não ter dívida
                    payout:        false,   // Empresa pode não distribuir
                };

                // Calcula completude dos dados fundamentalistas (0–100%)
                const fundamentalFields = ['pl', 'marketCap', 'roe', 'netMargin', 'revenueGrowth', 'evEbitda'];
                const missingCount = fundamentalFields.filter(f => _missing[f]).length;
                const dataCompleteness = Math.round(((fundamentalFields.length - missingCount) / fundamentalFields.length) * 100);

                // Calcula quantos dias desde a última atualização de fundamentais
                const _staleDays = asset.lastFundamentalsDate
                    ? Math.floor((Date.now() - new Date(asset.lastFundamentalsDate).getTime()) / (1000 * 60 * 60 * 24))
                    : null;

                // REITs do Exterior: setor de EXIBIÇÃO vira o sub-segmento fino (Varejo,
                // Industrial/Logística, Saúde…) p/ diversificar o donut — o `sector` no
                // banco segue "Real Estate" (classificação intacta).
                const isReitDisplay = asset.type === 'STOCK_US' && asset.usSubType === 'REIT';
                const displaySector = isReitDisplay ? reitSegmentPT(asset.industry) : asset.sector;

                results.push({
                    ticker: asset.ticker,
                    type: asset.type,
                    allocationClass: asset.allocationClass || null,
                    currency: asset.currency || (asset.type === 'STOCK_US' ? 'USD' : 'BRL'),
                    name: asset.name || asset.ticker,
                    sector: displaySector,
                    // Metadados da calibração buy-and-hold STOCK. Permanecem no
                    // topo para não contaminar `metrics` com dados de proveniência.
                    stockArchetype: asset.stockArchetype || null,
                    sectorMetrics: asset.sectorMetrics?.toObject
                        ? asset.sectorMetrics.toObject()
                        : (asset.sectorMetrics || {}),
                    fiiSubType: asset.fiiSubType || null,
                    usSubType: asset.usSubType || null,
                    price: asset.lastPrice || 0,
                    dbFlags: { isBlacklisted: asset.isBlacklisted, isTier1: asset.isTier1 },
                    metrics: {
                        ticker: asset.ticker,
                        price: asset.lastPrice,
                        dy: asset.dy || 0,
                        pvp: asset.pvp || asset.p_vp || 0,
                        marketCap: asset.marketCap || 0,
                        avgLiquidity: asset.avgLiquidity || asset.liquidity || 0,
                        pl: asset.pl || 0,
                        roe: asset.roe || 0,
                        roic: asset.roic || 0,
                        netMargin: asset.netMargin || 0,
                        evEbitda: asset.evEbitda || 0,
                        revenueGrowth: asset.revenueGrowth || 0,
                        debtToEquity: asset.debtToEquity || 0,
                        netDebt: asset.netDebt || 0,
                        payout: asset.payout || 0,
                        // Financials LTM (cacheados): preenchem o modal "Financials (LTM)".
                        netRevenue: asset.netRevenue || 0,
                        netIncome: asset.netIncome || 0,
                        totalAssets: asset.totalAssets || 0,
                        patrimLiq: asset.patrimLiq || 0,
                        vacancy: asset.vacancy || 0,
                        capRate: asset.capRate || 0,
                        qtdImoveis: asset.qtdImoveis || 0,
                        // FFO do FII (0 = fonte não publicou). vpCota alimenta o VP do preço
                        // justo em calculateIntrinsicValue, que sem ele usa o fallback price/pvp.
                        ffoYield: asset.ffoYield || 0,
                        vpCota: asset.vpCota || 0,
                        ffoCota: asset.ffoCota || 0,
                        volatility: asset.volatility || 0,
                        beta: asset.beta || 0,
                        sma200: asset.sma200 || 0,
                        ema50: asset.ema50 || 0,
                        // Passados para o scoringEngine identificar isPapel e setor
                        sector: asset.sector,
                        fiiSubType: asset.fiiSubType || null,
                        // Flags de qualidade de dados
                        _missing,
                        _staleDays,
                        dataCompleteness,
                        // (Fase 3) Resumo de track record (consistência ao longo do tempo) ou
                        // null quando não há série suficiente. Consumido pelo scoringEngine.
                        trackRecord: trackByTicker.get(asset.ticker) || null,
                        structural: {
                            quality: 50,
                            valuation: 50,
                            risk: 50
                        }
                    }
                });
            }
        }
        
        if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
            return deduplicateAssets(results);
        }
        return results;
    }
};

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
