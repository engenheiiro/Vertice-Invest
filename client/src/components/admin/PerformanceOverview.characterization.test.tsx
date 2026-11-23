import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { PerformanceOverview } from './PerformanceOverview';
import type {
    PerformanceDurationMetric, PerformanceRuntime, PerformanceSnapshot,
} from '../../services/performance';

/**
 * Caracterização do painel de desempenho: trava o que a tela MOSTRA em cada ramo
 * (veredito, tendência de memória, teto de heap, conselho do allocator, campos
 * ausentes), para que reorganizar o código não mude nada que o leitor vê.
 */
const AGORA = new Date('2026-11-18T14:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

type Trend = NonNullable<PerformanceRuntime['memoryTrend']>;

const metric = (key: string, p95Ms: number | null, over: Partial<PerformanceDurationMetric> = {}): PerformanceDurationMetric => ({
    key, count: 10, sampled: 5, errors: 0, errorRate: 0, avgMs: p95Ms, minMs: p95Ms,
    p50Ms: p95Ms === null ? null : p95Ms / 2, p95Ms, p99Ms: p95Ms, maxMs: p95Ms, retainedSamples: 5, ...over,
});

const trend = (over: Partial<Trend> = {}): Trend => ({
    points: 288, spanHours: 24, sampleIntervalMinutes: 5, retentionHours: 24,
    direction: 'STABLE', rssSlopeMbPerHour: 0.2, offHeapSlopeMbPerHour: 0.1,
    recentSlopeMbPerHour: 0.1, recentSpanHours: 4, decelerating: false,
    rssMinMb: 300, rssMaxMb: 320, hoursToLimit: null, ...over,
});

const runtime = (over: Partial<PerformanceRuntime> = {}): PerformanceRuntime => ({
    uptimeSeconds: 7200,
    limitsMb: { container: 512, heap: 300 },
    memoryMb: { rss: 310, heapUsed: 100, heapTotal: 120, external: 30, offHeap: 170 },
    eventLoopDelayMs: { mean: 10, p50: 10, p95: 20, p99: 30, max: 40 },
    ...over,
});

const snap = (over: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot => ({
    enabled: true,
    startedAt: AGORA.toISOString(),
    generatedAt: AGORA.toISOString(),
    sampleRate: 0.5,
    limits: { maxSeries: 200, maxSamplesPerSeries: 500 },
    runtime: runtime(),
    durations: { http: [] },
    counters: { cache: {} },
    ...over,
});

const renderWith = async (snapshot: PerformanceSnapshot) => {
    const utils = render(<PerformanceOverview loadSnapshot={async () => snapshot} />);
    await screen.findByText('Ver detalhes técnicos');
    return utils;
};

/** O `<p>` do valor dentro do card cujo rótulo é `label`. */
const cardValue = (label: string) => {
    const card = screen.getByText(label).closest('div.rounded-xl');
    const value = card?.querySelector('p.text-lg');
    if (!value) throw new Error(`card ${label} sem valor`);
    return value;
};

const memoryNoteBox = (title: RegExp) => {
    const box = screen.getByText(title).closest('div.rounded-xl');
    if (!box) throw new Error('nota de memória sem caixa');
    return box;
};

describe('estados de carregamento', () => {
    it('mostra o carregando antes da primeira resposta', () => {
        render(<PerformanceOverview loadSnapshot={() => new Promise<PerformanceSnapshot>(() => undefined)} />);
        expect(screen.getByText('Carregando medidores…')).toBeInTheDocument();
        expect(screen.queryByText('Medição ativa')).not.toBeInTheDocument();
        expect(screen.getByText(/Tudo dentro do normal/)).toBeInTheDocument();
    });

    it('falha do endpoint vira aviso amarelo, sem cards', async () => {
        render(<PerformanceOverview loadSnapshot={async () => { throw new Error('x'); }} />);
        expect(await screen.findByText('Medidores indisponíveis')).toHaveClass('text-yellow-400');
        expect(screen.queryByText('Chamada mais lenta')).not.toBeInTheDocument();
    });

    it('coleta desligada não mostra cards nem selo de medição', async () => {
        render(<PerformanceOverview loadSnapshot={async () => snap({ enabled: false })} />);
        expect(await screen.findByText('Medição contínua desativada')).toBeInTheDocument();
        expect(screen.queryByText('Medição ativa')).not.toBeInTheDocument();
        expect(screen.queryByText('Chamada mais lenta')).not.toBeInTheDocument();
    });
});

describe('vereditos de cada medidor', () => {
    it('tudo bom: verde em todos os medidores julgados', async () => {
        await renderWith(snap({
            durations: { http: [metric('GET /a 2xx', 200, { count: 1000, errors: 0 })] },
            counters: { cache: { 'x.hit': 90, 'x.miss': 10 } },
        }));
        expect(cardValue('Chamada mais lenta')).toHaveClass('text-emerald-400');
        expect(cardValue('Requisições com erro')).toHaveClass('text-emerald-400');
        expect(cardValue('Memória do servidor')).toHaveClass('text-emerald-400');
        expect(cardValue('Congestionamento')).toHaveClass('text-emerald-400');
        expect(cardValue('Aproveitamento de cache')).toHaveClass('text-emerald-400');
        expect(screen.getAllByText('normal')).toHaveLength(5);
        expect(screen.getByText(/Tudo dentro do normal/)).toBeInTheDocument();
    });

    it('limiares de atenção pintam amarelo e contam no topo', async () => {
        await renderWith(snap({
            durations: { http: [metric('GET /a 2xx', 1500, { count: 100, errors: 2 })] },
            counters: { cache: { 'x.hit': 40, 'x.miss': 60 } },
            runtime: runtime({
                memoryMb: { rss: 400, heapUsed: 100, heapTotal: 120, external: 30, offHeap: 280 },
                eventLoopDelayMs: { mean: 1, p50: 1, p95: 150, p99: 1, max: 1 },
            }),
        }));
        for (const label of ['Chamada mais lenta', 'Requisições com erro', 'Memória do servidor', 'Congestionamento', 'Aproveitamento de cache']) {
            expect(cardValue(label)).toHaveClass('text-yellow-400');
        }
        expect(screen.getAllByText('atenção')).toHaveLength(5);
        expect(screen.getByText('5 medidor(es) merecendo o olho, mas nada quebrado.')).toBeInTheDocument();
        expect(screen.getByText('2.00%')).toBeInTheDocument();
        expect(screen.getByText('40.0%')).toBeInTheDocument();
        expect(screen.getByText('1.50 s')).toBeInTheDocument();
    });

    it('limiares ruins pintam vermelho e o topo alerta', async () => {
        await renderWith(snap({
            durations: { http: [metric('GET /a 5xx', 3500, { count: 10, errors: 1 })] },
            counters: { cache: { 'x.hit': 1, 'x.miss': 9, 'x.other': 50 } },
            runtime: runtime({
                memoryMb: { rss: 470, heapUsed: 100, heapTotal: 120, external: 30 },
                eventLoopDelayMs: { mean: 1, p50: 1, p95: 600, p99: 1, max: 1 },
            }),
        }));
        for (const label of ['Chamada mais lenta', 'Requisições com erro', 'Memória do servidor', 'Congestionamento', 'Aproveitamento de cache']) {
            expect(cardValue(label)).toHaveClass('text-red-400');
        }
        expect(screen.getAllByText('ruim')).toHaveLength(5);
        expect(screen.getByText(/^5 medidor\(es\) fora do aceitável/)).toBeInTheDocument();
        expect(screen.getByText('10.0%')).toBeInTheDocument();
        expect(screen.getByText('10 consultas observadas')).toBeInTheDocument();
    });

    it('sem amostras: medidores sem veredito ficam brancos e sem selo', async () => {
        await renderWith(snap({
            durations: { http: [metric('GET /a 2xx', null, { sampled: 0, count: 0 })] },
            runtime: null,
        }));
        expect(cardValue('Chamada mais lenta')).toHaveClass('text-white');
        expect(cardValue('Requisições com erro')).toHaveClass('text-white');
        expect(cardValue('Memória do servidor')).toHaveClass('text-white');
        expect(cardValue('Congestionamento')).toHaveClass('text-white');
        expect(cardValue('Aproveitamento de cache')).toHaveClass('text-white');
        expect(screen.queryByText('normal')).not.toBeInTheDocument();
        expect(screen.getAllByText('—')).toHaveLength(5);
        expect(screen.getByText('A chamada de API que mais faz esperar')).toBeInTheDocument();
        expect(screen.getByText('Aguardando tráfego')).toBeInTheDocument();
        expect(screen.getByText('Aguardando consultas')).toBeInTheDocument();
        expect(screen.getByText('0 erro(s) em 0 requisições')).toBeInTheDocument();
        expect(screen.getByText('Sem leitura')).not.toHaveAttribute('title', expect.stringContaining('RSS'));
        expect(screen.getByText('De 512 MB disponíveis no plano')).toBeInTheDocument();
        expect(screen.getByText(/servidor ativo há —/)).toBeInTheDocument();
        expect(screen.getByText(/Tudo dentro do normal/)).toBeInTheDocument();
    });

    it('a chamada mais lenta é a de maior p95 entre as amostradas', async () => {
        await renderWith(snap({
            durations: {
                http: [metric('GET /rapida', 100), metric('GET /lenta', 0.5), metric('GET /sem', 9000, { sampled: 0 })],
            },
        }));
        expect(screen.getByText('100 ms')).toBeInTheDocument();
        expect(screen.getByText('GET /rapida')).toBeInTheDocument();
        expect(screen.getByText('Metade responde em 50 ms')).toBeInTheDocument();
    });
});

describe('formatos de rodapé', () => {
    it.each([
        [30, '1 min'], [600, '10 min'], [7200, '2h'], [200_000, '2 dias'],
    ])('uptime %s s vira %s', async (uptimeSeconds, texto) => {
        await renderWith(snap({ runtime: runtime({ uptimeSeconds }) }));
        expect(screen.getByText(`Amostragem 50% · servidor ativo há ${texto}`)).toBeInTheDocument();
    });
});

describe('tendência de memória', () => {
    it('janela sem direção: sem nota, balão diz que ainda acumula', async () => {
        await renderWith(snap({ runtime: runtime({ memoryTrend: trend({ direction: null }) }) }));
        expect(screen.queryByText(/^Memória (estável|em queda|subindo|estabilizada)/)).not.toBeInTheDocument();
        const detalhe = screen.getByText('Heap 100 de 120 MB · 170 MB fora do heap · Buffers 30 MB');
        expect(detalhe.getAttribute('title')).toBe([
            'Total do processo (RSS): 310 MB de 512 MB da instância',
            'Heap em uso: 100 MB',
            'Heap reservado pelo V8: 120 MB (teto de 300 MB)',
            'Buffers e nativo (external): 30 MB',
            'Fora do heap (RSS − heap reservado): 170 MB',
            'Janela medida: ainda acumulando amostras',
        ].join('\n'));
    });

    it('balão com janela medida e sem teto de heap nem offHeap', async () => {
        await renderWith(snap({
            runtime: runtime({
                limitsMb: undefined,
                memoryMb: { rss: 310, heapUsed: 100, heapTotal: 120, external: 30 },
                memoryTrend: trend(),
            }),
        }));
        const detalhe = screen.getByText('Heap 100 de 120 MB · Buffers 30 MB');
        expect(detalhe.getAttribute('title')).toBe([
            'Total do processo (RSS): 310 MB de 512 MB da instância',
            'Heap em uso: 100 MB',
            'Heap reservado pelo V8: 120 MB',
            'Buffers e nativo (external): 30 MB',
            'Janela medida: 288 amostras em 24.0h (mín. 300 / máx. 320 MB)',
        ].join('\n'));
        // Sem offHeap não há composição: a nota fica só com o título.
        const box = memoryNoteBox(/Memória estável há 24h/);
        expect(box.querySelectorAll('p')).toHaveLength(1);
    });

    it('estável: nota neutra com ícone de memória', async () => {
        await renderWith(snap({ runtime: runtime({ memoryTrend: trend() }) }));
        const titulo = screen.getByText('Memória estável há 24h — 310 MB agora, entre 300 e 320 MB na janela');
        expect(titulo).toHaveClass('text-slate-300');
        const box = memoryNoteBox(/Memória estável/);
        expect(box).toHaveClass('border-slate-800', 'bg-panel');
        expect(box.querySelector('svg')).toHaveClass('text-slate-500');
        expect(box.querySelector('svg')?.getAttribute('class')).toContain('memory-stick');
        expect(screen.getByText(
            'Fora do heap há 170 MB, 30 deles em Buffers vivos — dentro do que o binário, as bibliotecas e os downloads explicam.',
        )).toBeInTheDocument();
    });

    it('em queda: nota neutra que diz a queda', async () => {
        await renderWith(snap({ runtime: runtime({ memoryTrend: trend({ direction: 'FALLING', spanHours: 12.4 }) }) }));
        expect(screen.getByText('Memória em queda há 12h — 310 MB agora, entre 300 e 320 MB na janela')).toBeInTheDocument();
    });

    it('subindo sem horizonte: amarelo, fala da janela e do heap', async () => {
        await renderWith(snap({
            runtime: runtime({
                memoryTrend: trend({ direction: 'RISING', rssSlopeMbPerHour: 4, offHeapSlopeMbPerHour: 1, hoursToLimit: null }),
            }),
        }));
        const titulo = screen.getByText('Memória subindo 4.0 MB/h nas últimas 24h');
        expect(titulo).toHaveClass('text-yellow-400');
        const box = memoryNoteBox(/Memória subindo/);
        expect(box).toHaveClass('border-yellow-900/40', 'bg-yellow-900/10');
        expect(box.querySelector('svg')).toHaveClass('text-yellow-400');
        expect(box.querySelector('svg')?.getAttribute('class')).toContain('trending-up');
        expect(screen.getByText(/O crescimento está no heap \(3.0 MB\/h dos 4.0\): é objeto JavaScript retido/)).toBeInTheDocument();
        expect(cardValue('Memória do servidor')).toHaveClass('text-yellow-400');
    });

    it('subindo com horizonte longo: amarelo e projeção', async () => {
        await renderWith(snap({
            runtime: runtime({ memoryTrend: trend({ direction: 'RISING', rssSlopeMbPerHour: 2, hoursToLimit: 100.4 }) }),
        }));
        expect(screen.getByText('Memória subindo 2.0 MB/h — no mesmo ritmo, encosta nos 512 MB da instância em ~100h')).toHaveClass('text-yellow-400');
        expect(cardValue('Memória do servidor')).toHaveClass('text-yellow-400');
    });

    it('subindo com horizonte de até 24h: vermelho', async () => {
        await renderWith(snap({
            runtime: runtime({
                memoryTrend: trend({ direction: 'RISING', rssSlopeMbPerHour: 20, offHeapSlopeMbPerHour: 15, hoursToLimit: 24 }),
            }),
        }));
        const titulo = screen.getByText(/Memória subindo 20.0 MB\/h — no mesmo ritmo, encosta nos 512 MB da instância em ~24h/);
        expect(titulo).toHaveClass('text-red-400');
        const box = memoryNoteBox(/Memória subindo/);
        expect(box).toHaveClass('border-red-900/40', 'bg-red-900/10');
        expect(box.querySelector('svg')).toHaveClass('text-red-400');
        expect(screen.getByText(/O crescimento está FORA do heap \(15.0 MB\/h dos 20.0\)/)).toBeInTheDocument();
        expect(cardValue('Memória do servidor')).toHaveClass('text-red-400');
        expect(screen.getByText(/^1 medidor\(es\) fora do aceitável/)).toBeInTheDocument();
    });

    it('subindo sem inclinação fora do heap e sem inclinação total', async () => {
        await renderWith(snap({
            runtime: runtime({
                memoryTrend: trend({ direction: 'RISING', rssSlopeMbPerHour: null, offHeapSlopeMbPerHour: null, hoursToLimit: null }),
            }),
        }));
        expect(screen.getByText('Memória subindo 0.0 MB/h nas últimas 24h')).toBeInTheDocument();
        expect(screen.queryByText(/O crescimento está/)).not.toBeInTheDocument();
    });

    it('desacelerando: neutro, explica a janela e não piora o nível', async () => {
        await renderWith(snap({
            runtime: runtime({
                memoryTrend: trend({
                    direction: 'RISING', rssSlopeMbPerHour: 1.1, recentSlopeMbPerHour: null, decelerating: true, hoursToLimit: 5,
                }),
            }),
        }));
        expect(screen.getByText('Memória estabilizada — plana nas últimas 4h, em 310 MB')).toHaveClass('text-slate-300');
        expect(screen.getByText(/nas últimas 4h a inclinação é 0.0 MB\/h\./)).toBeInTheDocument();
        expect(screen.queryByText(/O crescimento está/)).not.toBeInTheDocument();
        expect(cardValue('Memória do servidor')).toHaveClass('text-emerald-400');
    });

    it('memória ausente com janela: sem nota', async () => {
        await renderWith(snap({ runtime: { ...runtime({ memoryTrend: trend() }), memoryMb: undefined as never } }));
        expect(screen.queryByText(/^Memória (estável|em queda|subindo|estabilizada)/)).not.toBeInTheDocument();
        expect(screen.getByText('Sem leitura')).toBeInTheDocument();
    });
});

describe('excedente fora do heap e conselho do allocator', () => {
    const muitoFora = (mallocArenaMax?: number | null) => snap({
        runtime: runtime({
            memoryMb: { rss: 310, heapUsed: 100, heapTotal: 120, external: 30, offHeap: 180 },
            memoryTrend: trend(),
            mallocArenaMax,
        }),
    });

    it.each([[undefined], [null]])('arena %s: sugere MALLOC_ARENA_MAX', async (arena) => {
        await renderWith(muitoFora(arena));
        expect(screen.getByText(/os outros 150 MB estão muito acima dos ~80 MB/)).toBeInTheDocument();
        expect(screen.getByText(/MALLOC_ARENA_MAX=2 no ambiente do processo/)).toBeInTheDocument();
    });

    it('arena definida: muda de assunto', async () => {
        await renderWith(muitoFora(4));
        expect(screen.getByText(/As arenas já estão limitadas a 4/)).toBeInTheDocument();
        expect(screen.queryByText(/MALLOC_ARENA_MAX=2/)).not.toBeInTheDocument();
    });

    it('excedente negativo é tratado como zero', async () => {
        await renderWith(snap({
            runtime: runtime({ memoryMb: { rss: 310, heapUsed: 100, heapTotal: 120, external: 60, offHeap: 40 }, memoryTrend: trend() }),
        }));
        expect(screen.getByText(/Fora do heap há 40 MB, 60 deles em Buffers vivos/)).toBeInTheDocument();
    });
});

describe('teto de heap × instância', () => {
    it('denuncia com os dois números quando o heap passa da instância', async () => {
        await renderWith(snap({ runtime: runtime({ limitsMb: { container: 256, heap: 300 } }) }));
        const titulo = screen.getByText('O limite de memória do Node não cabe na instância');
        expect(titulo).toHaveClass('text-yellow-400');
        expect(screen.getByText(/O processo pode crescer até 300 MB só de heap,\s+numa instância de 256 MB/)).toBeInTheDocument();
        expect(screen.getByText('De 256 MB disponíveis no plano')).toBeInTheDocument();
    });

    it('teto igual à instância não acusa', async () => {
        await renderWith(snap({ runtime: runtime({ limitsMb: { container: 300, heap: 300 } }) }));
        expect(screen.queryByText('O limite de memória do Node não cabe na instância')).not.toBeInTheDocument();
    });
});

describe('entrega de arquivos e detalhes técnicos', () => {
    it('sem arquivo amostrado, a linha de entrega some', async () => {
        await renderWith(snap({ durations: { http: [], web: [metric('GET /x.js', null, { sampled: 0 })] } }));
        expect(screen.queryByText(/Entrega de arquivos do site/)).not.toBeInTheDocument();
    });

    it('mostra o maior arquivo', async () => {
        await renderWith(snap({ durations: { http: [], web: [metric('GET /a.js', 100), metric('GET /b.js', 2500)] } }));
        expect(screen.getByText('GET /b.js')).toHaveClass('font-mono');
        expect(screen.getByText(/2.50 s no maior deles/)).toBeInTheDocument();
    });

    it('detalhes: vazio explica, cheio ordena por p95 e corta em 12', async () => {
        const { unmount } = await renderWith(snap());
        fireEvent.click(screen.getByText('Ver detalhes técnicos'));
        expect(screen.getByText('Ainda não há amostras suficientes.')).toBeInTheDocument();
        expect(screen.getByText('Ocultar detalhes técnicos')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Ocultar detalhes técnicos'));
        expect(screen.queryByText('Ainda não há amostras suficientes.')).not.toBeInTheDocument();
        unmount();

        const http = Array.from({ length: 10 }, (_, i) => metric(`GET /r${i}`, (i + 1) * 10));
        await renderWith(snap({
            durations: { http, mongo: [metric('find users', 5000), metric('find zero', 9000, { sampled: 0 })], misc: [metric('y', 1)] },
        }));
        fireEvent.click(screen.getByText('Ver detalhes técnicos'));
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows).toHaveLength(12);
        expect(rows[0]).toHaveTextContent('Banco');
        expect(rows[0]).toHaveTextContent('find users');
        expect(rows[0]).toHaveTextContent('5.00 s');
        expect(rows[0]).toHaveTextContent('5/10');
        expect(rows[1]).toHaveTextContent('GET /r9');
        expect(rows[11]).toHaveTextContent('misc');
        expect(screen.queryByText('find zero')).not.toBeInTheDocument();
    });

    it('não tem violação de acessibilidade com detalhes abertos', async () => {
        const { container } = await renderWith(snap({
            durations: { http: [metric('GET /a', 100)] },
            runtime: runtime({ memoryTrend: trend({ direction: 'RISING', hoursToLimit: 10 }), limitsMb: { container: 256, heap: 300 } }),
        }));
        fireEvent.click(screen.getByText('Ver detalhes técnicos'));
        expect(await axe(container)).toHaveNoViolations();
    });
});
