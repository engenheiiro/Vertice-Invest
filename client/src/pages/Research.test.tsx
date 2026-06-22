/**
 * Testes da página Research.
 *
 * Cobre: controle de acesso por plano, bypass de admin, estado de carregamento,
 * seleção de aba de ativos e deep-link via location.state.
 *
 * Estratégia de mock:
 *  - researchService.getLatest é mockado para evitar chamadas de rede.
 *  - useAuth controla plano e role do usuário.
 *  - useLocation/useNavigate são mockados via react-router-dom.
 *  - Todos os componentes pesados (ResearchViewer, AssetDetailModal, etc.) são stubs.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Research } from './Research';
import { useAuth } from '../contexts/AuthContext';
import { researchService } from '../services/research';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/research', () => ({
  researchService: { getLatest: vi.fn(), getFixedIncomeData: vi.fn() },
}));

const mockNavigate = vi.fn();
let mockLocationState: any = null;
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState, pathname: '/research' }),
}));

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/research/ResearchViewer', () => ({
  ResearchViewer: () => <div data-testid="research-viewer" />,
}));
vi.mock('../components/research/AssetDetailModal', () => ({
  AssetDetailModal: ({ isOpen }: any) =>
    isOpen ? <div data-testid="asset-detail-modal" /> : null,
}));
vi.mock('../components/research/ExplainableAIRenderer', () => ({
  ExplainableAIRenderer: () => null,
}));
vi.mock('../components/research/ResearchAporteModal', () => ({
  ResearchAporteModal: () => null,
}));
vi.mock('../components/research/TreasuryPanel', () => ({
  TreasuryPanel: () => <div data-testid="treasury-panel" />,
}));
vi.mock('../components/ui', () => ({
  SkeletonCard: ({ className }: any) => <div data-testid="skeleton-card" className={className} />,
  SkeletonTableRows: () => <div data-testid="skeleton-rows" />,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeUser = (plan: string, role = 'USER') => ({ plan, role });

const makeReport = (ranking: any[] = []) => ({
  content: { ranking, analysis: {} },
  date: '2025-01-01T00:00:00.000Z',
});

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockLocationState = null;
  vi.mocked(researchService.getLatest).mockResolvedValue(makeReport() as any);
  vi.mocked(useAuth).mockReturnValue({ user: makeUser('PRO') } as any);
});

const renderResearch = () => render(<Research />);

// ─── Render e abas ────────────────────────────────────────────────────────────

describe('render básico', () => {
  it('exibe o título RESEARCH CENTER', async () => {
    renderResearch();
    expect(screen.getByText('RESEARCH CENTER')).toBeInTheDocument();
  });

  it('renderiza os 7 botões de ativo (inclui ETFs e Renda Fixa)', () => {
    renderResearch();
    expect(screen.getByText('Brasil 10 (Mix)')).toBeInTheDocument();
    expect(screen.getByText('Ações BR')).toBeInTheDocument();
    expect(screen.getByText('FIIs')).toBeInTheDocument();
    expect(screen.getByText('Cripto')).toBeInTheDocument();
    expect(screen.getByText('Exterior')).toBeInTheDocument();
    expect(screen.getByText('ETFs')).toBeInTheDocument();
    expect(screen.getByText('Renda Fixa')).toBeInTheDocument();
  });

  it('inicia com Brasil 10 selecionado (bg-emerald-600)', () => {
    renderResearch();
    expect(screen.getByText('Brasil 10 (Mix)').closest('button')).toHaveClass('bg-emerald-600');
  });
});

// ─── Controle de acesso ───────────────────────────────────────────────────────

describe('controle de acesso por plano', () => {
  it('plano GUEST não consegue acessar BRASIL_10 (ESSENTIAL required)', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('GUEST') } as any);
    renderResearch();
    // GUEST (0) < ESSENTIAL (1): após fetchReport, deve mostrar tela de bloqueio
    await waitFor(() =>
      expect(screen.getByText(/Conteúdo Exclusivo/i)).toBeInTheDocument()
    );
    expect(vi.mocked(researchService.getLatest)).not.toHaveBeenCalled();
  });

  it('plano ESSENTIAL acessa BRASIL_10 sem bloqueio', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ESSENTIAL') } as any);
    renderResearch();
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledWith('BRASIL_10', 'BUY_HOLD')
    );
    expect(screen.queryByText(/Conteúdo Exclusivo/i)).not.toBeInTheDocument();
  });

  it('plano PRO acessa Ações BR (minPlan: PRO)', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('PRO') } as any);
    renderResearch();
    fireEvent.click(screen.getByText('Ações BR'));
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledWith('STOCK', 'BUY_HOLD')
    );
  });

  it('plano ESSENTIAL não acessa Ações BR (PRO required) — exibe bloqueio', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ESSENTIAL') } as any);
    renderResearch();

    // Aguarda carregamento inicial (BRASIL_10)
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledTimes(1)
    );

    vi.mocked(researchService.getLatest).mockClear();
    fireEvent.click(screen.getByText('Ações BR'));

    await waitFor(() =>
      expect(screen.getByText(/Conteúdo Exclusivo/i)).toBeInTheDocument()
    );
    expect(vi.mocked(researchService.getLatest)).not.toHaveBeenCalled();
  });

  it('plano PRO acessa a aba ETFs (minPlan: PRO)', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('PRO') } as any);
    renderResearch();

    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledTimes(1)
    );

    vi.mocked(researchService.getLatest).mockClear();
    fireEvent.click(screen.getByText('ETFs'));

    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledWith('ETF', 'BUY_HOLD')
    );
  });

  it('plano ELITE não acessa Exterior (minPlan: ELITE)', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ELITE') } as any);
    renderResearch();

    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledTimes(1)
    );

    vi.mocked(researchService.getLatest).mockClear();
    fireEvent.click(screen.getByText('Exterior'));

    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledWith('STOCK_US', 'BUY_HOLD')
    );
  });
});

// ─── Aba Exterior ──────────────────────────────────────────────────────────────
// O sub-toggle Ações/REITs migrou para a barra "Perfil da Carteira" (TopPicksCard);
// o comportamento do toggle é coberto em TopPicksCard.test.tsx. Aqui basta garantir
// que a aba Exterior busca o ranking de Ações US.

describe('Exterior', () => {
  it('a aba Exterior busca o ranking STOCK_US', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ELITE') } as any);
    renderResearch();

    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(screen.getByText('Exterior'));
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledWith('STOCK_US', 'BUY_HOLD')
    );
  });
});

// ─── Aba Renda Fixa (Tesouro) ─────────────────────────────────────────────────

describe('aba Renda Fixa', () => {
  it('ESSENTIAL acessa Renda Fixa e renderiza o TreasuryPanel (sem buscar ranking)', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ESSENTIAL') } as any);
    renderResearch();

    // Carregamento inicial de BRASIL_10
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledTimes(1)
    );

    vi.mocked(researchService.getLatest).mockClear();
    fireEvent.click(screen.getByText('Renda Fixa'));

    // Painel informativo aparece e nenhum getLatest é disparado (não há ranking)
    await waitFor(() =>
      expect(screen.getByTestId('treasury-panel')).toBeInTheDocument()
    );
    expect(vi.mocked(researchService.getLatest)).not.toHaveBeenCalled();
  });

  it('GUEST não acessa Renda Fixa (ESSENTIAL required) — exibe bloqueio', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('GUEST') } as any);
    renderResearch();
    fireEvent.click(screen.getByText('Renda Fixa'));
    await waitFor(() =>
      expect(screen.getByText(/Conteúdo Exclusivo/i)).toBeInTheDocument()
    );
    expect(screen.queryByTestId('treasury-panel')).not.toBeInTheDocument();
  });
});

// ─── Bypass de admin ─────────────────────────────────────────────────────────

describe('bypass de ADMIN', () => {
  it('admin acessa qualquer ativo independente do plano GUEST', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('GUEST', 'ADMIN') } as any);
    renderResearch();
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalledWith('BRASIL_10', 'BUY_HOLD')
    );
    expect(screen.queryByText(/Conteúdo Exclusivo/i)).not.toBeInTheDocument();
  });

  it('admin exibe "ADMIN ACCESS" no subtítulo', () => {
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('GUEST', 'ADMIN') } as any);
    renderResearch();
    expect(screen.getByText(/ADMIN ACCESS/i)).toBeInTheDocument();
  });
});

// ─── Estado de carregamento ───────────────────────────────────────────────────

describe('estado de carregamento', () => {
  it('exibe skeleton enquanto isLoading=true (antes da resposta da API)', () => {
    // A API não resolve imediatamente → componente fica em isLoading=true
    vi.mocked(researchService.getLatest).mockReturnValue(new Promise(() => {}));
    renderResearch();
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-rows')).toBeInTheDocument();
  });
});

// ─── Deep link via location.state ────────────────────────────────────────────

describe('deep link openTicker', () => {
  it('abre AssetDetailModal quando location.state.openTicker bate com o ranking', async () => {
    mockLocationState = { openTicker: 'PETR4' };
    vi.mocked(researchService.getLatest).mockResolvedValue({
      content: {
        ranking: [
          { ticker: 'PETR4', name: 'Petrobras', score: 75, action: 'BUY' },
        ],
      },
      date: '2025-01-01T00:00:00.000Z',
    } as any);
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ESSENTIAL') } as any);

    renderResearch();
    await waitFor(() =>
      expect(screen.getByTestId('asset-detail-modal')).toBeInTheDocument()
    );
  });

  it('não abre AssetDetailModal quando openTicker não está no ranking', async () => {
    mockLocationState = { openTicker: 'XPTO3' };
    vi.mocked(researchService.getLatest).mockResolvedValue(makeReport() as any);
    vi.mocked(useAuth).mockReturnValue({ user: makeUser('ESSENTIAL') } as any);

    renderResearch();
    await waitFor(() =>
      expect(vi.mocked(researchService.getLatest)).toHaveBeenCalled()
    );
    expect(screen.queryByTestId('asset-detail-modal')).not.toBeInTheDocument();
  });
});
