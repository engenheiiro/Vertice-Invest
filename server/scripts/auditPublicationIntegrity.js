/**
 * Auditoria read-only da cadeia de publicação do MarketAnalysis.
 *
 * Não salva, não publica e não altera documentos. Resume a versão que o endpoint
 * escolheria, invariantes persistidos, flags parciais, delta e retenção/indexes.
 *
 * Uso: node server/scripts/auditPublicationIntegrity.js [--compact]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const Notification = (await import('../models/Notification.js')).default;

const BUY_THRESHOLD = 70;
const compact = process.argv.includes('--compact');
const normalize = (ticker) => String(ticker || '').toUpperCase().replace('.SA', '').replace(/[^A-Z0-9]/g, '').trim();
const desc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
const id = (doc) => String(doc?._id || '');
const summary = (doc) => doc ? {
    id: id(doc),
    createdAt: doc.createdAt,
    date: doc.date,
    rankingCount: doc.content?.ranking?.length || 0,
    flags: {
        ranking: !!doc.isRankingPublished,
        morningCall: !!doc.isMorningCallPublished,
        report: !!doc.isReportPublished,
        explainableAI: !!doc.isExplainableAIPublished,
    },
    hasMorningCall: !!String(doc.content?.morningCall || '').trim(),
    hasExplainableAI: !!(
        String(doc.generatedExplainableAI || '').trim()
        || Object.values(doc.generatedExplainableAIByProfile || {}).some(value => String(value || '').trim())
    ),
} : null;

const validateRanking = (doc) => {
    const ranking = doc.content?.ranking || [];
    const tickers = ranking.map(item => normalize(item.ticker));
    const seen = new Set();
    const duplicates = [];
    for (const ticker of tickers) {
        if (seen.has(ticker)) duplicates.push(ticker);
        seen.add(ticker);
    }
    const actionMismatches = ranking
        .filter(item => item.action !== (item.score >= BUY_THRESHOLD ? 'BUY' : 'WAIT'))
        .map(item => ({ ticker: item.ticker, score: item.score, action: item.action }));
    const positionMismatches = ranking
        .map((item, index) => ({ ticker: item.ticker, stored: item.position, expected: index + 1 }))
        .filter(item => item.stored !== item.expected);
    const sortMismatches = [];
    for (let index = 1; index < ranking.length; index += 1) {
        if ((ranking[index - 1].score ?? -Infinity) < (ranking[index].score ?? -Infinity)) {
            sortMismatches.push({
                before: ranking[index - 1].ticker,
                beforeScore: ranking[index - 1].score,
                after: ranking[index].ticker,
                afterScore: ranking[index].score,
            });
        }
    }
    const invalidProfiles = ranking
        .filter(item => !['DEFENSIVE', 'MODERATE', 'BOLD'].includes(item.riskProfile))
        .map(item => ({ ticker: item.ticker, riskProfile: item.riskProfile }));
    return { duplicates, actionMismatches, positionMismatches, sortMismatches, invalidProfiles };
};

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    try {
        const docs = await MarketAnalysis.find({ strategy: 'BUY_HOLD' })
            .select([
                'date', 'createdAt', 'assetClass', 'strategy',
                'isRankingPublished', 'isMorningCallPublished', 'isReportPublished', 'isExplainableAIPublished',
                'generatedExplainableAI', 'generatedExplainableAIByProfile', 'content.morningCall',
                'content.ranking.ticker', 'content.ranking.score', 'content.ranking.action',
                'content.ranking.position', 'content.ranking.previousPosition', 'content.ranking.riskProfile',
            ].join(' '))
            .sort({ createdAt: -1 })
            .lean();

        const classes = [...new Set(docs.map(doc => doc.assetClass))].sort();
        const byClass = Object.fromEntries(classes.map(assetClass => {
            const items = docs.filter(doc => doc.assetClass === assetClass).sort(desc);
            const latestAny = items[0] || null;
            const latestRankingPublished = items.find(doc => doc.isRankingPublished) || null;
            const latestVisible = items.find(doc => doc.isRankingPublished || doc.isMorningCallPublished || doc.isExplainableAIPublished) || null;
            return [assetClass, {
                documents: items.length,
                publishedRankings: items.filter(doc => doc.isRankingPublished).length,
                drafts: items.filter(doc => !doc.isRankingPublished).length,
                latestAny: summary(latestAny),
                latestRankingPublished: summary(latestRankingPublished),
                latestVisibleByApi: summary(latestVisible),
                apiDiffersFromLastPublishedRanking: id(latestVisible) !== id(latestRankingPublished),
            }];
        }));

        const anomalies = {
            publishedEmptyRanking: [],
            publishedExplainableWithoutText: [],
            publishedMorningWithoutText: [],
            unpublishedRankingExposedByOtherFlag: [],
            actionScoreMismatch: [],
            duplicateTicker: [],
            positionMismatch: [],
            sortMismatch: [],
            invalidProfile: [],
            deltaMismatch: [],
        };

        for (const doc of docs) {
            const ranking = doc.content?.ranking || [];
            const base = { id: id(doc), assetClass: doc.assetClass, createdAt: doc.createdAt };
            if (doc.isRankingPublished && ranking.length === 0) anomalies.publishedEmptyRanking.push(base);
            const hasAI = !!(
                String(doc.generatedExplainableAI || '').trim()
                || Object.values(doc.generatedExplainableAIByProfile || {}).some(value => String(value || '').trim())
            );
            if (doc.isExplainableAIPublished && !hasAI) anomalies.publishedExplainableWithoutText.push(base);
            if (doc.isMorningCallPublished && !String(doc.content?.morningCall || '').trim()) anomalies.publishedMorningWithoutText.push(base);
            if (!doc.isRankingPublished && ranking.length > 0 && (doc.isMorningCallPublished || doc.isExplainableAIPublished)) {
                anomalies.unpublishedRankingExposedByOtherFlag.push({ ...base, rankingCount: ranking.length });
            }
            const check = validateRanking(doc);
            if (check.actionMismatches.length) anomalies.actionScoreMismatch.push({ ...base, items: check.actionMismatches });
            if (check.duplicates.length) anomalies.duplicateTicker.push({ ...base, tickers: check.duplicates });
            if (check.positionMismatches.length) anomalies.positionMismatch.push({ ...base, items: check.positionMismatches.slice(0, 10) });
            if (check.sortMismatches.length) anomalies.sortMismatch.push({ ...base, items: check.sortMismatches.slice(0, 10) });
            if (check.invalidProfiles.length) anomalies.invalidProfile.push({ ...base, items: check.invalidProfiles });
        }

        // Confere o previousPosition contra o último ranking publicado anterior à criação.
        for (const assetClass of classes) {
            const chronological = docs.filter(doc => doc.assetClass === assetClass)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const priorPublished = [];
            for (const doc of chronological) {
                const baseline = priorPublished[priorPublished.length - 1];
                if (baseline) {
                    const expected = new Map((baseline.content?.ranking || []).map(item => [normalize(item.ticker), item.position]));
                    const mismatches = (doc.content?.ranking || []).filter(item => {
                        const value = expected.get(normalize(item.ticker));
                        const expectedPrevious = value === undefined ? null : value;
                        return (item.previousPosition ?? null) !== expectedPrevious;
                    }).map(item => ({
                        ticker: item.ticker,
                        stored: item.previousPosition ?? null,
                        expected: expected.get(normalize(item.ticker)) ?? null,
                    }));
                    if (mismatches.length) anomalies.deltaMismatch.push({
                        id: id(doc), assetClass, createdAt: doc.createdAt,
                        baselineId: id(baseline), items: mismatches.slice(0, 10), total: mismatches.length,
                    });
                }
                if (doc.isRankingPublished) priorPublished.push(doc);
            }
        }

        const notifications = await Notification.find({ type: 'RANKING_PUBLISHED', user: null })
            .select('relatedAssetClass createdAt title message')
            .sort({ createdAt: 1 })
            .lean();
        const notificationNearDuplicates = [];
        for (let index = 1; index < notifications.length; index += 1) {
            const current = notifications[index];
            const previous = notifications[index - 1];
            const gapMs = new Date(current.createdAt) - new Date(previous.createdAt);
            if (current.relatedAssetClass === previous.relatedAssetClass && gapMs <= 5 * 60 * 1000) {
                notificationNearDuplicates.push({
                    assetClass: current.relatedAssetClass,
                    first: previous.createdAt,
                    second: current.createdAt,
                    gapSeconds: Math.round(gapMs / 1000),
                });
            }
        }

        const indexes = await MarketAnalysis.collection.indexes();
        const published = docs.filter(doc => doc.isRankingPublished).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const output = {
            generatedAt: new Date().toISOString(),
            documents: docs.length,
            classes,
            byClass,
            anomalyCounts: Object.fromEntries(Object.entries(anomalies).map(([key, value]) => [key, value.length])),
            anomalies,
            history: {
                oldestPublished: summary(published[0]),
                newestPublished: summary(published[published.length - 1]),
                publishedDocuments: published.length,
            },
            indexes,
            notifications: {
                broadcasts: notifications.length,
                nearDuplicates: notificationNearDuplicates,
            },
        };
        if (compact) {
            output.anomalies = Object.fromEntries(Object.entries(anomalies).map(([key, value]) => [key, {
                first: value[0] || null,
                last: value[value.length - 1] || null,
                latestByClass: Object.fromEntries(classes.map(assetClass => [
                    assetClass,
                    value.find(item => item.assetClass === assetClass) || null,
                ])),
            }]));
        }
        console.log(JSON.stringify(output, null, 2));
    } finally {
        await mongoose.disconnect();
    }
};

run().catch(error => {
    console.error(error);
    process.exit(1);
});
