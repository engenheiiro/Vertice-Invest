/**
 * ResearchAporteModal — aporte inteligente por classe.
 *  - Aba ETFs: o aporte respeita a origem visível (Nacional B3 / Internacional US),
 *    nunca mistura os dois universos (moedas diferentes: BRL vs USD).
 *  - Só distribui entre ativos COMPRAR; itens AGUARDAR nunca entram na sugestão.
 * Mocka o WalletContext (usdRate) para isolar a lógica de alocação.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ResearchAporteModal } from './ResearchAporteModal';
import type { RankingItem } from '../../services/research';

vi.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ usdRate: 5 }),
}));

const mk = (
  ticker: string,
  type: string,
  action: 'BUY' | 'WAIT',
  currentPrice: number,
  score = 80,
): RankingItem => ({
  position: 1,
  ticker,
  name: ticker,
  sector: 'Índice',
  type,
  usSubType: type === 'ETF' ? null : 'ETF',
  action,
  currentPrice,
  targetPrice: currentPrice * 1.1,
  score,
  probability: 0.8,
  riskProfile: 'DEFENSIVE',
  thesis: '',
  reason: '',
  metrics: { dy: 0, marketCap: 1e9, structural: { quality: 50, valuation: 50, risk: 50 } } as any,
});

// ETF ranking misto: 2 nacionais (B3, BRL) e 2 internacionais (US, USD).
const ETF_RANKING: RankingItem[] = [
  mk('BOVA11', 'ETF', 'BUY', 170),
  mk('IVVB11', 'ETF', 'BUY', 440),
  mk('SCHD', 'STOCK_US', 'BUY', 32),
  mk('VNQ', 'STOCK_US', 'BUY', 98),
];

const rowsContainer = () => screen.getByText('Sugestão de compra').closest('div')!.parentElement as HTMLElement;
const suggestedTickers = () =>
  within(rowsContainer())
    .getAllByText(/^[A-Z]+\d*$/)
    .map((el) => el.textContent);

beforeEach(() => vi.clearAllMocks());

describe('ResearchAporteModal — aba ETFs respeita a origem', () => {
  it('Internacional (default US): sugere apenas ETFs US e usa US$', () => {
    render(
      <ResearchAporteModal isOpen onClose={() => {}} ranking={ETF_RANKING} assetClass="ETF" etfOrigin="US" />,
    );
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '1000' } });

    const tickers = suggestedTickers();
    expect(tickers).toEqual(expect.arrayContaining(['SCHD', 'VNQ']));
    expect(tickers).not.toContain('BOVA11');
    expect(tickers).not.toContain('IVVB11');
    // Moeda dos ETFs US é dólar
    expect(screen.getAllByText(/US\$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Valor do Aporte \(US\$\)/)).toBeInTheDocument();
  });

  it('Nacional (BR): sugere apenas ETFs B3 e usa R$', () => {
    render(
      <ResearchAporteModal isOpen onClose={() => {}} ranking={ETF_RANKING} assetClass="ETF" etfOrigin="BR" />,
    );
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '2000' } });

    const tickers = suggestedTickers();
    expect(tickers).toEqual(expect.arrayContaining(['BOVA11', 'IVVB11']));
    expect(tickers).not.toContain('SCHD');
    expect(tickers).not.toContain('VNQ');
    expect(screen.getByText(/Valor do Aporte \(R\$\)/)).toBeInTheDocument();
  });
});

describe('ResearchAporteModal — só distribui em COMPRAR', () => {
  it('ignora ativos AGUARDAR na sugestão', () => {
    const ranking: RankingItem[] = [
      mk('AAA3', 'STOCK', 'BUY', 20),
      mk('BBB3', 'STOCK', 'WAIT', 25),
    ];
    render(<ResearchAporteModal isOpen onClose={() => {}} ranking={ranking} assetClass="STOCK" etfOrigin="US" />);
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '500' } });

    const tickers = suggestedTickers();
    expect(tickers).toContain('AAA3');
    expect(tickers).not.toContain('BBB3');
  });
});
