/**
 * Montagem (PURA) dos fatos da sentinela de saúde dos dados.
 *
 * `services/dataHealthService.js` faz a coleta (IO) e entrega aqui os resultados
 * brutos das consultas, por nome; este módulo resolve as réguas de tempo e dá a
 * forma que `utils/dataHealthRules.js` consome. Nenhuma consulta mora aqui.
 */
import { DEFAULT_THRESHOLDS } from './dataHealthRules.js';
import { brazilDayKey, isBrBusinessDay } from './walletSnapshot.js';
import { auditTreasuryCatalog } from './treasuryCatalogAudit.js';

/**
 * Dias ÚTEIS entre a data do último PU ('YYYY-MM-DD') e hoje.
 *
 * Em horas o check acusaria ~52h todo domingo, porque o Tesouro só publica em dia
 * útil e a última data disponível no fim de semana é sempre a sexta. Contar em
 * dias úteis (pulando feriado, via holidayService) faz "0 = em dia" valer também
 * no domingo, e um atraso de verdade aparecer no primeiro dia útil sem publicação.
 */
const businessDaysStale = (latestDateStr, now) => {
    if (!latestDateStr) return null;
    const todayKey = brazilDayKey(now);
    let count = 0;
    let cursor = latestDateStr;
    // Teto de 30 iterações: série abandonada não deve virar laço longo.
    for (let i = 0; i < 30; i += 1) {
        const d = new Date(`${cursor}T12:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        cursor = brazilDayKey(d);
        if (cursor > todayKey) break;
        if (isBrBusinessDay(cursor)) count += 1;
    }
    return count;
};

/** Override do Admin quando é número não-zero; senão o padrão. */
const thresholdOf = (overrides, key) => Number(overrides?.[key]) || DEFAULT_THRESHOLDS[key];

/**
 * Cortes de data e tolerâncias que a coleta precisa ANTES de consultar: quem
 * separa "parado" de "em dia" é a régua, não o corte de datas.
 */
export const resolveCollectionWindows = (overrides, now) => {
    const staleAfterHours = thresholdOf(overrides, 'priceStaleAfterHours');
    const staleCutoff = new Date(now.getTime() - staleAfterHours * 3600000);
    const since24h = new Date(now.getTime() - 24 * 3600000);
    const fundamentalsDays = thresholdOf(overrides, 'fundamentalsDateStaleAfterDays');
    const fundamentalsCutoff = new Date(now.getTime() - fundamentalsDays * 86400000);
    // Tolerâncias de atraso do candle (em dias).
    const candleTolerances = {
        timeSeriesWalletDaysStale: thresholdOf(overrides, 'timeSeriesWalletDaysStale'),
        timeSeriesWalletDaysStaleCrypto: thresholdOf(overrides, 'timeSeriesWalletDaysStaleCrypto'),
        timeSeriesUniverseDaysStale: thresholdOf(overrides, 'timeSeriesUniverseDaysStale'),
    };
    const frozenDays = thresholdOf(overrides, 'frozenPriceAfterDays');
    const frozenCutoff = new Date(now.getTime() - frozenDays * 86400000);
    return { staleCutoff, since24h, fundamentalsCutoff, candleTolerances, frozenCutoff };
};

/**
 * Campos do `MACRO_INDICATORS` que viram fato, na ordem: [saída, origem, forma].
 * `raw` copia, `orNull` troca falso por null, `bool` força booleano.
 *
 * - `ratesSources`/`ratesUpdatedAt`/`ratesStale`: origem efetiva das taxas
 *   oficiais. Sem isto dá para ver que a Selic está fresca, mas não que ela veio
 *   da secundária porque o BCB caiu.
 * - `currencies*`: frescor do bloco de MOEDAS, medido à parte. `lastUpdated`
 *   avança a cada run do cron mesmo com a fonte de câmbio fora do ar, então
 *   sozinho ele dava saúde verde para um dólar de ontem — 04/09/2026, um dia
 *   inteiro sem ninguém ver.
 * - `indices*`: mesma separação, para os ÍNDICES. Sem eles o painel só tinha
 *   `lastUpdated` para responder pelo Ibovespa, e `lastUpdated` responde pelo
 *   documento inteiro.
 */
const MACRO_FIELDS = [
    ['selic', 'selic', 'raw'],
    ['ipca', 'ipca', 'raw'],
    ['cdi', 'cdi', 'raw'],
    ['ibov', 'ibov', 'raw'],
    ['dollar', 'dollar', 'raw'],
    ['btc', 'btc', 'raw'],
    ['updatedAt', 'lastUpdated', 'orNull'],
    ['ratesSources', 'ratesSources', 'orNull'],
    ['ratesUpdatedAt', 'ratesUpdatedAt', 'orNull'],
    ['ratesStale', 'ratesStale', 'bool'],
    ['currenciesUpdatedAt', 'currenciesUpdatedAt', 'orNull'],
    ['currenciesStale', 'currenciesStale', 'bool'],
    ['currenciesSources', 'currenciesSources', 'orNull'],
    ['indicesUpdatedAt', 'indicesUpdatedAt', 'orNull'],
    ['indicesStale', 'indicesStale', 'bool'],
    ['indicesSources', 'indicesSources', 'orNull'],
];

const SHAPE = {
    raw: (v) => v,
    orNull: (v) => v || null,
    bool: (v) => !!v,
};

const shapeMacroFacts = (macroConfig) => {
    if (!macroConfig) return {};
    return Object.fromEntries(
        MACRO_FIELDS.map(([out, src, shape]) => [out, SHAPE[shape](macroConfig[src])]),
    );
};

const shapeTreasuryFacts = (treasuryRows, now) => {
    const treasury = treasuryRows[0] || {};
    return {
        titles: treasury.titles || 0,
        // history.date é 'YYYY-MM-DD'; ancorar ao meio-dia UTC evita que o fuso
        // jogue o dia para trás na conversão.
        latestDate: treasury.latest ? new Date(`${treasury.latest}T12:00:00.000Z`) : null,
        businessDaysStale: businessDaysStale(treasury.latest, now),
    };
};

const shapeFundamentalsFacts = (macroConfig) => {
    const stats = macroConfig?.lastSyncStats;
    return {
        healthy: stats?.fundamentalsHealthy === true,
        timestamp: stats?.timestamp || null,
        errorCode: stats?.errorCode || null,
    };
};

/**
 * Chave = `priceSource` gravado no ativo; valor = quando aquela fonte escreveu
 * preço pela última vez, e para quantos ativos. É o relógio de ENTREGA da cadeia
 * de cotação.
 */
const shapePriceDelivery = (rows) => Object.fromEntries(
    (rows || []).map((r) => [r._id, { at: r.at || null, assets: r.assets || 0 }]),
);

/**
 * Fatos no formato de `buildHealthReport`, a partir dos resultados nomeados da
 * coleta (`c`). `email` e `walletPayload` já chegam prontos.
 */
export const assembleHealthFacts = (now, c) => ({
    now,
    totals: {
        all: c.totalAll,
        active: c.assetFacts.activeTotal,
        inactive: c.totalInactive,
        retiredButActive: c.retiredButActive,
    },
    assets: c.assetFacts.assets,
    implausible: c.assetFacts.implausible,
    macro: shapeMacroFacts(c.macroConfig),
    treasury: shapeTreasuryFacts(c.treasuryRows, now),
    treasuryCatalog: auditTreasuryCatalog(c.treasuryCatalogRows, { now }),
    timeSeries: c.candleFacts,
    fundamentals: shapeFundamentalsFacts(c.macroConfig),
    jobs: c.jobs,
    email: c.email,
    errors: { last24h: c.errors24h[0]?.total || 0 },
    // Carteiras degradadas: total nas 24h e QUAIS buscas caíram — é o que decide o conserto.
    walletPayload: c.walletPayload,
    // Marco zero da instrumentação: sem ele, todo cron diário apareceria como
    // "nunca executado" nas primeiras horas depois do deploy.
    instrumentationSince: c.oldestRun?.startedAt || now,
    frozen: {
        count: c.frozenAssets.length,
        // Só os 10 mais parados no detalhe — a lista inteira não cabe num card.
        tickers: c.frozenAssets.slice(0, 10).map((a) => a.ticker),
    },
    dividendPayment: c.dividendPayment,
    priceDelivery: shapePriceDelivery(c.priceDelivery),
});
