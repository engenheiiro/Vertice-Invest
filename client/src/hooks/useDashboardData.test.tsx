import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDashboardData } from './useDashboardData';
import { useWallet, type Asset } from '../contexts/WalletContext';
import { useAuth } from '../contexts/AuthContext';
import { useDemo } from '../contexts/DemoContext';
import { researchService } from '../services/research';
import { walletService } from '../services/wallet';
import { authService } from '../services/auth';

/**
 * Painel: proventos só para quem tem plano (e nunca os REAIS no tour demo),
 * índices ausentes chegam ausentes (nunca 0), saúde do sistema acusa câmbio
 * velho, sinais são rotulados pelo acesso decidido no backend e a carteira é
 * enriquecida com o score do research.
 */

vi.mock('../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../services/research', () => ({ researchService: { getMacroData: vi.fn(), getLatest: vi.fn() } }));
vi.mock('../services/wallet', () => ({ walletService: { getDividends: vi.fn() } }));
vi.mock('../services/auth', () => ({ authService: { api: vi.fn() } }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOW = new Date('2026-11-20T15:00:00Z');

const asset = (ticker: string, extra: Partial<Asset> = {}) => ({
  ticker, name: '', quantity: 10, averagePrice: 20, currentPrice: 25, totalValue: 250, totalCost: 200, type: 'STOCK', ...extra,
});

type WalletState = ReturnType<typeof useWallet>;
type AuthState = ReturnType<typeof useAuth>;
type DemoState = ReturnType<typeof useDemo>;

const setWallet = (assets: ReturnType<typeof asset>[] = []) => vi.mocked(useWallet).mockReturnValue({
  assets,
  kpis: { totalEquity: 10000, dayVariation: 120, dayVariationPercent: 1.234 },
  isLoading: false,
  activeWalletId: 'w-1',
  isWalletScopeReady: true,
} as unknown as WalletState);

const setUser = (plan: string, role = 'USER') =>
  vi.mocked(useAuth).mockReturnValue({ user: { plan, role } } as unknown as AuthState);

const setDemo = (isDemoMode: boolean) => vi.mocked(useDemo).mockReturnValue({ isDemoMode } as unknown as DemoState);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

const DIVIDENDS = { provisioned: [{ amount: 12.5 }, { amount: 7.5 }, {}], goal: { target: 500, current: 20, progressPercent: 4 } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(researchService.getMacroData).mockResolvedValue({ lastUpdated: NOW.toISOString() });
  vi.mocked(researchService.getLatest).mockResolvedValue(null);
  vi.mocked(walletService.getDividends).mockResolvedValue(DIVIDENDS);
  vi.mocked(authService.api).mockImplementation(async () => json({ signals: [], meta: null }));
  setWallet();
  setUser('ESSENTIAL');
  setDemo(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useDashboardData — proventos e modo demo', () => {
  it('ESSENTIAL vê a soma dos provisionados e a meta da carteira ativa', async () => {
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.dividends).toBe(20));
    expect(walletService.getDividends).toHaveBeenCalledWith('w-1');
    expect(result.current.dividendGoal).toEqual(DIVIDENDS.goal);
  });

  it('GUEST não busca proventos (evita 403 a cada carregamento)', async () => {
    setUser('GUEST');
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(walletService.getDividends).not.toHaveBeenCalled();
    expect(result.current.dividends).toBe(0);
  });

  it('ADMIN com plano GUEST ainda vê proventos', async () => {
    setUser('GUEST', 'ADMIN');
    renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(walletService.getDividends).toHaveBeenCalled());
  });

  it('no tour demo não busca e ignora o CACHE real da mesma chave', async () => {
    setDemo(true);
    client.setQueryData(['dividends', 'w-1'], DIVIDENDS);

    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(walletService.getDividends).not.toHaveBeenCalled();
    expect(result.current.dividends).toBe(0);
    expect(result.current.dividendGoal).toBeNull();
  });
});

describe('useDashboardData — índices e saúde do sistema', () => {
  it('valor ausente chega null (não 0) e o BTC leva o "$"', async () => {
    vi.mocked(researchService.getMacroData).mockResolvedValue({
      lastUpdated: NOW.toISOString(), ibov: { value: 130000, change: 0.8 }, cdi: { value: 0 }, btc: { value: 90000, change: -1 },
    });
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.marketIndices).toHaveLength(5));

    const byTicker = Object.fromEntries(result.current.marketIndices.map((m) => [m.ticker, m]));
    expect(byTicker.IBOV).toMatchObject({ value: 130000, changePercent: 0.8, type: 'INDEX' });
    expect(byTicker.CDI.value).toBe(0);
    expect(byTicker.USD.value).toBeNull();
    expect(byTicker['S&P'].value).toBeNull();
    expect(byTicker.BTC).toMatchObject({ value: 90000, prefix: '$', stale: false });
    expect(result.current.systemHealth).toMatchObject({ status: 'ONLINE', message: 'Sistemas Operacionais' });
  });

  it('macro com mais de 1h é STALE', async () => {
    vi.mocked(researchService.getMacroData).mockResolvedValue({ lastUpdated: '2026-11-20T13:30:00Z' });
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.systemHealth.status).toBe('STALE'));
    expect(result.current.systemHealth.message).toBe('Dados Desatualizados (>1h)');
  });

  it('câmbio preservado de sync anterior derruba o "operacional" e marca USD/BTC', async () => {
    vi.mocked(researchService.getMacroData).mockResolvedValue({ lastUpdated: NOW.toISOString(), currenciesStale: true, usd: { value: 5.4 } });
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.systemHealth.status).toBe('STALE'));
    expect(result.current.systemHealth.message).toBe('Câmbio desatualizado (USD/BTC)');
    const usd = result.current.marketIndices.find((m) => m.ticker === 'USD');
    expect(usd?.stale).toBe(true);
  });

  it('falha do macro é OFFLINE', async () => {
    vi.mocked(researchService.getMacroData).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.systemHealth.message).toBe('Falha na conexão'));
    expect(result.current.systemHealth.status).toBe('OFFLINE');
    expect(result.current.marketIndices).toEqual([]);
  });

  it('alpha do dia = variação da carteira menos a do Ibovespa', async () => {
    vi.mocked(researchService.getMacroData).mockResolvedValue({ lastUpdated: NOW.toISOString(), ibov: { value: 1, change: 0.5 } });
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.equity.alpha).toBe(0.73));
    expect(result.current.equity).toEqual({ total: 10000, dayChange: 120, dayPercent: 1.23, alpha: 0.73 });
  });
});

describe('useDashboardData — sinais', () => {
  const signal = (extra: Record<string, unknown>) => ({
    _id: 's', ticker: 'X', assetType: 'STOCK', riskProfile: 'BOLD', type: 'VOLUME_SPIKE', value: 2, message: 'm',
    timestamp: '2026-11-20T14:00:00Z', ...extra,
  });

  it('score e impacto por tipo/qualidade', async () => {
    vi.mocked(authService.api).mockImplementation(async () => json({
      access: { tier: 'REALTIME', delayMinutes: null },
      meta: { lastScanAt: null },
      signals: [
        signal({ _id: 'rsi', type: 'RSI_OVERSOLD', value: 22.4, quality: 'GOLD' }),
        signal({ _id: 'div', type: 'BULLISH_DIVERGENCE', value: 30, quality: 'SILVER' }),
        signal({ _id: 'deep', type: 'DEEP_VALUE', value: 1, urgencyLevel: 'HIGH', quality: 'SILVER' }),
        signal({ _id: 'sup', type: 'SUPPORT_ZONE', value: 1, urgencyLevel: 'CRITICAL', riskProfile: undefined, assetType: '' }),
        signal({ _id: 'vol', quality: 'SILVER' }),
        signal({ _id: 'neg', type: 'RSI_OVERSOLD', value: 140 }),
      ],
    }));
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.signals).toHaveLength(6));

    const byId = Object.fromEntries(result.current.signals.map((s) => [s.id, s]));
    expect(byId.rsi).toMatchObject({ score: 78, impact: 'HIGH', urgencyLevel: 'HIGH', type: 'OPPORTUNITY', source: 'ALGO' });
    expect(byId.div).toMatchObject({ score: 60, impact: 'MEDIUM', urgencyLevel: 'MEDIUM', quality: 'SILVER' });
    expect(byId.deep).toMatchObject({ score: 85, impact: 'HIGH', urgencyLevel: 'HIGH' });
    expect(byId.sup).toMatchObject({ score: 80, impact: 'HIGH', riskProfile: 'MODERATE', assetType: 'STOCK', quality: 'GOLD' });
    expect(byId.vol).toMatchObject({ score: 65, impact: 'MEDIUM' });
    // RSI acima de 100 (dado ruim) não produz score negativo.
    expect(byId.neg.score).toBe(0);
    expect(result.current.radarMeta).toEqual({ lastScanAt: null });
    expect(result.current.signalAccess.tier).toBe('REALTIME');
  });

  it('acesso DELAYED rotula todos os sinais como DELAYED', async () => {
    vi.mocked(authService.api).mockImplementation(async () => json({
      access: { tier: 'DELAYED', delayMinutes: 60 }, signals: [signal({})],
    }));
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.signals).toHaveLength(1));
    expect(result.current.signals[0].type).toBe('DELAYED');
    expect(result.current.signalAccess).toEqual({ tier: 'DELAYED', delayMinutes: 60 });
  });

  it('falha dos sinais vira lista vazia e acesso NONE', async () => {
    vi.mocked(authService.api).mockImplementation(async () => json({ message: 'x' }, 500));
    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(authService.api).toHaveBeenCalledWith('/api/research/signals'));
    expect(result.current.signals).toEqual([]);
    expect(result.current.radarMeta).toBeNull();
    expect(result.current.signalAccess).toEqual({ tier: 'NONE', delayMinutes: null });
  });
});

describe('useDashboardData — carteira enriquecida pelo research', () => {
  it('casa ticker sem ".SA" e em qualquer caixa; um relatório que falha não derruba os outros', async () => {
    setWallet([asset(' petr4 '), asset('HGLG11', { type: 'FII', name: 'CSHG Log' }), asset('MGLU3'), asset('NOVO3')]);
    vi.mocked(researchService.getLatest).mockImplementation(async (assetClass: string) => {
      if (assetClass === 'STOCK') {
        return { content: { ranking: [{ ticker: 'PETR4.SA', score: 82, action: 'BUY' }, { ticker: 'MGLU3', score: 20, action: 'SELL' }] } };
      }
      if (assetClass === 'FII') throw new Error('timeout');
      return { content: { ranking: [{ ticker: 'hglg11', score: 64, action: 'WAIT' }] } };
    });

    const { result } = renderHook(() => useDashboardData(), { wrapper });
    await waitFor(() => expect(result.current.isResearchLoading).toBe(false));

    const byTicker = Object.fromEntries(result.current.portfolio.map((p) => [p.ticker.trim(), p]));
    expect(byTicker.petr4).toMatchObject({ aiScore: 82, aiSentiment: 'BULLISH', name: ' petr4 ' });
    expect(byTicker.HGLG11).toMatchObject({ aiScore: 64, aiSentiment: 'NEUTRAL', name: 'CSHG Log', type: 'FII' });
    expect(byTicker.MGLU3).toMatchObject({ aiScore: 20, aiSentiment: 'BEARISH' });
    expect(byTicker.NOVO3).toMatchObject({ aiScore: 0, aiSentiment: 'NEUTRAL' });
    expect(byTicker.NOVO3).toMatchObject({ shares: 10, avgPrice: 20, currentPrice: 25, totalValue: 250, totalCost: 200 });
  });
});
