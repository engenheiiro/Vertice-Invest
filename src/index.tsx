import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import * as Sentry from "@sentry/react";

const env = (import.meta as any).env;

if (env?.VITE_SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: env.VITE_SENTRY_DSN,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
      ],
      tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
      tracesSampleRate: 1.0, 
      replaysSessionSampleRate: 0.1, 
      replaysOnErrorSampleRate: 1.0, 
    });
    console.log("✅ Sentry Frontend Inicializado");
  } catch (e) {
    console.error("⚠️ Falha ao inicializar Sentry:", e);
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);