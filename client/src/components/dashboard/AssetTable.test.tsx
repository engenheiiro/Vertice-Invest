/**
 * Testes do AssetTable (Carteira Inteligente do Dashboard).
 *
 * Cobre: agrupamento por classe (ordem fixa, ETF nacional em Ações), recolher
 * grupo, esqueleto e vazio, preço unitário × RF sem PU, valor em US$ ao lado
 * do BRL, selo de score/recomendação, modo demo (ticker oculto) e o gating
 * dos botões Aporte Inteligente / Rebalanceamento IA por plano.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AssetTable } from './AssetTable';
import type { PortfolioItem } from '../../hooks/useDashboardData';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

const addToast = vi.fn();
const navigate = vi.fn();

vi.mock('../../hooks/useFeatureAccess', () => ({ useFeatureAccess: vi.fn() }));
vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));
vi.mock('../wallet/SmartContributionModal', () => ({
  SmartContributionModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>modal-aporte</div> : null),
}));
vi.mock('../wallet/RebalanceModal', () => ({
  RebalanceModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>modal-rebalance</div> : null),
}));

const PLAN_RANK: Record<string, number> = { GUEST: 0, ESSENTIAL: 1, PRO: 2, ELITE: 3, BLACK: 4 };

function setup({ plan = 'BLACK', demo = false, privacy = false } = {}) {
  vi.mocked(useFeatureAccess).mockReturnValue({
    hasPlan: (p: string) => PLAN_RANK[plan] >= PLAN_RANK[p],
    limitFor: () => (PLAN_RANK[plan] >= PLAN_RANK.PRO ? 10 : 0),
  } as unknown as ReturnType<typeof useFeatureAccess>);
  vi.mocked(useWallet).mockReturnValue({ isPrivacyMode: privacy } as unknown as ReturnType<typeof useWallet>);
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: demo } as unknown as ReturnType<typeof useDemo>);
}

const item = (over: Partial<PortfolioItem>): PortfolioItem => ({
  ticker: 'PETR4', name: 'Petrobras', shares: 100, avgPrice: 30, currentPrice: 36, type: 'STOCK',
  aiScore: 0, aiSentiment: 'NEUTRAL', ...over,
});

const ITEMS: PortfolioItem[] = [
  item({ ticker: 'HGLG11', name: 'CSHG Log', type: 'FII', avgPrice: 160, currentPrice: 150, shares: 10, aiScore: 72, aiSentiment: 'BULLISH' }),
  item({ ticker: 'PETR4', aiScore: 40, aiSentiment: 'BEARISH' }),
  item({ ticker: 'BOVA11', name: 'iShares Ibov', type: 'ETF', allocationClass: null, avgPrice: 100, currentPrice: 100, shares: 2 }),
  item({ ticker: 'AAPL', name: 'Apple', type: 'STOCK_US', avgPrice: 150, currentPrice: 200, shares: 2, totalValue: 2000, currency: 'USD' }),
  item({ ticker: 'TESOURO', name: 'Tesouro Selic', type: 'FIXED_INCOME', avgPrice: 1, currentPrice: 1, shares: 5000, totalValue: 5100, totalCost: 5000 }),
];

const desktop = () => screen.getByRole('table');

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe('tabela', () => {
  it('agrupa por classe na ordem fixa com contagem e valores', async () => {
    const { container } = render(<AssetTable items={ITEMS} />);
    const groups = within(desktop()).getAllByRole('button', { expanded: true }).map((b) => b.getAttribute('aria-label'));
    expect(groups).toEqual(['Ações Brasil: 2 Ativos', 'Fundos Imobiliários: 1 Ativo', 'Exterior: 1 Ativo', 'Renda Fixa: 1 Ativo']);

    const table = within(desktop());
    expect(table.getByText('+20.0%')).toHaveClass('text-emerald-500');
    expect(table.getByText('-6.3%')).toHaveClass('text-red-500');
    expect(table.getByText('VENDA')).toBeInTheDocument();
    expect(table.getByText('COMPRA')).toBeInTheDocument();
    expect(table.getByText('(US$ 400,00)')).toBeInTheDocument();
    expect(table.getByText('investido R$ 5.000,00')).toBeInTheDocument();
    expect(table.getByText('100 un')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('recolher um grupo esconde as linhas dele', () => {
    render(<AssetTable items={ITEMS} />);
    const table = within(desktop());
    fireEvent.click(table.getByRole('button', { name: 'Ações Brasil: 2 Ativos' }));
    expect(table.getByRole('button', { name: 'Ações Brasil: 2 Ativos' })).toHaveAttribute('aria-expanded', 'false');
    expect(table.queryByText('PETR4')).not.toBeInTheDocument();
    expect(table.getByText('HGLG11')).toBeInTheDocument();
  });

  it('carregando mostra esqueleto; vazio mostra aviso', () => {
    const { rerender } = render(<AssetTable items={[]} isLoading />);
    expect(screen.queryByText('Nenhum ativo na carteira.')).not.toBeInTheDocument();
    rerender(<AssetTable items={[]} />);
    expect(screen.getAllByText('Nenhum ativo na carteira.')).toHaveLength(2);
  });

  it('score zerado com research carregando mostra placeholder, sem research mostra --', () => {
    const { rerender } = render(<AssetTable items={[item({ ticker: 'VALE3' })]} isResearchLoading />);
    expect(within(desktop()).queryByText('--')).not.toBeInTheDocument();
    rerender(<AssetTable items={[item({ ticker: 'VALE3' })]} />);
    expect(within(desktop()).getAllByText('--')).toHaveLength(2);
  });

  it('em privacidade oculta o valor nativo em US$', () => {
    setup({ privacy: true });
    render(<AssetTable items={ITEMS} />);
    expect(screen.queryByText('(US$ 400,00)')).not.toBeInTheDocument();
  });

  it('modo demo oculta tickers', () => {
    setup({ demo: true });
    render(<AssetTable items={ITEMS} />);
    expect(screen.queryByText('PETR4')).not.toBeInTheDocument();
    expect(screen.getAllByText('••••').length).toBe(ITEMS.length);
  });
});

describe('ações por plano', () => {
  it('Black abre o Aporte Inteligente e o Rebalanceamento', () => {
    render(<AssetTable items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Aporte Inteligente/ }));
    expect(screen.getByText('modal-aporte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Rebalanceamento IA/ }));
    expect(screen.getByText('modal-rebalance')).toBeInTheDocument();
  });

  it('Rebalanceamento em modo demo avisa que precisa de dados reais', () => {
    setup({ demo: true });
    render(<AssetTable items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Rebalanceamento IA/ }));
    expect(addToast).toHaveBeenCalledWith('O Rebalanceamento IA usa os dados reais da sua carteira.', 'info');
    expect(screen.queryByText('modal-rebalance')).not.toBeInTheDocument();
  });

  it('Essential vê o aviso de acesso restrito e pode ir para os planos', () => {
    setup({ plan: 'ESSENTIAL' });
    render(<AssetTable items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Aporte Inteligente/ }));
    expect(screen.getByText('Acesso Restrito')).toBeInTheDocument();
    expect(screen.getByText(/O Aporte Inteligente é um recurso exclusivo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver Planos' }));
    expect(navigate).toHaveBeenCalledWith('/pricing');
  });

  it('Pro não tem Rebalanceamento IA', () => {
    setup({ plan: 'PRO' });
    render(<AssetTable items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Rebalanceamento IA/ }));
    expect(screen.getByText(/Rebalanceamento Automático com IA é um recurso exclusivo/)).toBeInTheDocument();
  });
});
