import { describe, expect, it, vi } from 'vitest';
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
    // Derivado, com piso em zero: `heapTotal` conta página reservada que pode não
    // estar residente, e depois de um GC a subtração chega a virar negativa.
    expect(offHeap).toBe(Math.max(0, Number((rss - heapTotal).toFixed(2))));
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
