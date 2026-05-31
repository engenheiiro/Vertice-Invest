import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './Alert';

describe('Alert (UI base — M11)', () => {
  it('renderiza o conteúdo (children)', () => {
    render(<Alert variant="error">Falha ao salvar</Alert>);
    expect(screen.getByText('Falha ao salvar')).toBeInTheDocument();
  });

  it('erro e aviso usam role="alert" (lido com prioridade por leitores de tela)', () => {
    const { unmount } = render(<Alert variant="error">erro</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('erro');
    unmount();
    render(<Alert variant="warning">aviso</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('aviso');
  });

  it('sucesso e info usam role="status" (não interrompe)', () => {
    const { unmount } = render(<Alert variant="success">ok</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('ok');
    unmount();
    render(<Alert variant="info">informe</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('informe');
  });

  it('renderiza o título quando fornecido', () => {
    render(
      <Alert variant="warning" title="Atenção">
        Preço difere da referência
      </Alert>
    );
    expect(screen.getByText('Atenção')).toBeInTheDocument();
    expect(screen.getByText('Preço difere da referência')).toBeInTheDocument();
  });
});
