import { describe, expect, it } from 'vitest';
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
