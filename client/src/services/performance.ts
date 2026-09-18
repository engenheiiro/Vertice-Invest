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
    /**
     * Denominadores da memória, lidos do PROCESSO — não chutados aqui. `heap` é o
     * `--max-old-space-size` como o V8 o resolveu; `container` é o tamanho da
     * instância. Opcionais porque um servidor ainda não atualizado não os envia.
     */
    limitsMb?: {
        container: number;
        heap: number;
    };
    memoryMb: {
        rss: number;
        heapUsed: number;
        heapTotal: number;
        external: number;
        /** RSS menos o heap comprometido. Opcional pelo mesmo motivo acima. */
        offHeap?: number;
    };
    /**
     * A JANELA, ao lado da leitura de agora.
     *
     * Uma amostra instantânea de RSS não distingue as duas únicas coisas que
     * importam: regime de repouso alto (não passa disso) e vazamento (passa, e
     * termina em SIGKILL). O servidor amostra a cada 5 min e publica a
     * inclinação já calculada — 288 pontos não atravessam a rede a cada 2 min
     * para o card refazer a mesma conta.
     *
     * Opcional porque um servidor ainda não atualizado não envia.
     */
    memoryTrend?: {
        points: number;
        spanHours: number;
        sampleIntervalMinutes: number;
        retentionHours: number;
        /** `null` = janela curta demais para afirmar direção. Nunca "estável" por omissão. */
        direction: 'RISING' | 'STABLE' | 'FALLING' | null;
        rssSlopeMbPerHour: number | null;
        /** Separa vazamento de objeto JS (heap) de Buffer/nativo preso (fora dele). */
        offHeapSlopeMbPerHour: number | null;
        rssMinMb: number | null;
        rssMaxMb: number | null;
        /** Projeção linear até o teto da instância. Só existe quando há subida. */
        hoursToLimit: number | null;
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
