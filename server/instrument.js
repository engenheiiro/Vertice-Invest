
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.httpIntegration(),
    ],
    tracesSampleRate: 1.0,
  });
  console.log("🛡️ [Observability] Sentry Instrumentado");
}
