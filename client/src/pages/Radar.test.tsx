/**
 * Página do Radar Alfa: oportunidades ativas, taxa de acerto e histórico.
 *
 * O que os testes travam:
 *  - carregando → esqueleto e "Carregando histórico..."; sem sinal → estado vazio;
 *  - ativos ordenados por urgência (CRÍTICO antes de MÉDIO) e filtrados por classe;
 *  - histórico filtra por status (Hits/Stops/Expirados) e mostra o resultado com sinal;
 *  - taxa de acerto troca pela classe escolhida e cai em "—" sem base;
 *  - preço de cripto/Exterior sai em dólar, nunca em R$;
 *  - "última varredura" é contada a partir do relógio (fixo aqui).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { RadarPage } from './Radar';
import { researchService } from '../services/research';

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
vi.mock('../components/common/ScanStatus', () => ({
  ScanCountdown: () => <span>05:00</span>,
  FreshnessDot: () => null,
}));
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Nothing = () => null;
  return { PieChart: Box, Pie: Box, Cell: Nothing, Tooltip: Nothing, ResponsiveContainer: Box, Legend: Nothing };
});
vi.mock('../services/research', () => ({
  researchService: { getSignalsHistory: vi.fn(), getRadarStats: vi.fn() },
}));

const mockedHistory = vi.mocked(researchService.getSignalsHistory);
const mockedStats = vi.mocked(researchService.getRadarStats);

const signal = (over: Record<string, unknown>) => ({
  _id: String(over.ticker), assetType: 'STOCK', type: 'RSI_OVERSOLD', message: 'mensagem',
  timestamp: '2026-11-20T15:00:00Z', status: 'ACTIVE', ...over,
});

const SIGNALS = [
  signal({ ticker: 'PETR4', urgencyLevel: 'MEDIUM', value: 28, priceAtSignal: 30.5, sector: 'Petróleo', message: 'RSI baixo em PETR4' }),
  signal({ ticker: 'BTC', assetType: 'CRYPTO', urgencyLevel: 'CRITICAL', type: 'DEEP_VALUE', value: 12.3, priceAtSignal: 0.5, resultPercent: -1.2 }),
  signal({ ticker: 'HGLG11', assetType: 'FII', urgencyLevel: 'HIGH', type: 'SUPPORT_ZONE', resultPercent: 2.5, riskProfile: 'DEFENSIVE' }),
  signal({ ticker: 'VALE3', status: 'HIT', resultPercent: 3.6, priceAtSignal: 60, finalPrice: 62.16, urgencyLevel: 'HIGH' }),
  signal({ ticker: 'ITUB4', status: 'MISS', resultPercent: -3.5, type: 'VOLUME_SPIKE' }),
  signal({ ticker: 'AAPL', assetType: 'STOCK_US', status: 'NEUTRAL', resultPercent: 0, type: 'CUSTOM_SETUP', priceAtSignal: 200 }),
];

const STATS = {
  winRate: 62.5, totalSignals: 40, backtestHorizon: 21,
  byAssetType: {
    STOCK: { winRate: 70, totalSignals: 20 },
    FII: { winRate: 0, totalSignals: 0 },
    STOCK_US: { winRate: 55, totalSignals: 10 },
  },
  heatmapOpen: [{ sector: 'Energia', value: 3, avgReturn: 0 }],
  heatmapClosed: [],
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><RadarPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
  mockedHistory.mockReset();
  mockedStats.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const withData = () => {
  mockedHistory.mockResolvedValue({
    signals: SIGNALS,
    meta: {
      lastScanAt: '2026-11-22T11:45:00Z', nextScanAt: '2026-11-22T12:05:00Z', assetsScanned: 420,
      assetsWithHistory: 400, activeSignalsTotal: 3, scanIntervalMinutes: 15,
    },
  });
  mockedStats.mockResolvedValue(STATS);
};

describe('carregando e vazio', () => {
  it('enquanto as buscas não voltam, mostra o carregando do histórico', () => {
    mockedHistory.mockReturnValue(new Promise(() => {}));
    mockedStats.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Carregando histórico...')).toBeInTheDocument();
    expect(screen.getByText(/— ativos monitorados/)).toBeInTheDocument();
  });

  it('sem sinal nenhum: estado vazio, histórico vazio e taxa "—"', async () => {
    mockedHistory.mockResolvedValue({ signals: [], meta: null });
    mockedStats.mockResolvedValue({ ...STATS, winRate: 0, totalSignals: 0, heatmapOpen: [] });
    renderPage();
    expect(await screen.findByText('Nenhuma anomalia detectada no momento.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum registro encontrado.')).toBeInTheDocument();
    expect(screen.getByText('Sem dados suficientes para este filtro.')).toBeInTheDocument();
    expect(screen.getByText('0 sinais')).toBeInTheDocument();
    expect(screen.getByText('Base: 0 sinais')).toBeInTheDocument();
  });

  it('uma busca falhar não derruba a outra (stats sai, sinais ficam)', async () => {
    mockedHistory.mockResolvedValue({ signals: SIGNALS, meta: null });
    mockedStats.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('PETR4')).toBeInTheDocument();
    // Horizonte cai no padrão de 14 dias quando o stats não veio.
    expect(screen.getByText(/14 dias Time Stop/)).toBeInTheDocument();
  });
});

describe('com dados', () => {
  it('cabeçalho: ativos monitorados, horizonte e varredura contada pelo relógio', async () => {
    withData();
    renderPage();
    expect(await screen.findByText('há 15 min')).toBeInTheDocument();
    expect(screen.getByText(/420 ativos monitorados/)).toBeInTheDocument();
    expect(screen.getByText(/21 dias Time Stop/)).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('Base: 40 sinais')).toBeInTheDocument();
  });

  it('oportunidades ativas vêm ordenadas por urgência e contam só as ativas', async () => {
    withData();
    renderPage();
    expect(await screen.findByText('3 sinais')).toBeInTheDocument();
    const labels = screen.getAllByText(/^(CRÍTICO|ALTO|MÉDIO)$/).map((el) => el.textContent);
    // Os 3 primeiros são os cards ativos; o histórico vem depois.
    expect(labels.slice(0, 3)).toEqual(['CRÍTICO', 'ALTO', 'MÉDIO']);
    expect(screen.getByText('RSI 28')).toBeInTheDocument();
    expect(screen.getByText('Graham R$12.30')).toBeInTheDocument();
    expect(screen.getByText('Defensivo')).toBeInTheDocument();
    expect(screen.getByText('+2.50%')).toBeInTheDocument();
    expect(screen.getByText('-1.20%')).toBeInTheDocument();
  });

  it('cripto sai em dólar; ação BR em real', async () => {
    withData();
    renderPage();
    await screen.findByText('RSI baixo em PETR4');
    expect(screen.getByText(/entrada US\$/)).toBeInTheDocument();
    expect(screen.getByText(/entrada R\$/)).toBeInTheDocument();
  });

  it('filtro de classe deixa só os ativos daquela classe', async () => {
    withData();
    renderPage();
    await screen.findByText('3 sinais');
    fireEvent.click(screen.getAllByRole('button', { name: 'FIIs' })[1]);
    expect(screen.getByText('1 sinal')).toBeInTheDocument();
    expect(screen.queryByText('RSI baixo em PETR4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Renda Fixa' }));
    expect(screen.getByText('0 sinais')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma anomalia detectada no momento.')).toBeInTheDocument();
  });

  it('histórico filtra por status e mostra rótulo amigável do sinal', async () => {
    withData();
    const { container } = renderPage();
    await screen.findByText('VALE3');
    const table = within(screen.getByRole('table'));
    expect(table.getByText('VALE3')).toBeInTheDocument();
    expect(table.getByText('ITUB4')).toBeInTheDocument();
    expect(table.getByText('AAPL')).toBeInTheDocument();
    expect(table.getByText('Pico de Volume')).toBeInTheDocument();
    expect(table.getByText('CUSTOM SETUP')).toBeInTheDocument();
    expect(table.getByText('+3.60%')).toBeInTheDocument();
    expect(table.getByText('Alvo')).toBeInTheDocument();
    expect(table.getByText('Stop')).toBeInTheDocument();
    expect(table.getByText('Expirado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stops' }));
    expect(table.queryByText('VALE3')).not.toBeInTheDocument();
    expect(table.getByText('ITUB4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hits' }));
    expect(table.getByText('VALE3')).toBeInTheDocument();
    expect(table.queryByText('ITUB4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expirados' }));
    expect(table.getByText('AAPL')).toBeInTheDocument();
    expect(table.getByText('Exterior')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tudo' }));
    expect(table.getByText('VALE3')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('taxa de acerto por classe: Ações BR 70%, FII sem base "—"', async () => {
    withData();
    renderPage();
    await screen.findByText('62.5%');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ações BR' })[0]);
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('Base: 20 sinais')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'FIIs' })[0]);
    expect(screen.getByText('Base: 0 sinais')).toBeInTheDocument();
  });

  it('concentração setorial: aberto tem dado, fechado mostra o vazio', async () => {
    withData();
    renderPage();
    await screen.findByText('62.5%');
    expect(screen.queryByText('Sem dados suficientes para este filtro.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechados' }));
    expect(screen.getByText('Sem dados suficientes para este filtro.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Em Aberto' }));
    expect(screen.queryByText('Sem dados suficientes para este filtro.')).not.toBeInTheDocument();
  });

  it('varredura no mesmo minuto aparece como "agora"', async () => {
    mockedHistory.mockResolvedValue({
      signals: [],
      meta: { lastScanAt: '2026-11-22T11:59:40Z', nextScanAt: null, assetsScanned: 1, assetsWithHistory: 1, activeSignalsTotal: 0, scanIntervalMinutes: 15 },
    });
    mockedStats.mockResolvedValue(STATS);
    renderPage();
    expect(await screen.findByText('agora')).toBeInTheDocument();
  });
});
