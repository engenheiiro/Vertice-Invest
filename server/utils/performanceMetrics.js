import { monitorEventLoopDelay, performance } from 'perf_hooks';

const parseBoolean = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
export const resolveMetricsEnabled = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  return parseBoolean(value);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return round(sorted[index]);
};

const newSeries = () => ({
  count: 0,
  sampled: 0,
  errors: 0,
  totalMs: 0,
  minMs: Number.POSITIVE_INFINITY,
  maxMs: 0,
  samples: [],
});

/**
 * Coletor bounded e sem dependência externa. Mantém somente as últimas N
 * durações de cada série e limita a quantidade de chaves, evitando que uma rota
 * dinâmica ou provedor inesperado transforme observabilidade em memory leak.
 */
export class PerformanceMetricsRegistry {
  constructor({
    enabled = false,
    sampleRate = 1,
    maxSeries = 200,
    maxSamples = 500,
    random = Math.random,
  } = {}) {
    this.enabled = enabled;
    this.sampleRate = clamp(Number(sampleRate) || 0, 0, 1);
    this.maxSeries = Math.max(10, Number(maxSeries) || 200);
    this.maxSamples = Math.max(10, Number(maxSamples) || 500);
    this.random = random;
    this.startedAt = new Date();
    this.series = new Map();
    this.counters = new Map();
  }

  _seriesFor(domain, key) {
    let domainSeries = this.series.get(domain);
    if (!domainSeries) {
      domainSeries = new Map();
      this.series.set(domain, domainSeries);
    }
    const safeKey = domainSeries.has(key) || domainSeries.size < this.maxSeries ? key : '__overflow__';
    if (!domainSeries.has(safeKey)) domainSeries.set(safeKey, newSeries());
    return domainSeries.get(safeKey);
  }

  observe(domain, key, durationMs, { error = false, count = 1 } = {}) {
    if (!this.enabled) return;
    const entry = this._seriesFor(String(domain), String(key));
    entry.count += Math.max(1, Number(count) || 1);
    if (error) entry.errors += Math.max(1, Number(count) || 1);

    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0 || this.random() > this.sampleRate) return;

    entry.sampled += 1;
    entry.totalMs += duration;
    entry.minMs = Math.min(entry.minMs, duration);
    entry.maxMs = Math.max(entry.maxMs, duration);
    entry.samples.push(duration);
    if (entry.samples.length > this.maxSamples) entry.samples.shift();
  }

  increment(domain, key, count = 1) {
    if (!this.enabled) return;
    const domainCounters = this.counters.get(domain) || new Map();
    const safeKey = domainCounters.has(key) || domainCounters.size < this.maxSeries ? key : '__overflow__';
    domainCounters.set(safeKey, (domainCounters.get(safeKey) || 0) + Math.max(0, Number(count) || 0));
    this.counters.set(domain, domainCounters);
  }

  snapshot(runtime = null) {
    const durations = {};
    for (const [domain, entries] of this.series) {
      durations[domain] = [...entries.entries()]
        .map(([key, entry]) => ({
          key,
          count: entry.count,
          sampled: entry.sampled,
          errors: entry.errors,
          errorRate: entry.count ? round(entry.errors / entry.count, 4) : 0,
          avgMs: entry.sampled ? round(entry.totalMs / entry.sampled) : null,
          minMs: entry.sampled ? round(entry.minMs) : null,
          p50Ms: percentile(entry.samples, 50),
          p95Ms: percentile(entry.samples, 95),
          p99Ms: percentile(entry.samples, 99),
          maxMs: entry.sampled ? round(entry.maxMs) : null,
          retainedSamples: entry.samples.length,
        }))
        .sort((a, b) => (b.p95Ms || 0) - (a.p95Ms || 0));
    }

    const counters = {};
    for (const [domain, entries] of this.counters) {
      counters[domain] = Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
    }

    return {
      enabled: this.enabled,
      startedAt: this.startedAt.toISOString(),
      generatedAt: new Date().toISOString(),
      sampleRate: this.sampleRate,
      limits: { maxSeries: this.maxSeries, maxSamplesPerSeries: this.maxSamples },
      runtime,
      durations,
      counters,
    };
  }
}

const enabled = resolveMetricsEnabled(process.env.PERF_METRICS_ENABLED);
const configuredSampleRate = Number(process.env.PERF_METRICS_SAMPLE_RATE);

export const performanceMetrics = new PerformanceMetricsRegistry({
  enabled,
  sampleRate: Number.isFinite(configuredSampleRate) ? configuredSampleRate : 0.25,
  maxSeries: Number(process.env.PERF_METRICS_MAX_SERIES) || 200,
  maxSamples: Number(process.env.PERF_METRICS_MAX_SAMPLES) || 500,
});

let eventLoopHistogram = null;

export const startRuntimeMetrics = () => {
  if (!performanceMetrics.enabled || eventLoopHistogram) return;
  eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopHistogram.enable();
};

const nsToMs = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? round(numeric / 1e6, 3) : null;
};

const runtimeSnapshot = () => {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: round(process.uptime(), 1),
    memoryMb: {
      rss: round(memory.rss / 1024 / 1024),
      heapUsed: round(memory.heapUsed / 1024 / 1024),
      heapTotal: round(memory.heapTotal / 1024 / 1024),
      external: round(memory.external / 1024 / 1024),
    },
    eventLoopDelayMs: eventLoopHistogram
      ? {
          mean: nsToMs(eventLoopHistogram.mean),
          p50: nsToMs(eventLoopHistogram.percentile(50)),
          p95: nsToMs(eventLoopHistogram.percentile(95)),
          p99: nsToMs(eventLoopHistogram.percentile(99)),
          max: nsToMs(eventLoopHistogram.max),
        }
      : null,
  };
};

export const getPerformanceSnapshot = () => performanceMetrics.snapshot(runtimeSnapshot());

const normalizeSegment = (segment) => {
  if (!segment) return segment;
  if (/^[0-9a-f]{24}$/i.test(segment)) return ':id';
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return ':uuid';
  if (/^\d+$/.test(segment)) return ':number';
  if (/^[A-Z]{4,6}\d{1,2}$/i.test(segment)) return ':ticker';
  if (segment.length >= 20 || segment.includes('@') || /%40/i.test(segment)) return ':value';
  return segment;
};

export const normalizeMetricPath = (rawPath) => {
  const pathOnly = String(rawPath || '/unknown').split('?')[0];
  return pathOnly.split('/').map(normalizeSegment).join('/') || '/';
};

export const routeMetricKey = (req) => {
  const routePath = typeof req?.route?.path === 'string' && req?.baseUrl
    ? `${req.baseUrl}${req.route.path}`
    : req?.originalUrl || req?.path;
  return `${String(req?.method || 'UNKNOWN').toUpperCase()} ${normalizeMetricPath(routePath)}`;
};

/**
 * Entrega de arquivo do build (bundle, CSS, imagem) e do shell da SPA vive num
 * domínio SEPARADO de `http`.
 *
 * A medição é `res.on('finish')` — tempo até o último byte sair. Para uma chamada
 * de API isso é latência nossa; para um arquivo de 400 KB é, em boa parte, a banda
 * de quem está baixando. Misturados na mesma série, o `index-*.js` sempre ganha o
 * p95 e o painel passa a apontar "a página mais lenta do sistema" para algo que
 * nenhum código nosso deixaria mais rápido — enquanto a rota de API realmente
 * lenta fica escondida atrás dele.
 *
 * A fronteira é `/api`: o que não é API é arquivo servido (inclusive o deep link
 * da SPA, que devolve o `index.html`).
 */
const isApiRequest = (req) => String(req?.path || req?.originalUrl || '').startsWith('/api');

export const recordHttpMetric = (req, statusCode, durationMs) => {
  const statusClass = `${Math.floor(Number(statusCode || 0) / 100)}xx`;
  const domain = isApiRequest(req) ? 'http' : 'web';
  performanceMetrics.observe(domain, `${routeMetricKey(req)} ${statusClass}`, durationMs, {
    error: Number(statusCode) >= 500,
  });
};

export const recordCacheAccess = (cacheName, outcome, count = 1) => {
  performanceMetrics.increment('cache', `${cacheName}.${outcome}`, count);
};

export const measurePerformance = async (domain, key, fn) => {
  if (!performanceMetrics.enabled) return fn();
  const startedAt = performance.now();
  try {
    const result = await fn();
    performanceMetrics.observe(domain, key, performance.now() - startedAt);
    return result;
  } catch (error) {
    performanceMetrics.observe(domain, key, performance.now() - startedAt, { error: true });
    throw error;
  }
};

const externalHost = (config = {}) => {
  try {
    return new URL(config.url || '', config.baseURL || undefined).host.toLowerCase() || 'unknown';
  } catch {
    return 'unknown';
  }
};

const AXIOS_ATTACHED = Symbol.for('vertice.performance.axios.attached');
const AXIOS_STARTED_AT = Symbol.for('vertice.performance.axios.startedAt');

export const attachAxiosMetrics = (axiosInstance) => {
  if (!performanceMetrics.enabled || !axiosInstance?.interceptors || axiosInstance[AXIOS_ATTACHED]) return;
  axiosInstance[AXIOS_ATTACHED] = true;

  axiosInstance.interceptors.request.use((config) => {
    config[AXIOS_STARTED_AT] = performance.now();
    return config;
  });

  axiosInstance.interceptors.response.use(
    (response) => {
      const config = response.config || {};
      const startedAt = config[AXIOS_STARTED_AT];
      if (Number.isFinite(startedAt)) {
        const method = String(config.method || 'GET').toUpperCase();
        const statusClass = `${Math.floor(Number(response.status || 0) / 100)}xx`;
        performanceMetrics.observe('external', `${method} ${externalHost(config)} ${statusClass}`, performance.now() - startedAt);
      }
      return response;
    },
    (error) => {
      const config = error?.config || {};
      const startedAt = config[AXIOS_STARTED_AT];
      if (Number.isFinite(startedAt)) {
        const method = String(config.method || 'GET').toUpperCase();
        const status = Number(error?.response?.status || 0);
        const outcome = status ? `${Math.floor(status / 100)}xx` : String(error?.code || 'NETWORK_ERROR').toUpperCase();
        performanceMetrics.observe('external', `${method} ${externalHost(config)} ${outcome}`, performance.now() - startedAt, { error: true });
      }
      return Promise.reject(error);
    },
  );
};

const MONGO_ATTACHED = Symbol.for('vertice.performance.mongo.attached');

export const attachMongoCommandMetrics = (client) => {
  if (!performanceMetrics.enabled || !client?.on || client[MONGO_ATTACHED]) return;
  client[MONGO_ATTACHED] = true;
  const pending = new Map();

  client.on('commandStarted', (event) => {
    const rawCollection = event?.command?.[event.commandName];
    const collection = typeof rawCollection === 'string'
      ? rawCollection.replace(/[^a-z0-9_-]/gi, '').slice(0, 80)
      : 'database';
    pending.set(event.requestId, {
      startedAt: performance.now(),
      key: `${event.commandName} ${collection}`,
    });
    if (pending.size > 10_000) pending.clear();
  });

  const finish = (event, error) => {
    const active = pending.get(event.requestId);
    if (!active) return;
    pending.delete(event.requestId);
    performanceMetrics.observe('mongo', active.key, performance.now() - active.startedAt, { error });
  };

  client.on('commandSucceeded', (event) => finish(event, false));
  client.on('commandFailed', (event) => finish(event, true));
};
