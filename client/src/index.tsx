
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Configuração do React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Evita refetch ao trocar de aba do navegador
      retry: 1, // Tenta apenas 1 vez em caso de erro
      staleTime: 1000 * 60 * 5, // 5 minutos de cache "quente"
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
