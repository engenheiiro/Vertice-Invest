import React from 'react';
import * as Sentry from '@sentry/react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error Boundary global: impede que um erro de renderização derrube todo o app
 * (tela branca). Captura o erro, reporta ao Sentry e exibe um fallback amigável.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    } catch {
      // Sentry pode não estar inicializado — não deixar o reporte quebrar o fallback.
    }
    console.error('[ErrorBoundary] Erro de renderização capturado:', error, info);
  }

  private handleReload = () => window.location.reload();

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 bg-deep flex items-center justify-center p-6 z-[9999]">
        <div className="max-w-md w-full text-center bg-card border border-red-500/20 rounded-2xl p-8">
          <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center rounded-2xl bg-red-500/10">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-white mb-2">Algo deu errado</h1>
          <p className="text-sm text-slate-400 mb-6">
            Encontramos um erro inesperado e já registramos o ocorrido. Tente recarregar a página.
          </p>
          <button
            onClick={this.handleReload}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
