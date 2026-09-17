
import * as Sentry from "@sentry/node";
import axios from 'axios';
import { attachAxiosMetrics, startRuntimeMetrics } from './utils/performanceMetrics.js';

startRuntimeMetrics();
attachAxiosMetrics(axios);

/**
 * Fração das requisições que vira TRAÇO (span) no Sentry.
 *
 * Estava em 1.0 — toda requisição. `integrations` na v8 SOMA às padrão em vez de
 * substituí-las, então junto vem a instrumentação OpenTelemetry de http, express,
 * mongo e mongoose: a 100%, cada requisição monta a árvore de spans inteira na
 * memória e a serializa antes de despachar. Num processo de 512 MB isso é custo em
 * RSS e em latência ao mesmo tempo, nas duas pontas do que o painel de Saúde mede
 * — e a própria Sentry desaconselha 1.0 em produção.
 *
 * 10% continua dando amostra de sobra para achar rota lenta (o painel de Saúde já
 * mede 100% das chamadas, de graça, em `utils/performanceMetrics.js`). Erro NÃO é
 * afetado: `captureException` não passa por aqui — isto governa só o traço de
 * desempenho. `SENTRY_TRACES_SAMPLE_RATE` sobe de volta sem deploy quando alguém
 * estiver caçando um caso específico.
 */
const parsedTracesRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
const tracesSampleRate = Number.isFinite(parsedTracesRate) && parsedTracesRate >= 0 && parsedTracesRate <= 1
  ? parsedTracesRate
  : 0.1;

if (process.env.SENTRY_DSN) {
  const PII_FIELDS = ['email', 'password', 'cpf', 'token', 'accessToken', 'refreshToken'];

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.httpIntegration(),
    ],
    tracesSampleRate,
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
