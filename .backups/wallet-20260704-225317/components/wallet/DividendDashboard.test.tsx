/**
 * Testes do DividendDashboard (aba Proventos).
 *
 * Cobre: modo demo (renderiza YoC/meta sem chamar API), graceful degradation
 * quando o backend ainda não envia yieldOnCost/goal, e interação básica com
 * o simulador de reinvestimento.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DividendDashboard } from './DividendDashboard';
import { walletService } from '../../services/wallet';
import { useDemo } from '../../contexts/DemoContext';
import { useWallet } from '../../contexts/WalletContext';

vi.mock('../../services/wallet', () => ({ walletService: { getDividends: vi.fn() } }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

// jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts.
(global as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const walletStub = { kpis: { totalEquity: 10000 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWallet).mockReturnValue(walletStub as any);
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: false } as any);
});

describe('modo demo', () => {
  it('renderiza dados de DEMO_DIVIDENDS (YoC incluído) sem chamar a API', async () => {
    vi.mocked(useDemo).mockReturnValue({ isDemoMode: true } as any);

    render(<DividendDashboard />);

    await waitFor(() => expect(screen.getByText('Yield on Cost')).toBeInTheDocument(), { timeout: 1000 });
    expect(walletService.getDividends).not.toHaveBeenCalled();
    expect(screen.getAllByText(/% a\.a\./).length).toBeGreaterThan(0);
  });
});

describe('graceful degradation', () => {
  it('resposta sem yieldOnCost/goal (backend antigo) não quebra e oculta a seção de YoC', async () => {
    vi.mocked(walletService.getDividends).mockResolvedValue({
      history: [],
      provisioned: [],
      totalAllTime: 0,
      projectedMonthly: 0,
      // yieldOnCost/goal ausentes de propósito
    } as any);

    render(<DividendDashboard />);

    await waitFor(() => expect(screen.getByText('Yield on Cost')).toBeInTheDocument());
    expect(screen.getByText('Ainda sem proventos recebidos nos últimos 12 meses.')).toBeInTheDocument();
  });
});

describe('simulador de reinvestimento', () => {
  it('alterar o período (10 → 20 anos) atualiza a projeção exibida', async () => {
    vi.mocked(walletService.getDividends).mockResolvedValue({
      history: [],
      provisioned: [],
      totalAllTime: 0,
      projectedMonthly: 100,
      yieldOnCost: [],
      goal: null,
    } as any);

    render(<DividendDashboard />);
    await waitFor(() => expect(screen.getByText('Simulador de Reinvestimento')).toBeInTheDocument());

    const textBefore = screen.getByText(/Reinvestindo, em 10 anos/).textContent;

    fireEvent.click(screen.getByText('20 anos'));

    await waitFor(() => {
      const textAfter = screen.getByText(/Reinvestindo, em 20 anos/).textContent;
      expect(textAfter).not.toBe(textBefore);
    });
  });
});
