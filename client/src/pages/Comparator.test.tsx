/**
 * Comparador de ativos (PRO+).
 *
 * O que os testes travam:
 *  - sem plano PRO não busca ranking e oferece upgrade (que leva a /pricing);
 *  - a busca filtra por ticker ou nome e esconde quem já foi escolhido;
 *  - com menos de 2 escolhidos mostra o estado vazio; com 2+, a tabela;
 *  - o melhor valor de cada métrica "quanto maior, melhor" sai destacado;
 *  - no limite de 3 a busca trava; trocar de classe busca de novo;
 *  - erro na busca do ranking vira lista vazia, não tela quebrada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'jest-axe';
import { Comparator } from './Comparator';
import { researchService, type RankingItem } from '../services/research';

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
const access = { pro: true };
vi.mock('../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ hasPlan: () => access.pro }) }));
vi.mock('../services/research', () => ({ researchService: { getLatest: vi.fn() } }));

const mockedGetLatest = vi.mocked(researchService.getLatest);

const item = (over: Partial<RankingItem> & { ticker: string; name: string }): RankingItem =>
  ({
    position: 1, action: 'WAIT', currentPrice: 10, targetPrice: 12, score: 60, probability: 50,
    riskProfile: 'MODERATE', type: 'STOCK',
    metrics: { pl: 8, pvp: 1.2, dy: 5, roe: 15, netMargin: 10, beta: 0.9, volatility: 25 },
    ...over,
  }) as RankingItem;

const RANKING = [
  item({
    ticker: 'PETR4', name: 'Petrobras', score: 82, action: 'BUY', riskProfile: 'BOLD',
    metrics: { pl: 4, pvp: 1, dy: 14, roe: 30 } as RankingItem['metrics'],
  }),
  item({ ticker: 'WEGE3', name: 'WEG', score: 75, riskProfile: 'DEFENSIVE', currentPrice: 40, targetPrice: 50 }),
  item({ ticker: 'ITUB4', name: 'Itaú Unibanco', score: 70, currentPrice: 0 }),
  item({ ticker: 'VALE3', name: 'Vale', score: 50, riskProfile: undefined }),
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/comparador']}>
      <Routes>
        <Route path="/comparador" element={<Comparator />} />
        <Route path="/pricing" element={<div>Página de planos</div>} />
      </Routes>
    </MemoryRouter>,
  );

const search = () => screen.getByLabelText('Buscar ativo para comparar');

const pick = (term: string, ticker: string) => {
  fireEvent.change(search(), { target: { value: term } });
  fireEvent.click(screen.getByText(ticker).closest('button') as HTMLButtonElement);
};

beforeEach(() => {
  access.pro = true;
  mockedGetLatest.mockReset();
  mockedGetLatest.mockResolvedValue({ content: { ranking: RANKING } } as Awaited<ReturnType<typeof researchService.getLatest>>);
});

describe('sem plano PRO', () => {
  it('não busca o ranking e o botão de upgrade leva a /pricing', () => {
    access.pro = false;
    renderPage();
    expect(screen.getByText('Conteúdo Exclusivo PRO')).toBeInTheDocument();
    expect(mockedGetLatest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fazer Upgrade' }));
    expect(screen.getByText('Página de planos')).toBeInTheDocument();
  });
});

describe('com plano PRO', () => {
  it('busca o ranking BUY_HOLD da classe e começa no estado vazio', async () => {
    renderPage();
    expect(await screen.findByText('Selecione ao menos 2 ativos')).toBeInTheDocument();
    expect(mockedGetLatest).toHaveBeenCalledWith('STOCK', 'BUY_HOLD');
  });

  it('busca filtra por ticker e por nome', async () => {
    renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    fireEvent.change(search(), { target: { value: 'unibanco' } });
    expect(screen.getByText('ITUB4')).toBeInTheDocument();
    expect(screen.queryByText('PETR4')).not.toBeInTheDocument();

    fireEvent.change(search(), { target: { value: 'pe' } });
    expect(screen.getByText('PETR4')).toBeInTheDocument();
    expect(screen.queryByText('VALE3')).not.toBeInTheDocument();
  });

  it('dois escolhidos montam a tabela e destacam o melhor de cada métrica', async () => {
    const { container } = renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    pick('PETR4', 'PETR4');
    expect(screen.getByText('Selecione ao menos 2 ativos')).toBeInTheDocument();
    // Escolhido sai da busca.
    fireEvent.change(search(), { target: { value: 'PETR4' } });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    pick('WEG', 'WEGE3');

    const table = within(screen.getByRole('table'));
    expect(table.getByText('COMPRAR')).toBeInTheDocument();
    expect(table.getByText('AGUARDAR')).toBeInTheDocument();
    expect(table.getByText('Arrojado')).toBeInTheDocument();
    expect(table.getByText('Defensivo')).toBeInTheDocument();

    const scoreRow = within(table.getByRole('row', { name: /^Score/ }));
    expect(scoreRow.getByText('82')).toHaveClass('text-emerald-400');
    expect(scoreRow.getByText('75')).not.toHaveClass('text-emerald-400');

    const upsideRow = within(table.getByRole('row', { name: /^Upside/ }));
    // WEGE3: 40 → 50 = +25%; PETR4: 10 → 12 = +20%.
    expect(upsideRow.getByText(/25,00%/)).toHaveClass('text-emerald-400');

    const dyRow = within(table.getByRole('row', { name: /^Dividend Yield/ }));
    expect(dyRow.getByText(/14,00%/)).toHaveClass('text-emerald-400');

    // Métrica ausente aparece como N/A.
    const marginRow = within(table.getByRole('row', { name: /^Margem Líquida/ }));
    expect(marginRow.getByText('N/A')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('preço zero vira Upside N/A e perfil ausente vira "-"', async () => {
    renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    pick('ITUB', 'ITUB4');
    pick('VALE', 'VALE3');
    const table = within(screen.getByRole('table'));
    const upsideRow = within(table.getByRole('row', { name: /^Upside/ }));
    expect(upsideRow.getByText('N/A')).toBeInTheDocument();
    expect(table.getByText('-')).toBeInTheDocument();
  });

  it('remover um ativo volta para o estado vazio', async () => {
    renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    pick('PETR4', 'PETR4');
    pick('WEG', 'WEGE3');
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remover PETR4 da comparação'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Selecione ao menos 2 ativos')).toBeInTheDocument();
  });

  it('no limite de 3 a busca trava', async () => {
    renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    pick('PETR4', 'PETR4');
    pick('WEG', 'WEGE3');
    pick('VALE', 'VALE3');
    expect(search()).toBeDisabled();
    expect(search()).toHaveAttribute('placeholder', 'Máximo de 3 ativos selecionados');
  });

  it('trocar de classe busca de novo, e erro vira lista vazia', async () => {
    renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    mockedGetLatest.mockRejectedValueOnce(new Error('falhou'));
    fireEvent.click(screen.getByRole('tab', { name: 'FIIs' }));
    expect(screen.getByRole('tab', { name: 'FIIs' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mockedGetLatest).toHaveBeenLastCalledWith('FII', 'BUY_HOLD'));
    await screen.findByText('Selecione ao menos 2 ativos');
    fireEvent.change(search(), { target: { value: 'P' } });
    expect(screen.queryByText('PETR4')).not.toBeInTheDocument();
  });

  it('cripto é formatada em dólar', async () => {
    mockedGetLatest.mockResolvedValue({
      content: {
        ranking: [
          item({ ticker: 'BTC', name: 'Bitcoin', type: 'CRYPTO', currentPrice: 90000, targetPrice: 100000 }),
          item({ ticker: 'ETH', name: 'Ethereum', type: 'CRYPTO', currentPrice: 3000, targetPrice: 3500 }),
        ],
      },
    } as Awaited<ReturnType<typeof researchService.getLatest>>);
    renderPage();
    await screen.findByText('Selecione ao menos 2 ativos');
    pick('BTC', 'BTC');
    pick('ETH', 'ETH');
    const priceRow = within(screen.getByRole('row', { name: /^Preço Atual/ }));
    expect(priceRow.getAllByText(/US\$/)).toHaveLength(2);
  });
});
