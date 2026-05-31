import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WalletProvider, useWallet } from './WalletContext';
import { DEMO_ASSETS } from '../data/DEMO_DATA';
import { walletService } from '../services/wallet';

// Modo demo ligado; demais contextos e o serviço de carteira são mockados.
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'demo-user' } }) }));
vi.mock('./DemoContext', () => ({ useDemo: () => ({ isDemoMode: true }) }));
vi.mock('./ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../services/wallet', () => ({
  walletService: {
    getWallet: vi.fn(),
    getHistory: vi.fn(),
    addAsset: vi.fn(),
    removeAsset: vi.fn(),
    resetWallet: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <WalletProvider>{children}</WalletProvider>
  </QueryClientProvider>
);

describe('WalletContext — modo demo', () => {
  it('injeta os ativos de demonstração (DEMO_ASSETS)', () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.assets).toBe(DEMO_ASSETS);
    expect(result.current.assets.length).toBeGreaterThan(0);
  });

  it('expõe KPIs de demo fixos (sharpe 1.8, beta 0.85) e desliga privacidade', () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.kpis.sharpeRatio).toBe(1.8);
    expect(result.current.kpis.beta).toBe(0.85);
    expect(result.current.isPrivacyMode).toBe(false); // demo é sempre visível
  });

  it('bloqueia mutações no demo (addAsset não chama a API)', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await act(async () => {
      await result.current.addAsset({ ticker: 'PETR4', quantity: 10 });
    });
    expect(walletService.addAsset).not.toHaveBeenCalled();
  });
});
