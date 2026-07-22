/**
 * Auditoria read-only do tratamento de controle estatal no ranking STOCK.
 *
 * Executa os cenários A-E da Fase 6 sem persistir documentos, logs de descarte
 * ou alterações de configuração. A lista exportada por sectorTaxonomy é
 * alterada apenas em memória e restaurada ao final.
 *
 * Uso: node server/scripts/auditStateGovernance.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { marketDataService } = await import('../services/marketDataService.js');
const { scoringEngine } = await import('../services/engines/scoringEngine.js');
const { portfolioEngine } = await import('../services/engines/portfolioEngine.js');
const {
    STATE_CONTROLLED_TICKERS,
    getConcentrationKey,
} = await import('../config/sectorTaxonomy.js');
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { DEFAULT_SELIC_FALLBACK, BUY_THRESHOLD } = await import('../config/financialConstants.js');

const ORIGINAL_STATE_TICKERS = [...STATE_CONTROLLED_TICKERS];

// Corte oficial em 19/07/2026. Inclui todas as classes conhecidas, mesmo que
// ausentes ou sem liquidez no cache atual, para testar normalização e cobertura.
const DIRECT_STATE_TICKERS = new Set([
    'PETR3', 'PETR4',
    'BBAS3', 'BAZA3', 'BNBR3',
    'SAPR3', 'SAPR4', 'SAPR11',
    'CMIG3', 'CMIG4',
    'BRSR3', 'BRSR5', 'BRSR6',
    'CLSC3', 'CLSC4',
    'CEBR3', 'CEBR5', 'CEBR6',
    'TELB3', 'TELB4',
    'CASN3', 'CASN4',
    'BPAR3',
    'BEES3', 'BEES4',
    'BSLI3', 'BSLI4',
    'BGIP3', 'BGIP4',
]);

const INDIRECT_STATE_TICKERS = new Set(['BBSE3']);
const OFFICIAL_STATE_TICKERS = new Set([...DIRECT_STATE_TICKERS, ...INDIRECT_STATE_TICKERS]);
const PRIVATIZED_OR_NO_CONTROLLER = new Set([
    'CSMG3',
    'CPLE3', 'CPLE5', 'CPLE6',
    'SBSP3',
    'EMAE4',
    'AXIA3', 'AXIA5', 'AXIA6', 'AXIA7',
]);

const BANK_TICKERS = new Set([
    'BBAS3', 'BAZA3', 'BNBR3',
    'BRSR3', 'BRSR5', 'BRSR6',
    'BPAR3', 'BEES3', 'BEES4',
    'BSLI3', 'BSLI4', 'BGIP3', 'BGIP4',
]);

const setStateTickers = (tickers) => {
    STATE_CONTROLLED_TICKERS.clear();
    for (const ticker of tickers) STATE_CONTROLLED_TICKERS.add(ticker);
};

const processAssets = (rawData, context, stateTickers) => {
    setStateTickers(stateTickers);
    const processed = [];
    const discarded = [];
    for (const asset of rawData) {
        const result = scoringEngine.processAsset(asset, context);
        if (result?._discarded) discarded.push({ ticker: asset.ticker, ...result });
        else if (result) processed.push(result);
    }
    return { processed, discarded };
};

const composite = (asset) => {
    const structural = asset.metrics?.structural;
    if (!structural) return 0;
    return (structural.quality + structural.valuation + structural.risk) / 3;
};

const buildRanking = (processed) => {
    const draft = portfolioEngine.performCompetitiveDraft(processed);
    const draftByTicker = new Map(draft.map(item => [item.ticker, item]));
    const ranking = portfolioEngine.applyConcentrationPenalty(draft)
        .sort((a, b) => (b.score - a.score) || (composite(b) - composite(a)))
        .map((item, index) => ({ ...item, position: index + 1 }));
    return { ranking, draftByTicker };
};

const withHalfIndirectPenalty = (processed) => processed.map((asset) => {
    if (!INDIRECT_STATE_TICKERS.has(asset.ticker)) return asset;
    const defensive = Math.max(10, asset.scores.DEFENSIVE - 4);
    const moderate = Math.max(10, asset.scores.MODERATE - 2);
    return {
        ...asset,
        scores: { ...asset.scores, DEFENSIVE: defensive, MODERATE: moderate },
        auditLog: [
            ...(asset.auditLog || []),
            { factor: 'Controle estatal indireto (shadow)', points: -4, type: 'penalty', category: 'Perfil Defensivo' },
            { factor: 'Controle estatal indireto (shadow)', points: -2, type: 'penalty', category: 'Perfil Moderado' },
        ],
    };
});

const summarizeScenario = (name, scenario, baselineRanking) => {
    const { ranking, draftByTicker } = buildRanking(scenario.processed);
    const baselineTickers = new Set(baselineRanking?.map(item => item.ticker) || []);
    const rankingTickers = new Set(ranking.map(item => item.ticker));
    const exits = baselineRanking
        ? [...baselineTickers].filter(ticker => !rankingTickers.has(ticker))
        : [];
    const entries = baselineRanking
        ? [...rankingTickers].filter(ticker => !baselineTickers.has(ticker))
        : [];
    const baselineByTicker = new Map((baselineRanking || []).map(item => [item.ticker, item]));
    const profileChanges = ranking.filter(item => {
        const old = baselineByTicker.get(item.ticker);
        return old && old.riskProfile !== item.riskProfile;
    }).map(item => ({ ticker: item.ticker, from: baselineByTicker.get(item.ticker).riskProfile, to: item.riskProfile }));

    const buckets = {};
    for (const item of ranking) {
        const profile = item.riskProfile;
        const key = getConcentrationKey(item);
        buckets[profile] ||= {};
        buckets[profile][key] = (buckets[profile][key] || 0) + 1;
    }

    const concentrationPenalty = ranking.reduce((total, item) => {
        const before = draftByTicker.get(item.ticker)?.score ?? item.score;
        return total + Math.max(0, before - item.score);
    }, 0);

    return {
        name,
        processed: scenario.processed.length,
        discarded: scenario.discarded.length,
        selected: ranking.length,
        buy: ranking.filter(item => item.action === 'BUY').length,
        scoreTotal: ranking.reduce((total, item) => total + item.score, 0),
        concentrationPenalty,
        maxBucketByProfile: Object.fromEntries(Object.entries(buckets).map(([profile, counts]) => [
            profile,
            Math.max(...Object.values(counts)),
        ])),
        stateSelected: ranking.filter(item => OFFICIAL_STATE_TICKERS.has(item.ticker)).map(item => ({
            ticker: item.ticker,
            profile: item.riskProfile,
            score: item.score,
            action: item.action,
            position: item.position,
            concentrationPenalty: Math.max(0, (draftByTicker.get(item.ticker)?.score ?? item.score) - item.score),
        })),
        privatizedSelected: ranking.filter(item => PRIVATIZED_OR_NO_CONTROLLER.has(item.ticker)).map(item => ({
            ticker: item.ticker,
            profile: item.riskProfile,
            score: item.score,
            action: item.action,
            position: item.position,
        })),
        exits,
        entries,
        turnover: exits.length,
        profileChanges,
        ranking,
    };
};

const correctedDataAssets = (rawData, context) => {
    setStateTickers(ORIGINAL_STATE_TICKERS);
    const result = {};
    for (const asset of rawData) {
        if (!OFFICIAL_STATE_TICKERS.has(asset.ticker) && asset.ticker !== 'CSMG3') continue;
        const clone = structuredClone(asset);
        let corrected = false;
        if (BANK_TICKERS.has(clone.ticker)) {
            // Margem líquida não é requisito comparável a empresas não financeiras;
            // usa NaN como sentinela N/A no shadow: não inventa margem, não dispara
            // bônus/penalidade econômica e remove apenas a cobrança de missingness.
            // Corrige também os bancos que chegaram do cache como setor genérico.
            clone.metrics.netMargin = Number.NaN;
            clone.metrics._missing = { ...clone.metrics._missing, netMargin: false };
            if (clone.sector === 'Outros') {
                clone.sector = 'Bancos';
                clone.metrics.sector = 'Bancos';
            }
            corrected = true;
        }
        if (clone.ticker === 'BBSE3') {
            clone.metrics.netMargin = Number.NaN;
            clone.metrics._missing = { ...clone.metrics._missing, netMargin: false };
            corrected = true;
        }
        if (!corrected) continue;
        const scored = scoringEngine.processAsset(clone, context);
        if (scored && !scored._discarded) result[clone.ticker] = scored;
    }
    return result;
};

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    try {
        const rawData = await marketDataService.getMarketData('STOCK');
        const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
        const context = {
            MACRO: macroConfig ? {
                SELIC: macroConfig.selic,
                IPCA: macroConfig.ipca,
                RISK_FREE: macroConfig.riskFree,
                NTNB_LONG: macroConfig.ntnbLong,
            } : {
                SELIC: DEFAULT_SELIC_FALLBACK,
                IPCA: 4.5,
                RISK_FREE: DEFAULT_SELIC_FALLBACK,
                NTNB_LONG: 6.3,
            },
        };

        const current = processAssets(rawData, context, ORIGINAL_STATE_TICKERS);
        const noDiscount = processAssets(rawData, context, []);
        const directOnly = processAssets(rawData, context, DIRECT_STATE_TICKERS);
        const correctedFixed = processAssets(rawData, context, OFFICIAL_STATE_TICKERS);
        const graduated = { ...directOnly, processed: withHalfIndirectPenalty(directOnly.processed) };
        const excluded = {
            ...noDiscount,
            processed: noDiscount.processed.filter(asset => !OFFICIAL_STATE_TICKERS.has(asset.ticker)),
        };

        const scenarioA = summarizeScenario('A-current', current, null);
        const scenarioB = summarizeScenario('B-no-fixed-discount', noDiscount, scenarioA.ranking);
        const scenarioC = summarizeScenario('C-graduated-control-rights', graduated, scenarioA.ranking);
        const scenarioD = summarizeScenario('D-metadata-only', noDiscount, scenarioA.ranking);
        const scenarioE = summarizeScenario('E-categorical-exclusion', excluded, scenarioA.ranking);

        const byTicker = (items) => new Map(items.map(item => [item.ticker, item]));
        const currentByTicker = byTicker(current.processed);
        const noDiscountByTicker = byTicker(noDiscount.processed);
        const correctedFixedByTicker = byTicker(correctedFixed.processed);
        const graduatedByTicker = byTicker(graduated.processed);
        const rawByTicker = byTicker(rawData);
        const currentDiscarded = byTicker(current.discarded);
        const correctedAssets = correctedDataAssets(rawData, context);
        const dataCorrectionOnly = {
            ...current,
            processed: current.processed.map(asset => correctedAssets[asset.ticker] || asset),
        };
        const scenarioTaxonomy = summarizeScenario('T-taxonomy-corrected-fixed', correctedFixed, scenarioA.ranking);
        const scenarioData = summarizeScenario('F-data-applicability-only', dataCorrectionOnly, scenarioA.ranking);
        const stateRows = [...new Set([
            ...OFFICIAL_STATE_TICKERS,
            'CSMG3',
            ...PRIVATIZED_OR_NO_CONTROLLER,
        ])].sort().map(ticker => {
            const raw = rawByTicker.get(ticker);
            const currentAsset = currentByTicker.get(ticker);
            const noDiscountAsset = noDiscountByTicker.get(ticker);
            const selectedByScenario = Object.fromEntries(
                [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE].map(scenario => {
                    const item = scenario.ranking.find(candidate => candidate.ticker === ticker);
                    return [scenario.name[0], item ? {
                        profile: item.riskProfile,
                        score: item.score,
                        action: item.action,
                        position: item.position,
                    } : null];
                })
            );
            return {
                ticker,
                classification: DIRECT_STATE_TICKERS.has(ticker) ? 'direct-control'
                    : INDIRECT_STATE_TICKERS.has(ticker) ? 'indirect-control'
                        : PRIVATIZED_OR_NO_CONTROLLER.has(ticker) || ticker === 'CSMG3' ? 'no-state-controller'
                            : 'other',
                inRawUniverse: !!raw,
                liquidity: raw?.metrics?.avgLiquidity ?? null,
                sector: raw?.sector ?? null,
                processed: !!currentAsset,
                discardReason: currentDiscarded.get(ticker)?.reason ?? null,
                defensiveEligible: currentAsset?.isDefensiveEligible ?? null,
                currentScores: currentAsset?.scores ?? null,
                noStatePenaltyScores: noDiscountAsset?.scores ?? null,
                correctedTaxonomyFixedScores: correctedFixedByTicker.get(ticker)?.scores ?? null,
                graduatedScores: graduatedByTicker.get(ticker)?.scores ?? null,
                correctedDataScores: correctedAssets[ticker]?.scores ?? null,
                selectedByScenario,
            };
        });

        const output = {
            generatedAt: new Date().toISOString(),
            buyThreshold: BUY_THRESHOLD,
            rawUniverse: rawData.length,
            originalTaxonomy: ORIGINAL_STATE_TICKERS,
            correctedDirectTaxonomy: [...DIRECT_STATE_TICKERS],
            correctedIndirectTaxonomy: [...INDIRECT_STATE_TICKERS],
            falsePositives: ORIGINAL_STATE_TICKERS.filter(ticker => !OFFICIAL_STATE_TICKERS.has(ticker)),
            missingFromOriginal: [...OFFICIAL_STATE_TICKERS].filter(ticker => !ORIGINAL_STATE_TICKERS.includes(ticker)),
            scenarios: [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE].map(({ ranking, ...summary }) => summary),
            diagnostics: [scenarioTaxonomy, scenarioData].map(({ ranking, ...summary }) => summary),
            stateRows,
        };
        if (process.argv.includes('--compact')) {
            output.stateRows = stateRows.filter(row => row.inRawUniverse);
        }
        if (process.argv.includes('--scores')) {
            console.log(JSON.stringify(stateRows.filter(row => row.processed), null, 2));
            return;
        }
        console.log(JSON.stringify(output, null, 2));
    } finally {
        setStateTickers(ORIGINAL_STATE_TICKERS);
        await mongoose.disconnect();
    }
};

run().catch(error => {
    setStateTickers(ORIGINAL_STATE_TICKERS);
    console.error(error);
    process.exit(1);
});
