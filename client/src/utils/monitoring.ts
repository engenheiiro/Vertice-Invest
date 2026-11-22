/**
 * Porta de entrada do monitoramento de erros. Nada aqui importa o Sentry de
 * forma estática: o SDK chega por import dinâmico quando o navegador fica ocioso
 * após o boot (ou antes, se um erro precisar ser reportado).
 *
 * Ordem garantida: init e captura esperam a MESMA promessa (`ensureSentry`), que
 * só resolve depois do `Sentry.init` — um erro reportado enquanto o SDK ainda
 * baixa é enviado depois do init, não perdido.
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

let ready: Promise<typeof import('./sentryClient')> | null = null;

/**
 * Baixa o SDK e inicializa UMA vez; quem espera recebe o módulo já iniciado.
 * Por isso um erro reportado antes do init nunca chega a um Sentry "cru".
 */
const ensureSentry = () => (ready ??= import('./sentryClient').then((m) => {
  m.initSentry(dsn as string, tracesSampleRate);
  return m;
}));

/**
 * Agenda para quando o navegador estiver ocioso — o SDK (~75 KB gzip) não disputa
 * CPU nem rede com o primeiro paint. Sem `requestIdleCallback` (Safari), cai num
 * timeout curto. O teto de 4s garante o init mesmo numa aba que nunca fica ociosa.
 */
const whenIdle = (fn: () => void) => {
  const w = typeof window !== 'undefined' ? window : undefined;
  if (w && typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 2000);
};

export const startMonitoring = () => {
  if (!dsn) return;
  whenIdle(() => {
    ensureSentry().catch((e) => console.error('⚠️ Falha ao inicializar Sentry:', e));
  });
};

export const reportError = (error: unknown, extra?: Record<string, unknown>) => {
  if (!dsn) return;
  // Erro antes da ociosidade antecipa o init em vez de esperar por ela.
  ensureSentry()
    .then((m) => m.captureException(error, extra))
    .catch(() => { /* reporte nunca pode quebrar quem chamou */ });
};
