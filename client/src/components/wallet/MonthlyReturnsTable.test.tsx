/**
 * Testes do MonthlyReturnsTable (Rentabilidade Mensal).
 *
 * A tabela encadeia a cota acumulada (TWRR) mês a mês: retorno do mês =
 * (1 + cota_mês) / (1 + cota_mês_anterior) − 1. Cobre o primeiro mês contra
 * zero, a virada de ano contra o fechamento de dezembro, mês sem ponto, YTD
 * e acumulado, privacidade, carregando, vazio e modo demo.
 *
 * Datas no meio do mês de propósito: o componente lê o mês do primeiro ponto
 * por `new Date(...)` no fuso local, e o dia 1 em UTC cai no mês anterior em
 * fuso negativo — fora do escopo deste teste.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { MonthlyReturnsTable } from './MonthlyReturnsTable';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));

const getPerformance = vi.fn();

const HISTORY = [
  { date: '2026-03-15T00:00:00Z', wallet: 10 },
  { date: '2025-11-15', wallet: 2 },
  { date: '2026-01-15', wallet: 4 },
  { date: '2025-12-15', wallet: 5 },
];

function setup({ privacy = false, demo = false, ready = true } = {}) {
  vi.mocked(useWallet).mockReturnValue({
    isPrivacyMode: privacy, activeWalletId: 'w1', isWalletScopeReady: ready, dataSource: { getPerformance },
  } as unknown as ReturnType<typeof useWallet>);
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: demo } as unknown as ReturnType<typeof useDemo>);
}

const renderTable = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MonthlyReturnsTable /></QueryClientProvider>);
};

const rowCells = (year: string) => {
  const header = within(screen.getByRole('table')).getByRole('rowheader', { name: year });
  return within(header.closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);
};

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe('MonthlyReturnsTable', () => {
  it('encadeia a cota mês a mês, com YTD e acumulado por ano', async () => {
    getPerformance.mockResolvedValue({ history: HISTORY });
    const { container } = renderTable();
    expect(await screen.findByText('Rentabilidade Mensal')).toBeInTheDocument();

    // Anos do mais recente para o mais antigo.
    const years = within(screen.getByRole('table')).getAllByRole('rowheader').map((h) => h.textContent);
    expect(years).toEqual(['2026', '2025']);

    // 2025: nov contra zero (+2%), dez = 1,05/1,02 − 1; YTD/acumulado = cota de dez.
    expect(rowCells('2025')).toEqual(['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '+2.00%', '+2.94%', '+5.00%', '+5.00%']);
    // 2026: jan contra o fechamento de dez (1,04/1,05 − 1); março sem fevereiro fica sem retorno.
    expect(rowCells('2026')).toEqual(['-0.95%', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '+4.76%', '+10.00%']);
    expect(within(screen.getByRole('table')).getByText('-0.95%')).toHaveClass('text-red-400');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('aceita a resposta como array puro', async () => {
    getPerformance.mockResolvedValue([{ date: '2026-05-15', wallet: 0 }]);
    renderTable();
    await screen.findByText('Rentabilidade Mensal');
    const cells = rowCells('2026');
    expect(cells[4]).toBe('0.00%');
    expect(within(screen.getByRole('table')).getAllByText('0.00%')[0]).toHaveClass('text-slate-400');
  });

  it('em privacidade mascara os percentuais', async () => {
    setup({ privacy: true });
    getPerformance.mockResolvedValue({ history: HISTORY });
    renderTable();
    await screen.findByText('Rentabilidade Mensal');
    expect(rowCells('2025')[10]).toBe('•••');
    expect(screen.queryByText('+2.00%')).not.toBeInTheDocument();
  });

  it('sem histórico não renderiza nada', async () => {
    getPerformance.mockResolvedValue({ history: [] });
    const { container } = renderTable();
    await vi.waitFor(() => expect(getPerformance).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector('.animate-spin')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('espera o escopo da carteira antes de buscar', () => {
    setup({ ready: false });
    renderTable();
    expect(getPerformance).not.toHaveBeenCalled();
  });

  it('modo demo usa a série de demonstração mesmo em privacidade', () => {
    setup({ demo: true, privacy: true });
    renderTable();
    expect(screen.getByText('Rentabilidade Mensal')).toBeInTheDocument();
    expect(getPerformance).not.toHaveBeenCalled();
    expect(screen.queryByText('•••')).not.toBeInTheDocument();
  });
});
