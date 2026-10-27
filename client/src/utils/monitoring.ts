/**
 * Porta de entrada do monitoramento de erros. Nada aqui importa o Sentry de
 * forma estática: o SDK chega por import dinâmico logo após o boot.
 *
 * Ordem garantida: `startMonitoring()` registra o `then` do init antes de
 * qualquer `reportError()`, e os dois esperam a MESMA promessa — então um erro
 * reportado enquanto o SDK ainda baixa é enviado depois do init, não perdido.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const dsn = env.VITE_SENTRY_DSN;

// 100% de traces em produção custa cota e CPU do visitante; 10% basta para
// latência por rota. Ajustável sem deploy de código via VITE_SENTRY_TRACES_SAMPLE_RATE.
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
const parsedRate = Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE);
const tracesSampleRate = Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1
  ? parsedRate
  : DEFAULT_TRACES_SAMPLE_RATE;

let sentryModule: Promise<typeof import('./sentryClient')> | null = null;
const loadSentry = () => (sentryModule ??= import('./sentryClient'));

export const startMonitoring = () => {
  if (!dsn) return;
  loadSentry()
    .then((m) => m.initSentry(dsn, tracesSampleRate))
    .catch((e) => console.error('⚠️ Falha ao inicializar Sentry:', e));
};

export const reportError = (error: unknown, extra?: Record<string, unknown>) => {
  if (!dsn) return;
  loadSentry()
    .then((m) => m.captureException(error, extra))
    .catch(() => { /* reporte nunca pode quebrar quem chamou */ });
};
