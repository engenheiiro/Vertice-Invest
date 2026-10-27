
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initAnalyticsConsent } from './utils/analyticsConsent';
import { startMonitoring } from './utils/monitoring';

// Antes de qualquer render: carrega o GA só se já houver "Aceitar" registrado.
initAnalyticsConsent();

// Sentry chega por import dinâmico (fora do pacote inicial); ver utils/monitoring.ts.
startMonitoring();

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
