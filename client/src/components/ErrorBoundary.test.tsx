import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { reportError } from '../utils/monitoring';

vi.mock('../utils/monitoring', () => ({ reportError: vi.fn() }));

const Boom: React.FC<{ fail: boolean }> = ({ fail }) => {
  if (fail) throw new Error('falha de render');
  return <p>conteúdo ok</p>;
};

// O React loga o erro capturado no console; silenciado para não poluir a saída.
let consoleSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleSpy.mockRestore());

describe('ErrorBoundary', () => {
  it('escopo app: fallback de tela cheia e reporte ao monitoramento', () => {
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>);
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
  });

  it('escopo page: fallback da página com atalho para o início', () => {
    render(<ErrorBoundary scope="page" homeHref="/wallet"><Boom fail /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Esta tela não carregou');
    expect(screen.getByText('Ir para o início').closest('a')).toHaveAttribute('href', '/wallet');
  });

  it('troca de resetKey (rota) descarta o erro e renderiza a nova tela', () => {
    const { rerender } = render(
      <ErrorBoundary scope="page" resetKey="/research"><Boom fail /></ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<ErrorBoundary scope="page" resetKey="/wallet"><Boom fail={false} /></ErrorBoundary>);
    expect(screen.getByText('conteúdo ok')).toBeInTheDocument();
  });

  it('mesma resetKey mantém o fallback (não entra em laço de re-render)', () => {
    const { rerender } = render(
      <ErrorBoundary scope="page" resetKey="/research"><Boom fail /></ErrorBoundary>
    );
    rerender(<ErrorBoundary scope="page" resetKey="/research"><Boom fail={false} /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
