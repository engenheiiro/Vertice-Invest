/**
 * Sub-filtros do TopPicksCard:
 *  - Exterior (STOCK_US): chips Todos/Stocks/REITs filtram por usSubType (null cai em
 *    STOCK). ETF e Dólar NÃO têm chip aqui (ETF tem aba própria; Dólar/Ouro não são
 *    ativos investíveis na vitrine). O badge de sub-tipo na linha foi removido: o ranking
 *    já é puro por classe, então só o setor/segmento é rotulado (em linha única).
 *  - Aba ETFs: chips Todos/Nacional/Internacional separam type 'ETF' (B3) de 'STOCK_US'.
 * Mocka Wallet/Router/AssetLogo para isolar a lógica de filtragem.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TopPicksCard } from './TopPicksCard';
import type { RankingItem } from '../../services/research';

vi.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ assets: [], kpis: { totalEquity: 0 }, isPrivacyMode: false }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

const mkPick = (
  ticker: string,
  usSubType: RankingItem['usSubType'],
  type: string = 'STOCK_US',
): RankingItem => ({
  position: 1,
  ticker,
  name: ticker,
  sector: 'Tech',
  type,
  usSubType,
  action: 'BUY',
  currentPrice: 100,
  targetPrice: 120,
  score: 80,
  probability: 0.8,
  riskProfile: 'DEFENSIVE',
  thesis: '',
  reason: '',
  metrics: { dy: 0, marketCap: 1e9, structural: { quality: 50, valuation: 50, risk: 50 } } as any,
});

const PICKS: RankingItem[] = [
  mkPick('AAPL', 'STOCK'),
  mkPick('VOO', 'ETF'),
  mkPick('OREIT', 'REIT'),
  mkPick('GLD', 'GOLD'),
  mkPick('USDCASH', 'DOLLAR'),
  mkPick('LEGACY', null), // sem sub-tipo → tratado como STOCK
];

// A "Composição Detalhada" é a lista onde cada item exibe o ticker.
const listTickers = () =>
  screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

beforeEach(() => vi.clearAllMocks());

describe('TopPicksCard — alocação ideal considera apenas COMPRAR', () => {
  const MIXED: RankingItem[] = [
    { ...mkPick('AAA3', null, 'STOCK'), action: 'BUY' },
    { ...mkPick('BBB3', null, 'STOCK'), action: 'BUY' },
    { ...mkPick('CCC3', null, 'STOCK'), action: 'WAIT' },
  ];

  it('Meta % divide por nº de COMPRAR; AGUARDAR fica com Meta —', () => {
    render(<TopPicksCard picks={MIXED} assetClass="STOCK" />);
    // 2 COMPRAR → meta 50% cada; o AGUARDAR não entra na alocação-alvo.
    expect(screen.getAllByText('Meta: 50%')).toHaveLength(2);
    expect(screen.getByText('Meta: —')).toBeInTheDocument();
  });

  it('AGUARDAR não possuído mostra status neutro, sem "Aportar ~"', () => {
    render(<TopPicksCard picks={MIXED} assetClass="STOCK" />);
    // "Aguardar" aparece para o CCC3 (não possuído + WAIT).
    expect(screen.getAllByText('Aguardar').length).toBeGreaterThan(0);
  });
});

describe('TopPicksCard — Exterior (ranking puro, sem sub-chips)', () => {
  it('NÃO renderiza mais chips de sub-tipo no Exterior (separação vem do dado)', () => {
    render(<TopPicksCard picks={PICKS} assetClass="STOCK_US" />);
    expect(screen.queryByTitle(/Filtrar Exterior: Stocks/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Filtrar Exterior: REITs/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Filtrar Exterior: ETFs/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Filtrar Exterior: Dólar/)).not.toBeInTheDocument();
  });

  it('lista todos os picks recebidos (já filtrados pelo backend por classe)', () => {
    render(<TopPicksCard picks={PICKS} assetClass="STOCK_US" />);
    const tickers = listTickers();
    expect(tickers).toEqual(expect.arrayContaining(['AAPL', 'VOO', 'OREIT', 'GLD', 'USDCASH', 'LEGACY']));
  });

  it('NÃO exibe mais o badge de sub-tipo na linha (ranking já é puro por classe)', () => {
    render(<TopPicksCard picks={[mkPick('VNQ', 'ETF')]} assetClass="STOCK_US" />);
    const headings = screen.getAllByRole('heading', { level: 4 });
    const row = headings.find((h) => h.textContent === 'VNQ')!.closest('div.bg-base')!;
    // Só o setor permanece (em linha única); o rótulo redundante 'ETFs' some.
    expect(within(row as HTMLElement).getByText('Tech')).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText('ETFs')).not.toBeInTheDocument();
  });
});

describe('TopPicksCard — sub-filtro da aba ETFs (Nacional/Internacional)', () => {
  const ETF_PICKS: RankingItem[] = [
    mkPick('VOO', 'ETF', 'STOCK_US'),   // internacional
    mkPick('IVV', 'ETF', 'STOCK_US'),   // internacional
    mkPick('BOVA11', null, 'ETF'),      // nacional (B3)
    mkPick('IVVB11', null, 'ETF'),      // nacional (B3)
  ];

  it('mostra os chips de origem (Nacional/Internacional, SEM "Todos") só na aba ETFs', () => {
    const { rerender } = render(<TopPicksCard picks={ETF_PICKS} assetClass="STOCK_US" />);
    expect(screen.queryByTitle(/Filtrar ETFs: Nacional/)).not.toBeInTheDocument();

    rerender(<TopPicksCard picks={ETF_PICKS} assetClass="ETF" />);
    expect(screen.getByTitle(/Filtrar ETFs: Nacional/)).toBeInTheDocument();
    expect(screen.getByTitle(/Filtrar ETFs: Internacional/)).toBeInTheDocument();
    expect(screen.queryByTitle(/Filtrar ETFs: Todos/)).not.toBeInTheDocument();
  });

  it('abre em Internacional por padrão (só ETFs US, sem "Todos")', () => {
    render(<TopPicksCard picks={ETF_PICKS} assetClass="ETF" />);
    const tickers = listTickers();
    expect(tickers).toEqual(expect.arrayContaining(['VOO', 'IVV']));
    expect(tickers).not.toContain('BOVA11');
    expect(tickers).not.toContain('IVVB11');
  });

  it('chip Nacional deixa só os ETFs B3 (type ETF)', () => {
    render(<TopPicksCard picks={ETF_PICKS} assetClass="ETF" />);
    fireEvent.click(screen.getByTitle(/Filtrar ETFs: Nacional/));
    const tickers = listTickers();
    expect(tickers).toEqual(expect.arrayContaining(['BOVA11', 'IVVB11']));
    expect(tickers).not.toContain('VOO');
    expect(tickers).not.toContain('IVV');
  });

  it('chip Internacional deixa só os ETFs US (type STOCK_US)', () => {
    render(<TopPicksCard picks={ETF_PICKS} assetClass="ETF" />);
    fireEvent.click(screen.getByTitle(/Filtrar ETFs: Internacional/));
    const tickers = listTickers();
    expect(tickers).toEqual(expect.arrayContaining(['VOO', 'IVV']));
    expect(tickers).not.toContain('BOVA11');
    expect(tickers).not.toContain('IVVB11');
  });
});

describe('TopPicksCard — toggle Ações/REITs do Exterior (na barra Perfil)', () => {
  it('renderiza os chips Ações/REITs quando há onExteriorViewChange', () => {
    const fn = vi.fn();
    render(<TopPicksCard picks={PICKS} assetClass="STOCK_US" onExteriorViewChange={fn} />);
    expect(screen.getByTitle('Exterior: Ações')).toBeInTheDocument();
    expect(screen.getByTitle('Exterior: REITs')).toBeInTheDocument();
  });

  it('NÃO renderiza os chips sem o callback', () => {
    render(<TopPicksCard picks={PICKS} assetClass="STOCK_US" />);
    expect(screen.queryByTitle('Exterior: REITs')).not.toBeInTheDocument();
  });

  it('clicar em REITs chama onExteriorViewChange("REIT")', () => {
    const fn = vi.fn();
    render(<TopPicksCard picks={PICKS} assetClass="STOCK_US" onExteriorViewChange={fn} />);
    fireEvent.click(screen.getByTitle('Exterior: REITs'));
    expect(fn).toHaveBeenCalledWith('REIT');
  });

  it('o chip ativo reflete a classe carregada (REIT → REITs ativo)', () => {
    const fn = vi.fn();
    render(<TopPicksCard picks={PICKS} assetClass="REIT" onExteriorViewChange={fn} />);
    expect(screen.getByTitle('Exterior: REITs').className).toContain('cyan');
    expect(screen.getByTitle('Exterior: Ações').className).not.toContain('cyan');
  });
});
