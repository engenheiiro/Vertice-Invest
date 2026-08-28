/**
 * Testes da página Dashboard.
 *
 * Cobre o render básico, o estado de carregamento e a lógica de dividendos
 * exibidos. Componentes filhos pesados são substituídos por stubs vazios —
 * o foco é na lógica do componente pai.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import { useDashboardData } from '../hooks/useDashboardData';
import { useWallet } from '../contexts/WalletContext';
import { useDemo } from '../contexts/DemoContext';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../hooks/useDashboardData', () => ({ useDashboardData: vi.fn() }));
vi.mock('../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/dashboard/MarketStatusBar', () => ({ MarketStatusBar: () => null }));
vi.mock('../components/dashboard/EquitySummary', () => ({ EquitySummary: () => null }));
vi.mock('../components/dashboard/AssetTable', () => ({ AssetTable: () => null }));
vi.mock('../components/dashboard/AiRadar', () => ({ AiRadar: () => null }));

// ─── Stubs reutilizáveis ─────────────────────────────────────────────────────

const dashboardDataStub = {
  portfolio: [],
  signals: [],
  radarMeta: null,
  dividends: 0,
  dividendGoal: null,
  marketIndices: [],
  isLoading: false,
  isResearchLoading: false,
  systemHealth: null,
};

const walletStub = {
  isPrivacyMode: false,
  kpis: { projectedDividends: 0 },
};

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDashboardData).mockReturnValue(dashboardDataStub as any);
  vi.mocked(useWallet).mockReturnValue(walletStub as any);
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: false } as any);
});

const renderDashboard = () => render(<Dashboard />);

// ─── Render básico ────────────────────────────────────────────────────────────

describe('render básico', () => {
  it('renderiza sem erros no estado padrão', () => {
    expect(() => renderDashboard()).not.toThrow();
  });
});

// ─── Estado de carregamento ───────────────────────────────────────────────────

describe('estado de carregamento', () => {
  it('isLoading=true não causa crash na renderização', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      isLoading: true,
    } as any);
    expect(() => renderDashboard()).not.toThrow();
  });
});

// ─── Lógica de dividendos exibidos ───────────────────────────────────────────

describe('displayDividends', () => {
  it('quando dividends=0 e há projectedDividends, não exibe zero', () => {
    vi.mocked(useWallet).mockReturnValue({
      isPrivacyMode: false,
      kpis: { projectedDividends: 500 },
    } as any);
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividends: 0,
    } as any);

    renderDashboard();
    // O "Cofre de Dividendos" deve mostrar R$ 500,00 (projeção)
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('quando dividends > 0, prioriza dividendos reais', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividends: 1200,
    } as any);
    vi.mocked(useWallet).mockReturnValue({
      isPrivacyMode: false,
      kpis: { projectedDividends: 500 },
    } as any);

    renderDashboard();
    expect(screen.getByText(/1\.200/)).toBeInTheDocument();
  });

  it('modo privacidade mascara o valor de dividendos', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividends: 1200,
    } as any);
    vi.mocked(useWallet).mockReturnValue({
      isPrivacyMode: true,
      kpis: { projectedDividends: 0 },
    } as any);

    renderDashboard();
    expect(screen.getByText('••••••')).toBeInTheDocument();
  });
});

// ─── Cofre de Dividendos — meta ──────────────────────────────────────────────

describe('Cofre de Dividendos — meta', () => {
  it('sem meta definida (target=0) → exibe CTA "Definir meta", não a barra', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividendGoal: { target: 0, current: 0, progressPercent: null },
    } as any);

    renderDashboard();
    expect(screen.getByText(/Definir meta de renda passiva/i)).toBeInTheDocument();
  });

  it('meta definida (target=500, progressPercent=50) → exibe a barra com percentual', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividendGoal: { target: 500, current: 250, progressPercent: 50 },
    } as any);

    renderDashboard();
    expect(screen.queryByText(/Definir meta de renda passiva/i)).not.toBeInTheDocument();
    expect(screen.getByText(/50% de/)).toBeInTheDocument();
  });

  it('progressPercent excedendo 100 → largura da barra capada em 100%', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividendGoal: { target: 100, current: 300, progressPercent: 100 },
    } as any);

    const { container } = renderDashboard();
    const bar = container.querySelector('[style*="width"]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('dividendGoal null (loading/erro) não quebra a renderização', () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...dashboardDataStub,
      dividendGoal: null,
    } as any);

    expect(() => renderDashboard()).not.toThrow();
    expect(screen.getByText(/Definir meta de renda passiva/i)).toBeInTheDocument();
  });
});
