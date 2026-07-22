/**
 * Auditoria determinística e sem I/O do scoring STOCK.
 *
 * Varre ativos sintéticos dentro de domínios plausíveis, confere invariantes de
 * faixa/finito e propriedades metamórficas básicas. Não conecta ao MongoDB.
 *
 * Uso: node server/scripts/auditScoringMetamorphic.js [--samples=500]
 */
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CONTEXT = {
    MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, NTNB_LONG: 6.4 },
};

const sampleArg = process.argv.find(arg => arg.startsWith('--samples='));
const sampleCount = Math.max(1, Number(sampleArg?.split('=')[1]) || 500);

let seed = 0x5eed1234;
const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
};
const between = (min, max) => min + random() * (max - min);

const makeStock = (index) => {
    const price = between(8, 120);
    return {
        ticker: `T${String(index).padStart(4, '0')}3`,
        type: 'STOCK',
        name: 'Ativo sintético',
        sector: 'Energia Elétrica',
        fiiSubType: null,
        price,
        dbFlags: { isBlacklisted: false, isTier1: false },
        metrics: {
            price,
            pl: between(5, 25),
            pvp: between(0.6, 3),
            roe: between(6, 28),
            roic: between(4, 24),
            netMargin: between(5, 32),
            evEbitda: between(3, 13),
            revenueGrowth: between(-3, 25),
            debtToEquity: between(0.1, 2.5),
            netDebt: between(0, 2e9),
            payout: between(20, 100),
            dy: between(1, 12),
            marketCap: between(1.1e9, 40e9),
            avgLiquidity: between(1e6, 30e6),
            vacancy: 0,
            capRate: 0,
            qtdImoveis: 0,
            volatility: between(15, 65),
            beta: between(0.5, 1.45),
            sma200: price * between(0.75, 1.25),
            ema50: price * between(0.8, 1.2),
            sector: 'Energia Elétrica',
            fiiSubType: null,
            _missing: {
                pl: false, marketCap: false, roe: false, netMargin: false,
                revenueGrowth: false, evEbitda: false, beta: false, dy: false,
                debtToEquity: false, payout: false,
            },
            _staleDays: between(0, 60),
            dataCompleteness: 100,
        },
    };
};

const transformations = {
    higherRoe: metrics => { metrics.roe = Math.min(40, metrics.roe + 5); },
    higherRoic: metrics => { metrics.roic = Math.min(35, metrics.roic + 5); },
    higherNetMargin: metrics => { metrics.netMargin = Math.min(45, metrics.netMargin + 5); },
    higherRevenueGrowth: metrics => { metrics.revenueGrowth = Math.min(40, metrics.revenueGrowth + 5); },
    lowerLeverage: metrics => { metrics.debtToEquity = Math.max(0, metrics.debtToEquity * 0.7); },
    lowerBeta: metrics => { metrics.beta = Math.max(0.1, metrics.beta * 0.8); },
    lowerVolatility: metrics => { metrics.volatility = Math.max(1, metrics.volatility * 0.8); },
    lowerPl: metrics => { metrics.pl = Math.max(0.5, metrics.pl * 0.8); },
};

const profiles = ['DEFENSIVE', 'MODERATE', 'BOLD'];
const invariantFailures = [];
const metamorphicRegressions = [];
let processed = 0;

for (let index = 0; index < sampleCount; index += 1) {
    const asset = makeStock(index);
    const baseline = scoringEngine.processAsset(structuredClone(asset), CONTEXT);
    if (!baseline || baseline._discarded) continue;
    processed += 1;

    for (const profile of profiles) {
        const score = baseline.scores?.[profile];
        if (!Number.isFinite(score) || score < 10 || score > 100) {
            invariantFailures.push({ ticker: asset.ticker, profile, score });
        }
    }

    for (const [name, transform] of Object.entries(transformations)) {
        const changed = structuredClone(asset);
        transform(changed.metrics);
        const result = scoringEngine.processAsset(changed, CONTEXT);
        if (!result || result._discarded) {
            metamorphicRegressions.push({ ticker: asset.ticker, transformation: name, issue: 'discarded' });
            continue;
        }
        for (const profile of profiles) {
            if (result.scores[profile] < baseline.scores[profile]) {
                metamorphicRegressions.push({
                    ticker: asset.ticker,
                    transformation: name,
                    profile,
                    before: baseline.scores[profile],
                    after: result.scores[profile],
                });
            }
        }
    }
}

const boundaries = [
    { name: 'price=0.01', asset: { ...makeStock(9001), price: 0.01 }, expectedDiscard: true },
    { name: 'price>0.01', asset: { ...makeStock(9002), price: 0.010001 }, expectedDiscard: false },
    {
        name: 'liquidity=199999',
        asset: (() => { const a = makeStock(9003); a.metrics.avgLiquidity = 199999; return a; })(),
        expectedDiscard: true,
    },
    {
        name: 'liquidity=200000',
        asset: (() => { const a = makeStock(9004); a.metrics.avgLiquidity = 200000; return a; })(),
        expectedDiscard: false,
    },
].map(test => {
    const result = scoringEngine.processAsset(test.asset, CONTEXT);
    const discarded = !!result?._discarded;
    return { ...test, asset: undefined, discarded, pass: discarded === test.expectedDiscard };
});

const output = {
    seed: '0x5eed1234',
    requestedSamples: sampleCount,
    processedSamples: processed,
    transformations: Object.keys(transformations),
    checks: processed * profiles.length + processed * Object.keys(transformations).length * profiles.length,
    invariantFailures: invariantFailures.slice(0, 20),
    invariantFailureCount: invariantFailures.length,
    metamorphicRegressions: metamorphicRegressions.slice(0, 50),
    metamorphicRegressionCount: metamorphicRegressions.length,
    boundaries,
};

console.log(JSON.stringify(output, null, 2));
if (invariantFailures.length || metamorphicRegressions.length || boundaries.some(item => !item.pass)) {
    process.exitCode = 1;
}
