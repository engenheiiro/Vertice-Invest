import * as Sentry from '@sentry/react';

/**
 * Único módulo que importa o SDK do Sentry. Ele só é carregado por import
 * dinâmico (ver `utils/monitoring.ts`), então o SDK — e principalmente o
 * Replay, que é a maior parte dele — fica fora do pacote inicial que todo
 * visitante da landing baixa.
 */
export const initSentry = (dsn: string, tracesSampleRate: number) => {
  Sentry.init({
    dsn,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // A API é servida na mesma origem (`API_URL` vazio), então o cabeçalho de
    // trace só precisa seguir para /api. O valor anterior era o placeholder da
    // documentação (`yourserver.io`) e nunca casava: o trace do front não se
    // ligava ao do backend.
    tracePropagationTargets: ['localhost', /^\/api\//],
    tracesSampleRate,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers?.['Authorization']) {
        event.request.headers['Authorization'] = '[Filtered]';
      }
      return event;
    },
  });
};

export const captureException = (error: unknown, extra?: Record<string, unknown>) => {
  Sentry.captureException(error, extra ? { extra } : undefined);
};
