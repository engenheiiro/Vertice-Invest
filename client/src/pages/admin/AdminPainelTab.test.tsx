/**
 * Aba "Painel" do Admin: cartões de qualidade, curva de backtest e macro.
 *
 * Teste de caracterização escrito antes de a lógica derivada sair do componente
 * (`adminPainelView.ts`): trava a frase do card de snapshot (anomalia só com
 * `errors`, nunca com carteira vazia), o alerta de séries defasadas, o botão de
 * reativar a blacklist, os seletores do backtest e o "—" de cotação ausente.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminPainelTab, type MacroData } from './AdminPainelTab';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
// O gráfico real precisa de ResizeObserver e mede 0px no jsdom; aqui basta saber QUAIS séries entram.
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Nil = () => null;
  return {
    ResponsiveContainer: Pass, AreaChart: Pass, XAxis: Nil, YAxis: Nil, Tooltip: Nil, CartesianGrid: Nil, Legend: Nil,
    Area: ({ name }: { name: string }) => <span>série {name}</span>,
  };
});

const handlers = {
  setAccuracyWindow: vi.fn(), setAccuracyAsset: vi.fn(), setAccuracyProfile: vi.fn(),
  onResetHealth: vi.fn(), onForceSnapshot: vi.fn(), onSyncTimeSeries: vi.fn(),
  onMacroSync: vi.fn(), onSyncData: vi.fn(), onRetryMacro: vi.fn(),
};

const MACRO: MacroData = {
  selic: { value: 15 }, cdi: { value: 14.9 }, ipca: { value: 4.5 },
  ibov: { value: 128456.7, change: 1.23 }, usd: { value: 0, change: 0 },
  spx: { value: 5800.2, change: -0.5 }, btc: { value: 95000, change: 0 },
};

type Props = React.ComponentProps<typeof AdminPainelTab>;
const renderTab = (over: Partial<Props> = {}) => render(
  <AdminPainelTab
    qualityStats={null}
    accuracyData={[]}
    accuracyWindow={30}
    accuracyAsset="STOCK"
    accuracyProfile="DEFENSIVE"
    macroData={null}
    isLoadingMacro={false}
    isMacroSyncing={false}
    isSyncing={false}
    isGlobalRunning={false}
    isResettingHealth={false}
    isSnapshotRunning={false}
    isSyncingTimeSeries={false}
    {...handlers}
    {...over}
  />,
);

const stats = (over: Record<string, unknown> = {}) => ({
  assetsProcessed: 812, typosFixed: 7, blacklistedAssets: 0,
  snapshotStats: { created: 40, errors: 0, empty: 0, exists: 0 },
  timeSeriesAgeHours: 5.25, timeSeriesTracked: 0, timeSeriesOrphans: 0,
  ...over,
});

beforeEach(() => Object.values(handlers).forEach((f) => f.mockReset()));

describe('AdminPainelTab — cartões de qualidade', () => {
  it('sem estatísticas ainda: esqueleto e reticências', () => {
    renderTab();
    expect(screen.getAllByText('...')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Reativar/ })).not.toBeInTheDocument();
  });

  it('com estatísticas: números, série saudável e sem anomalias', () => {
    renderTab({ qualityStats: stats() });
    expect(screen.getByText('812')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('5.3')).toBeInTheDocument();
    expect(screen.getByText('Saudável')).toBeInTheDocument();
    expect(screen.getByText('Sem anomalias')).toBeInTheDocument();
  });

  it('carteira vazia e dia já fotografado viram frase neutra, não alarme', () => {
    renderTab({ qualityStats: stats({ snapshotStats: { created: 3, errors: 0, empty: 1, exists: 2 } }) });
    const note = screen.getByText('Sem anomalias · 1 carteira sem ativos · 2 já do dia');
    expect(note.className).toContain('text-emerald-500');
  });

  it('plural das carteiras vazias', () => {
    renderTab({ qualityStats: stats({ snapshotStats: { created: 3, errors: 0, empty: 4, exists: 0 } }) });
    expect(screen.getByText('Sem anomalias · 4 carteiras sem ativos')).toBeInTheDocument();
  });

  it('anomalia de verdade acende o laranja', () => {
    renderTab({ qualityStats: stats({ snapshotStats: { created: 3, errors: 1, empty: 5, exists: 0 } }) });
    const note = screen.getByText('1 anomalia — snapshot abortado');
    expect(note.className).toContain('text-orange-500');
    renderTab({ qualityStats: stats({ snapshotStats: { created: 3, errors: 2 } }) });
    expect(screen.getByText('2 anomalias — snapshot abortado')).toBeInTheDocument();
  });

  it('série defasada (> 48h) alerta e mostra a coorte', () => {
    renderTab({ qualityStats: stats({ timeSeriesAgeHours: 50, timeSeriesTracked: 900, timeSeriesOrphans: 12 }) });
    expect(screen.getByText('ALERTA: Defasado')).toBeInTheDocument();
    expect(screen.getByText(/900 séries/)).toBeInTheDocument();
    expect(screen.getByText(/12 fora da coorte/)).toBeInTheDocument();
  });

  it('idade zero aparece como 0', () => {
    renderTab({ qualityStats: stats({ timeSeriesAgeHours: 0 }) });
    const card = screen.getByText('Séries Temporais').parentElement as HTMLElement;
    expect(card.querySelector('h3')?.textContent).toBe('0');
  });

  it('blacklist com ativos oferece reativar; os botões chamam as ações', () => {
    renderTab({ qualityStats: stats({ blacklistedAssets: 3 }) });
    fireEvent.click(screen.getByRole('button', { name: /Reativar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Forçar/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Sync$/ }));
    expect(handlers.onResetHealth).toHaveBeenCalledOnce();
    expect(handlers.onForceSnapshot).toHaveBeenCalledOnce();
    expect(handlers.onSyncTimeSeries).toHaveBeenCalledOnce();
  });
});

describe('AdminPainelTab — backtest', () => {
  it('sem curva explica como ela nasce', () => {
    renderTab();
    expect(screen.getByText(/Sem curva para esta classe/)).toBeInTheDocument();
  });

  it('classe com perfil mostra o seletor; janela e perfil chamam os setters', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Arrojado' }));
    expect(handlers.setAccuracyProfile).toHaveBeenCalledWith('BOLD');
    fireEvent.click(screen.getByRole('button', { name: '90D' }));
    expect(handlers.setAccuracyWindow).toHaveBeenCalledWith(90);
    expect(screen.getByRole('button', { name: 'Defensivo' }).className).toContain('text-emerald-400');
    expect(screen.getByRole('button', { name: '30D' }).className).toContain('bg-slate-700');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'FII' } });
    expect(handlers.setAccuracyAsset).toHaveBeenCalledWith('FII');
  });

  it('Brasil 10 é curva única, sem seletor de perfil', () => {
    renderTab({ accuracyAsset: 'BRASIL_10' });
    expect(screen.queryByRole('button', { name: 'Defensivo' })).not.toBeInTheDocument();
  });

  it('com curva, só entram os benchmarks que têm dado', () => {
    renderTab({ accuracyData: [{ formattedDate: '01/11', equityReturn: 1, ibovReturn: 0.5, cdiReturn: 0, ifixReturn: 0, spxReturn: 0, btcReturn: 0 }] });
    expect(screen.queryByText(/Sem curva para esta classe/)).not.toBeInTheDocument();
    expect(screen.getByText('série Carteira Recomendada')).toBeInTheDocument();
    expect(screen.getByText('série IBOV')).toBeInTheDocument();
    expect(screen.queryByText('série CDI')).not.toBeInTheDocument();
    expect(screen.queryByText('série BTC')).not.toBeInTheDocument();
  });
});

describe('AdminPainelTab — macro', () => {
  it('sem macro válido: aviso e tentar de novo', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar Novamente' }));
    expect(handlers.onRetryMacro).toHaveBeenCalledOnce();
  });

  it('carregando o macro não oferece tentar de novo', () => {
    renderTab({ isLoadingMacro: true });
    expect(screen.queryByRole('button', { name: 'Tentar Novamente' })).not.toBeInTheDocument();
  });

  it('cartões macro, com "—" para cotação ausente e variação com sinal', () => {
    renderTab({ macroData: MACRO });
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('14.90%')).toBeInTheDocument();
    expect(screen.getByText('4.5%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('1.23%').className).toContain('text-emerald-500');
    expect(screen.getByText('0.50%').className).toContain('text-red-500');
  });

  it('botões de sync mostram o estado de execução', () => {
    renderTab({ isMacroSyncing: true, isSyncing: true });
    expect(screen.getByRole('button', { name: /Atualizando/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Sincronizando/ })).toBeDisabled();
  });

  it('sync de preços fica travado durante o pipeline global', () => {
    renderTab({ isGlobalRunning: true });
    expect(screen.getByRole('button', { name: /Sync Preços/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Sync Macro/ }));
    expect(handlers.onMacroSync).toHaveBeenCalledOnce();
  });
});
