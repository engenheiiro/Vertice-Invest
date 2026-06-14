
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  const PII_FIELDS = ['email', 'password', 'cpf', 'token', 'accessToken', 'refreshToken'];

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.httpIntegration(),
    ],
    tracesSampleRate: 1.0,
    beforeSend(event) {
      const scrub = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        for (const key of Object.keys(obj)) {
          if (PII_FIELDS.some(f => key.toLowerCase().includes(f))) {
            obj[key] = '[Filtered]';
          } else if (typeof obj[key] === 'object') {
            scrub(obj[key]);
          }
        }
        return obj;
      };
      if (event.request) {
        scrub(event.request.data);
        scrub(event.request.headers);
        if (event.request.cookies) event.request.cookies = '[Filtered]';
      }
      return event;
    },
  });
  console.log("🛡️ [Observability] Sentry Instrumentado");
}
