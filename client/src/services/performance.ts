import { authService } from './auth';

export interface PerformanceDurationMetric {
    key: string;
    count: number;
    sampled: number;
    errors: number;
    errorRate: number;
    avgMs: number | null;
    minMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
    retainedSamples: number;
}

export interface PerformanceRuntime {
    uptimeSeconds: number;
    memoryMb: {
        rss: number;
        heapUsed: number;
        heapTotal: number;
        external: number;
    };
    eventLoopDelayMs: {
        mean: number | null;
        p50: number | null;
        p95: number | null;
        p99: number | null;
        max: number | null;
    } | null;
}

export interface PerformanceSnapshot {
    enabled: boolean;
    startedAt: string;
    generatedAt: string;
    sampleRate: number;
    limits: {
        maxSeries: number;
        maxSamplesPerSeries: number;
    };
    runtime: PerformanceRuntime | null;
    durations: Record<string, PerformanceDurationMetric[]>;
    counters: Record<string, Record<string, number>>;
}

export const performanceService = {
    async getSnapshot(): Promise<PerformanceSnapshot> {
        const response = await authService.api('/api/admin/performance-metrics');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar as métricas de desempenho.');
        return data as PerformanceSnapshot;
    },
};
