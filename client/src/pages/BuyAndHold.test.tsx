/**
 * Página da lista âncora — o que estes testes protegem é a LEITURA da apuração.
 *
 * O ranking chega do servidor com um `action` binário (BUY/WAIT) e um punhado de
 * bloqueadores no payload âncora. A tela agrupa isso em seções nomeadas, e o
 * risco é justamente esse agrupamento silenciar: um fundo barrado pelo teto de
 * composição da carteira caindo no mesmo balde de um ativo sem convicção é a
 * confusão que a página existe para desfazer.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { BuyAndHold } from './BuyAndHold';
import { useAuth } from '../contexts/AuthContext';
import { researchService } from '../services/research';

// jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts
// no donut de setores das seções.
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/research', async () => {
  const actual = await vi.importActual<typeof import('../services/research')>('../services/research');
  return { ...actual, researchService: { getAnchorReport: vi.fn() } };
});
vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/research">{children}</a>,
}));

const item = (ticker: string, action: 'BUY' | 'WAIT', score: number, anchor: Record<string, unknown> = {}) => ({
  position: 1,
  ticker,
  name: ticker,
  sector: 'Energia',
  action,
  score,
  currentPrice: 10,
  targetPrice: 12,
  probability: 0,
  reason: `motivo de ${ticker}`,
  anchor: { axes: { durability: 80, resilience: 70, consistency: 75 }, ...anchor },
});

const report = (ranking: unknown[], anchorExits: unknown[] = []) => ({
  _id: 'r1',
  date: '2026-08-01T00:00:00.000Z',
  assetClass: 'STOCK',
  strategy: 'BUY_AND_HOLD',
  anchorExits,
  inputManifest: { thresholds: { entryScore: 70, holdScore: 62 } },
  content: { morningCall: '', ranking },
});

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BuyAndHold />
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { plan: 'PRO', role: 'USER' } } as never);
});

describe('BuyAndHold', () => {
  it('separa o que está fora do COMPRAR em seções com nome próprio', async () => {
    vi.mocked(researchService.getAnchorReport).mockResolvedValue(report([
      item('WEGE3', 'BUY', 88),
      item('ITUB4', 'WAIT', 74, { expensive: true, composite: 82 }),
      item('KNCR11', 'WAIT', 78, { publicationLimit: { bucket: 'PAPER', cap: 1 } }),
      item('XPML11', 'WAIT', 72, { payoutUncovered: true }),
      item('CMIG4', 'WAIT', 58),
    ]) as never);

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: /Para comprar/ })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /Aguardando preço/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Fora por composição da carteira/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Renda não operacional/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Em observação/ })).toBeInTheDocument();
  });

  it('o painel conta COMPRAR, aguardando, saídas e score médio da lista', async () => {
    vi.mocked(researchService.getAnchorReport).mockResolvedValue(report(
      [item('WEGE3', 'BUY', 80), item('ITUB4', 'WAIT', 70, { expensive: true, composite: 75 })],
      [{ ticker: 'PSSA3', name: null, reason: 'Saiu da lista: score caiu', score: 60, previousScore: 72, stillListed: true }],
    ) as never);

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: /Para comprar/ })).toBeInTheDocument());
    expect(screen.getByText('Score médio da lista')).toBeInTheDocument();
    expect(screen.getByText('75,0')).toBeInTheDocument();
    expect(screen.getByText('PSSA3')).toBeInTheDocument();
  });

  it('apuração sem nenhum COMPRAR ainda abre pela seção "Para comprar"', async () => {
    // Sem o cabeçalho, uma lista honestamente vazia parece uma página quebrada.
    vi.mocked(researchService.getAnchorReport).mockResolvedValue(
      report([item('CMIG4', 'WAIT', 58)]) as never,
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: /Para comprar/ })).toBeInTheDocument());
    expect(screen.getByText(/Esperar é uma posição/)).toBeInTheDocument();
  });

  it('sem saídas, diz que ninguém saiu em vez de sumir com a seção', async () => {
    vi.mocked(researchService.getAnchorReport).mockResolvedValue(
      report([item('WEGE3', 'BUY', 80)]) as never,
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: /Saíram da lista nesta apuração/ })).toBeInTheDocument());
    expect(screen.getByText(/Nenhum ativo saiu da lista nesta apuração/)).toBeInTheDocument();
  });

  it('seções de leitura ganham a repartição por setor; as de bloqueio, não', async () => {
    // "Fora por composição" é o excedente de um balde já cheio — a pizza ali
    // repetiria o próprio critério da seção.
    vi.mocked(researchService.getAnchorReport).mockResolvedValue(report([
      { ...item('ITUB4', 'BUY', 88), sector: 'Bancos' },
      { ...item('CPFE3', 'BUY', 80), sector: 'Elétricas' },
      { ...item('KNCR11', 'WAIT', 78, { publicationLimit: { bucket: 'PAPER', cap: 1 } }), sector: 'Papel' },
      { ...item('KNRI11', 'WAIT', 76, { publicationLimit: { bucket: 'PAPER', cap: 1 } }), sector: 'Logística' },
    ]) as never);

    renderPage();

    await waitFor(() => expect(screen.getByText('Setores')).toBeInTheDocument());
    expect(screen.getAllByText('Setores')).toHaveLength(1);
    // Os setores do gráfico são os do próprio ativo, iguais aos selos dos cartões.
    expect(screen.getAllByText('Bancos').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Energia Elétrica').length).toBeGreaterThan(0);
    expect(screen.queryByText('Utilidade Pública')).not.toBeInTheDocument();
  });

  it('plano abaixo de PRO não chega a pedir o relatório', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { plan: 'ESSENTIAL', role: 'USER' } } as never);
    renderPage();
    expect(screen.getByText('Disponível a partir do plano Pro')).toBeInTheDocument();
    expect(researchService.getAnchorReport).not.toHaveBeenCalled();
  });
});
