/**
 * Painel de Indicadores: cards macro, Tesouro Direto e CDBs.
 *
 * O que os testes travam:
 *  - primeira carga mostra o esqueleto com rótulo acessível;
 *  - taxa em fallback ganha aviso (SELIC arrasta o CDI junto) e painel sem
 *    atualização há mais de 1h avisa que a sincronização pode ter parado;
 *  - Tesouro abre por clique ou teclado, filtra por família e ordena por coluna;
 *  - título sem PU/mínimo mostra "—", nunca R$ 0;
 *  - sem títulos, a tabela diz que a base está sincronizando.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Indicators } from './Indicators';
import { researchService } from '../services/research';

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../services/research', () => ({ researchService: { getMacroData: vi.fn() } }));

const mockedMacro = vi.mocked(researchService.getMacroData);

const BONDS = [
  { _id: 'b1', title: 'Tesouro IPCA+ 2035', type: 'IPCA', index: 'IPCA', rate: 7.4, unitPrice: 2500.5, minInvestment: 25.01, maturityDate: '2035-05-15' },
  { _id: 'b2', title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', index: 'PRE', rate: 13.9, unitPrice: 600, minInvestment: 0, maturityDate: '2029-01-01' },
  { _id: 'b3', title: 'Tesouro Selic 2031', type: 'SELIC', index: 'SELIC', rate: 0.07, unitPrice: 0, minInvestment: 160, maturityDate: '2031-03-01' },
  { _id: 'b4', title: 'Tesouro Educa+ 2040', type: 'EDUCA', index: 'IPCA', rate: 7.1, unitPrice: 3000, minInvestment: 30, maturityDate: '2040-12-15' },
];

const MACRO = {
  selic: { value: 15 }, cdi: { value: 14.9 }, ipca: { value: 4.5 },
  ibov: { value: 128000, change: 1.25 }, usd: { value: 5.4321, change: -0.5 },
  spx: { value: 6000, change: 0 }, btc: { value: 95000, change: 2 },
  bonds: BONDS,
  lastUpdated: '2026-11-22T11:50:00Z',
  ratesSources: { selic: 'BCB', ipca: 'IBGE' },
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><Indicators /></QueryClientProvider>,
  );
};

const titlesInOrder = () =>
  within(screen.getByRole('table')).getAllByText(/^Tesouro /).map((el) => el.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
  mockedMacro.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('carregando', () => {
  it('primeira carga mostra o esqueleto com rótulo', () => {
    mockedMacro.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByRole('status', { name: 'Carregando indicadores' }).length).toBeGreaterThan(0);
    // Conteúdo fica montado, mas recolhido (classe `hidden`) até o dado chegar.
    expect(screen.getByText('Painel de Indicadores').closest('.hidden')).not.toBeNull();
  });
});

describe('cards e avisos', () => {
  it('dados frescos: cards preenchidos, variação com sinal e sem aviso', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    expect(await screen.findByText('15%')).toBeInTheDocument();
    expect(screen.getByText('14,9%')).toBeInTheDocument();
    expect(screen.getByText('R$ 5,432')).toBeInTheDocument();
    expect(screen.getByText('$ 95.000,00')).toBeInTheDocument();
    expect(screen.getByText('1.25%')).toBeInTheDocument();
    expect(screen.getByText('0.50%')).toBeInTheDocument();
    expect(screen.getByText(/Refresh automático a cada 15 min/)).toBeInTheDocument();
    expect(screen.queryByText(/em fallback/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sem atualização há mais de 1 hora/)).not.toBeInTheDocument();
  });

  it('SELIC e IPCA em fallback avisam SELIC, CDI e IPCA', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, ratesSources: { selic: 'fallback', ipca: 'fallback' } });
    renderPage();
    expect(await screen.findByText('SELIC, CDI, IPCA em fallback.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Dado em fallback (BCB indisponível)')).toHaveLength(3);
  });

  it('painel parado há mais de 1h avisa a sincronização', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, lastUpdated: '2026-11-22T10:30:00Z' });
    renderPage();
    expect(await screen.findByText(/sem atualização há mais de 1 hora/)).toBeInTheDocument();
  });

  it('sem lastUpdated nem valores: texto padrão e zeros de placeholder', async () => {
    mockedMacro.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText('Atualização automática a cada 15 minutos.')).toBeInTheDocument();
    expect(screen.getByText(/Base Oficial: 0 Títulos/)).toBeInTheDocument();
    expect(screen.getAllByText('R$ 0,00').length).toBeGreaterThan(0);
  });
});

describe('Tesouro Direto', () => {
  it('abre pelo clique e lista os títulos; PU/mínimo ausentes viram "—"', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    const { container } = renderPage();
    const toggle = await screen.findByRole('button', { name: 'Tesouro Direto' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Aberto, com os filtros à vista: eles ficam ao lado do botão, não dentro (nested-interactive).
    expect(await axe(container)).toHaveNoViolations();

    const table = within(screen.getByRole('table'));
    expect(table.getByText('IPCA + 7.40%')).toBeInTheDocument();
    expect(table.getByText('13.90%')).toBeInTheDocument();
    expect(table.getByText('R$ 2.500,50')).toBeInTheDocument();
    expect(table.getAllByText('—')).toHaveLength(2);
  });

  it('teclado (Enter/espaço) abre e fecha; outra tecla não', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    const toggle = await screen.findByRole('button', { name: 'Tesouro Direto' });
    toggle.focus();
    await userEvent.keyboard('a');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('filtro por família deixa só os títulos dela, sem fechar o painel', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tesouro Direto' }));
    fireEvent.click(screen.getByRole('button', { name: 'SELIC' }));
    expect(titlesInOrder()).toEqual(['Tesouro Selic 2031']);
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(titlesInOrder()).toHaveLength(4);
  });

  it('ordena por coluna e inverte no segundo clique', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tesouro Direto' }));
    // Padrão: tipo ascendente.
    expect(titlesInOrder()).toEqual(['Tesouro Educa+ 2040', 'Tesouro IPCA+ 2035', 'Tesouro Prefixado 2029', 'Tesouro Selic 2031']);

    fireEvent.click(screen.getByText('Rentabilidade Anual'));
    expect(titlesInOrder()[0]).toBe('Tesouro Selic 2031');
    fireEvent.click(screen.getByText('Rentabilidade Anual'));
    expect(titlesInOrder()[0]).toBe('Tesouro Prefixado 2029');
  });

  it('sem títulos: base sincronizando', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, bonds: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tesouro Direto' }));
    expect(screen.getByText('Base de dados sincronizando...')).toBeInTheDocument();
  });
});

describe('CDBs e cofrinhos', () => {
  it('abre a lista curada com a taxa em % do CDI', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    const toggle = await screen.findByRole('button', { name: /CDBs, Caixinhas/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sofisa Direto')).toBeInTheDocument();
    expect(screen.getAllByText('115% do CDI')).toHaveLength(1);
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(screen.queryByText('Sofisa Direto')).not.toBeInTheDocument();
  });
});
