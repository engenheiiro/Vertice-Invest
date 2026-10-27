import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '../utils/monitoring';

interface Props {
  children: React.ReactNode;
  /**
   * 'app' (padrão): tela cheia por cima de tudo — último recurso do app inteiro.
   * 'page': ocupa só a área da página; navegação inferior e suporte seguem de pé.
   */
  scope?: 'app' | 'page';
  /** Quando muda (ex.: a rota), o erro é descartado e a página tenta de novo. */
  resetKey?: string;
  /** Destino do botão "Ir para o início" no escopo 'page'. */
  homeHref?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Error Boundary: impede que um erro de renderização derrube o app (tela branca).
 * Captura o erro, reporta ao Sentry e exibe um fallback amigável. Há um global
 * (scope 'app') e um por rota (scope 'page'), para que o erro de UMA tela não
 * leve as outras junto: ao trocar de rota, `resetKey` muda e a nova tela renderiza.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // reportError nunca lança: Sentry ausente ou ainda carregando não quebra o fallback.
    reportError(error, { componentStack: info.componentStack });
    console.error('[ErrorBoundary] Erro de renderização capturado:', error, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private handleReload = () => window.location.reload();

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.scope === 'page') {
      return (
        <div role="alert" className="min-h-[70vh] bg-deep flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center bg-card border border-red-500/20 rounded-2xl p-8">
            <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center rounded-2xl bg-red-500/10">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <h1 className="text-lg font-bold text-white mb-2">Esta tela não carregou</h1>
            <p className="text-sm text-slate-400 mb-6">
              Encontramos um erro inesperado e já registramos o ocorrido. O resto do app continua funcionando.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={this.handleReload}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
              >
                Recarregar
              </button>
              <a
                href={this.props.homeHref || '/'}
                className="flex-1 py-3 rounded-xl border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-sm font-semibold transition-colors"
              >
                Ir para o início
              </a>
            </div>
          </div>
        </div>
      );
    }

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
