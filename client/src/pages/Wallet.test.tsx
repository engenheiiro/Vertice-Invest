/**
 * Testes da página Wallet.
 *
 * Cobre: estado de carregamento, carteira vazia, navegação por abas,
 * controle de permissão (Aporte Inteligente e Rebalanceamento),
 * comportamento em modo demo e ação de reset da carteira.
 *
 * Estratégia de mock:
 *  - Todos os componentes filhos pesados são stubados com renderings mínimos.
 *  - Contextos (useAuth, useWallet, useToast, useDemo) são funções vi.fn().
 *  - useNavigate é interceptado para verificar redirecionamentos.
 */
import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Wallet } from './Wallet';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import { useDemo } from '../contexts/DemoContext';

// ─── Mocks de módulos ─────────────────────────────────────────────────────────

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: vi.fn() }));
vi.mock('../contexts/DemoContext', () => ({ useDemo: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

vi.mock('../services/auth', () => ({ authService: {} }));

// Componentes filhos — renderização mínima para não arrastar dependências
vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/wallet/WalletSummary', () => ({ WalletSummary: () => null }));
vi.mock('../components/wallet/AssetList', () => ({ AssetList: () => null }));
vi.mock('../components/wallet/EvolutionChart', () => ({ EvolutionChart: () => null }));
vi.mock('../components/wallet/AllocationChart', () => ({ AllocationChart: () => null }));
vi.mock('../components/wallet/PerformanceChart', () => ({ PerformanceChart: () => null }));
vi.mock('../components/wallet/MonthlyReturnsTable', () => ({ MonthlyReturnsTable: () => null }));
vi.mock('../components/wallet/DividendDashboard', () => ({ DividendDashboard: () => null }));
vi.mock('../components/wallet/CashFlowHistory', () => ({ CashFlowHistory: () => null }));

vi.mock('../components/wallet/AddAssetModal', () => ({
  AddAssetModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-modal" /> : null,
}));
vi.mock('../components/wallet/SmartContributionModal', () => ({
  SmartContributionModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="smart-modal" /> : null,
}));
vi.mock('../components/wallet/RebalanceModal', () => ({
  RebalanceModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="rebalance-modal" /> : null,
}));

vi.mock('../components/ui/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, title, message, onConfirm, onClose, confirmText }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText ?? 'Confirmar'}</button>
        <button onClick={onClose}>Fechar</button>
      </div>
    ) : null,
}));

vi.mock('../components/ui', () => ({
  SkeletonChart: ({ className }: any) => (
    <div data-testid="skeleton-chart" className={className} />
  ),
  SkeletonTableRows: () => <div data-testid="skeleton-rows" />,
  EmptyState: ({ title, action }: any) => (
    <div>
      <p>{title}</p>
      {action}
    </div>
  ),
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

// ─── Stubs reutilizáveis ─────────────────────────────────────────────────────

const mockAddToast = vi.fn();
const mockResetWallet = vi.fn();

const makeWalletStub = (overrides: Record<string, any> = {}) => ({
  assets: [],
  kpis: {},
  resetWallet: mockResetWallet,
  isLoading: false,
  isRefreshing: false,
  usdRate: 0,
  ...overrides,
});

const makeAuthStub = (plan = 'GUEST') => ({
  user: { plan },
});

const demoPauseStub = { isDemoMode: false, currentStep: 0 };

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(makeAuthStub() as any);
  vi.mocked(useWallet).mockReturnValue(makeWalletStub() as any);
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast } as any);
  vi.mocked(useDemo).mockReturnValue(demoPauseStub as any);
});

const renderWallet = () => render(<Wallet />);

// ─── Render básico ────────────────────────────────────────────────────────────

describe('render básico', () => {
  it('exibe o título "Minha Carteira"', () => {
    renderWallet();
    expect(screen.getByText('Minha Carteira')).toBeInTheDocument();
  });

  it('mostra esqueleto de carregamento quando isLoading=true', () => {
    vi.mocked(useWallet).mockReturnValue(makeWalletStub({ isLoading: true }) as any);
    renderWallet();
    expect(screen.getByTestId('skeleton-chart')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-rows')).toBeInTheDocument();
  });
});

// ─── Estado vazio ────────────────────────────────────────────────────────────

describe('carteira vazia', () => {
  it('exibe EmptyState quando não há ativos', () => {
    renderWallet();
    expect(screen.getByText('Sua carteira está vazia')).toBeInTheDocument();
  });

  it('botão "Resetar Carteira" fica desabilitado quando assets=[]', () => {
    renderWallet();
    const resetBtn = screen.getByTitle('Resetar Carteira');
    expect(resetBtn).toBeDisabled();
  });
});

// ─── Abas ────────────────────────────────────────────────────────────────────

describe('navegação por abas', () => {
  it('aba Visão Geral está ativa por padrão', () => {
    renderWallet();
    const overviewTab = screen.getByText('Visão Geral');
    expect(overviewTab.closest('button')).toHaveClass('bg-slate-800');
  });

  it('clicar em "Rentabilidade" torna a aba ativa', async () => {
    renderWallet();
    fireEvent.click(screen.getByText('Rentabilidade'));
    await waitFor(() =>
      expect(screen.getByText('Rentabilidade').closest('button')).toHaveClass('bg-slate-800')
    );
  });

  it('clicar em "Proventos" torna a aba ativa', () => {
    renderWallet();
    fireEvent.click(screen.getByText('Proventos'));
    expect(screen.getByText('Proventos').closest('button')).toHaveClass('bg-slate-800');
  });

  it('clicar em "Extrato" torna a aba ativa', () => {
    renderWallet();
    fireEvent.click(screen.getByText('Extrato'));
    expect(screen.getByText('Extrato').closest('button')).toHaveClass('bg-slate-800');
  });
});

// ─── Modal "Nova Transação" ───────────────────────────────────────────────────

describe('botão Nova Transação', () => {
  it('abre o AddAssetModal ao clicar', () => {
    renderWallet();
    fireEvent.click(screen.getByText('Nova Transação'));
    expect(screen.getByTestId('add-modal')).toBeInTheDocument();
  });
});

// ─── Permissão: Aporte Inteligente ───────────────────────────────────────────

describe('Aporte Inteligente — controle de acesso', () => {
  it('plano GUEST abre modal de limite (não o modal inteligente)', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('GUEST') as any);
    renderWallet();
    fireEvent.click(screen.getByText('Aporte Inteligente'));
    // Modal de limite deve aparecer (ConfirmModal com título "Acesso Restrito")
    expect(screen.getByRole('dialog', { name: 'Acesso Restrito' })).toBeInTheDocument();
    expect(screen.queryByTestId('smart-modal')).not.toBeInTheDocument();
  });

  it('plano ESSENTIAL abre modal de limite', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('ESSENTIAL') as any);
    renderWallet();
    fireEvent.click(screen.getByText('Aporte Inteligente'));
    expect(screen.getByRole('dialog', { name: 'Acesso Restrito' })).toBeInTheDocument();
  });

  it('plano PRO abre o SmartContributionModal', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('PRO') as any);
    renderWallet();
    fireEvent.click(screen.getByText('Aporte Inteligente'));
    expect(screen.getByTestId('smart-modal')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Acesso Restrito' })).not.toBeInTheDocument();
  });
});

// ─── Permissão: Rebalanceamento IA ───────────────────────────────────────────

describe('Rebalanceamento IA — controle de acesso', () => {
  it('plano GUEST abre modal de limite', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('GUEST') as any);
    renderWallet();
    fireEvent.click(screen.getByText('Rebalanceamento IA'));
    expect(screen.getByRole('dialog', { name: 'Acesso Restrito' })).toBeInTheDocument();
  });

  it('plano PRO abre modal de limite', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('PRO') as any);
    renderWallet();
    fireEvent.click(screen.getByText('Rebalanceamento IA'));
    expect(screen.getByRole('dialog', { name: 'Acesso Restrito' })).toBeInTheDocument();
  });

  it('plano BLACK em modo normal abre RebalanceModal', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('BLACK') as any);
    renderWallet();
    fireEvent.click(screen.getByText('Rebalanceamento IA'));
    expect(screen.getByTestId('rebalance-modal')).toBeInTheDocument();
  });

  it('plano BLACK em demo-mode exibe toast informativo (não abre rebalance)', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthStub('BLACK') as any);
    vi.mocked(useDemo).mockReturnValue({ isDemoMode: true, currentStep: 0 } as any);
    renderWallet();
    fireEvent.click(screen.getByText('Rebalanceamento IA'));
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining('dados reais'),
      'info'
    );
    expect(screen.queryByTestId('rebalance-modal')).not.toBeInTheDocument();
  });
});

// ─── Reset de carteira ────────────────────────────────────────────────────────

describe('reset de carteira', () => {
  it('botão Resetar fica habilitado quando há ativos', () => {
    vi.mocked(useWallet).mockReturnValue(
      makeWalletStub({ assets: [{ id: 'A', ticker: 'PETR4' }] }) as any
    );
    renderWallet();
    expect(screen.getByTitle('Resetar Carteira')).not.toBeDisabled();
  });

  it('clicar em Resetar abre o ConfirmModal de confirmação', () => {
    vi.mocked(useWallet).mockReturnValue(
      makeWalletStub({ assets: [{ id: 'A', ticker: 'PETR4' }] }) as any
    );
    renderWallet();
    fireEvent.click(screen.getByTitle('Resetar Carteira'));
    expect(
      screen.getByRole('dialog', { name: 'Excluir Carteira Permanentemente?' })
    ).toBeInTheDocument();
  });

  it('confirmar reset chama resetWallet()', () => {
    vi.mocked(useWallet).mockReturnValue(
      makeWalletStub({ assets: [{ id: 'A', ticker: 'PETR4' }] }) as any
    );
    renderWallet();
    fireEvent.click(screen.getByTitle('Resetar Carteira'));
    fireEvent.click(screen.getByText('Sim, Excluir Tudo'));
    expect(mockResetWallet).toHaveBeenCalledOnce();
  });
});
