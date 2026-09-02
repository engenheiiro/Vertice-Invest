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
import { useDemo } from '../../contexts/DemoContext';
import { useWallet } from '../../contexts/WalletContext';

const { assetLogoSpy } = vi.hoisted(() => ({ assetLogoSpy: vi.fn(() => null) }));

vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: assetLogoSpy }));

// jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts.
(global as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// A aba busca pelo `dataSource` do contexto (walletService na área logada,
// rota pública no link compartilhado) — o teste injeta o dele.
const getDividends = vi.fn();
// `isWalletScopeReady` é o portão que segura a busca até a carteira ativa existir.
const walletStub = { assets: [], kpis: { totalEquity: 10000 }, isWalletScopeReady: true, dataSource: { getDividends } };

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
    expect(getDividends).not.toHaveBeenCalled();
    expect(screen.getAllByText(/% a\.a\./).length).toBeGreaterThan(0);
  });
});

describe('graceful degradation', () => {
  it('resposta sem yieldOnCost/goal (backend antigo) não quebra e oculta a seção de YoC', async () => {
    getDividends.mockResolvedValue({
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

describe('logos dos FIIs', () => {
  it('repassa tipo e segmento ao logo nas Provisões Futuras e no Yield on Cost', async () => {
    vi.mocked(useWallet).mockReturnValue({
      ...walletStub,
      assets: [{
        ticker: 'KNCR11', name: 'Kinea Rendimentos', type: 'FII', sector: 'Papel',
        currency: 'BRL', isReserve: false,
      }],
    } as any);
    getDividends.mockResolvedValue({
      history: [],
      provisioned: [{ ticker: 'KNCR11', date: '2026-09-15', amount: 12.50 }],
      yieldOnCost: [{ ticker: 'KNCR11', dividends12m: 150, totalCost: 3000, yocPercent: 5 }],
    });

    render(<DividendDashboard />);
    await waitFor(() => expect(screen.getAllByText('KNCR11')).toHaveLength(2));

    const provisionLogoProps = assetLogoSpy.mock.calls
      .map(([props]) => props)
      .find((props) => props.ticker === 'KNCR11' && props.size === 32);
    const yieldLogoProps = assetLogoSpy.mock.calls
      .map(([props]) => props)
      .find((props) => props.ticker === 'KNCR11' && props.size === 24);
    const expectedMetadata = {
      ticker: 'KNCR11',
      type: 'FII',
      currency: 'BRL',
      name: 'Kinea Rendimentos',
      sector: 'Papel',
      isReserve: false,
    };
    expect(provisionLogoProps).toMatchObject(expectedMetadata);
    expect(yieldLogoProps).toMatchObject(expectedMetadata);
  });
});

describe('simulador de reinvestimento', () => {
  it('alterar o período (10 → 20 anos) atualiza a projeção exibida', async () => {
    getDividends.mockResolvedValue({
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
