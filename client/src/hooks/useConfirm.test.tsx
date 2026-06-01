import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './useConfirm';

// Consumidor de teste: dispara confirm() e guarda o resultado em estado (limpo
// pela cleanup do testing-library entre os testes).
function Probe() {
  const confirm = useConfirm();
  const [result, setResult] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          const ok = await confirm({ title: 'Remover?', message: 'Tem certeza?', isDestructive: true });
          setResult(ok ? 'CONFIRMED' : 'CANCELLED');
        }}
      >
        open
      </button>
      <span data-testid="result">{result}</span>
    </>
  );
}

const setup = () =>
  render(
    <ConfirmProvider>
      <Probe />
    </ConfirmProvider>,
  );

describe('useConfirm', () => {
  it('resolve true ao confirmar', async () => {
    setup();
    await act(async () => fireEvent.click(screen.getByText('open')));
    expect(screen.getByText('Remover?')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Confirmar')));
    expect(screen.getByTestId('result').textContent).toBe('CONFIRMED');
  });

  it('resolve false ao cancelar', async () => {
    setup();
    await act(async () => fireEvent.click(screen.getByText('open')));
    await act(async () => fireEvent.click(screen.getByText('Cancelar')));
    expect(screen.getByTestId('result').textContent).toBe('CANCELLED');
  });

  it('lança fora do provider', () => {
    // Renderizar o Probe sem o provider deve estourar o erro guard.
    expect(() => render(<Probe />)).toThrow(/ConfirmProvider/);
  });
});
