import { isValidDayKey } from './walletSnapshot.js';
import { isDollarized } from './assetCurrency.js';

/**
 * Câmbio de um lançamento em moeda nativa → BRL.
 *
 * Convenção ÚNICA do sistema: `fxRate` é quanto vale UMA unidade da moeda
 * nativa do lançamento em reais NA DATA DELE. Posição em BRL → sempre 1.
 *
 * Existe porque o custo de uma posição em dólar não pode ser reconvertido pelo
 * câmbio de hoje: multiplicar custo E saldo pela mesma taxa cancela o câmbio e
 * esconde o resultado cambial (um stablecoin ficava travado em 0,00% para
 * sempre, e cripto em alta aparecia no vermelho). O câmbio da COMPRA fica
 * congelado no lançamento; só o saldo é marcado a mercado.
 */

/**
 * Resolvedor puro (testável sem banco): recebe as entradas do histórico
 * USD/BRL e devolve `(dayKey) => taxa`.
 *
 * Para datas sem cotação (fim de semana, feriado, gap da fonte) devolve a taxa
 * mais recente ANTERIOR ao alvo via busca binária — nunca a taxa de hoje, que
 * contaminaria retroativamente o custo de uma compra antiga.
 */
export const buildUsdRateResolver = (historyEntries, currentUsdRate) => {
    const rateByDate = new Map();
    for (const entry of historyEntries || []) {
        const rate = Number(entry?.adjClose ?? entry?.close);
        if (isValidDayKey(entry?.date) && Number.isFinite(rate) && rate > 0) {
            rateByDate.set(entry.date, rate);
        }
    }

    const parsedCurrent = Number(currentUsdRate);
    const hasSpot = Number.isFinite(parsedCurrent) && parsedCurrent > 0;
    // Sem cotação corrente nem série, não há câmbio: nulo (regra 13), nunca um fixo.
    const safeCurrent = hasSpot ? parsedCurrent : null;

    const sorted = [...rateByDate.entries()]
        .map(([day, rate]) => [new Date(day).getTime(), rate])
        .filter(([time]) => !Number.isNaN(time))
        .sort((a, b) => a[0] - b[0]);
    const lastCandleMs = sorted.length > 0 ? sorted[sorted.length - 1][0] : null;

    const resolver = (dayKey) => {
        if (!isValidDayKey(dayKey)) throw new RangeError(`Data de câmbio inválida: ${dayKey}`);
        if (rateByDate.has(dayKey)) return rateByDate.get(dayKey);
        if (sorted.length === 0) return safeCurrent;

        const targetMs = new Date(dayKey).getTime();
        // Depois do último candle (a série fecha com 1-3 dias de atraso), a melhor
        // estimativa é a cotação corrente, não um candle velho — senão uma compra
        // de HOJE nasce com o câmbio da semana passada no custo.
        if (hasSpot && targetMs > lastCandleMs) return safeCurrent;

        let lo = 0, hi = sorted.length - 1, best = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid][0] <= targetMs) { best = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        // Alvo anterior a todo o histórico → 1ª taxa conhecida (não a de hoje).
        return best >= 0 ? sorted[best][1] : sorted[0][1];
    };
    // Sem série E sem cotação corrente, o resolvedor devolve nulo: quem grava
    // histórico (rebuild, snapshot) lê isto para abortar; o recálculo da posição
    // deixa o lançamento sem carimbo (regra 13).
    resolver.hasSeries = sorted.length > 0;
    return resolver;
};

/**
 * Carrega o histórico USD/BRL do banco e devolve o resolvedor por data.
 *
 * O model entra por import dinâmico de propósito: os helpers puros deste módulo
 * são usados no caminho de leitura da carteira, e um import estático arrastaria
 * a definição de schema do Mongoose para todo mundo que só quer converter um
 * custo (quebrando testes que sobem sem banco).
 */
export const loadUsdRateResolver = async (currentUsdRate) => {
    const { default: AssetHistory } = await import('../models/AssetHistory.js');
    // Só `history` importa aqui, e a projeção não é detalhe: `USD-BRL` está em
    // HISTORY_CAP_EXEMPT_TICKERS (config/financialConstants.js), ou seja, é uma
    // das poucas séries que NUNCA é truncada nos 400 candles — ela cresce um
    // ponto por dia, para sempre, e este documento é o maior que a carteira lê.
    const doc = await AssetHistory.findOne({ ticker: 'USD-BRL' }).select('history').lean();
    return buildUsdRateResolver(doc?.history, currentUsdRate);
};

/** Chave de dia (UTC) usada pelo histórico de câmbio. */
export const fxDayKey = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * Câmbio efetivo de um lançamento: o carimbado na compra tem precedência
 * absoluta sobre qualquer reconstrução histórica — ele É o fato.
 */
export const effectiveFxRate = (tx, currency, resolver) => {
    const stamped = Number(tx?.fxRate);
    if (Number.isFinite(stamped) && stamped > 0) return stamped;
    if (currency !== 'USD') return 1;
    return resolver(fxDayKey(tx.date));
};

/**
 * Valor em BRL de um campo de custo/resultado da posição.
 *
 * Precedência: o acumulado com o câmbio de cada lançamento (`brlField`) quando
 * existe; senão o legado — moeda nativa × câmbio de HOJE. O fallback é o
 * comportamento antigo, mantido para posições ainda não recalculadas: ele
 * esconde o resultado cambial, mas nunca quebra a leitura.
 *
 * `null` é o marcador de "não migrado" e precisa de checagem explícita:
 * `Number(null)` é 0 e finito, então um teste ingênuo zeraria o custo.
 */
const nativeToBRL = (asset, nativeValue, brlValue, spotUsdRate) => {
    if (brlValue != null && Number.isFinite(Number(brlValue))) return Number(brlValue);
    const native = Number(nativeValue) || 0;
    return isDollarized(asset) ? native * (Number(spotUsdRate) || 0) : native;
};

/** Custo total da posição em BRL. */
export const positionCostBRL = (asset, spotUsdRate) =>
    nativeToBRL(asset, asset?.totalCost, asset?.totalCostBrl, spotUsdRate);

/** Lucro realizado da posição em BRL. */
export const positionRealizedProfitBRL = (asset, spotUsdRate) =>
    nativeToBRL(asset, asset?.realizedProfit, asset?.realizedProfitBrl, spotUsdRate);

/**
 * Câmbio para EXIBIR (KPI, carteira, metas, rebalanceamento) — regra 13.
 *
 * Ordem: a cotação da macro; sem ela, o último candle REAL da série USD/BRL
 * (último valor bom, com a data junto); sem nenhum dos dois, `null`. Antes era
 * `config?.dollar || 5.75`: a tela mostrava um câmbio inventado como cotação.
 */
export const pickDisplayUsdRate = (macroDollar, lastCandle) => {
    const spot = Number(macroDollar);
    if (Number.isFinite(spot) && spot > 0) return { rate: spot, source: 'macro', asOf: null };
    const candle = Number(lastCandle?.adjClose ?? lastCandle?.close);
    if (isValidDayKey(lastCandle?.date) && Number.isFinite(candle) && candle > 0) {
        return { rate: candle, source: 'series', asOf: lastCandle.date };
    }
    return { rate: null, source: null, asOf: null };
};

/** Lê só o último candle da série (`$slice: -1`) quando a macro não tem cotação. */
export const loadDisplayUsdRate = async (config) => {
    if (Number(config?.dollar) > 0) return pickDisplayUsdRate(config.dollar, null);
    try {
        const { default: AssetHistory } = await import('../models/AssetHistory.js');
        const doc = await AssetHistory.findOne({ ticker: 'USD-BRL' }, { history: { $slice: -1 } }).lean();
        return pickDisplayUsdRate(null, doc?.history?.[0]);
    } catch {
        return pickDisplayUsdRate(null, null); // leitura falhou: sem câmbio, nunca um número fixo
    }
};

/**
 * Multiplicador BRL de uma posição. Sem câmbio nenhum, a posição em dólar usa o
 * câmbio MÉDIO das próprias compras (custo BRL ÷ custo nativo, ambos reais) —
 * sem ganho cambial, mas sem inventar cotação. Sem nem isso, 0.
 */
export const usdMultiplierFor = (asset, usdRate) => {
    if (!isDollarized(asset)) return 1;
    if (Number(usdRate) > 0) return Number(usdRate);
    const brl = Number(asset?.totalCostBrl);
    const native = Number(asset?.totalCost);
    return brl > 0 && native > 0 ? brl / native : 0;
};
