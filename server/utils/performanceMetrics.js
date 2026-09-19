import { monitorEventLoopDelay, performance } from 'perf_hooks';
import v8 from 'v8';

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

  // `unref`: o amostrador NUNCA é motivo para o processo continuar de pé. Um
  // timer de 5 min sem isto segura o event loop e transforma um encerramento
  // limpo em espera — medir memória não pode custar o desligamento do servidor.
  memorySamplerTimer = setInterval(() => sampleMemory(), MEMORY_TREND_INTERVAL_MS);
  memorySamplerTimer.unref?.();
};

/** Encerra a coleta contínua. Existe para os testes e para o shutdown limpo. */
export const stopRuntimeMetrics = () => {
  if (memorySamplerTimer) clearInterval(memorySamplerTimer);
  memorySamplerTimer = null;
  if (eventLoopHistogram) eventLoopHistogram.disable();
  eventLoopHistogram = null;
};

const nsToMs = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? round(numeric / 1e6, 3) : null;
};

/**
 * Teto de RAM da INSTÂNCIA, em MB.
 *
 * O painel precisa de um denominador: "407 MB" sozinho é folga num plano e
 * véspera de reinício em outro. Vem do ambiente porque quem sabe o tamanho da
 * instância é o deploy, não o código — e estava chutado em dois lugares livres
 * para divergirem entre si e do plano contratado: o `512` cravado no card e o
 * `--max-old-space-size` do `npm start`.
 */
const CONTAINER_MEMORY_MB = Number(process.env.MEMORY_LIMIT_MB) || 512;

/**
 * SÉRIE DE MEMÓRIA — a metade que faltava para responder "está subindo?".
 *
 * `process.memoryUsage()` era chamado num lugar só, sob demanda, e nada guardava
 * o resultado: o card exibia UMA amostra instantânea. Com ela, "396 MB de 512"
 * serve a dois diagnósticos opostos — regime de repouso de um processo que nunca
 * passa disso, ou vazamento a caminho do OOM — e é exatamente essa diferença que
 * decide se alguém precisa agir. Uptime não desempata: 24h de processo vivo é
 * compatível com os dois, e o painel tinha série temporal de latência mas não de
 * memória, justamente o medidor em que o AGORA não basta.
 *
 * Fechar o vão custa ~14 KB: 288 pontos de cinco números, um a cada 5 min,
 * cobrindo 24h. O teto é fixo pela mesma razão que as séries de duração são
 * bounded — observabilidade que cresce sozinha vira o vazamento que deveria
 * denunciar.
 *
 * Quem escreve na série é o amostrador, e só ele. Gravar também a cada
 * `getPerformanceSnapshot()` amarraria a densidade da série ao número de admins
 * com a aba aberta: a mesma inclinação sairia diferente conforme quem está
 * olhando.
 */
const MEMORY_TREND_INTERVAL_MS = 5 * 60 * 1000;
const MEMORY_TREND_MAX_POINTS = 288;

/**
 * Janela em que a amostra é descartada porque o processo ainda está esquentando.
 *
 * O RSS do primeiro minuto é o de um processo que não abriu pool do Mongo, não
 * compilou rota nenhuma e não encheu cache nenhum — um piso que ele nunca mais
 * revisita. Como a regressão pesa MAIS os extremos da janela, deixar esse ponto
 * entrar inventaria uma subida que é só o boot terminando.
 */
const MEMORY_TREND_WARMUP_SECONDS = 10 * 60;

/**
 * Janela recente, comparada com a janela inteira para separar RAMPA de VAZAMENTO.
 *
 * A quarentena acima protege contra o pico do primeiro minuto e não contra o que
 * veio depois: o processo leva horas enchendo cache, abrindo conexão e rodando
 * cada job pela primeira vez, e o allocator retém o que foi tocado. Essa subida
 * é côncava — rápida no começo, plana depois —, e mínimos quadrados só sabem
 * traçar reta. Medido em 19/09/2026: 26h de uptime, RSS caindo de 330 para 324
 * nas últimas 19h, e a regressão da janela inteira ainda lendo +1,1 MB/h porque
 * as primeiras horas continuavam dentro dela. O card acusava subida num processo
 * parado, e a projeção extrapolava uma reta de uma curva que já tinha achatado.
 *
 * A saída não é calar nem alargar a quarentena — é MEDIR se a inclinação está
 * caindo. A janela inteira segue decidindo a direção, porque é ela que enxerga
 * vazamento lento demais para aparecer em poucas horas; a janela recente diz se
 * aquela subida ainda está acontecendo AGORA. Vazamento real mantém as duas
 * iguais, e a comparação não o absolve.
 *
 * 4h porque precisa ser longa contra o ruído do GC (que se mede em minutos) e
 * curta o bastante para a comparação existir cedo: ela só vale quando a janela
 * inteira tem pelo menos o dobro disso, senão "recente" e "inteira" são a mesma
 * reta comparada consigo mesma.
 */
const MEMORY_TREND_RECENT_HOURS = 4;

/** Abaixo desta inclinação o que se mede é respiração do GC, não tendência. */
const MEMORY_TREND_NOISE_MB_PER_HOUR = 1;

/** Piso de evidência: sem esta janela não se afirma direção nenhuma. */
const MEMORY_TREND_MIN_POINTS = 6;
const MEMORY_TREND_MIN_SPAN_HOURS = 0.5;

const memoryTrendPoints = [];
let memorySamplerTimer = null;

const readMemorySample = () => {
  const memory = process.memoryUsage();
  const mb = (bytes) => round(bytes / 1024 / 1024);
  return {
    at: Date.now(),
    rss: mb(memory.rss),
    heapUsed: mb(memory.heapUsed),
    heapTotal: mb(memory.heapTotal),
    external: mb(memory.external),
    // Dos BYTES crus, como em `runtimeSnapshot`: refazer a conta a partir dos
    // valores já arredondados arredondaria duas vezes.
    offHeap: Math.max(0, mb(memory.rss - memory.heapTotal)),
  };
};

/**
 * Registra um ponto na série. `read` é injetável pelo mesmo motivo que `random`
 * é injetável no registry: sem isso não há como testar uma inclinação sem
 * esperar horas pelo processo real escalar.
 */
export const sampleMemory = ({ force = false, read = readMemorySample } = {}) => {
  if (!force && process.uptime() < MEMORY_TREND_WARMUP_SECONDS) return null;
  const point = read();
  memoryTrendPoints.push(point);
  if (memoryTrendPoints.length > MEMORY_TREND_MAX_POINTS) memoryTrendPoints.shift();
  return point;
};

export const resetMemoryTrend = () => { memoryTrendPoints.length = 0; };

/**
 * Inclinação em MB/h por mínimos quadrados sobre a janela inteira.
 *
 * Primeiro ponto contra último seria mais simples e responderia errado: duas
 * amostras pegas logo antes e logo depois de um GC diferem em dezenas de MB sem
 * que nada tenha mudado. A regressão usa os 288 pontos, então um GC no extremo
 * da janela não decide o veredito sozinho.
 */
const slopeMbPerHour = (points, field) => {
  const n = points.length;
  if (n < 2) return null;
  const baseAt = points[0].at;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0;
  for (const point of points) {
    const x = (point.at - baseAt) / 3600000;
    const y = Number(point[field]) || 0;
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const denominator = (n * sumXX) - (sumX * sumX);
  if (!denominator) return null;
  return round(((n * sumXY) - (sumX * sumY)) / denominator);
};

const memoryTrendSummary = () => {
  const points = memoryTrendPoints.length;
  const spanHours = points >= 2
    ? round((memoryTrendPoints[points - 1].at - memoryTrendPoints[0].at) / 3600000, 2)
    : 0;
  const base = {
    points,
    spanHours,
    sampleIntervalMinutes: MEMORY_TREND_INTERVAL_MS / 60000,
    retentionHours: round((MEMORY_TREND_MAX_POINTS * MEMORY_TREND_INTERVAL_MS) / 3600000, 1),
  };
  const vazio = {
    ...base,
    direction: null,
    rssSlopeMbPerHour: null,
    offHeapSlopeMbPerHour: null,
    recentSlopeMbPerHour: null,
    recentSpanHours: MEMORY_TREND_RECENT_HOURS,
    decelerating: false,
    rssMinMb: null,
    rssMaxMb: null,
    hoursToLimit: null,
  };

  // Fail-closed: janela curta não vira afirmação. Meia hora de amostra diz sobre
  // o dia do processo o mesmo que uma requisição diz sobre o p95 — nada.
  if (points < MEMORY_TREND_MIN_POINTS || spanHours < MEMORY_TREND_MIN_SPAN_HOURS) return vazio;

  const rssSlope = slopeMbPerHour(memoryTrendPoints, 'rss');
  if (rssSlope === null) return vazio;

  const rssValues = memoryTrendPoints.map((point) => point.rss);
  const current = memoryTrendPoints[points - 1].rss;
  const direction = rssSlope >= MEMORY_TREND_NOISE_MB_PER_HOUR
    ? 'RISING'
    : rssSlope <= -MEMORY_TREND_NOISE_MB_PER_HOUR ? 'FALLING' : 'STABLE';

  // A subida ainda está acontecendo, ou é o começo da janela que ainda pesa?
  // Só se pergunta isso quando a janela inteira tem pelo menos o DOBRO da
  // recente: abaixo disso, comparar é traçar a mesma reta duas vezes.
  const recentPoints = spanHours >= MEMORY_TREND_RECENT_HOURS * 2
    ? memoryTrendPoints.filter((point) => (
      point.at >= memoryTrendPoints[points - 1].at - (MEMORY_TREND_RECENT_HOURS * 3600000)
    ))
    : [];
  const recentSlope = recentPoints.length >= MEMORY_TREND_MIN_POINTS
    ? slopeMbPerHour(recentPoints, 'rss')
    : null;

  /**
   * Rampa que já achatou, não vazamento.
   *
   * O critério é o valor ABSOLUTO da inclinação recente, não a razão entre as
   * duas: "caiu pela metade" ainda pode ser 5 MB/h a caminho do teto. Só se
   * declara desaceleração quando o ritmo de AGORA é indistinguível de parado —
   * e uma subida que se mantém, ou acelera, deixa as duas retas parecidas e não
   * passa por aqui.
   */
  const decelerating = direction === 'RISING'
    && recentSlope !== null
    && Math.abs(recentSlope) < MEMORY_TREND_NOISE_MB_PER_HOUR;

  return {
    ...base,
    direction,
    rssSlopeMbPerHour: rssSlope,
    recentSlopeMbPerHour: recentSlope,
    recentSpanHours: MEMORY_TREND_RECENT_HOURS,
    decelerating,
    // Separa os dois vazamentos possíveis: objeto JavaScript vivo (heap, que o
    // teto do V8 ainda contém e o GC ainda pode atacar) e Buffer/nativo preso
    // (fora do heap, onde nem um nem outro alcançam).
    offHeapSlopeMbPerHour: slopeMbPerHour(memoryTrendPoints, 'offHeap'),
    rssMinMb: Math.min(...rssValues),
    rssMaxMb: Math.max(...rssValues),
    // Projeção linear até o teto da INSTÂNCIA, não do heap: quem mata o processo
    // é o container, e ele conta o RSS inteiro. Só existe quando há subida — em
    // regime estável a divisão devolveria um horizonte imenso ou negativo, que
    // na tela viraria uma promessa que a medição não sustenta.
    // ...e nem quando a subida já parou: extrapolar reta de uma curva que
    // achatou põe uma data na tela que a medição não sustenta. Em 19/09/2026 o
    // card anunciou "encosta nos 512 MB em ~184h" sobre um processo cujo RSS
    // vinha CAINDO havia 19 horas.
    hoursToLimit: direction === 'RISING' && !decelerating && CONTAINER_MEMORY_MB > current
      ? round((CONTAINER_MEMORY_MB - current) / rssSlope, 1)
      : null,
  };
};

/**
 * Quantas arenas de malloc o processo recebeu, se alguém limitou.
 *
 * Existe para a tela não dar conselho vencido. O card aponta retenção do
 * allocator quando sobra muito fora do heap sem Buffer vivo, e a resposta é
 * `MALLOC_ARENA_MAX` — mas repetir essa frase para quem já a aplicou é ruído que
 * nunca apaga, e ensina a ignorar o bloco inteiro.
 *
 * Ler `process.env` responde de verdade porque quem consome essa variável é o
 * glibc, no arranque, a partir do ambiente do processo: se ela está aqui, ela
 * valeu. Foi por isso, aliás, que pôr no `.env` não funcionava — o dotenv escreve
 * em `process.env` depois, quando o allocator já decidiu.
 */
const mallocArenaMax = () => {
  const raw = Number(process.env.MALLOC_ARENA_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
};

const runtimeSnapshot = () => {
  const memory = process.memoryUsage();
  // Teto REAL do heap do V8 — o que `--max-old-space-size` virou de fato, não o
  // que alguém acha que passou na linha de comando. É a metade da conta que
  // faltava para ler o RSS: heap de 117 MB sob um teto de 400 não é a mesma
  // coisa que 117 sob um teto de 160, e só com os dois dá para dizer se o vão
  // entre RSS e heap é página que o V8 comprometeu ou memória nativa presa.
  const heapLimitMb = round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
  return {
    uptimeSeconds: round(process.uptime(), 1),
    limitsMb: {
      container: CONTAINER_MEMORY_MB,
      heap: heapLimitMb,
    },
    memoryMb: {
      rss: round(memory.rss / 1024 / 1024),
      heapUsed: round(memory.heapUsed / 1024 / 1024),
      heapTotal: round(memory.heapTotal / 1024 / 1024),
      external: round(memory.external / 1024 / 1024),
      // Tudo que o processo ocupa FORA do heap comprometido: código, pilhas,
      // Buffer de download (o arquivo diário da B3 tem 8,5 MB) e o que o
      // allocator nativo reteve sem devolver ao SO. É DERIVADO, não medido — daí
      // o piso em zero: `heapTotal` conta página reservada que pode não estar
      // residente, e logo depois de um GC a subtração chega a virar negativa.
      offHeap: Math.max(0, round((memory.rss - memory.heapTotal) / 1024 / 1024)),
    },
    // A leitura de agora só vira diagnóstico ao lado da janela. Ver
    // `memoryTrendSummary`.
    memoryTrend: memoryTrendSummary(),
    mallocArenaMax: mallocArenaMax(),
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
 * Caminho COMPLETO da requisição — `/api/wallet/performance`, não `/performance`.
 *
 * `req.path` sozinho NÃO responde isso aqui, e o motivo é de TEMPO: quem chama
 * este módulo roda dentro do `res.on('finish')`, e a essa altura o Express já
 * aparou o prefixo do mount e não o restaurou. A restauração só acontece quando a
 * requisição SEGUE para fora do router, e a rota que respondeu não segue. Em
 * produção, então, `GET /api/wallet/performance` chega com `req.path` valendo
 * `/performance` e `req.baseUrl` valendo `/api/wallet` — e como `req.path` é
 * truthy, um `req.path || req.originalUrl` nunca alcança o segundo.
 *
 * Foi o defeito que esvaziou o medidor de API: TODA rota montada em sub-router
 * (ou seja, todas menos `/api/health`) caía no domínio de arquivo, e o card de
 * erro anunciava "0 erro em 0 requisições" com o site inteiro passando por ali.
 * Um teste que monta `req` à mão com o caminho já inteiro não alcança isso — só a
 * forma que o Express entrega alcança.
 *
 * Nunca `originalUrl` como fonte primária: ele carrega a query string crua, que é
 * entrada do cliente (ver `middleware/accessLog.js`). `baseUrl + path` devolve o
 * caminho inteiro sem ela; o fallback cobre o `req` que não tem nenhum dos dois.
 */
export const fullRequestPath = (req) => (
  `${req?.baseUrl || ''}${req?.path || ''}` || String(req?.originalUrl || '').split('?')[0]
);

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
const isApiRequest = (req) => fullRequestPath(req).startsWith('/api');

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
