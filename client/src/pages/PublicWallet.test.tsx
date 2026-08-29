/**
 * Testes da carteira PÚBLICA (/p/:token).
 *
 * O ponto do link compartilhado é renderizar a MESMA página Carteira em modo
 * leitura — então aqui a WalletView e seus componentes rodam de verdade (só os
 * gráficos são stubados, por ruído de canvas no jsdom). O que se trava:
 *   - a página é a Carteira: KPIs, abas e lista de ativos;
 *   - nada que escreve aparece (transação, aporte, rebalanceamento, reset, IR);
 *   - com valores ocultos, nenhum R$ é exibido — só percentuais.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicWallet } from './PublicWallet';
import { publicWalletService } from '../services/publicWallet';

vi.mock('../services/publicWallet', () => {
  const publicWalletService = {
    getWallet: vi.fn(),
    getHistory: vi.fn(),
    getPerformance: vi.fn(),
    getDividends: vi.fn(),
    getCashFlow: vi.fn(),
  };
  return {
    publicWalletService,
    // Mesma chave do módulo real, apontando para o serviço mockado — é o que
    // faz página e provider compartilharem uma única "requisição".
    publicWalletQueryOptions: (token: string) => ({
      queryKey: ['publicWallet', token],
      queryFn: () => publicWalletService.getWallet(token),
      retry: false,
    }),
  };
});

// Visitante anônimo: o contexto de auth existe, sem usuário.
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../contexts/DemoContext', () => ({
  useDemo: () => ({ isDemoMode: false, currentStep: 0 }),
  DemoProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useConfirm', () => ({ useConfirm: () => vi.fn() }));

// Gráficos: fora do escopo deste teste (recharts precisa de layout real).
vi.mock('../components/wallet/EvolutionChart', () => ({ EvolutionChart: () => <div data-testid="evolution" /> }));
vi.mock('../components/wallet/AllocationChart', () => ({ AllocationChart: () => <div data-testid="allocation" /> }));

const walletPayload = (showValues: boolean) => ({
  wallet: { name: 'Carteira Principal', ownerFirstName: 'Matheus' },
  showValues,
  // Com valores ocultos o servidor manda tudo normalizado (patrimônio = 100).
  assets: [
    {
      id: '1', ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', sector: 'Petróleo',
      quantity: showValues ? 1000 : 0, averagePrice: showValues ? 30 : 0, currentPrice: showValues ? 37.5 : 0,
      currency: 'BRL', totalValue: showValues ? 150000 : 60, totalCost: showValues ? 120000 : 48,
      profit: showValues ? 30000 : 12, profitPercent: 25, dayChangePct: 1.2,
      dividendsReceived: showValues ? 8000 : 3.2,
    },
    {
      id: '2', ticker: 'MXRF11', name: 'Maxi Renda', type: 'FII', sector: 'Papel',
      quantity: showValues ? 10000 : 0, averagePrice: showValues ? 10 : 0, currentPrice: showValues ? 10 : 0,
      currency: 'BRL', totalValue: showValues ? 100000 : 40, totalCost: showValues ? 100000 : 40,
      profit: 0, profitPercent: 0, dayChangePct: 0,
      dividendsReceived: showValues ? 4000 : 1.6,
    },
  ],
  kpis: {
    totalEquity: showValues ? 250000 : 100, totalInvested: showValues ? 220000 : 88,
    totalResult: showValues ? 30000 : 12, totalResultPercent: 13.64,
    dayVariation: showValues ? 900 : 0.36, dayVariationPercent: 0.36,
    totalDividends: showValues ? 12000 : 4.8, projectedDividends: showValues ? 1000 : 0.4,
    weightedRentability: 11.2, dataQuality: 'AUDITED', sharpeRatio: null, beta: 0.85,
  },
  meta: { usdRate: 5.4, lastUpdate: new Date().toISOString() },
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/p/tok-publico-123456789012']}>
        <Routes>
          <Route path="/p/:token" element={<PublicWallet />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(publicWalletService.getHistory).mockResolvedValue([]);
});

describe('link público', () => {
  it('renderiza a própria página Carteira, sem nenhuma ação de escrita', async () => {
    vi.mocked(publicWalletService.getWallet).mockResolvedValue(walletPayload(true) as any);

    renderPage();

    await screen.findByText('Carteira Principal');
    // A Carteira de verdade: KPIs, abas e lista de ativos.
    await screen.findByText('Patrimônio Líquido');
    ['Visão Geral', 'Rentabilidade', 'Proventos', 'Extrato'].forEach((tab) =>
      expect(screen.getAllByText(tab).length).toBeGreaterThan(0));
    expect(screen.getAllByText('PETR4').length).toBeGreaterThan(0);

    // Nada que escreve — nem a aba de IR, que é declaração fiscal do dono.
    expect(screen.queryByLabelText('Nova Transação')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Aporte Inteligente')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rebalanceamento IA')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Resetar Carteira')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Renomear carteira')).not.toBeInTheDocument();
    expect(screen.queryByText('Imposto de Renda')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Remover PETR4/)).not.toBeInTheDocument();

    expect(screen.getByText(/Somente leitura/i)).toBeInTheDocument();
    expect(screen.getByText(/Carteira compartilhada por Matheus/)).toBeInTheDocument();
  });

  it('com valores em R$ liberados, exibe os números do dono', async () => {
    vi.mocked(publicWalletService.getWallet).mockResolvedValue(walletPayload(true) as any);

    renderPage();

    await screen.findByText('Valor Aplicado');
    // Valor Aplicado é estático (o Patrimônio Líquido anima via useCountUp).
    expect(screen.getAllByText(/R\$\s?220\.000,00/).length).toBeGreaterThan(0);
  });

  it('com valores ocultos, mascara todo R$ e mantém os percentuais', async () => {
    vi.mocked(publicWalletService.getWallet).mockResolvedValue(walletPayload(false) as any);

    const { container } = renderPage();

    await waitFor(() => expect(screen.getByText('Carteira Principal')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText('••••••').length).toBeGreaterThan(0));

    // Nenhum valor monetário renderizado — nem o normalizado (R$ 100,00). O que
    // sobra com "R$" é rótulo de coluna e o badge de câmbio USD/BRL.
    expect(container.textContent).not.toMatch(/R\$\s?[\d.]+,\d{2}/);
    // Percentuais continuam reais: é o que a página tem a dizer nesse modo.
    expect(screen.getAllByText(/25[.,]00%/).length).toBeGreaterThan(0);
    // O botão de revelar some: não há número real para revelar.
    expect(screen.queryByLabelText(/privacidade/i)).not.toBeInTheDocument();
  });

  it('token inválido cai na tela de carteira não encontrada', async () => {
    vi.mocked(publicWalletService.getWallet).mockRejectedValue(new Error('NOT_FOUND'));

    renderPage();

    await waitFor(() => expect(screen.getByText('Carteira não encontrada')).toBeInTheDocument());
  });
});
