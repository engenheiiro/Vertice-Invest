/**
 * Testes do TunablesCard (Admin → Parâmetros do Sistema).
 *
 * Cobre: carga dos parâmetros, erro de carga, botão Salvar só com alteração,
 * restaurar o padrão, gravação via PUT com o rascunho e o valor devolvido
 * pelo servidor, mensagem temporária de sucesso e erro de gravação.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TunablesCard } from './TunablesCard';
import { authService } from '../../services/auth';

vi.mock('../../services/auth', () => ({ authService: { api: vi.fn() } }));
const api = vi.mocked(authService.api);

const TUNABLES = [
  { key: 'SIGNAL_RSI', label: 'RSI de sobrevenda', value: 30, default: 25, min: 10, max: 40 },
  { key: 'MAX_SIGNALS', label: 'Máximo de sinais', value: 20, default: 20, min: 1, max: 50 },
];

const response = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as unknown as Response;

const inputs = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];
const saveBtn = () => screen.getByRole('button', { name: /Salvar alterações/ });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TunablesCard', () => {
  it('carrega os parâmetros com faixa e padrão; Salvar começa desabilitado', async () => {
    api.mockResolvedValue(response(true, { tunables: TUNABLES }));
    render(<TunablesCard />);
    expect(screen.getByText(/Carregando/)).toBeInTheDocument();
    expect(await screen.findByText('RSI de sobrevenda')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/research/config/tunables', { method: 'GET' });
    expect(inputs().map((i) => i.value)).toEqual(['30', '20']);
    expect(screen.getByText('Faixa 10–40 · padrão 25')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('erro na carga mostra a mensagem do servidor', async () => {
    api.mockResolvedValue(response(false, { message: 'Acesso negado' }));
    render(<TunablesCard />);
    expect(await screen.findByText('Acesso negado')).toBeInTheDocument();
  });

  it('restaurar padrão e editar habilitam Salvar; grava e mostra sucesso temporário', async () => {
    api.mockResolvedValueOnce(response(true, { tunables: TUNABLES }))
      .mockResolvedValueOnce(response(true, { tunables: { SIGNAL_RSI: 25, MAX_SIGNALS: 35 } }));
    render(<TunablesCard />);
    await screen.findByText('RSI de sobrevenda');

    fireEvent.click(screen.getAllByTitle('Restaurar padrão')[0]);
    expect(inputs()[0]).toHaveValue(25);
    fireEvent.change(inputs()[1], { target: { value: '35' } });
    expect(saveBtn()).toBeEnabled();

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(saveBtn());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('Salvo! Em vigor em até 1 min.')).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith('/api/research/config/tunables', {
      method: 'PUT', body: JSON.stringify({ SIGNAL_RSI: 25, MAX_SIGNALS: 35 }),
    });
    expect(saveBtn()).toBeDisabled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText('Salvo! Em vigor em até 1 min.')).not.toBeInTheDocument();
  });

  it('erro na gravação mantém o rascunho e mostra a mensagem', async () => {
    api.mockResolvedValueOnce(response(true, { tunables: TUNABLES }))
      .mockResolvedValueOnce(response(false, {}));
    render(<TunablesCard />);
    await screen.findByText('RSI de sobrevenda');
    fireEvent.change(inputs()[0], { target: { value: '12' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Falha ao salvar')).toBeInTheDocument();
    await waitFor(() => expect(saveBtn()).toBeEnabled());
    expect(inputs()[0]).toHaveValue(12);
  });
});
