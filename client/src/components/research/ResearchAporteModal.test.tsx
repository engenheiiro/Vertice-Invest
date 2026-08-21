/**
 * ResearchAporteModal — aporte inteligente por classe.
 *  - Aba ETFs: o aporte respeita a origem visível (Nacional B3 / Internacional US),
 *    nunca mistura os dois universos (moedas diferentes: BRL vs USD).
 *  - Só distribui entre ativos COMPRAR; itens AGUARDAR nunca entram na sugestão.
 *  - Aba FIIs: mostra o setor de cada sugestão e a alocação setorial (do aporte e
 *    da carteira depois dele).
 * Mocka o WalletContext (usdRate + posições) para isolar a lógica de alocação.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ResearchAporteModal } from './ResearchAporteModal';
import type { RankingItem } from '../../services/research';

// jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts.
(global as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const wallet = vi.hoisted(() => ({ usdRate: 5, assets: [] as any[], isPrivacyMode: false }));

vi.mock('../../contexts/WalletContext', () => ({
  useWallet: () => wallet,
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

beforeEach(() => {
  vi.clearAllMocks();
  wallet.assets = [];
  wallet.isPrivacyMode = false;
});

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

// ---------------------------------------------------------------------------
// Aba FIIs — leitura setorial.
//
// A sugestão de compra sozinha não diz que risco está sendo comprado: 6 FIIs de
// papel e 6 segmentos diferentes têm a mesma cara na lista. Estes testes fixam
// que o setor aparece por linha e que as duas pizzas (aporte e carteira depois)
// usam a mesma chave de segmento do backend.
// ---------------------------------------------------------------------------

const fiiItem = (ticker: string, sector: string, currentPrice: number, score: number): RankingItem => ({
  ...mk(ticker, 'FII', 'BUY', currentPrice, score),
  sector,
});

// Preços iguais e scores próximos: KNCR11 e VISC11 recebem 2 cotas cada (R$ 200
// de um aporte de R$ 400) — 50% para cada segmento.
const FII_RANKING: RankingItem[] = [
  fiiItem('KNCR11', 'Títulos e Val. Mob.', 100, 99),
  fiiItem('VISC11', 'Shoppings', 100, 90),
];

const walletFii = (ticker: string, totalValue: number, sector: string) => ({
  id: ticker, ticker, type: 'FII', quantity: 1, averagePrice: totalValue, currentPrice: totalValue,
  totalValue, totalCost: totalValue, profit: 0, profitPercent: 0, currency: 'BRL', sector,
});

const renderFiiAporte = (amount = '400') => {
  render(<ResearchAporteModal isOpen onClose={() => {}} ranking={FII_RANKING} assetClass="FII" />);
  fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: amount } });
};

describe('ResearchAporteModal — aba FIIs mostra o setor', () => {
  it('rotula cada sugestão com o segmento canônico do FII', () => {
    renderFiiAporte();

    const rows = rowsContainer();
    // Sinônimo do Fundamentus ("Títulos e Val. Mob.") normalizado para o rótulo de carteira.
    expect(within(rows).getAllByText('Papel (CRI)').length).toBeGreaterThan(0);
    expect(within(rows).getAllByText('Shoppings').length).toBeGreaterThan(0);
  });

  it('conta setores pela chave de segmento, não pelo rótulo cru', () => {
    render(
      <ResearchAporteModal
        isOpen
        onClose={() => {}}
        // Dois rótulos distintos na origem, um único risco de crédito (CRI).
        ranking={[fiiItem('KNCR11', 'Títulos e Val. Mob.', 100, 99), fiiItem('KNSC11', 'Papel', 100, 90)]}
        assetClass="FII"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '400' } });

    expect(screen.getByText(/2 ativos · 1 setor$/)).toBeInTheDocument();
  });

  it('não mostra setor nas classes ainda não cobertas (ex. Ações BR)', () => {
    render(
      <ResearchAporteModal isOpen onClose={() => {}} ranking={[mk('AAA3', 'STOCK', 'BUY', 20)]} assetClass="STOCK" />,
    );
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '500' } });

    expect(screen.queryByText('Alocação setorial')).not.toBeInTheDocument();
  });
});

describe('ResearchAporteModal — pizzas de alocação setorial', () => {
  it('reparte o aporte por setor', () => {
    renderFiiAporte();

    expect(screen.getByText('Alocação setorial')).toBeInTheDocument();
    const doAporte = screen.getByText('Do aporte').closest('div')!.parentElement as HTMLElement;
    expect(within(doAporte).getByText('2 setores')).toBeInTheDocument();
    // R$ 200 em cada segmento.
    expect(within(doAporte).getAllByText('50.0%')).toHaveLength(2);
  });

  it('projeta a carteira depois do aporte, com o antes de cada segmento', () => {
    wallet.assets = [
      walletFii('VISC11', 600, 'Shoppings'),
      // Ação BR não entra num donut de segmento de FII.
      { ...walletFii('PETR4', 5000, 'Petróleo'), type: 'STOCK' },
    ];
    renderFiiAporte();

    const depois = screen.getByText('Sua carteira depois').closest('div')!.parentElement as HTMLElement;
    // VISC11 600 + 200 = 800 e KNCR11 200, sobre 1000.
    expect(within(depois).getByText('80.0%')).toBeInTheDocument();
    expect(within(depois).getByText('20.0%')).toBeInTheDocument();
    // Antes do aporte a carteira de FII era 100% shopping; o papel entra do zero.
    expect(within(depois).getByText(/antes 100\.0%/)).toBeInTheDocument();
    expect(within(depois).getByText(/antes 0\.0%/)).toBeInTheDocument();
    expect(within(depois).queryByText('Petróleo')).not.toBeInTheDocument();
  });

  it('mostra TODOS os FIIs da carteira, inclusive segmentos ausentes do ranking', () => {
    // O "depois" é a carteira do usuário, não um recorte do ranking: hotel e laje
    // não estão no ranking desta semana, mas continuam sendo risco que ele carrega —
    // omiti-los mostraria uma concentração menor do que a real.
    wallet.assets = [
      walletFii('VISC11', 400, 'Shoppings'),
      walletFii('HTMX11', 300, 'Hotéis'),
      walletFii('BRCR11', 100, 'Lajes Corporativas'),
    ];
    renderFiiAporte();

    const depois = screen.getByText('Sua carteira depois').closest('div')!.parentElement as HTMLElement;
    // VISC11 600, KNCR11 200, HTMX11 300, BRCR11 100 — sobre 1200.
    expect(within(depois).getByText('Hotéis')).toBeInTheDocument();
    expect(within(depois).getByText('25.0%')).toBeInTheDocument();
    expect(within(depois).getByText('Lajes Corporativas')).toBeInTheDocument();
    expect(within(depois).getByText('8.3%')).toBeInTheDocument();
    // Os 4 segmentos da carteira, contra os 2 comprados no aporte.
    expect(within(depois).getByText('4')).toBeInTheDocument();
  });

  it('sem posição na classe, explica em vez de repetir a mesma pizza', () => {
    renderFiiAporte();

    expect(screen.queryByText('Sua carteira depois')).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não tem essa classe na carteira/i)).toBeInTheDocument();
  });
});
