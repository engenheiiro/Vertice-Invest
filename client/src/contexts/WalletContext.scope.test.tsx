import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WalletProvider, useWallet, DEFAULT_WALLET_TARGETS, deriveWalletTargets, toUsdRate } from './WalletContext';
import { walletService } from '../services/wallet';
import { walletsService } from '../services/wallets';

// Modo demo desligado — aqui interessa o caminho real de resolução da carteira ativa.
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('./DemoContext', () => ({ useDemo: () => ({ isDemoMode: false }) }));
vi.mock('./ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../services/wallets', () => ({ walletsService: { list: vi.fn(), setActive: vi.fn() } }));
vi.mock('../services/wallet', () => ({
  walletService: { getWallet: vi.fn(), getHistory: vi.fn(), updateTargets: vi.fn() },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WalletProvider>{children}</WalletProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(walletService.getWallet).mockResolvedValue({ assets: [], kpis: {} });
  vi.mocked(walletService.getHistory).mockResolvedValue([]);
});

describe('WalletContext — escopo de carteira', () => {
  it('busca UMA vez, já com a carteira ativa (sem chamada prévia sem escopo)', async () => {
    vi.mocked(walletsService.list).mockResolvedValue({
      wallets: [{ id: 'w-1', name: 'Principal', isDefault: true, createdAt: '2026-01-01' }],
      activeWalletId: 'w-1',
    } as any);

    const { result } = renderHook(() => useWallet(), { wrapper });

    // Enquanto GET /wallets não responde, nada escopado por carteira pode sair.
    expect(walletService.getWallet).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.activeWalletId).toBe('w-1'));
    await waitFor(() => expect(walletService.getWallet).toHaveBeenCalledTimes(1));

    expect(walletService.getWallet).toHaveBeenCalledWith('w-1');
    expect(walletService.getHistory).toHaveBeenCalledTimes(1);
    expect(walletService.getHistory).toHaveBeenCalledWith('w-1');
  });

  it('não trava a carteira se GET /wallets falhar — segue sem id e o servidor resolve', async () => {
    vi.mocked(walletsService.list).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.isWalletScopeReady).toBe(true));
    await waitFor(() => expect(walletService.getWallet).toHaveBeenCalledTimes(1));
    expect(walletService.getWallet).toHaveBeenCalledWith(undefined);
  });
});

describe('WalletContext — Carteira Ideal derivada da carteira ativa', () => {
  const twoWallets = {
    wallets: [
      { id: 'w-a', name: 'A', isDefault: true, createdAt: '2026-01-01' },
      { id: 'w-b', name: 'B', isDefault: false, createdAt: '2026-01-02' },
    ],
    activeWalletId: 'w-a',
  };

  it('trocar de A (com metas) para B (sem metas) mostra o padrão, não as metas de A', async () => {
    vi.mocked(walletsService.list).mockResolvedValue(twoWallets as any);
    vi.mocked(walletsService.setActive).mockResolvedValue({} as any);
    vi.mocked(walletService.getWallet).mockImplementation(async (id?: string) => (id === 'w-a'
      ? { assets: [], kpis: {}, targetAllocation: { STOCK: 70, FII: 30 }, targetReserve: 5000, targetMonthlyDividendIncome: 800 }
      : { assets: [], kpis: {} }) as any);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.targetReserve).toBe(5000));
    expect(result.current.targetAllocation).toMatchObject({ STOCK: 70, FII: 30 });
    expect(result.current.targetMonthlyDividendIncome).toBe(800);

    await act(async () => { await result.current.setActiveWallet('w-b'); });

    await waitFor(() => expect(result.current.activeWalletId).toBe('w-b'));
    await waitFor(() => expect(walletService.getWallet).toHaveBeenCalledWith('w-b'));
    await waitFor(() => expect(result.current.targetReserve).toBe(DEFAULT_WALLET_TARGETS.targetReserve));
    expect(result.current.targetAllocation).toEqual(DEFAULT_WALLET_TARGETS.targetAllocation);
    expect(result.current.targetMonthlyDividendIncome).toBe(0);
  });

  it('updateTargets reflete na hora e volta ao valor anterior se a gravação falhar', async () => {
    vi.mocked(walletsService.list).mockResolvedValue(twoWallets as any);
    vi.mocked(walletService.getWallet).mockResolvedValue({ assets: [], kpis: {}, targetReserve: 5000, targetAllocation: { STOCK: 100 } } as any);
    let fail: (e: Error) => void = () => {};
    vi.mocked(walletService.updateTargets).mockReturnValue(new Promise((_, reject) => { fail = reject; }) as any);

    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.targetReserve).toBe(5000));

    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.updateTargets({ STOCK: 50, FII: 50 }, 9000) as unknown as Promise<void>; });
    await waitFor(() => expect(result.current.targetReserve).toBe(9000));
    await act(async () => { fail(new Error('offline')); await pending; });
    // O cache notifica os observadores em lote (fora do act), daí o waitFor.
    await waitFor(() => expect(result.current.targetReserve).toBe(5000));
    expect(result.current.targetAllocation).toMatchObject({ STOCK: 100 });
  });
});

describe('deriveWalletTargets', () => {
  it('resposta sem metas cai inteira no padrão', () => {
    expect(deriveWalletTargets({ assets: [] })).toEqual(DEFAULT_WALLET_TARGETS);
    expect(deriveWalletTargets(undefined)).toEqual(DEFAULT_WALLET_TARGETS);
  });

  it('ETF legado de topo é absorvido por Ações BR', () => {
    const t = deriveWalletTargets({ targetAllocation: { STOCK: 30, ETF: 10, FII: 60 } });
    expect(t.targetAllocation.STOCK).toBe(40);
    expect(t.targetAllocation.ETF).toBe(0);
  });
});

describe('usdRate — nunca uma cotação inventada', () => {
  it('toUsdRate só aceita número finito e positivo', () => {
    expect(toUsdRate(5.42)).toBe(5.42);
    expect(toUsdRate(undefined)).toBeNull();
    expect(toUsdRate(0)).toBeNull();
    expect(toUsdRate(NaN)).toBeNull();
    expect(toUsdRate('5.4')).toBeNull();
  });

  it('carteira sem meta.usdRate expõe null (antes: 5,75 fixo)', async () => {
    vi.mocked(walletsService.list).mockResolvedValue({ wallets: [], activeWalletId: 'w-1' } as any);
    vi.mocked(walletService.getWallet).mockResolvedValue({ assets: [], kpis: {} } as any);
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(walletService.getWallet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.usdRate).toBeNull();
  });

  it('com meta.usdRate, repassa a cotação do servidor', async () => {
    vi.mocked(walletsService.list).mockResolvedValue({ wallets: [], activeWalletId: 'w-1' } as any);
    vi.mocked(walletService.getWallet).mockResolvedValue({ assets: [], kpis: {}, meta: { usdRate: 5.42 } } as any);
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.usdRate).toBe(5.42));
  });
});
