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
        memoryMb: { rss: 148, heapUsed: 76, heapTotal: 100, external: 4 },
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
