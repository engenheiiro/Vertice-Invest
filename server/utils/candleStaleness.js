/**
 * Atraso do último CANDLE de uma série de `AssetHistory`.
 *
 * Puro de propósito (nada de Mongo): a coleta das datas fica em
 * `services/dataHealthService.js`, o veredito em `utils/dataHealthRules.js`, e o
 * cálculo do atraso mora aqui no meio — onde dá para testar sem banco.
 *
 * Por que a data do CANDLE e não `AssetHistory.lastUpdated`: lastUpdated marca
 * quando o worker BUSCOU, não o que ele trouxe. Em 20/08/2026 as séries de BOVA11
 * e IVVB11 tinham lastUpdated da mesma manhã e candle mais recente de 18/08 — a
 * sentinela, que media lastUpdated contra um corte de 168h, deu tudo verde com 910
 * de ~1.264 ativos parados no dia 17. É exatamente o erro que o próprio worker já
 * havia corrigido dentro de `isHistoryStale` (jul/2026, o "touch" diário renovava
 * lastUpdated sem dados novos) e que a sentinela seguia repetindo.
 */
import { brazilDayKey, isBrBusinessDay } from './walletSnapshot.js';
import { historyStorageKey } from './assetHistory.js';

/** Classes que negociam 24/7 — medidas em dias CORRIDOS, não úteis. */
const TRADES_EVERY_DAY = new Set(['CRYPTO']);

/**
 * Janela de varredura, em dias corridos. Série mais velha que isso devolve o teto
 * da escala: não interessa distinguir "parou há 20 dias" de "parou em 2018", os
 * dois já estouraram qualquer limiar.
 */
export const CANDLE_CLOCK_WINDOW_DAYS = 25;

/**
 * Pré-calcula as chaves de dia (fuso BR) da janela, uma vez por relatório.
 * Sem isso seriam ~1.000 ativos × dezenas de `Intl.DateTimeFormat` cada um.
 */
export const buildCandleClock = (now = new Date(), windowDays = CANDLE_CLOCK_WINDOW_DAYS) => {
    const calendarDays = [];
    const businessDays = [];
    const base = new Date(now).getTime();
    for (let i = windowDays; i >= 0; i -= 1) {
        const key = brazilDayKey(new Date(base - i * 86400000));
        calendarDays.push(key);
        if (isBrBusinessDay(key)) businessDays.push(key);
    }
    return { todayKey: calendarDays[calendarDays.length - 1], calendarDays, businessDays };
};

/**
 * Atraso do último candle, em dias ÚTEIS (B3/EUA) ou CORRIDOS (cripto).
 *
 * A régua PRECISA ser diferente por classe: dia útil na cripto faria uma série
 * parada na sexta parecer em dia no domingo, e dia corrido na B3 acusaria atraso
 * todo fim de semana — alarme que toca todo sábado é alarme que se aprende a ignorar.
 *
 * Hoje entra na contagem, então o piso saudável NÃO é zero durante o pregão: o
 * candle de fechamento de D só existe depois do fechamento (o worker roda às 18:30),
 * e até lá o mais novo possível é o de D-1. Um dia de atraso é o estado normal da
 * manhã, não defeito.
 */
export const candleDaysStale = (lastCandleDate, type, clock) => {
    const scale = TRADES_EVERY_DAY.has(String(type || '').toUpperCase())
        ? clock.calendarDays
        : clock.businessDays;
    if (!lastCandleDate) return scale.length; // sem série = pior caso possível
    let stale = 0;
    for (let i = scale.length - 1; i >= 0 && scale[i] > lastCandleDate; i -= 1) stale += 1;
    return stale;
};

/**
 * Resume o atraso de uma COORTE de ativos.
 *
 * A conta é dirigida pela coorte, nunca pelo conteúdo de `AssetHistory`: a coleção
 * guarda séries legitimamente mortas (SMAL parou em 2018; MATIC, RNDR, IMX, GRT e
 * TAO são chaves de cripto que saíram da fonte; MERC4 deixou a bolsa em abril) e
 * varrer tudo faria o alarme nascer vermelho e permanecer vermelho — ruído que
 * ninguém olha. Quem decide relevância é quem monta a coorte: posição viva em
 * carteira, ou ativo líquido do universo de pesquisa.
 *
 * @param {Array<{ticker:string,type:string}>} cohort ativos relevantes
 * @param {Map<string,string|null>} lastCandleByKey data do último candle por historyStorageKey
 * @param {{calendarDays:string[],businessDays:string[]}} clock de `buildCandleClock`
 * @param {number} toleranceDays atraso a partir do qual o ativo conta como parado
 */
export const summarizeCandleStaleness = (
    cohort = [],
    lastCandleByKey = new Map(),
    clock,
    toleranceDays,
    sampleSize = 10,
) => {
    const seen = new Set();
    const stale = [];
    for (const asset of cohort) {
        const key = historyStorageKey(asset?.ticker, asset?.type);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const lastCandle = lastCandleByKey.get(key) || null;
        const daysStale = candleDaysStale(lastCandle, asset?.type, clock);
        if (daysStale >= toleranceDays) {
            stale.push({ ticker: asset.ticker, lastCandle, daysStale });
        }
    }

    stale.sort((a, b) => b.daysStale - a.daysStale || (a.ticker < b.ticker ? -1 : 1));

    // Concentração por data: numa falha de cobertura do worker as séries param
    // TODAS no mesmo dia (910 em 17/08/2026), e essa é a informação que separa
    // "o worker perdeu um ciclo" de "alguns tickers morreram na fonte".
    const byDate = new Map();
    for (const s of stale) {
        const key = s.lastCandle || 'sem série';
        byDate.set(key, (byDate.get(key) || 0) + 1);
    }

    return {
        total: seen.size,
        stale: stale.length,
        worst: stale.slice(0, sampleSize),
        dates: [...byDate.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([date, count]) => ({ date, count })),
    };
};
