import { describe, expect, it } from 'vitest';
import { buildPerformanceSummary, formatMs, formatUptime } from './performanceOverviewView';
import type { PerformanceDurationMetric, PerformanceRuntime, PerformanceSnapshot } from '../../services/performance';

type Trend = NonNullable<PerformanceRuntime['memoryTrend']>;

const metric = (key: string, p95Ms: number | null, over: Partial<PerformanceDurationMetric> = {}): PerformanceDurationMetric => ({
    key, count: 10, sampled: 5, errors: 0, errorRate: 0, avgMs: p95Ms, minMs: p95Ms,
    p50Ms: p95Ms, p95Ms, p99Ms: p95Ms, maxMs: p95Ms, retainedSamples: 5, ...over,
});

const trend = (over: Partial<Trend> = {}): Trend => ({
    points: 288, spanHours: 24, sampleIntervalMinutes: 5, retentionHours: 24,
    direction: 'STABLE', rssSlopeMbPerHour: 0.2, offHeapSlopeMbPerHour: 0.1,
    recentSlopeMbPerHour: 0.1, recentSpanHours: 4, decelerating: false,
    rssMinMb: 300, rssMaxMb: 320, hoursToLimit: null, ...over,
});

const snap = (runtime: Partial<PerformanceRuntime> = {}, over: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot => ({
    enabled: true,
    startedAt: '2026-11-18T17:00:00.000Z',
    generatedAt: '2026-11-18T17:00:00.000Z',
    sampleRate: 1,
    limits: { maxSeries: 1, maxSamplesPerSeries: 1 },
    runtime: {
        uptimeSeconds: 60,
        limitsMb: { container: 512, heap: 300 },
        memoryMb: { rss: 300, heapUsed: 100, heapTotal: 120, external: 20, offHeap: 180 },
        eventLoopDelayMs: { mean: 1, p50: 1, p95: 10, p99: 1, max: 1 },
        ...runtime,
    },
    durations: { http: [] },
    counters: { cache: {} },
    ...over,
});

describe('formatos', () => {
    it.each([
        [null, '—'], [undefined, '—'], [Number.NaN, '—'], [Infinity, '—'],
        [0.25, '0.25 ms'], [999.4, '999 ms'], [1000, '1.00 s'],
    ])('formatMs(%s) = %s', (value, texto) => expect(formatMs(value)).toBe(texto));

    it.each([
        [null, '—'], [0, '1 min'], [3599, '59 min'], [3600, '1h'], [47 * 3600, '47h'], [48 * 3600, '2 dias'],
    ])('formatUptime(%s) = %s', (value, texto) => expect(formatUptime(value)).toBe(texto));
});

describe('buildPerformanceSummary', () => {
    it('sem snapshot nada é julgado e o topo não alarma', () => {
        const s = buildPerformanceSummary(null);
        expect(Object.values(s.cardVerdicts)).toEqual([null, null, null, null, null]);
        expect(s.memoryLimitMb).toBe(512);
        expect(s.memoryDetail).toBe('Sem leitura');
        expect(s.memoryDetailTitle).toBeUndefined();
        expect(s.memoryNote).toBeNull();
        expect(s.heapCeilingOverflow).toBeNull();
        expect(s.verdictLabel).toMatch(/^Tudo dentro do normal/);
    });

    it('cache conta só os desfechos conhecidos', () => {
        const s = buildPerformanceSummary(snap({}, {
            counters: { cache: { 'a.hit': 3, 'a.miss': 1, 'a.expired': 1, 'a.fallback': 1, 'a.error': 1, 'a.set': 99 } },
        }));
        expect(s.cacheAttempts).toBe(7);
        expect(s.cacheRate).toBeCloseTo(3 / 7);
    });

    it('fronteiras dos vereditos de latência, erro e cache', () => {
        const s = buildPerformanceSummary(snap({}, {
            durations: { http: [metric('a', 1000, { count: 100, errors: 5 })] },
            counters: { cache: { 'a.hit': 1, 'a.miss': 4 } },
        }));
        expect(s.cardVerdicts.latency).toBe('WATCH');
        expect(s.cardVerdicts.errors).toBe('BAD');
        expect(s.cardVerdicts.cache).toBe('BAD');
        expect(s.verdictLabel).toBe('2 medidor(es) fora do aceitável — o site pode estar lento ou falhando para o usuário.');
    });

    it('memória: subida só piora o nível, nunca o cala', () => {
        const alto = buildPerformanceSummary(snap({ memoryMb: { rss: 470, heapUsed: 1, heapTotal: 1, external: 1 }, memoryTrend: trend() }));
        expect(alto.cardVerdicts.memory).toBe('BAD');
        const subindo = buildPerformanceSummary(snap({ memoryTrend: trend({ direction: 'RISING', hoursToLimit: 30 }) }));
        expect(subindo.cardVerdicts.memory).toBe('WATCH');
        expect(subindo.memoryNote?.tone).toBe('WATCH');
        const urgente = buildPerformanceSummary(snap({ memoryTrend: trend({ direction: 'RISING', hoursToLimit: 24 }) }));
        expect(urgente.cardVerdicts.memory).toBe('BAD');
        expect(urgente.memoryNote?.tone).toBe('BAD');
        const parou = buildPerformanceSummary(snap({ memoryTrend: trend({ direction: 'RISING', hoursToLimit: 3, decelerating: true }) }));
        expect(parou.cardVerdicts.memory).toBe('GOOD');
        expect(parou.memoryNote?.tone).toBe('NEUTRAL');
    });

    it('excedente fora do heap na fronteira de 150 MB acusa o allocator', () => {
        const s = buildPerformanceSummary(snap({
            memoryMb: { rss: 300, heapUsed: 100, heapTotal: 120, external: 30, offHeap: 180 }, memoryTrend: trend(), mallocArenaMax: null,
        }));
        expect(s.memoryNote?.body).toMatch(/os outros 150 MB estão muito acima dos ~80 MB/);
        expect(s.memoryNote?.body).toMatch(/MALLOC_ARENA_MAX=2/);
        const abaixo = buildPerformanceSummary(snap({
            memoryMb: { rss: 300, heapUsed: 100, heapTotal: 120, external: 31, offHeap: 180 }, memoryTrend: trend(),
        }));
        expect(abaixo.memoryNote?.body).toMatch(/^Fora do heap há 180 MB, 31 deles em Buffers vivos/);
    });

    it('crescimento: 60% da inclinação fora do heap já é "fora"', () => {
        const fora = buildPerformanceSummary(snap({
            memoryTrend: trend({ direction: 'RISING', rssSlopeMbPerHour: 10, offHeapSlopeMbPerHour: 6, hoursToLimit: 40 }),
        }));
        expect(fora.memoryNote?.body).toMatch(/^O crescimento está FORA do heap \(6.0 MB\/h dos 10.0\)/);
        const dentro = buildPerformanceSummary(snap({
            memoryTrend: trend({ direction: 'RISING', rssSlopeMbPerHour: 10, offHeapSlopeMbPerHour: 5.9, hoursToLimit: 40 }),
        }));
        expect(dentro.memoryNote?.body).toMatch(/^O crescimento está no heap \(4.1 MB\/h dos 10.0\)/);
    });

    it('teto de heap só acusa quando passa da instância', () => {
        expect(buildPerformanceSummary(snap({ limitsMb: { container: 512, heap: 513 } })).heapCeilingOverflow)
            .toEqual({ heapLimitMb: 513, memoryLimitMb: 512 });
        expect(buildPerformanceSummary(snap({ limitsMb: { container: 512, heap: 512 } })).heapCeilingOverflow).toBeNull();
        expect(buildPerformanceSummary(snap({ limitsMb: undefined })).heapCeilingOverflow).toBeNull();
    });

    it('detalhe ordena por p95, ignora sem amostra e corta em 12', () => {
        const http = Array.from({ length: 14 }, (_, i) => metric(`r${i}`, i));
        const s = buildPerformanceSummary(snap({}, { durations: { http, web: [metric('nada', 9, { sampled: 0 })] } }));
        expect(s.detailRows).toHaveLength(12);
        expect(s.detailRows[0]).toEqual({ domain: 'http', metric: http[13] });
        expect(s.detailRows.some((row) => row.metric.key === 'nada')).toBe(false);
        expect(s.slowestWeb).toBeUndefined();
    });
});
