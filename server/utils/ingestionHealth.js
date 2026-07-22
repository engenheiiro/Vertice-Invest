export const FUNDAMENTUS_MIN_PARSED_ROWS = 100;
export const FUNDAMENTUS_MIN_ACCEPTED_ROWS = 50;
export const FUNDAMENTUS_MIN_ACCEPTANCE_RATIO = 0.10;
export const FUNDAMENTALS_HEALTH_MAX_AGE_HOURS = 36;

const REQUIRED_CLASSES = ['STOCK', 'FII'];
const BR_RANKING_CLASSES = new Set(['STOCK', 'FII', 'BRASIL_10']);

export const createFundamentusStats = ({ stockParsed = 0, fiiParsed = 0 } = {}) => ({
    STOCK: {
        parsed: stockParsed,
        accepted: 0,
        rejectedLowLiquidity: 0,
        duplicates: 0,
    },
    FII: {
        parsed: fiiParsed,
        accepted: 0,
        rejectedLowLiquidity: 0,
        duplicates: 0,
    },
});

export const finalizeFundamentusStats = (stats) => {
    const result = {};
    for (const assetClass of REQUIRED_CLASSES) {
        const row = stats?.[assetClass] || {};
        const parsed = Number(row.parsed) || 0;
        const accepted = Number(row.accepted) || 0;
        result[assetClass] = {
            parsed,
            accepted,
            rejectedLowLiquidity: Number(row.rejectedLowLiquidity) || 0,
            duplicates: Number(row.duplicates) || 0,
            acceptanceRate: parsed > 0 ? accepted / parsed : 0,
        };
    }
    return result;
};

export const validateFundamentusIngestion = (rawStats) => {
    const stats = finalizeFundamentusStats(rawStats);

    for (const assetClass of REQUIRED_CLASSES) {
        const row = stats[assetClass];
        if (row.parsed === 0) {
            return {
                ok: false,
                code: 'FUNDAMENTUS_PARTIAL',
                reason: `${assetClass}: fonte retornou 0 linhas`,
                stats,
            };
        }
        if (row.parsed < FUNDAMENTUS_MIN_PARSED_ROWS) {
            return {
                ok: false,
                code: 'FUNDAMENTUS_SOURCE_TOO_SMALL',
                reason: `${assetClass}: apenas ${row.parsed} linhas parseadas (mínimo ${FUNDAMENTUS_MIN_PARSED_ROWS})`,
                stats,
            };
        }

        const minAccepted = Math.max(
            FUNDAMENTUS_MIN_ACCEPTED_ROWS,
            Math.ceil(row.parsed * FUNDAMENTUS_MIN_ACCEPTANCE_RATIO),
        );
        if (row.accepted < minAccepted) {
            return {
                ok: false,
                code: 'FUNDAMENTUS_ACCEPTANCE_COLLAPSE',
                reason: `${assetClass}: ${row.accepted}/${row.parsed} linhas aceitas (mínimo ${minAccepted})`,
                stats,
            };
        }
    }

    return { ok: true, code: null, reason: null, stats };
};

export const validateFundamentalsPublicationHealth = (
    assetClass,
    lastSyncStats,
    now = new Date(),
) => {
    if (!BR_RANKING_CLASSES.has(assetClass)) return { ok: true };

    if (lastSyncStats?.fundamentalsHealthy !== true) {
        return { ok: false, reason: 'último sync de fundamentos BR não está saudável' };
    }

    const timestamp = new Date(lastSyncStats.timestamp || 0);
    const ageMs = now.getTime() - timestamp.getTime();
    const maxAgeMs = FUNDAMENTALS_HEALTH_MAX_AGE_HOURS * 3600000;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
        return {
            ok: false,
            reason: `saúde dos fundamentos BR sem confirmação nas últimas ${FUNDAMENTALS_HEALTH_MAX_AGE_HOURS}h`,
        };
    }

    return { ok: true };
};
