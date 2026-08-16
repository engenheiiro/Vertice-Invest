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
import DataHealthReport from '../models/DataHealthReport.js';
import ErrorLog from '../models/ErrorLog.js';
import JobRun from '../models/JobRun.js';
import logger from '../config/logger.js';
import { JOB_CATALOG } from '../config/jobCatalog.js';
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

/** Todos os campos cobrados, sem repetição entre classes. */
const allCoverageFields = () => [
    ...new Set(Object.values(COVERAGE_SPEC).flatMap((spec) => spec.map((s) => s.field))),
];

const collectAssetFacts = async (staleCutoff) => {
    const group = {
        _id: '$type',
        active: { $sum: 1 },
        stalePrice: sumIf({ $lt: [{ $ifNull: ['$updatedAt', new Date(0)] }, staleCutoff] }),
        nonPositivePrice: sumIf({ $lte: [{ $ifNull: ['$lastPrice', 0] }, 0] }),
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

    const [
        assetFacts,
        totalAll,
        totalInactive,
        macroConfig,
        treasuryRows,
        historyStats,
        errors24h,
        jobs,
    ] = await Promise.all([
        collectAssetFacts(staleCutoff),
        MarketAsset.countDocuments({}),
        MarketAsset.countDocuments({ isActive: false, failCount: { $gte: 10 } }),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean(),
        // Data do PU mais recente entre todos os títulos. Usa a data do DADO
        // (history.date), não o instante da ingestão: um CSV velho reingerido
        // renovaria `lastUpdated` e esconderia exatamente a falha que queremos ver.
        TreasuryPriceHistory.aggregate([
            { $group: { _id: null, latest: { $max: { $max: '$history.date' } }, titles: { $sum: 1 } } },
        ]),
        AssetHistory.aggregate([
            { $group: { _id: null, count: { $sum: 1 }, avgUpdated: { $avg: { $toLong: '$lastUpdated' } } } },
        ]),
        ErrorLog.aggregate([
            { $match: { lastSeenAt: { $gte: since24h } } },
            { $group: { _id: null, total: { $sum: '$count' } } },
        ]),
        collectJobFacts(),
    ]);

    const treasury = treasuryRows[0] || {};
    const history = historyStats[0] || {};

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
            },
            timeSeries: {
                count: history.count || 0,
                avgAgeHours: history.avgUpdated
                    ? (now.getTime() - history.avgUpdated) / 3600000
                    : null,
            },
            fundamentals: {
                healthy: macroConfig?.lastSyncStats?.fundamentalsHealthy === true,
                timestamp: macroConfig?.lastSyncStats?.timestamp || null,
                errorCode: macroConfig?.lastSyncStats?.errorCode || null,
            },
            jobs,
            errors: { last24h: errors24h[0]?.total || 0 },
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
        logger.error(`❌ [DataHealth] Falha ao avaliar saúde dos dados: ${error.message}`);
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
