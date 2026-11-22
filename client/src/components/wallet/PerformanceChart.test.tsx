/**
 * Testes do PerformanceChart (Performance Comparativa da Carteira).
 *
 * O recharts é trocado por dublês que expõem o que o componente entrega a ele
 * (séries, ticks e formatadores): o gráfico real precisa de layout que o jsdom
 * não tem. Cobre carregando/erro/vazio, ordenação por data de calendário,
 * reconciliação do último ponto com os KPIs ao vivo, recortes de período,
 * visão em R$ (com privacidade), Ibovespa opcional e o modo demo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { axe } from 'jest-axe';
import { PerformanceChart } from './PerformanceChart';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));

type Fmt = (v: unknown, n?: string) => unknown;
vi.mock('recharts', async () => {
  const R = await import('react');
  const el = R.createElement;
  return {
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => el('div', null, children),
    AreaChart: ({ children, data }: { children?: React.ReactNode; data?: Array<Record<string, unknown>> }) =>
      el('div', { 'data-testid': 'chart', 'data-points': JSON.stringify(data ?? []) }, children),
    Area: ({ dataKey }: { dataKey: string }) => el('span', { 'data-testid': 'area' }, dataKey),
    XAxis: ({ ticks, tickFormatter }: { ticks?: string[]; tickFormatter: Fmt }) =>
      el('div', { 'data-testid': 'x-ticks' }, (ticks ?? []).map((t) => String(tickFormatter(t))).join('|')),
    YAxis: ({ tickFormatter }: { tickFormatter: Fmt }) => el('div', { 'data-testid': 'y-tick' }, String(tickFormatter(12000))),
    Tooltip: ({ formatter, labelFormatter }: { formatter: Fmt; labelFormatter: Fmt }) =>
      el('div', { 'data-testid': 'tooltip' }, `${JSON.stringify(formatter(1234.5, 'walletBRL'))} ${String(labelFormatter('2026-11-10'))}`),
    CartesianGrid: () => null,
  };
});

type Wallet = ReturnType<typeof useWallet>;
const getPerformance = vi.fn();

const point = (date: string, wallet: number, cdi: number, extra: Record<string, number> = {}) => ({
  date, wallet, walletRoi: wallet, cdi, ibov: 1, ipca: 2, equity: 10000, cdiValue: 9000, ipcaValue: 9500, ibovValue: 8000, ...extra,
});

const HISTORY = [
  point('2026-11-10', 9, 4),
  point('2025-06-01', 1, 1),
  point('2026-01-05', 3, 2),
  point('2026-10-20', 7, 3),
];

function mockWallet(over: Record<string, unknown> = {}) {
  vi.mocked(useWallet).mockReturnValue({
    kpis: { totalEquity: 0 },
    activeWalletId: 'w1',
    isWalletScopeReady: true,
    isPrivacyMode: false,
    dataSource: { getPerformance },
    ...over,
  } as unknown as Wallet);
}

const points = () => JSON.parse(screen.getByTestId('chart').getAttribute('data-points') ?? '[]') as Array<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 15, 12));
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: false } as unknown as ReturnType<typeof useDemo>);
  mockWallet();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('carregamento', () => {
  it('mostra o estado carregando e depois os dados ordenados por data', async () => {
    getPerformance.mockResolvedValue({ history: [...HISTORY] });
    render(<PerformanceChart />);
    expect(screen.getByText('Calculando rentabilidade relativa...')).toBeInTheDocument();

    expect(await screen.findByText('Performance Comparativa')).toBeInTheDocument();
    expect(points().map((p) => p.date)).toEqual(['2025-06-01', '2026-01-05', '2026-10-20', '2026-11-10']);
    expect(screen.getByTestId('y-tick')).toHaveTextContent('12000%');
  });

  it('sem histórico mostra "Dados insuficientes"', async () => {
    getPerformance.mockResolvedValue({ history: [] });
    render(<PerformanceChart />);
    expect(await screen.findByText('Dados insuficientes para comparação histórica.')).toBeInTheDocument();
  });

  it('falha da API cai no estado vazio sem quebrar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getPerformance.mockRejectedValue(new Error('offline'));
    render(<PerformanceChart />);
    expect(await screen.findByText('Dados insuficientes para comparação histórica.')).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('não busca enquanto o escopo da carteira não está pronto', () => {
    mockWallet({ isWalletScopeReady: false });
    render(<PerformanceChart />);
    expect(getPerformance).not.toHaveBeenCalled();
  });
});

describe('com dados', () => {
  beforeEach(() => {
    getPerformance.mockResolvedValue({ history: [...HISTORY] });
  });

  it('reconcilia o último ponto com os KPIs ao vivo', async () => {
    mockWallet({ kpis: { totalEquity: 15000, weightedRentability: 11.5, totalResultPercent: 20 } });
    render(<PerformanceChart />);
    await screen.findByText('Performance Comparativa');
    const last = points()[3];
    expect(last).toMatchObject({ equity: 15000, wallet: 11.5, walletRoi: 20 });
    expect(screen.getByText('Superando o Mercado 🚀')).toBeInTheDocument();
  });

  it('recortes de período mantêm o ponto-âncora anterior ao corte', async () => {
    render(<PerformanceChart />);
    await screen.findByText('Performance Comparativa');

    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
    // Corte = 01/11: primeiro ponto no mês é 10/11; entra também 20/10 como âncora.
    expect(points().map((p) => p.date)).toEqual(['2026-10-20', '2026-11-10']);
    expect(screen.getByTestId('x-ticks').textContent).toBe('20 de out|10 de nov');

    fireEvent.click(screen.getByRole('button', { name: 'YTD' }));
    expect(points().map((p) => p.date)).toEqual(['2025-06-01', '2026-01-05', '2026-10-20', '2026-11-10']);

    fireEvent.click(screen.getByRole('button', { name: '12M' }));
    expect(points()).toHaveLength(4);
    expect(screen.getByTestId('x-ticks').textContent).toMatch(/jun\/25/);
  });

  it('visão em R$ troca as séries e formata moeda', async () => {
    render(<PerformanceChart />);
    await screen.findByText('Performance Comparativa');
    fireEvent.click(screen.getByRole('button', { name: 'R$' }));

    expect(screen.getByText('Evolução do patrimônio em R$ vs benchmarks')).toBeInTheDocument();
    expect(screen.getAllByTestId('area').map((a) => a.textContent)).toEqual(['ipcaBRL', 'cdiBRL', 'walletBRL']);
    expect(points()[0]).toMatchObject({ walletBRL: 10000, cdiBRL: 9000 });
    expect(screen.getByTestId('y-tick')).toHaveTextContent('R$12k');
    expect(screen.getByTestId('tooltip').textContent).toContain('Minha Carteira');
    expect(screen.getByTestId('tooltip').textContent).toContain('10/11/2026');
  });

  it('em privacidade o eixo em R$ é mascarado', async () => {
    mockWallet({ isPrivacyMode: true });
    render(<PerformanceChart />);
    await screen.findByText('Performance Comparativa');
    fireEvent.click(screen.getByRole('button', { name: 'R$' }));
    expect(screen.getByTestId('y-tick')).not.toHaveTextContent('R$12k');
  });

  it('Ibovespa entra e sai do gráfico pelo botão', async () => {
    const { container } = render(<PerformanceChart />);
    await screen.findByText('Performance Comparativa');
    const toggle = screen.getByRole('button', { name: 'Exibir Ibovespa' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ocultar Ibovespa' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('area').map((a) => a.textContent)).toContain('ibov');
    expect(screen.getByRole('img', { name: /CDI, IPCA e Ibovespa/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('modo demo', () => {
  it('usa os dados de demonstração sem chamar a API', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 15, 12));
    vi.mocked(useDemo).mockReturnValue({ isDemoMode: true } as unknown as ReturnType<typeof useDemo>);
    render(<PerformanceChart />);
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByText('Performance Comparativa')).toBeInTheDocument();
    expect(points().length).toBeGreaterThan(3);
    expect(getPerformance).not.toHaveBeenCalled();
  });
});
