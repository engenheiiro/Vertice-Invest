/**
 * Caracterização do Painel de Indicadores: trava o que a tela mostra hoje em
 * cada ramo (avisos, placeholders, cores de variação, filtros, ordenação e os
 * dois painéis recolhíveis) para a separação em partes menores não mudar nada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Indicators } from './Indicators';
import { researchService } from '../services/research';

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../services/research', () => ({ researchService: { getMacroData: vi.fn() } }));

const mockedMacro = vi.mocked(researchService.getMacroData);

const BONDS = [
  { _id: 'b1', title: 'Tesouro IPCA+ 2035', type: 'IPCA', index: 'IPCA', rate: 7.4, unitPrice: 2500.5, minInvestment: 25.01, maturityDate: '2035-05-15' },
  { _id: 'b2', title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', index: 'PRE', rate: 13.9, unitPrice: 600, minInvestment: 6, maturityDate: '2029-01-01' },
  { _id: 'b3', title: 'Tesouro Selic 2031', type: 'SELIC', index: 'SELIC', rate: 0.07, unitPrice: 16000, minInvestment: 160, maturityDate: '2031-03-01' },
  { _id: 'b4', title: 'Tesouro Educa+ 2040', type: 'EDUCA', index: 'IPCA', rate: 7.1, unitPrice: 3000, minInvestment: 30, maturityDate: '2040-12-15' },
  { _id: 'b5', title: 'Tesouro RendA+ 2050', type: 'RENDAMAIS', index: 'IPCA', rate: 6.9, unitPrice: 1000, minInvestment: 10, maturityDate: '2050-01-15' },
  { _id: 'b6', title: 'Tesouro Outro 2060', type: 'OUTRO', index: 'IPCA', rate: 6.5, unitPrice: 900, minInvestment: 9, maturityDate: '2060-01-15' },
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
  return render(<QueryClientProvider client={client}><Indicators /></QueryClientProvider>);
};

const titlesInOrder = () =>
  within(screen.getByRole('table')).getAllByText(/^Tesouro /).map((el) => el.textContent);

/** Card do indicador a partir do rótulo (o rótulo fica num span no topo do card). */
const cardOf = (label: string) => {
  const card = screen.getByText(label).closest('div.rounded-2xl');
  if (!card) throw new Error(`card ${label} não encontrado`);
  return card as HTMLElement;
};

/** Espera a primeira busca terminar (com dado ou com erro): o esqueleto sai da tela. */
const waitSettled = () =>
  waitFor(() => expect(screen.queryByRole('status', { name: 'Carregando indicadores' })).not.toBeInTheDocument());

const openTreasury = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Tesouro Direto' }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
  mockedMacro.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('carregamento e falha', () => {
  it('carregado: esqueleto some e o conteúdo deixa de ficar oculto', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    await screen.findByText('15%');
    expect(screen.queryByRole('status', { name: 'Carregando indicadores' })).not.toBeInTheDocument();
    expect(screen.getByText('Painel de Indicadores').closest('.hidden')).toBeNull();
  });

  it('erro na busca: sem esqueleto, cards com placeholder e Tesouro sincronizando', async () => {
    mockedMacro.mockRejectedValue(new Error('fora do ar'));
    renderPage();
    await waitSettled();
    expect(screen.getByText('Atualização automática a cada 15 minutos.')).toBeInTheDocument();
    expect(screen.getByText('Painel de Indicadores').closest('.hidden')).toBeNull();
    expect(screen.getByText(/Base Oficial: 0 Títulos/)).toBeInTheDocument();
    await openTreasury();
    expect(screen.getByText('Base de dados sincronizando...')).toBeInTheDocument();
  });
});

describe('cards', () => {
  it('valores ausentes: taxa "0.00%", pontos "0.00", moeda "R$ 0,00"/"$ 0,00", sem variação', async () => {
    mockedMacro.mockResolvedValue({});
    renderPage();
    await waitSettled();
    expect(within(cardOf('SELIC')).getByText('0.00%')).toBeInTheDocument();
    expect(within(cardOf('IPCA (12m)')).getByText('0.00%')).toBeInTheDocument();
    expect(within(cardOf('Ibovespa')).getByText('0.00')).toBeInTheDocument();
    expect(within(cardOf('Dólar Comercial')).getByText('R$ 0,00')).toBeInTheDocument();
    expect(within(cardOf('Bitcoin')).getByText('$ 0,00')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+\.\d{2}%$/, { selector: 'span' })).not.toBeInTheDocument();
  });

  it('pontos sem moeda saem no formato pt-BR; cor do valor por card', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    await screen.findByText('15%');
    const ibovValue = within(cardOf('Ibovespa')).getByText('128.000');
    expect(ibovValue.tagName).toBe('P');
    expect(ibovValue).toHaveClass('text-white');
    expect(within(cardOf('SELIC')).getByText('15%')).toHaveClass('text-emerald-400');
    expect(within(cardOf('IPCA (12m)')).getByText('4,5%')).toHaveClass('text-yellow-400');
    expect(within(cardOf('Bitcoin')).getByText('$ 95.000,00')).toHaveClass('text-purple-400');
    expect(within(cardOf('S&P 500')).getByText('6.000')).toBeInTheDocument();
  });

  it('variação positiva verde, negativa vermelha (sem sinal), zero sem indicador', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    await screen.findByText('15%');
    expect(within(cardOf('Ibovespa')).getByText('1.25%')).toHaveClass('text-emerald-500');
    expect(within(cardOf('Dólar Comercial')).getByText('0.50%')).toHaveClass('text-red-500');
    expect(within(cardOf('Bitcoin')).getByText('2.00%')).toHaveClass('text-emerald-500');
    expect(within(cardOf('S&P 500')).queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('só IPCA em fallback: aviso cita só IPCA e um card marcado', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, ratesSources: { selic: 'BCB', ipca: 'fallback' } });
    renderPage();
    expect(await screen.findByText('IPCA em fallback.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Dado em fallback (BCB indisponível)')).toHaveLength(1);
    expect(cardOf('IPCA (12m)')).toHaveClass('border-yellow-500/40');
    expect(cardOf('SELIC')).toHaveClass('border-slate-800');
    expect(screen.queryByText(/sem atualização há mais de 1 hora/)).not.toBeInTheDocument();
  });

  it('só SELIC em fallback marca SELIC e CDI', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, ratesSources: { selic: 'fallback' } });
    renderPage();
    expect(await screen.findByText('SELIC, CDI em fallback.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Dado em fallback (BCB indisponível)')).toHaveLength(2);
    expect(cardOf('CDI')).toHaveClass('border-yellow-500/40');
  });

  it('fallback e painel parado: os dois avisos juntos', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, lastUpdated: '2026-11-22T09:00:00Z', ratesSources: { selic: 'fallback', ipca: 'IBGE' } });
    renderPage();
    expect(await screen.findByText('SELIC, CDI em fallback.')).toBeInTheDocument();
    expect(screen.getByText(/sem atualização há mais de 1 hora/)).toBeInTheDocument();
  });

  it('exatamente 1h sem atualização ainda não avisa', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, lastUpdated: '2026-11-22T11:00:00Z' });
    renderPage();
    await screen.findByText('15%');
    expect(screen.queryByText(/sem atualização há mais de 1 hora/)).not.toBeInTheDocument();
  });

  it('com lastUpdated, data e hora aparecem no topo e no cabeçalho do Tesouro', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    await screen.findByText('15%');
    const stamp = new Date(MACRO.lastUpdated).toLocaleString('pt-BR');
    expect(screen.getByText(new RegExp(`Atualizado: ${stamp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Tesouro Direto' });
    expect(within(toggle).getByText(/Base Oficial: 6 Títulos/)).toBeInTheDocument();
    expect(within(toggle).getByText(stamp)).toBeInTheDocument();
  });
});

describe('Tesouro Direto', () => {
  it('recolhido: sem tabela nem filtros; aberto: tabela com id do aria-controls', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    const { container } = renderPage();
    const toggle = await screen.findByRole('button', { name: 'Tesouro Direto' });
    expect(toggle).toHaveAttribute('aria-controls', 'treasury-table');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Todos' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(container.querySelector('#treasury-table table')).not.toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter((t) => ['Todos', 'IPCA', 'PREFIXADO', 'SELIC'].includes(t ?? '')))
      .toEqual(['Todos', 'IPCA', 'PREFIXADO', 'SELIC']);
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveClass('bg-blue-600');
    fireEvent.click(toggle);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('o chevron (oculto da leitura) também alterna o painel', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    const { container } = renderPage();
    const toggle = await screen.findByRole('button', { name: 'Tesouro Direto' });
    const chevron = container.querySelector('button[aria-hidden="true"]');
    if (!chevron) throw new Error('chevron ausente');
    expect(chevron).toHaveAttribute('tabindex', '-1');
    fireEvent.click(chevron);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(chevron);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('cada filtro: IPCA, PREFIXADO e SELIC; botão ativo destacado', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    await openTreasury();
    fireEvent.click(screen.getByRole('button', { name: 'IPCA' }));
    expect(titlesInOrder()).toEqual(['Tesouro IPCA+ 2035']);
    expect(screen.getByRole('button', { name: 'IPCA' })).toHaveClass('bg-blue-600');
    expect(screen.getByRole('button', { name: 'Todos' })).not.toHaveClass('bg-blue-600');
    fireEvent.click(screen.getByRole('button', { name: 'PREFIXADO' }));
    expect(titlesInOrder()).toEqual(['Tesouro Prefixado 2029']);
    fireEvent.click(screen.getByRole('button', { name: 'SELIC' }));
    expect(titlesInOrder()).toEqual(['Tesouro Selic 2031']);
  });

  it('filtro sem títulos da família mostra base sincronizando', async () => {
    mockedMacro.mockResolvedValue({ ...MACRO, bonds: [BONDS[0]] });
    renderPage();
    await openTreasury();
    fireEvent.click(screen.getByRole('button', { name: 'SELIC' }));
    expect(screen.getByText('Base de dados sincronizando...')).toBeInTheDocument();
  });

  it('linhas: taxa com índice (pré sem índice), PU e mínimo em reais, vencimento e estilo por tipo', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    await openTreasury();
    const rowOf = (title: string) => {
      const row = screen.getByText(title).closest('tr');
      if (!row) throw new Error(title);
      return within(row);
    };
    const selic = rowOf('Tesouro Selic 2031');
    expect(selic.getByText('SELIC + 0.07%')).toBeInTheDocument();
    expect(selic.getByText('R$ 16.000,00')).toBeInTheDocument();
    expect(selic.getByText('R$ 160,00')).toBeInTheDocument();
    expect(selic.getByText('2031-03-01')).toBeInTheDocument();
    expect(selic.getByText('SELIC')).toHaveClass('text-blue-400');
    expect(rowOf('Tesouro Prefixado 2029').getByText('13.90%')).toBeInTheDocument();
    expect(rowOf('Tesouro Prefixado 2029').getByText('PREFIXADO')).toHaveClass('text-emerald-400');
    expect(rowOf('Tesouro IPCA+ 2035').getByText('IPCA', { selector: 'span' })).toHaveClass('text-purple-400');
    expect(rowOf('Tesouro RendA+ 2050').getByText('RENDAMAIS')).toHaveClass('text-amber-400');
    expect(rowOf('Tesouro Educa+ 2040').getByText('EDUCA')).toHaveClass('text-pink-400');
    expect(rowOf('Tesouro Outro 2060').getByText('OUTRO')).toHaveClass('bg-slate-800', 'text-slate-400');
  });

  it('ordenação: título asc/desc, PU, mínimo e vencimento; coluna ativa destacada', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    const { container } = renderPage();
    await openTreasury();
    const activeArrows = () => container.querySelectorAll('th svg.text-blue-500').length;
    expect(activeArrows()).toBe(1);

    fireEvent.click(screen.getByText('Título Público'));
    expect(titlesInOrder()[0]).toBe('Tesouro Educa+ 2040');
    fireEvent.click(screen.getByText('Título Público'));
    expect(titlesInOrder()[0]).toBe('Tesouro Selic 2031');
    // Terceiro clique volta para ascendente.
    fireEvent.click(screen.getByText('Título Público'));
    expect(titlesInOrder()[0]).toBe('Tesouro Educa+ 2040');

    fireEvent.click(screen.getByText('Preço Unitário'));
    expect(titlesInOrder()[0]).toBe('Tesouro Prefixado 2029');
    fireEvent.click(screen.getByText('Investimento Mín.'));
    expect(titlesInOrder()[0]).toBe('Tesouro Prefixado 2029');
    fireEvent.click(screen.getByText('Investimento Mín.'));
    expect(titlesInOrder()[0]).toBe('Tesouro Selic 2031');
    fireEvent.click(screen.getByText('Vencimento'));
    expect(titlesInOrder()).toEqual([
      'Tesouro Prefixado 2029', 'Tesouro Selic 2031', 'Tesouro IPCA+ 2035', 'Tesouro Educa+ 2040', 'Tesouro RendA+ 2050', 'Tesouro Outro 2060',
    ]);
    fireEvent.click(screen.getByText('Tipo'));
    expect(titlesInOrder()[0]).toBe('Tesouro Educa+ 2040');
    expect(activeArrows()).toBe(1);
  });
});

describe('CDBs e cofrinhos', () => {
  it('recolhido por padrão; espaço abre, tecla qualquer não; lista os 10 produtos', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    const toggle = await screen.findByRole('button', { name: /CDBs, Caixinhas/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sofisa Direto')).not.toBeInTheDocument();
    fireEvent.keyDown(toggle, { key: 'a' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const table = within(screen.getByRole('table'));
    expect(table.getAllByRole('row')).toHaveLength(11);
    expect(table.getByText('Imediata (Max 5k)')).toBeInTheDocument();
    expect(table.getAllByText('R$ 1,00')).toHaveLength(9);
    expect(table.getAllByText('110% do CDI')).toHaveLength(2);
  });

  it('tecla vinda de elemento interno não alterna', async () => {
    mockedMacro.mockResolvedValue(MACRO);
    renderPage();
    const toggle = await screen.findByRole('button', { name: /CDBs, Caixinhas/ });
    fireEvent.keyDown(screen.getByText('CDBs, Caixinhas & Cofrinhos'), { key: 'Enter' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
