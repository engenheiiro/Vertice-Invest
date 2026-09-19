import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { accessLog } from '../middleware/accessLog.js';
import logger from '../config/logger.js';
import {
  PerformanceMetricsRegistry,
  measurePerformance,
  normalizeMetricPath,
  resolveMetricsEnabled,
  routeMetricKey,
  recordHttpMetric,
  getPerformanceSnapshot,
  sampleMemory,
  resetMemoryTrend,
} from '../utils/performanceMetrics.js';
import { getPerformanceMetrics } from '../controllers/performanceController.js';
import adminRoutes from '../routes/adminRoutes.js';

describe('performanceMetrics', () => {
  it('mantém a coleta leve ativa por padrão e permite desligamento explícito', () => {
    expect(resolveMetricsEnabled(undefined)).toBe(true);
    expect(resolveMetricsEnabled('')).toBe(true);
    expect(resolveMetricsEnabled('true')).toBe(true);
    expect(resolveMetricsEnabled('false')).toBe(false);
  });

  it('calcula percentis e taxa de erro com memória limitada', () => {
    const registry = new PerformanceMetricsRegistry({ enabled: true, sampleRate: 1, maxSamples: 10, random: () => 0 });
    [10, 20, 30, 40, 100].forEach((ms, index) => registry.observe('http', 'GET /api/wallet 2xx', ms, { error: index === 4 }));
    const metric = registry.snapshot().durations.http[0];

    expect(metric).toMatchObject({ count: 5, sampled: 5, errors: 1, p50Ms: 30, p95Ms: 100, p99Ms: 100 });
    expect(metric.errorRate).toBe(0.2);
  });

  it('limita cardinalidade e agrega excesso em overflow', () => {
    const registry = new PerformanceMetricsRegistry({ enabled: true, sampleRate: 1, maxSeries: 10, random: () => 0 });
    for (let index = 0; index < 15; index += 1) registry.observe('mongo', `find collection-${index}`, index + 1);
    const metrics = registry.snapshot().durations.mongo;

    expect(metrics).toHaveLength(11);
    expect(metrics.some((metric) => metric.key === '__overflow__' && metric.count === 5)).toBe(true);
  });

  it('normaliza ids, tickers, números e valores longos sem reter query string', () => {
    expect(normalizeMetricPath('/api/wallet/507f1f77bcf86cd799439011?token=segredo')).toBe('/api/wallet/:id');
    expect(normalizeMetricPath('/api/wallet/transactions/PETR4')).toBe('/api/wallet/transactions/:ticker');
    expect(normalizeMetricPath('/api/academy/lessons/123')).toBe('/api/academy/lessons/:number');
    expect(normalizeMetricPath('/api/public/abcdefghijklmnopqrstuv')).toBe('/api/public/:value');
  });

  it('compõe a chave sem dados da query', () => {
    expect(routeMetricKey({ method: 'GET', originalUrl: '/api/wallet?walletId=segredo' })).toBe('GET /api/wallet');
  });

  it('não coleta nada quando desabilitado', () => {
    const registry = new PerformanceMetricsRegistry({ enabled: false });
    registry.observe('http', 'GET /', 10);
    registry.increment('cache', 'user.hit');
    expect(registry.snapshot().durations).toEqual({});
    expect(registry.snapshot().counters).toEqual({});
  });

  it('expõe o snapshot sem cache somente atrás do guard de admin', () => {
    const layer = adminRoutes.stack.find((item) => item.route?.path === '/performance-metrics');
    const middlewareNames = layer.route.stack.map((item) => item.name);
    expect(middlewareNames.indexOf('rateLimit')).toBeLessThan(middlewareNames.indexOf('requireAdmin'));
    expect(middlewareNames).toContain('requireAdmin');

    const res = {
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      json(body) { this.body = body; return this; },
    };
    getPerformanceMetrics({}, res);

    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toHaveProperty('enabled');
    expect(JSON.stringify(res.body)).not.toMatch(/password|authorization|cookie|query/i);
  });

  /**
   * "407 MB de 512, Heap 117 MB" deixava 290 MB sem dono na tela. O snapshot
   * media `heapTotal` e `external` e não os publicava de forma utilizável, e o
   * denominador (512) estava CRAVADO no card — livre para divergir do
   * `--max-old-space-size` do `npm start` e do plano realmente contratado.
   * Os dois tetos agora saem daqui: um do ambiente, o outro medido no V8.
   */
  it('publica os tetos de memória junto da leitura, para o número ter denominador', () => {
    const { runtime } = getPerformanceSnapshot();

    expect(runtime.limitsMb.container).toBeGreaterThan(0);
    // Teto real do heap, como o V8 o resolveu — não o que se supõe ter passado
    // na linha de comando.
    expect(runtime.limitsMb.heap).toBeGreaterThan(0);

    const { rss, heapUsed, heapTotal, external, offHeap } = runtime.memoryMb;
    for (const valor of [rss, heapUsed, heapTotal, external, offHeap]) {
      expect(Number.isFinite(valor)).toBe(true);
      expect(valor).toBeGreaterThanOrEqual(0);
    }
    expect(heapUsed).toBeLessThanOrEqual(heapTotal);

    // `offHeap` é derivado, com piso em zero: `heapTotal` conta página reservada
    // que pode não estar residente, e depois de um GC a subtração chega a virar
    // negativa.
    //
    // A tolerância NÃO é frouxidão — é a mesma lição do centavo da reserva: o
    // código subtrai os BYTES crus e arredonda UMA vez; refazer a conta a partir
    // de `rss` e `heapTotal`, que já vêm arredondados, arredonda DUAS e erra por
    // 0,01 conforme a hora do dia em que o teste roda. Reproduzir a aritmética
    // aqui só travaria a ordem dos arredondamentos; o contrato é o valor.
    expect(offHeap).toBeCloseTo(Math.max(0, rss - heapTotal), 1);
  });

  /**
   * "396 MB de 512" não diz se alguém precisa agir.
   *
   * O número instantâneo serve a dois diagnósticos opostos — regime de repouso de
   * um processo que nunca passa disso, ou vazamento a caminho do SIGKILL — e o
   * uptime não desempata: 24h de processo vivo é compatível com os dois. A janela
   * é a única coisa que separa um do outro.
   */
  describe('janela de memória — separa platô de vazamento', () => {
    const em = (hora, rss) => () => ({
      at: Date.parse('2026-09-18T00:00:00Z') + (hora * 3600000),
      rss,
      heapUsed: 114,
      heapTotal: 124,
      external: 28,
      offHeap: rss - 124,
    });

    const alimentar = (horas, rssPorHora) => {
      resetMemoryTrend();
      horas.forEach((hora) => sampleMemory({ force: true, read: em(hora, rssPorHora(hora)) }));
    };

    afterEach(() => resetMemoryTrend());

    it('não afirma direção com janela curta — ausência de dado não é "estável"', () => {
      alimentar([0, 0.1], () => 396);
      const { memoryTrend } = getPerformanceSnapshot().runtime;

      expect(memoryTrend.points).toBe(2);
      expect(memoryTrend.direction).toBeNull();
      expect(memoryTrend.rssSlopeMbPerHour).toBeNull();
      expect(memoryTrend.hoursToLimit).toBeNull();
    });

    // O caso do painel: 24h de processo em 396 MB. O nível é apertado, mas a
    // reta é plana — e é a reta que diz que não há para onde escalar.
    it('reconhece repouso alto como estável, mesmo com o nível apertado', () => {
      const horas = Array.from({ length: 24 }, (_, i) => i);
      // Respiração do GC: ±4 MB sem tendência nenhuma.
      alimentar(horas, (h) => 396 + ((h % 3) - 1) * 4);
      const { memoryTrend } = getPerformanceSnapshot().runtime;

      expect(memoryTrend.direction).toBe('STABLE');
      expect(Math.abs(memoryTrend.rssSlopeMbPerHour)).toBeLessThan(1);
      // Sem subida não há horizonte: projetar daqui seria inventar uma data.
      expect(memoryTrend.hoursToLimit).toBeNull();
      expect(memoryTrend.rssMinMb).toBe(392);
      expect(memoryTrend.rssMaxMb).toBe(400);
    });

    it('acha a subida e projeta quando o RSS encosta no teto da instância', () => {
      const horas = Array.from({ length: 12 }, (_, i) => i);
      alimentar(horas, (h) => 300 + (h * 8));
      const { memoryTrend, memoryMb } = getPerformanceSnapshot().runtime;

      expect(memoryTrend.direction).toBe('RISING');
      expect(memoryTrend.rssSlopeMbPerHour).toBeCloseTo(8, 1);
      // Último ponto é 388; faltam 124 MB para 512, a 8 MB/h.
      expect(memoryTrend.hoursToLimit).toBeCloseTo(15.5, 1);
      // A leitura de agora continua sendo a do processo real, não a da série
      // injetada: a janela acrescenta, não substitui.
      expect(memoryMb.rss).toBeGreaterThan(0);
    });

    // Vazamento no heap e vazamento fora dele pedem ações opostas: um o GC ainda
    // alcança e o teto do V8 ainda transforma em OOM diagnosticável; o outro
    // termina em SIGKILL mudo do container.
    it('diz ONDE a memória cresce, não só que cresce', () => {
      resetMemoryTrend();
      Array.from({ length: 12 }, (_, h) => h).forEach((h) => sampleMemory({
        force: true,
        read: () => ({
          at: Date.parse('2026-09-18T00:00:00Z') + (h * 3600000),
          rss: 300 + (h * 10),
          heapUsed: 114,
          heapTotal: 124,
          external: 28,
          offHeap: 176 + (h * 10), // a subida inteira está fora do heap
        }),
      }));
      const { memoryTrend } = getPerformanceSnapshot().runtime;

      expect(memoryTrend.rssSlopeMbPerHour).toBeCloseTo(10, 1);
      expect(memoryTrend.offHeapSlopeMbPerHour).toBeCloseTo(10, 1);
    });

    /**
     * 19/09/2026, 26h de uptime: RSS caindo de 330 para 324 nas últimas 19h, e o
     * card anunciando "subindo 1,1 MB/h, encosta nos 512 MB em ~184h".
     *
     * Não era erro de medição: a rampa de aquecimento é côncava — sobe rápido
     * enquanto o processo enche cache e abre conexão, achata depois — e mínimos
     * quadrados só sabem traçar reta. Com as primeiras horas ainda dentro da
     * janela, a reta sobe embora o processo esteja parado. Sem isto o card grita
     * depois de TODO deploy, e alarme que acende sempre se aprende a ignorar.
     */
    it('não confunde rampa de aquecimento que já achatou com vazamento', () => {
      resetMemoryTrend();
      // A curva medida: 6h de aquecimento (270 → 330) e 18h de platô cedendo de
      // volta para ~324. Devolve +1,3 MB/h na janela inteira e −0,3 nas últimas
      // 4h — os mesmos números que estavam na tela.
      Array.from({ length: 145 }, (_, i) => i * 0.166).forEach((hora) => sampleMemory({
        force: true,
        read: em(hora, hora < 6 ? 270 + (hora * 10) : 330 - ((hora - 6) * 0.3)),
      }));
      const { memoryTrend } = getPerformanceSnapshot().runtime;

      // A janela inteira continua subindo: é o começo dela que pesa.
      expect(memoryTrend.direction).toBe('RISING');
      expect(memoryTrend.rssSlopeMbPerHour).toBeGreaterThan(0);
      // Mas o ritmo de AGORA é indistinguível de parado.
      expect(Math.abs(memoryTrend.recentSlopeMbPerHour)).toBeLessThan(1);
      expect(memoryTrend.decelerating).toBe(true);
      // E por isso nenhuma data de morte é publicada: extrapolar reta de curva
      // achatada põe na tela um número que a medição não sustenta.
      expect(memoryTrend.hoursToLimit).toBeNull();
    });

    // O outro lado: a comparação não pode virar anistia. Subida que se mantém
    // deixa as duas retas iguais e continua acusada.
    it('vazamento constante não é absolvido pela comparação', () => {
      resetMemoryTrend();
      Array.from({ length: 145 }, (_, i) => i * 0.166)
        .forEach((hora) => sampleMemory({ force: true, read: em(hora, 200 + (hora * 8)) }));
      const { memoryTrend } = getPerformanceSnapshot().runtime;

      expect(memoryTrend.direction).toBe('RISING');
      expect(memoryTrend.recentSlopeMbPerHour).toBeCloseTo(8, 0);
      expect(memoryTrend.decelerating).toBe(false);
      expect(memoryTrend.hoursToLimit).not.toBeNull();
    });

    // Janela curta não sustenta a comparação: "recente" e "inteira" seriam a
    // mesma reta medida duas vezes, e uma subida real seria perdoada por isso.
    it('não compara antes de a janela ter o dobro da recente', () => {
      resetMemoryTrend();
      Array.from({ length: 36 }, (_, i) => i * 0.166)
        .forEach((hora) => sampleMemory({ force: true, read: em(hora, 300 + (hora * 6)) }));
      const { memoryTrend } = getPerformanceSnapshot().runtime;

      expect(memoryTrend.spanHours).toBeLessThan(8);
      expect(memoryTrend.recentSlopeMbPerHour).toBeNull();
      expect(memoryTrend.decelerating).toBe(false);
      expect(memoryTrend.hoursToLimit).not.toBeNull();
    });

    // Observabilidade que cresce sozinha vira o vazamento que deveria denunciar.
    it('a própria série é bounded', () => {
      resetMemoryTrend();
      for (let i = 0; i < 400; i += 1) sampleMemory({ force: true, read: em(i, 300) });
      expect(getPerformanceSnapshot().runtime.memoryTrend.points).toBe(288);
    });

    // O boot é um piso que o processo nunca mais revisita, e a regressão pesa
    // mais os extremos: sem a quarentena, o fim do boot vira "subida".
    it('descarta amostra enquanto o processo esquenta', () => {
      resetMemoryTrend();
      const uptime = vi.spyOn(process, 'uptime').mockReturnValue(60);
      expect(sampleMemory()).toBeNull();
      expect(getPerformanceSnapshot().runtime.memoryTrend.points).toBe(0);

      uptime.mockReturnValue(30 * 60);
      expect(sampleMemory()).not.toBeNull();
      uptime.mockRestore();
    });
  });

  it('measurePerformance preserva retorno e exceção do trabalho medido', async () => {
    await expect(measurePerformance('pipeline', 'ranking STOCK', async () => 42)).resolves.toBe(42);
    await expect(measurePerformance('pipeline', 'ranking STOCK', async () => { throw new Error('falha original'); }))
      .rejects.toThrow('falha original');
  });
});

/**
 * O bundle do site pesa ~400 KB e é entregue pela mesma cadeia do Express, então
 * ele cai no mesmo coletor das rotas de API. Medido `res.on('finish')`, o tempo
 * dele é em boa parte a banda de quem baixa — e, na mesma série, ele vence o p95
 * sempre. O painel passava a apontar "a página mais lenta do sistema" para algo
 * que nenhum código nosso acelera, escondendo a rota de API realmente lenta.
 */
describe('recordHttpMetric — API e entrega de arquivo em séries separadas', () => {
  const keys = (domain) => (getPerformanceSnapshot().durations[domain] || []).map((m) => m.key);

  it('rota de API fica em "http"', () => {
    recordHttpMetric({ method: 'GET', path: '/api/wallet/history' }, 200, 120);
    expect(keys('http')).toContain('GET /api/wallet/history 2xx');
    expect(keys('web')).not.toContain('GET /api/wallet/history 2xx');
  });

  it('arquivo do build vai para "web", fora do medidor de latência', () => {
    recordHttpMetric({ method: 'GET', path: '/assets/index-CFpXr4Go.js' }, 200, 1480);
    expect(keys('web')).toContain('GET /assets/index-CFpXr4Go.js 2xx');
    expect(keys('http')).not.toContain('GET /assets/index-CFpXr4Go.js 2xx');
  });

  // Deep link da SPA devolve o index.html: é entrega de arquivo, não chamada.
  it('deep link da SPA conta como arquivo, não como API', () => {
    recordHttpMetric({ method: 'GET', path: '/carteira' }, 200, 90);
    expect(keys('web')).toContain('GET /carteira 2xx');
  });
});

/**
 * A FORMA QUE SÓ O EXPRESS PRODUZ — e que os casos acima não alcançam.
 *
 * Ali o `req` é montado à mão, com o caminho inteiro em `req.path`. Nenhuma
 * requisição de produção chega assim: a medição roda no `res.on('finish')`, e a
 * essa altura o Express já aparou o prefixo do mount. `/api/wallet/performance`
 * chega como `req.path` `/performance` + `req.baseUrl` `/api/wallet`, e a
 * fronteira do `/api` lida de `req.path` dava FALSO para todas elas.
 *
 * O estrago não era cosmético: com toda rota montada caindo no domínio de arquivo,
 * o medidor de latência da API ficava em "aguardando tráfego" e o card de erro em
 * "0 erro em 0 requisições" — o painel não tinha como acender numa tempestade de
 * 500. Por isso este caso sobe um Express de verdade, com o middleware de verdade:
 * é a única forma que reproduz o corte do caminho.
 */
describe('recordHttpMetric — a rota montada, como o Express a entrega', () => {
  const chaves = (domain) => (getPerformanceSnapshot().durations[domain] || []).map((m) => m.key);

  /** Sobe um app com o router MONTADO (a forma de todas as rotas do produto). */
  const pedir = async (prefixo, rota, caminho) => {
    vi.spyOn(logger, 'http').mockImplementation(() => logger);
    const app = express();
    app.use(accessLog);
    const router = express.Router();
    router.get(rota, (_req, res) => res.json({ ok: true }));
    app.use(prefixo, router);

    const server = app.listen(0);
    await new Promise((pronto) => server.once('listening', pronto));
    try {
      await fetch(`http://127.0.0.1:${server.address().port}${caminho}`);
      // `finish` é emitido depois que o último byte sai; o corpo já lido garante
      // que o evento correu antes das asserções.
      await new Promise((pronto) => setTimeout(pronto, 50));
    } finally {
      server.close();
      vi.restoreAllMocks();
    }
  };

  it('rota de sub-router continua sendo API, com o prefixo do mount de volta', async () => {
    await pedir('/api/wallet', '/performance', '/api/wallet/performance');

    expect(chaves('http')).toContain('GET /api/wallet/performance 2xx');
    expect(chaves('web')).not.toContain('GET /api/wallet/performance 2xx');
  });

  it('arquivo servido pela raiz segue fora do medidor de API', async () => {
    await pedir('/', '/robots.txt', '/robots.txt');

    expect(chaves('web')).toContain('GET /robots.txt 2xx');
    expect(chaves('http')).not.toContain('GET /robots.txt 2xx');
  });
});

/**
 * Conselho já aplicado é ruído que nunca apaga.
 *
 * O card aponta retenção do allocator e manda ligar MALLOC_ARENA_MAX. Repetir
 * isso para quem já ligou ensina a ignorar o bloco inteiro — e quem sabe se a
 * variável valeu é o PROCESSO, porque é do ambiente dele que o glibc a lê. Foi
 * por isso que pôr no .env nunca funcionou: o dotenv escreve em process.env
 * depois, com o allocator já decidido.
 */
describe('teto de arenas do allocator', () => {
  const original = process.env.MALLOC_ARENA_MAX;
  afterEach(() => {
    if (original === undefined) delete process.env.MALLOC_ARENA_MAX;
    else process.env.MALLOC_ARENA_MAX = original;
  });

  it('publica o teto quando o ambiente o define', () => {
    process.env.MALLOC_ARENA_MAX = '2';
    expect(getPerformanceSnapshot().runtime.mallocArenaMax).toBe(2);
  });

  it('não inventa teto quando ninguém definiu, nem aceita lixo', () => {
    delete process.env.MALLOC_ARENA_MAX;
    expect(getPerformanceSnapshot().runtime.mallocArenaMax).toBeNull();

    process.env.MALLOC_ARENA_MAX = 'talvez';
    expect(getPerformanceSnapshot().runtime.mallocArenaMax).toBeNull();
  });
});
