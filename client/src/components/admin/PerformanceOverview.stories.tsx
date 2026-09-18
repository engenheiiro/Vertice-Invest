import type { Meta, StoryObj } from '@storybook/react';
import { PerformanceOverview } from './PerformanceOverview';
import type { PerformanceSnapshot } from '../../services/performance';

const activeSnapshot: PerformanceSnapshot = {
    enabled: true,
    startedAt: new Date(Date.now() - 7_200_000).toISOString(),
    generatedAt: new Date().toISOString(),
    sampleRate: 0.25,
    limits: { maxSeries: 200, maxSamplesPerSeries: 500 },
    runtime: {
        uptimeSeconds: 7200,
        limitsMb: { container: 512, heap: 400 },
        memoryMb: { rss: 148, heapUsed: 76, heapTotal: 100, external: 4, offHeap: 48 },
        eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
    },
    durations: {
        http: [{
            key: 'GET /api/wallet 2xx', count: 100, sampled: 25, errors: 0,
            errorRate: 0, avgMs: 100, minMs: 50, p50Ms: 90, p95Ms: 240,
            p99Ms: 300, maxMs: 320, retainedSamples: 25,
        }],
        external: [{
            key: 'GET query1.finance.yahoo.com 2xx', count: 40, sampled: 10, errors: 0,
            errorRate: 0, avgMs: 310, minMs: 180, p50Ms: 290, p95Ms: 520,
            p99Ms: 540, maxMs: 540, retainedSamples: 10,
        }],
    },
    counters: {
        cache: { 'market-price.hit': 80, 'market-price.miss': 20 },
    },
};

const meta: Meta<typeof PerformanceOverview> = {
    title: 'Admin/Desempenho do sistema',
    component: PerformanceOverview,
    parameters: { layout: 'padded' },
    decorators: [(Story) => (
        <div className="max-w-[1360px] mx-auto">
            <Story />
        </div>
    )],
};

export default meta;
type Story = StoryObj<typeof PerformanceOverview>;

export const MedicaoAtiva: Story = {
    args: { loadSnapshot: async () => activeSnapshot },
};

export const MedicaoDesativada: Story = {
    args: { loadSnapshot: async () => ({ ...activeSnapshot, enabled: false }) },
};

const comMemoria = (
    memoryMb: NonNullable<PerformanceSnapshot['runtime']>['memoryMb'],
    memoryTrend: NonNullable<PerformanceSnapshot['runtime']>['memoryTrend'],
): PerformanceSnapshot => ({
    ...activeSnapshot,
    runtime: { ...activeSnapshot.runtime!, uptimeSeconds: 86_400, memoryMb, memoryTrend },
});

/**
 * O caso real de 18/09/2026: 396 MB de 512 — nível apertado, reta plana. É o
 * estado em que o card sozinho pintava amarelo sem conseguir dizer se havia para
 * onde escalar, e em que os 272 MB fora do heap não tinham dono.
 */
export const MemoriaEstavelEmRepousoAlto: Story = {
    args: {
        loadSnapshot: async () => comMemoria(
            { rss: 396, heapUsed: 114, heapTotal: 124, external: 28, offHeap: 272 },
            {
                points: 288, spanHours: 24, sampleIntervalMinutes: 5, retentionHours: 24,
                direction: 'STABLE', rssSlopeMbPerHour: 0.2, offHeapSlopeMbPerHour: 0.1,
                rssMinMb: 388, rssMaxMb: 402, hoursToLimit: null,
            },
        ),
    },
};

/** O vão que só o nível deixava sem alarme: folgado agora, morto em 6h. */
export const MemoriaSubindoRumoAoTeto: Story = {
    args: {
        loadSnapshot: async () => comMemoria(
            { rss: 300, heapUsed: 110, heapTotal: 124, external: 30, offHeap: 176 },
            {
                points: 96, spanHours: 8, sampleIntervalMinutes: 5, retentionHours: 24,
                direction: 'RISING', rssSlopeMbPerHour: 35, offHeapSlopeMbPerHour: 33,
                rssMinMb: 180, rssMaxMb: 300, hoursToLimit: 6,
            },
        ),
    },
};
