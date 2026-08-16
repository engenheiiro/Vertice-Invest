import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WalletProvider, useWallet } from './WalletContext';
import { walletService } from '../services/wallet';
import { walletsService } from '../services/wallets';

// Modo demo desligado — aqui interessa o caminho real de resolução da carteira ativa.
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('./DemoContext', () => ({ useDemo: () => ({ isDemoMode: false }) }));
vi.mock('./ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../services/wallets', () => ({ walletsService: { list: vi.fn() } }));
vi.mock('../services/wallet', () => ({
  walletService: { getWallet: vi.fn(), getHistory: vi.fn() },
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
