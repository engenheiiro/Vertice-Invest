import * as Sentry from '@sentry/react';

/**
 * Núcleo do SDK do Sentry. Só é carregado por import dinâmico (ver
 * `utils/monitoring.ts`), então fica fora do pacote inicial que todo visitante
 * da landing baixa. O Replay mora em `sentryReplay.ts`, num chunk à parte.
 */
export const initSentry = (dsn: string, tracesSampleRate: number) => {
  Sentry.init({
    dsn,
    integrations: [
      Sentry.browserTracingIntegration(),
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

  // Replay é a maior parte do SDK e só serve a 10% das sessões (e às com erro):
  // vem num chunk próprio, adicionado depois do init. A CSP não libera a CDN do
  // Sentry, por isso não `lazyLoadIntegration` — o chunk sai da nossa origem.
  import('./sentryReplay')
    .then((m) => Sentry.addIntegration(m.createReplayIntegration()))
    .catch(() => { /* sem replay, a captura de erros segue funcionando */ });
};

export const captureException = (error: unknown, extra?: Record<string, unknown>) => {
  Sentry.captureException(error, extra ? { extra } : undefined);
};
