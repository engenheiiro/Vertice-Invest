/**
 * Sentinela de saúde dos dados.
 *
 * Roda de hora em hora (e ao fim de todo sync, e sob demanda no Admin) e responde
 * a pergunta que nenhum teste unitário responde: "os dados que estão no banco AGORA
 * servem para o produto?".
 *
 * Complementa as defesas que já existiam:
 *   - `config/scraperSchemas.js` valida o LAYOUT da fonte na hora do scraping;
 *   - `utils/ingestionHealth.js` valida a EXECUÇÃO de um sync (parsed vs. aceitos);
 *   - esta sentinela valida o ESTADO acumulado, independente de quem escreveu e quando.
 *
 * A separação com `utils/dataHealthRules.js` é proposital: aqui só há coleta (IO);
 * lá, só veredito (puro e testável).
 */
import mongoose from 'mongoose';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import AssetHistory from '../models/AssetHistory.js';
import TreasuryPriceHistory from '../models/TreasuryPriceHistory.js';
import TreasuryBond from '../models/TreasuryBond.js';
import UserAsset from '../models/UserAsset.js';
import DataHealthReport from '../models/DataHealthReport.js';
import ErrorLog from '../models/ErrorLog.js';
import JobRun from '../models/JobRun.js';
import logger from '../config/logger.js';
import { isTransientMongoError } from '../utils/mongoResilience.js';
import { JOB_CATALOG } from '../config/jobCatalog.js';
import { brazilDayKey, isBrBusinessDay } from '../utils/walletSnapshot.js';
import { buildCandleClock, summarizeCandleStaleness } from '../utils/candleStaleness.js';
import { auditTreasuryCatalog } from '../utils/treasuryCatalogAudit.js';
import {
    COVERAGE_SPEC,
    DEFAULT_THRESHOLDS,
    HEALTH_STATUS,
    PLAUSIBILITY_RANGES,
    buildHealthReport,
} from '../utils/dataHealthRules.js';

const THRESHOLD_KEY = 'DATA_HEALTH_THRESHOLDS';

/** Classes que a sentinela audita. Fora daqui não há dado de mercado a validar. */
const MONITORED_CLASSES = Object.keys(COVERAGE_SPEC);

// Espelha MIN_LIQUIDITY_FOR_LIVE_QUOTE do syncService: abaixo disso o ativo nunca
// entra no lote de cotação, então preço parado é o esperado e não vira alarme.
const MIN_LIQUIDITY_FOR_LIVE_QUOTE = 100000;

/** Universo auditável: o que o produto realmente usa. */
const ACTIVE_UNIVERSE = {
    isActive: true,
    isBlacklisted: { $ne: true },
    isIgnored: { $ne: true },
};

/** null e 0 contam como ausente — o schema usa `default: 0` em toda métrica. */
const missingExpr = (field) => ({ $eq: [{ $ifNull: [`$${field}`, 0] }, 0] });

const outOfRangeExpr = (field, { min, max }) => ({
    $and: [
        { $ne: [{ $ifNull: [`$${field}`, null] }, null] },
        { $or: [{ $lt: [`$${field}`, min] }, { $gt: [`$${field}`, max] }] },
    ],
});

const sumIf = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });

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

/** Posições de mercado da carteira: só o que tem candle. Espelha loadSnapshotContext. */
const NON_MARKET_WALLET_TYPES = ['CASH', 'FIXED_INCOME'];

/**
 * Atraso do último candle, por coorte.
 *
 * Duas coortes, porque o dano é diferente (ver DEFAULT_THRESHOLDS):
 *   - CARTEIRA: `UserAsset` com quantidade > 0, fora caixa/renda fixa — exatamente
 *     o conjunto que `loadSnapshotContext` marca a fechamento no snapshot diário.
 *   - UNIVERSO: universo ativo COM liquidez acima de MIN_LIQUIDITY_FOR_LIVE_QUOTE.
 *     O filtro de liquidez é o mesmo critério do check de preço congelado, e pela
 *     mesma razão: abaixo dele o ativo não negocia todo pregão, então candle velho
 *     é o esperado e não defeito. Sem esse recorte o alarme nasceria vermelho por
 *     algo que ninguém pretende consertar.
 *
 * Séries órfãs de `AssetHistory` (SMAL parado em 2018, chaves legadas de cripto
 * como MATIC/RNDR/IMX/GRT/TAO) não entram em nenhuma das duas: a conta é dirigida
 * pela coorte, não pelo que está guardado na coleção.
 */
const collectCandleFacts = async (now, th) => {
    const clock = buildCandleClock(now);

    const [seriesRows, holdings, universe] = await Promise.all([
        // Data do ÚLTIMO CANDLE de cada série. `history.date` é 'YYYY-MM-DD', então
        // `$max` devolve a mais recente sem depender da ordenação do array — e é o
        // dado que interessa, ao contrário de `lastUpdated`, que só diz quando o
        // worker passou por ali.
        AssetHistory.aggregate([
            { $project: { _id: 0, ticker: 1, lastCandle: { $max: '$history.date' } } },
        ]),
        UserAsset.find({
            type: { $nin: NON_MARKET_WALLET_TYPES },
            quantity: { $gt: 0 },
        }).select('ticker type').lean(),
        MarketAsset.find({
            ...ACTIVE_UNIVERSE,
            liquidity: { $gt: MIN_LIQUIDITY_FOR_LIVE_QUOTE },
        }).select('ticker type').lean(),
    ]);

    const lastCandleByKey = new Map(seriesRows.map((r) => [r.ticker, r.lastCandle || null]));

    return {
        wallet: summarizeCandleStaleness(
            holdings, lastCandleByKey, clock, th.timeSeriesWalletDaysStale,
        ),
        universe: summarizeCandleStaleness(
            universe, lastCandleByKey, clock, th.timeSeriesUniverseDaysStale,
        ),
    };
};

/** Todos os campos cobrados, sem repetição entre classes. */
const allCoverageFields = () => [
    ...new Set(Object.values(COVERAGE_SPEC).flatMap((spec) => spec.map((s) => s.field))),
];

const collectAssetFacts = async (staleCutoff, fundamentalsCutoff) => {
    const group = {
        _id: '$type',
        active: { $sum: 1 },
        stalePrice: sumIf({ $lt: [{ $ifNull: ['$updatedAt', new Date(0)] }, staleCutoff] }),
        nonPositivePrice: sumIf({ $lte: [{ $ifNull: ['$lastPrice', 0] }, 0] }),
        // Nulo OU mais velho que o corte. `$ifNull` para a época zero faz o nunca
        // coletado cair naturalmente do lado "velho" da comparação.
        staleFundamentals: sumIf({
            $lt: [{ $ifNull: ['$lastFundamentalsDate', new Date(0)] }, fundamentalsCutoff],
        }),
    };

    for (const field of allCoverageFields()) {
        group[`missing__${field}`] = sumIf(missingExpr(field));
    }
    for (const [field, range] of Object.entries(PLAUSIBILITY_RANGES)) {
        group[`imp__${field}`] = sumIf(outOfRangeExpr(field, range));
    }

    const rows = await MarketAsset.aggregate([{ $match: ACTIVE_UNIVERSE }, { $group: group }]);

    const assets = {};
    const implausible = { nonPositivePrice: 0 };
    let activeTotal = 0;

    for (const row of rows) {
        const assetClass = row._id;
        activeTotal += row.active;
        implausible.nonPositivePrice += row.nonPositivePrice || 0;
        for (const field of Object.keys(PLAUSIBILITY_RANGES)) {
            implausible[field] = (implausible[field] || 0) + (row[`imp__${field}`] || 0);
        }
        // Classes fora do escopo (FIXED_INCOME, CASH, OURO) entram só no total.
        if (!MONITORED_CLASSES.includes(assetClass)) continue;

        const missing = {};
        for (const { field } of COVERAGE_SPEC[assetClass]) {
            missing[field] = row[`missing__${field}`] || 0;
        }
        assets[assetClass] = {
            active: row.active,
            stalePrice: row.stalePrice || 0,
            staleFundamentals: row.staleFundamentals || 0,
            missing,
        };
    }

    return { assets, implausible, activeTotal };
};

const collectJobFacts = async () => {
    // Última execução de cada job, numa varredura só.
    const rows = await JobRun.aggregate([
        { $sort: { startedAt: -1 } },
        {
            $group: {
                _id: '$jobId',
                lastRunAt: { $first: '$startedAt' },
                lastStatus: { $first: '$status' },
                lastError: { $first: '$error' },
            },
        },
    ]);
    const byId = new Map(rows.map((r) => [r._id, r]));

    return Object.entries(JOB_CATALOG)
        .filter(([, meta]) => meta.monitored !== false)
        .map(([jobId, meta]) => {
            const last = byId.get(jobId);
            return {
                jobId,
                label: meta.label,
                severity: meta.severity,
                maxSilenceHours: meta.maxSilenceHours,
                lastRunAt: last?.lastRunAt || null,
                lastStatus: last?.lastStatus || null,
                lastError: last?.lastError || null,
            };
        });
};

const collectFacts = async (now) => {
    const thresholdDoc = await SystemConfig.findOne({ key: THRESHOLD_KEY }).lean();
    const overrides = thresholdDoc?.value || null;
    const staleAfterHours = Number(overrides?.priceStaleAfterHours)
        || DEFAULT_THRESHOLDS.priceStaleAfterHours;
    const staleCutoff = new Date(now.getTime() - staleAfterHours * 3600000);
    const since24h = new Date(now.getTime() - 24 * 3600000);
    const fundamentalsDays = Number(overrides?.fundamentalsDateStaleAfterDays)
        || DEFAULT_THRESHOLDS.fundamentalsDateStaleAfterDays;
    const fundamentalsCutoff = new Date(now.getTime() - fundamentalsDays * 86400000);
    // Tolerâncias de atraso do candle (em dias). Precisam ser resolvidas ANTES da
    // coleta: quem separa "parado" de "em dia" aqui é a régua, não o corte de datas.
    const candleTolerances = {
        timeSeriesWalletDaysStale: Number(overrides?.timeSeriesWalletDaysStale)
            || DEFAULT_THRESHOLDS.timeSeriesWalletDaysStale,
        timeSeriesUniverseDaysStale: Number(overrides?.timeSeriesUniverseDaysStale)
            || DEFAULT_THRESHOLDS.timeSeriesUniverseDaysStale,
    };
    const frozenDays = Number(overrides?.frozenPriceAfterDays)
        || DEFAULT_THRESHOLDS.frozenPriceAfterDays;
    const frozenCutoff = new Date(now.getTime() - frozenDays * 86400000);

    const [
        assetFacts,
        totalAll,
        totalInactive,
        macroConfig,
        treasuryRows,
        treasuryCatalogRows,
        candleFacts,
        errors24h,
        jobs,
        oldestRun,
        frozenAssets,
    ] = await Promise.all([
        collectAssetFacts(staleCutoff, fundamentalsCutoff),
        MarketAsset.countDocuments({}),
        MarketAsset.countDocuments({ isActive: false, failCount: { $gte: 10 } }),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean(),
        // Data do PU mais recente entre todos os títulos. Usa a data do DADO
        // (history.date), não o instante da ingestão: um CSV velho reingerido
        // renovaria `lastUpdated` e esconderia exatamente a falha que queremos ver.
        TreasuryPriceHistory.aggregate([
            { $group: { _id: null, latest: { $max: { $max: '$history.date' } }, titles: { $sum: 1 } } },
        ]),
        // Catálogo inteiro (~37 documentos): as invariantes são estruturais e
        // baratas de checar sobre a coleção completa, sem agregação.
        TreasuryBond.find({}).select('title type index rate unitPrice minInvestment maturityDate updatedAt').lean(),
        collectCandleFacts(now, candleTolerances),
        ErrorLog.aggregate([
            { $match: { lastSeenAt: { $gte: since24h } } },
            { $group: { _id: null, total: { $sum: '$count' } } },
        ]),
        collectJobFacts(),
        // Marco zero da instrumentação: sem ele, todo cron diário apareceria como
        // "nunca executado" nas primeiras horas depois do deploy.
        JobRun.findOne().sort({ startedAt: 1 }).select('startedAt').lean(),
        // Congelados há semanas, restrito a quem o sync REALMENTE cotiza: abaixo de
        // MIN_LIQUIDITY_FOR_LIVE_QUOTE o ativo está fora do lote por decisão de
        // projeto e congelar é o comportamento esperado, não defeito.
        // Traz os tickers (limitado) porque o alarme só vira conserto se disser
        // QUAIS — ordenado do mais parado para o menos.
        MarketAsset.find({
            ...ACTIVE_UNIVERSE,
            updatedAt: { $lt: frozenCutoff },
            liquidity: { $gt: MIN_LIQUIDITY_FOR_LIVE_QUOTE },
        }).select('ticker updatedAt').sort({ updatedAt: 1 }).limit(200).lean(),
    ]);

    const treasury = treasuryRows[0] || {};
    const treasuryCatalog = auditTreasuryCatalog(treasuryCatalogRows, { now });

    return {
        facts: {
            now,
            totals: {
                all: totalAll,
                active: assetFacts.activeTotal,
                inactive: totalInactive,
            },
            assets: assetFacts.assets,
            implausible: assetFacts.implausible,
            macro: macroConfig
                ? {
                    selic: macroConfig.selic,
                    ipca: macroConfig.ipca,
                    cdi: macroConfig.cdi,
                    ibov: macroConfig.ibov,
                    dollar: macroConfig.dollar,
                    updatedAt: macroConfig.lastUpdated || null,
                }
                : {},
            treasury: {
                titles: treasury.titles || 0,
                // history.date é 'YYYY-MM-DD'; ancorar ao meio-dia UTC evita que o
                // fuso jogue o dia para trás na conversão.
                latestDate: treasury.latest ? new Date(`${treasury.latest}T12:00:00.000Z`) : null,
                businessDaysStale: businessDaysStale(treasury.latest, now),
            },
            treasuryCatalog,
            timeSeries: candleFacts,
            fundamentals: {
                healthy: macroConfig?.lastSyncStats?.fundamentalsHealthy === true,
                timestamp: macroConfig?.lastSyncStats?.timestamp || null,
                errorCode: macroConfig?.lastSyncStats?.errorCode || null,
            },
            jobs,
            errors: { last24h: errors24h[0]?.total || 0 },
            instrumentationSince: oldestRun?.startedAt || now,
            frozen: {
                count: frozenAssets.length,
                // Só os 10 mais parados no detalhe — a lista inteira não cabe num card.
                tickers: frozenAssets.slice(0, 10).map((a) => a.ticker),
            },
        },
        overrides,
    };
};

/**
 * Coleta, avalia e persiste um relatório de saúde.
 * `trigger`: 'CRON' | 'SYNC' | 'MANUAL'.
 */
export const runDataHealthCheck = async ({ trigger = 'CRON', persist = true } = {}) => {
    if (mongoose.connection?.readyState !== 1) {
        logger.debug('[DataHealth] Sem conexão com o banco — check ignorado.');
        return null;
    }

    const startedAt = Date.now();
    const now = new Date();

    try {
        const { facts, overrides } = await collectFacts(now);
        const report = buildHealthReport(facts, overrides);
        const durationMs = Date.now() - startedAt;

        if (persist) {
            await DataHealthReport.create({
                runAt: report.runAt,
                status: report.status,
                summary: report.summary,
                checks: report.checks,
                trigger,
                durationMs,
            });
        }

        const line = `[DataHealth] ${report.status} — ${report.summary.critical} crítico(s), `
            + `${report.summary.warn} alerta(s), ${report.summary.ok} ok (${durationMs}ms)`;
        if (report.status === HEALTH_STATUS.CRITICAL) logger.error(line, { trigger });
        else if (report.status === HEALTH_STATUS.WARN) logger.warn(line, { trigger });
        else logger.info(line, { trigger });

        return { ...report, durationMs, trigger };
    } catch (error) {
        // A sentinela NUNCA derruba quem a chamou: erro fica contido aqui e o
        // retorno null diz "não avaliei" (confirmado no run de 22/08/2026 — o
        // sync seguiu normalmente depois da falha). O que muda é o nível do log:
        // uma queda de conexão é ruído de rede, não defeito de dado, e logá-la
        // como ERROR virava o veredito do sync:prod inteiro para "SUCESSO COM
        // ERROS" — barulho que competia com os erros de verdade. Só o restante
        // (bug na coleta, schema quebrado) continua ERROR.
        if (isTransientMongoError(error)) {
            logger.warn(`⚠️ [DataHealth] Sentinela não avaliou (queda de conexão, não fatal): ${error.message}`);
        } else {
            logger.error(`❌ [DataHealth] Falha ao avaliar saúde dos dados: ${error.message}`);
        }
        return null;
    }
};

/** Último relatório salvo (o que o painel abre). */
export const getLatestHealthReport = async () =>
    DataHealthReport.findOne().sort({ runAt: -1 }).lean();

/** Série para o gráfico de tendência do painel. */
export const getHealthHistory = async (limit = 60) =>
    DataHealthReport.find()
        .sort({ runAt: -1 })
        .limit(Math.min(Math.max(Number(limit) || 60, 1), 200))
        .select('runAt status summary durationMs trigger')
        .lean();
