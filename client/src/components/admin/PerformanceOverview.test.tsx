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
        expect(screen.getByText('Heap 117 de 150 MB · 257 MB fora do heap · Buffers 22 MB')).toBeInTheDocument();
    });

    it('o balão traz os quatro números medidos, incluindo o teto real do heap', async () => {
        getSnapshot.mockResolvedValue(comMemoria());
        render(<PerformanceOverview />);

        const detalhe = await screen.findByText('Heap 117 de 150 MB · 257 MB fora do heap · Buffers 22 MB');
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
        expect(screen.getByText('Heap 76 de 100 MB · Buffers 4 MB')).toBeInTheDocument();
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

/**
 * O medidor que o AGORA não resolve.
 *
 * "396 MB de 512" serve a dois diagnósticos opostos: regime de repouso de um
 * processo que nunca passa disso, e vazamento a caminho do SIGKILL. O card lia
 * uma amostra instantânea e o uptime não desempatava — 24h de processo vivo é
 * compatível com os dois. Sem a janela, o amarelo permanente do repouso alto e o
 * amarelo de uma escalada real eram a mesma cor pelo mesmo motivo aparente.
 */
describe('memória ao longo do tempo — platô ou vazamento', () => {
    const comJanela = (
        trend: Partial<NonNullable<PerformanceSnapshot['runtime']>['memoryTrend']>,
        memoria: Partial<{ rss: number; external: number; offHeap: number }> = {},
    ) => snapshot({
        durations: { http: [] },
        counters: { cache: {} },
        runtime: {
            uptimeSeconds: 86400,
            limitsMb: { container: 512, heap: 492 },
            memoryMb: {
                rss: 396, heapUsed: 114, heapTotal: 124, external: 28, offHeap: 272, ...memoria,
            },
            memoryTrend: {
                points: 288, spanHours: 24, sampleIntervalMinutes: 5, retentionHours: 24,
                direction: 'STABLE', rssSlopeMbPerHour: 0.2, offHeapSlopeMbPerHour: 0.1,
                recentSlopeMbPerHour: 0.1, recentSpanHours: 4, decelerating: false,
                rssMinMb: 388, rssMaxMb: 402, hoursToLimit: null, ...trend,
            },
            eventLoopDelayMs: { mean: 12, p50: 11, p95: 24, p99: 31, max: 40 },
        },
    });

    it('diz que o nível apertado é repouso, não escalada', async () => {
        getSnapshot.mockResolvedValue(comJanela({}));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/Memória estável há 24h/)).toBeInTheDocument();
        expect(screen.getByText(/entre 388 e 402 MB na janela/)).toBeInTheDocument();
    });

    /**
     * O vão que só o nível deixava sem alarme: 300 MB de 512 é folgado, e o card
     * pintava "normal" enquanto o processo caminhava para o SIGKILL em 6h.
     */
    it('subida com horizonte curto condena o medidor mesmo com o nível folgado', async () => {
        getSnapshot.mockResolvedValue(comJanela(
            { direction: 'RISING', rssSlopeMbPerHour: 35, offHeapSlopeMbPerHour: 33, hoursToLimit: 6 },
            { rss: 300, offHeap: 176 },
        ));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/Memória subindo 35.0 MB\/h/)).toBeInTheDocument();
        expect(screen.getByText(/encosta nos 512 MB da instância em ~6h/)).toBeInTheDocument();
        expect(screen.getByText(/fora do aceitável/)).toBeInTheDocument();
        expect(screen.getAllByText('ruim').length).toBeGreaterThan(0);
    });

    // Onde cresce decide o que fazer: no heap o GC ainda alcança e o teto do V8
    // ainda transforma em OOM com stack; fora dele, o container mata em silêncio.
    it('aponta se o crescimento está dentro ou fora do heap', async () => {
        getSnapshot.mockResolvedValue(comJanela(
            { direction: 'RISING', rssSlopeMbPerHour: 10, offHeapSlopeMbPerHour: 9, hoursToLimit: 90 },
        ));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/O crescimento está FORA do heap/)).toBeInTheDocument();
        // Subida lenta não é emergência, mas também não é "normal".
        expect(screen.getByText(/merecendo o olho/)).toBeInTheDocument();
    });

    /**
     * 272 MB fora do heap com 28 MB de Buffers vivos: o excedente não é binário
     * nem pilha, é memória que o allocator nativo reteve. A tela passa a dizer
     * isso — e a dizer onde a variável funciona, porque no `.env` o dotenv lê
     * depois de o allocator já ter decidido.
     */
    it('atribui o excedente fora do heap em vez de deixá-lo sem dono', async () => {
        getSnapshot.mockResolvedValue(comJanela({}));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/os outros 244 MB estão muito acima/)).toBeInTheDocument();
        expect(screen.getByText(/MALLOC_ARENA_MAX=2/)).toBeInTheDocument();
    });

    it('cala a acusação quando o que está fora do heap se explica', async () => {
        getSnapshot.mockResolvedValue(comJanela({}, { rss: 200, offHeap: 76, external: 20 }));
        render(<PerformanceOverview />);

        await screen.findByText('200 MB');
        expect(screen.queryByText(/MALLOC_ARENA_MAX/)).not.toBeInTheDocument();
        expect(screen.getByText(/dentro do que o binário, as bibliotecas e os downloads explicam/)).toBeInTheDocument();
    });

    // Servidor sem a janela não é acusado de nada, e também não é absolvido.
    it('sem janela, nenhuma leitura é inventada', async () => {
        getSnapshot.mockResolvedValue(snapshot());
        render(<PerformanceOverview />);

        await screen.findByText('148 MB');
        expect(screen.queryByText(/Memória estável/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Memória subindo/)).not.toBeInTheDocument();
    });
});

/**
 * O alarme que acendia depois de TODO deploy.
 *
 * 19/09/2026, 26h de uptime: o RSS vinha caindo de 330 para 324 havia 19 horas e
 * o card anunciava "subindo 1,1 MB/h — encosta nos 512 MB em ~184h". A rampa de
 * aquecimento é côncava (sobe enquanto o processo enche cache e abre conexão,
 * achata depois) e mínimos quadrados só sabem traçar reta: com as primeiras
 * horas ainda dentro da janela, a reta sobe num processo parado.
 *
 * A saída não foi calar nem alargar a quarentena — foi medir se a inclinação
 * está caindo. Alarme que acende sempre se aprende a ignorar, e era esse o vício
 * que tínhamos acabado de tirar do amarelo permanente do card.
 */
describe('rampa de aquecimento não é vazamento', () => {
    const emRepouso = (over: Record<string, unknown> = {}) => snapshot({
        durations: { http: [] },
        counters: { cache: {} },
        runtime: {
            uptimeSeconds: 93_600,
            limitsMb: { container: 512, heap: 492 },
            memoryMb: { rss: 324, heapUsed: 109, heapTotal: 120, external: 41, offHeap: 204 },
            memoryTrend: {
                points: 288, spanHours: 24, sampleIntervalMinutes: 5, retentionHours: 24,
                direction: 'RISING', rssSlopeMbPerHour: 1.1, offHeapSlopeMbPerHour: 0.8,
                recentSlopeMbPerHour: -0.3, recentSpanHours: 4, decelerating: true,
                rssMinMb: 270, rssMaxMb: 331, hoursToLimit: null, ...over,
            },
            eventLoopDelayMs: { mean: 12, p50: 11, p95: 21, p99: 31, max: 40 },
        },
    });

    it('lê subida que já parou como processo estabilizado', async () => {
        getSnapshot.mockResolvedValue(emRepouso());
        render(<PerformanceOverview />);

        expect(await screen.findByText(/Memória estabilizada — plana nas últimas 4h, em 324 MB/)).toBeInTheDocument();
        expect(screen.queryByText(/Memória subindo/)).not.toBeInTheDocument();
    });

    // O número da janela longa continua na tela e CONTRADIZ o título. Mostrar os
    // dois sem explicar o desencontro devolveria a dúvida para quem lê.
    it('explica por que a janela longa ainda acusa subida', async () => {
        getSnapshot.mockResolvedValue(emRepouso());
        render(<PerformanceOverview />);

        expect(await screen.findByText(/A janela de 24h ainda acusa 1.1 MB\/h porque inclui a subida que todo processo faz ao esquentar/))
            .toBeInTheDocument();
        expect(screen.getByText(/nas últimas 4h a inclinação é -0.3 MB\/h/)).toBeInTheDocument();
    });

    it('e o medidor volta a ser julgado só pelo nível', async () => {
        getSnapshot.mockResolvedValue(emRepouso());
        render(<PerformanceOverview />);

        // 324 de 512 é folgado, e não há subida em curso para piorar isso.
        await screen.findByText('324 MB');
        expect(screen.getByText(/Tudo dentro do normal/)).toBeInTheDocument();
    });

    // A comparação mede, não anistia: subida que se mantém segue condenada.
    it('não perdoa vazamento cuja inclinação recente se mantém', async () => {
        getSnapshot.mockResolvedValue(emRepouso({
            rssSlopeMbPerHour: 12, recentSlopeMbPerHour: 11.4, decelerating: false, hoursToLimit: 15,
        }));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/Memória subindo 12.0 MB\/h/)).toBeInTheDocument();
        expect(screen.getByText(/fora do aceitável/)).toBeInTheDocument();
    });
});

/**
 * O painel não repete conselho já aplicado.
 *
 * "Ligue MALLOC_ARENA_MAX" para quem já ligou é ruído que nunca apaga, e ensina
 * a ignorar o bloco inteiro — o mesmo vício do amarelo permanente. Quem sabe se
 * a variável valeu é o processo: é do ambiente dele que o glibc a lê.
 */
describe('conselho do allocator só aparece para quem ainda não o aplicou', () => {
    const comArena = (mallocArenaMax: number | null) => snapshot({
        durations: { http: [] },
        counters: { cache: {} },
        runtime: {
            uptimeSeconds: 93_600,
            limitsMb: { container: 512, heap: 492 },
            memoryMb: { rss: 324, heapUsed: 109, heapTotal: 120, external: 41, offHeap: 204 },
            mallocArenaMax,
            memoryTrend: {
                points: 288, spanHours: 24, sampleIntervalMinutes: 5, retentionHours: 24,
                direction: 'STABLE', rssSlopeMbPerHour: 0.1, offHeapSlopeMbPerHour: 0.1,
                recentSlopeMbPerHour: 0.1, recentSpanHours: 4, decelerating: false,
                rssMinMb: 318, rssMaxMb: 331, hoursToLimit: null,
            },
            eventLoopDelayMs: { mean: 12, p50: 11, p95: 21, p99: 31, max: 40 },
        },
    });

    it('sugere a variável quando ninguém a definiu', async () => {
        getSnapshot.mockResolvedValue(comArena(null));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/MALLOC_ARENA_MAX=2 no ambiente do processo/)).toBeInTheDocument();
    });

    it('e muda de assunto quando já está aplicada', async () => {
        getSnapshot.mockResolvedValue(comArena(2));
        render(<PerformanceOverview />);

        expect(await screen.findByText(/As arenas já estão limitadas a 2/)).toBeInTheDocument();
        expect(screen.getByText(/reduzir o que ele aloca, não como o allocator agrupa/)).toBeInTheDocument();
        expect(screen.queryByText(/MALLOC_ARENA_MAX=2 no ambiente do processo/)).not.toBeInTheDocument();
    });
});
