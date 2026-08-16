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

describe('ResearchAporteModal — moeda por classe', () => {
  // REIT é o ranking imobiliário US: preço em dólar. Era tratado como BRL, o que
  // rotulava o aporte errado (e ficou visível ao vir do Aporte da Carteira, que já
  // converte o valor para a moeda da aba).
  it('REIT usa US$ e aceita fração', () => {
    const ranking: RankingItem[] = [mk('O', 'REIT', 'BUY', 55), mk('VICI', 'REIT', 'BUY', 32)];
    render(<ResearchAporteModal isOpen onClose={() => {}} ranking={ranking} assetClass="REIT" />);
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '1000' } });

    expect(screen.getByText(/Valor do Aporte \(US\$\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/US\$/).length).toBeGreaterThan(0);
  });
});

describe('ResearchAporteModal — valor herdado da Carteira', () => {
  it('pré-preenche o campo com initialAmount ao abrir', () => {
    const ranking: RankingItem[] = [mk('AAA3', 'STOCK', 'BUY', 20)];
    render(
      <ResearchAporteModal isOpen onClose={() => {}} ranking={ranking} assetClass="STOCK" initialAmount={750.5} />,
    );
    expect(screen.getByPlaceholderText('0,00')).toHaveValue(750.5);
    expect(suggestedTickers()).toContain('AAA3');
  });

  it('sem initialAmount não mexe no que o usuário digitou', () => {
    const ranking: RankingItem[] = [mk('AAA3', 'STOCK', 'BUY', 20)];
    render(<ResearchAporteModal isOpen onClose={() => {}} ranking={ranking} assetClass="STOCK" />);
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '120' } });
    expect(screen.getByPlaceholderText('0,00')).toHaveValue(120);
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
