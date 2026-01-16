// instrument.js
// Este arquivo deve ser importado ANTES de qualquer outro módulo no server.js
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.httpIntegration(),
    ],
    tracesSampleRate: 1.0,
  });
  console.log("✅ Sentry Instrumentado (v8)");
}