import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PerformanceOverview } from './PerformanceOverview';
import type { PerformanceSnapshot } from '../../services/performance';

const getSnapshot = vi.fn();

vi.mock('../../services/performance', () => ({
    performanceService: {
        getSnapshot: (...args: unknown[]) => getSnapshot(...args),
    },
}));

const snapshot = (over: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot => ({
    enabled: true,
    startedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    sampleRate: 0.25,
    limits: { maxSeries: 200, maxSamplesPerSeries: 500 },
    runtime: {
        uptimeSeconds: 7200,
        memoryMb: { rss: 148, heapUsed: 76, heapTotal: 100, external: 4 },
        eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
    },
    durations: {
        http: [
            {
                key: 'GET /api/wallet 2xx', count: 100, sampled: 25, errors: 0,
                errorRate: 0, avgMs: 100, minMs: 50, p50Ms: 90, p95Ms: 240,
                p99Ms: 300, maxMs: 320, retainedSamples: 25,
            },
            {
                key: 'GET /api/research/latest 5xx', count: 2, sampled: 1, errors: 2,
                errorRate: 1, avgMs: 800, minMs: 800, p50Ms: 800, p95Ms: 800,
                p99Ms: 800, maxMs: 800, retainedSamples: 1,
            },
        ],
    },
    counters: {
        cache: {
            'market-price.hit': 80,
            'market-price.miss': 20,
        },
    },
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('medidores de desempenho no Admin', () => {
    it('explica quando a coleta está desativada', async () => {
        getSnapshot.mockResolvedValue(snapshot({ enabled: false }));
        render(<PerformanceOverview />);

        expect(await screen.findByText('Medição contínua desativada')).toBeInTheDocument();
        expect(screen.getByText('PERF_METRICS_ENABLED=false')).toBeInTheDocument();
    });

    it('resume as métricas que ajudam a decidir', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);

        expect(await screen.findByText('Medição ativa')).toBeInTheDocument();
        expect(screen.getByText('800 ms')).toBeInTheDocument();
        expect(screen.getByText('1.96%')).toBeInTheDocument();
        expect(screen.getByText('148 MB')).toBeInTheDocument();
        expect(screen.getByText('24 ms')).toBeInTheDocument();
        expect(screen.getByText('80.0%')).toBeInTheDocument();
    });

    it('mantém os detalhes técnicos recolhidos até o clique', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);

        const button = await screen.findByText('Ver detalhes técnicos');
        expect(screen.queryByText('Amostras/total')).not.toBeInTheDocument();

        fireEvent.click(button);
        expect(screen.getByText('Amostras/total')).toBeInTheDocument();
        expect(screen.getAllByText('GET /api/research/latest 5xx')).toHaveLength(2);
    });

    // Antes, os cinco medidores eram cinco números sem régua: "800 ms" e "1.96%"
    // só significam alguma coisa para quem já sabe os limiares de cor.
    it('cada medidor carrega o veredito, não só o número', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);

        await screen.findByText('Medição ativa');
        // 800 ms de p95 na rota mais lenta = normal; 1,96% de erro = atenção.
        expect(screen.getAllByText('normal').length).toBeGreaterThan(0);
        expect(screen.getAllByText('atenção').length).toBeGreaterThan(0);
    });

    it('o topo diz em uma frase se é preciso agir', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);
        expect(await screen.findByText(/merecendo o olho, mas nada quebrado/)).toBeInTheDocument();
    });

    it('medidor fora do aceitável vira frase de alerta no topo', async () => {
        getSnapshot.mockResolvedValue(snapshot({
            runtime: {
                uptimeSeconds: 7200,
                memoryMb: { rss: 500, heapUsed: 380, heapTotal: 400, external: 10 }, // ~98% de 512 MB
                eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
            },
        }));
        render(<PerformanceOverview />);
        expect(await screen.findByText(/fora do aceitável/)).toBeInTheDocument();
    });

    it('sem amostra, o medidor não é julgado (ausência não é nota ruim)', async () => {
        getSnapshot.mockResolvedValue(snapshot({ durations: { http: [] }, counters: { cache: {} } }));
        render(<PerformanceOverview />);

        await screen.findByText('Medição ativa');
        expect(screen.getByText('Aguardando tráfego')).toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('não derruba a aba Saúde quando o endpoint está indisponível', async () => {
        getSnapshot.mockRejectedValue(new Error('offline'));
        render(<PerformanceOverview />);

        expect(await screen.findByText('Medidores indisponíveis')).toBeInTheDocument();
    });
});
