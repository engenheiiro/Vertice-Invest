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

/**
 * "407 MB de 512, Heap 117 MB" — e os outros 290 MB, de quem são?
 *
 * O card media RSS e imprimia `heapUsed`, engolindo `heapTotal` e `external`:
 * justamente os dois que fecham a conta. Sem eles, o mesmo par de números serve
 * para dois diagnósticos opostos — página que o V8 comprometeu e não devolveu
 * (esperado depois de um job pesado) ou memória nativa presa —, e não havia como
 * escolher entre eles sem ir ao JSON cru da rota.
 */
describe('memória do servidor — a conta inteira, não metade dela', () => {
    const comMemoria = () => snapshot({
        runtime: {
            uptimeSeconds: 7200,
            limitsMb: { container: 512, heap: 400 },
            memoryMb: { rss: 407, heapUsed: 117, heapTotal: 150, external: 22, offHeap: 257 },
            eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
        },
    });

    it('mostra o heap reservado e o que está fora dele', async () => {
        getSnapshot.mockResolvedValue(comMemoria());
        render(<PerformanceOverview />);

        expect(await screen.findByText('407 MB')).toBeInTheDocument();
        expect(screen.getByText('Heap 117 de 150 MB · 257 MB fora do heap')).toBeInTheDocument();
    });

    it('o balão traz os quatro números medidos, incluindo o teto real do heap', async () => {
        getSnapshot.mockResolvedValue(comMemoria());
        render(<PerformanceOverview />);

        const detalhe = await screen.findByText('Heap 117 de 150 MB · 257 MB fora do heap');
        expect(detalhe.getAttribute('title')).toContain('teto de 400 MB');
        expect(detalhe.getAttribute('title')).toContain('external): 22 MB');
    });

    // O teto é do DEPLOY, não do código: cravá-lo aqui foi o que deixou o painel
    // e o `--max-old-space-size` do `npm start` discordarem em silêncio.
    it('o denominador vem do processo, não de um número cravado na tela', async () => {
        // Sem tráfego nem cache, a memória é o ÚNICO medidor que pode emitir
        // veredito — então a frase do topo fala só dela.
        const soMemoria = (container: number) => snapshot({
            durations: { http: [] },
            counters: { cache: {} },
            runtime: {
                uptimeSeconds: 7200,
                limitsMb: { container, heap: 800 },
                memoryMb: { rss: 407, heapUsed: 117, heapTotal: 150, external: 22, offHeap: 257 },
                eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
            },
        });

        // Os mesmos 407 MB: apertado numa instância de 512, folgado numa de 1024.
        getSnapshot.mockResolvedValue(soMemoria(512));
        const { unmount } = render(<PerformanceOverview />);
        expect(await screen.findByText('De 512 MB disponíveis no plano')).toBeInTheDocument();
        expect(screen.getByText(/merecendo o olho/)).toBeInTheDocument();
        unmount();

        getSnapshot.mockResolvedValue(soMemoria(1024));
        render(<PerformanceOverview />);
        expect(await screen.findByText('De 1024 MB disponíveis no plano')).toBeInTheDocument();
        expect(screen.getByText(/Tudo dentro do normal/)).toBeInTheDocument();
    });

    // Servidor ainda não atualizado não manda os campos novos — a tela continua
    // legível, só sem a parte que ele não sabe informar.
    it('servidor antigo cai no teto padrão e omite o que não veio', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);

        expect(await screen.findByText('De 512 MB disponíveis no plano')).toBeInTheDocument();
        expect(screen.getByText('Heap 76 de 100 MB')).toBeInTheDocument();
    });
});

/**
 * O teto que não protege nada.
 *
 * `--max-old-space-size=400` numa instância de 512 MB faz o V8 reportar um
 * `heap_size_limit` de ~592 MB (o sinalizador governa a geração velha; as outras
 * áreas entram por cima) — maior que a instância INTEIRA, e ainda sem contar o
 * que roda fora do heap. O container mata o processo muito antes de o V8 sentir
 * pressão, então o limite existe sem defender coisa alguma.
 *
 * Nenhum dos cinco medidores acende para isto: todos falam de AGORA, e este é um
 * defeito de configuração, que não passa com o tráfego nem com um reinício.
 */
describe('teto de heap × tamanho da instância', () => {
    const comTeto = (heap: number, container: number) => snapshot({
        runtime: {
            uptimeSeconds: 7200,
            limitsMb: { container, heap },
            memoryMb: { rss: 407, heapUsed: 117, heapTotal: 150, external: 22, offHeap: 257 },
            eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
        },
    });

    it('denuncia quando o heap pode passar do tamanho da instância', async () => {
        getSnapshot.mockResolvedValue(comTeto(592, 512));
        render(<PerformanceOverview />);

        expect(await screen.findByText('O limite de memória do Node não cabe na instância')).toBeInTheDocument();
        expect(screen.getByText(/592 MB só de heap/)).toBeInTheDocument();
        expect(screen.getByText(/--max-old-space-size/)).toBeInTheDocument();
    });

    it('cala quando o teto cabe', async () => {
        getSnapshot.mockResolvedValue(comTeto(320, 512));
        render(<PerformanceOverview />);

        await screen.findByText('407 MB');
        expect(screen.queryByText('O limite de memória do Node não cabe na instância')).not.toBeInTheDocument();
    });

    // Servidor que não informa os tetos não pode ser acusado de nada.
    it('sem a leitura dos tetos, não inventa acusação', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);

        await screen.findByText('148 MB');
        expect(screen.queryByText('O limite de memória do Node não cabe na instância')).not.toBeInTheDocument();
    });
});

/**
 * Em 04/09/2026 o painel mostrou "Página mais lenta: 1,48 s" e ninguém conseguia
 * dizer de que página se tratava. Medido até o último byte, o bundle de ~400 KB
 * concorre no mesmo p95 das rotas de API e vence sempre — só que o tempo dele é a
 * banda de quem baixa, não latência nossa. Séries separadas, e a linha de arquivos
 * fica fora do veredito.
 */
describe('latência de API × entrega de arquivo', () => {
    const comWeb = () => snapshot({
        durations: {
            http: [{
                key: 'GET /api/wallet 2xx', count: 100, sampled: 25, errors: 0,
                errorRate: 0, avgMs: 100, minMs: 50, p50Ms: 90, p95Ms: 240,
                p99Ms: 300, maxMs: 320, retainedSamples: 25,
            }],
            web: [{
                key: 'GET /assets/index-CFpXr4Go.js 2xx', count: 400, sampled: 100, errors: 0,
                errorRate: 0, avgMs: 900, minMs: 300, p50Ms: 800, p95Ms: 1480,
                p99Ms: 2100, maxMs: 2400, retainedSamples: 100,
            }],
        },
    });

    it('o medidor principal ignora arquivo e aponta a rota de API', async () => {
        getSnapshot.mockResolvedValue(comWeb());
        render(<PerformanceOverview />);

        expect(await screen.findByText('Chamada mais lenta')).toBeInTheDocument();
        expect(screen.getByText('GET /api/wallet 2xx')).toBeInTheDocument();
        expect(screen.getByText('240 ms')).toBeInTheDocument();
    });

    it('a entrega de arquivo aparece à parte, sem veredito de cor', async () => {
        getSnapshot.mockResolvedValue(comWeb());
        render(<PerformanceOverview />);

        expect(await screen.findByText(/Entrega de arquivos do site/)).toBeInTheDocument();
        expect(screen.getByText(/depende sobretudo/)).toBeInTheDocument();
        // Nada de amarelo: 1,48 s ali não é defeito nosso e não entra no veredito.
        expect(screen.getByText(/Tudo dentro do normal/)).toBeInTheDocument();
    });

    // Só o p95 não separa "lenta para todo mundo" de "rápida com pico ocasional".
    it('mostra o p50 ao lado, para distinguir pico de lentidão crônica', async () => {
        getSnapshot.mockResolvedValue(comWeb());
        render(<PerformanceOverview />);
        expect(await screen.findByText(/Metade responde em 90 ms/)).toBeInTheDocument();
    });

    it('a tabela de detalhe nomeia o domínio em português', async () => {
        getSnapshot.mockResolvedValue(comWeb());
        render(<PerformanceOverview />);
        fireEvent.click(await screen.findByText('Ver detalhes técnicos'));
        expect(screen.getByText('Arquivo do site')).toBeInTheDocument();
        expect(screen.getByText('API')).toBeInTheDocument();
    });
});
