/** Benchmark local e sem banco/rede das duas mudanças algorítmicas da Fase 3. */
import { performance } from 'perf_hooks';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { downsampleTimeSeries } from '../utils/timeSeriesDownsample.js';

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

const timed = async (fn) => {
    const start = performance.now();
    await fn();
    return Number((performance.now() - start).toFixed(2));
};

const work = async (value) => {
    await new Promise((resolve) => setTimeout(resolve, 8));
    return value;
};

const items = Array.from({ length: 24 }, (_, index) => index);
const sequentialRuns = [];
const limitedRuns = [];
for (let run = 0; run < 7; run++) {
    sequentialRuns.push(await timed(async () => {
        for (const item of items) await work(item);
    }));
    limitedRuns.push(await timed(() => mapWithConcurrency(items, 4, work)));
}

const snapshots = Array.from({ length: 3650 }, (_, index) => ({
    date: new Date(Date.UTC(2012, 0, 1 + index)).toISOString().slice(0, 10),
    totalEquity: 100_000 + index * 17.31,
    totalInvested: 90_000 + index * 12.07,
    totalDividends: index * 2.11,
    quotaPrice: 100 + index * 0.013,
}));
const bounded = downsampleTimeSeries(snapshots, { maxPoints: 480, recentPoints: 120 });
const beforeBytes = Buffer.byteLength(JSON.stringify(snapshots));
const afterBytes = Buffer.byteLength(JSON.stringify(bounded));
const sequentialP95 = percentile(sequentialRuns, 0.95);
const limitedP95 = percentile(limitedRuns, 0.95);

console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    snapshotWorkers: {
        scenario: '24 carteiras independentes, I/O sintético de 8ms, 7 execuções',
        beforeSequentialP95Ms: sequentialP95,
        afterConcurrency4P95Ms: limitedP95,
        speedup: Number((sequentialP95 / limitedP95).toFixed(2)),
    },
    historyPayload: {
        beforePoints: snapshots.length,
        afterPoints: bounded.length,
        beforeBytes,
        afterBytes,
        reductionPercent: Number(((1 - afterBytes / beforeBytes) * 100).toFixed(2)),
        preservedFirst: bounded[0] === snapshots[0],
        preservedLast: bounded.at(-1) === snapshots.at(-1),
        preservedRecent120: bounded.slice(-120).every((point, index) => point === snapshots.at(index - 120)),
    },
}, null, 2));
