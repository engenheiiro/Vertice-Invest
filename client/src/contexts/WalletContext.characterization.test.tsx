import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WalletProvider, useWallet, DEFAULT_WALLET_TARGETS, type Asset } from './WalletContext';
import { DEMO_ASSETS, DEMO_HISTORY, DEMO_KPIS } from '../data/DEMO_DATA';
import { computeWalletKpis } from '../utils/kpiCalculations';

// Caracterização do WalletProvider: o que ele decide (valor exposto) e quais
// chamadas de API faz, no modo real e no demo. Trava o comportamento para a
// extração das regras puras em `walletContextState.ts`.

const env = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  demo: false,
  toast: vi.fn(),
}));

const api = vi.hoisted(() => ({
  wallet: {
    getWallet: vi.fn(), getHistory: vi.fn(), addAsset: vi.fn(), updateAsset: vi.fn(), removeAsset: vi.fn(),
    resetWallet: vi.fn(), updateTargets: vi.fn(), importCommit: vi.fn(), importUndo: vi.fn(),
    getPerformance: vi.fn(), getDividends: vi.fn(), getCashFlow: vi.fn(),
  },
  wallets: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), setActive: vi.fn() },
}));

vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock('./DemoContext', () => ({ useDemo: () => ({ isDemoMode: env.demo }) }));
vi.mock('./ToastContext', () => ({ useToast: () => ({ addToast: env.toast }) }));
vi.mock('../services/wallet', () => ({ walletService: api.wallet }));
vi.mock('../services/wallets', () => ({ walletsService: api.wallets }));

const SERVER_ASSETS: Asset[] = [{
  id: 'a-1', ticker: 'PETR4', type: 'STOCK', quantity: 10, averagePrice: 30, currentPrice: 35,
  totalValue: 350, totalCost: 300, profit: 50, profitPercent: 16.67, currency: 'BRL',
}];
const SERVER_KPIS = { totalResult: 50, dayVariation: 5, dayVariationPercent: 1.4, totalDividends: 12 };
const SERVER_HISTORY = [{ date: '2026-11-20', totalEquity: 340, totalInvested: 300 }];
const WALLETS = {
  wallets: [
    { id: 'w-1', name: 'Principal', isDefault: true, createdAt: '2026-01-01' },
    { id: 'w-2', name: 'Cripto', isDefault: false, createdAt: '2026-01-02' },
  ],
  activeWalletId: 'w-1',
};

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><WalletProvider>{children}</WalletProvider></QueryClientProvider>
  );
  return { wrapper, client };
};

const renderWallet = () => renderHook(() => useWallet(), { wrapper: makeWrapper().wrapper });

const renderLoaded = async () => {
  const view = renderWallet();
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(false));
  return view;
};

const allApiFns = () => [...Object.values(api.wallet), ...Object.values(api.wallets)];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  env.user = { id: 'u-1' };
  env.demo = false;
  api.wallets.list.mockResolvedValue(WALLETS);
  api.wallet.getWallet.mockResolvedValue({ assets: SERVER_ASSETS, kpis: SERVER_KPIS, meta: { usdRate: 5.4 } });
  api.wallet.getHistory.mockResolvedValue(SERVER_HISTORY);
  api.wallet.getPerformance.mockResolvedValue({});
  api.wallet.getDividends.mockResolvedValue({});
  api.wallet.getCashFlow.mockResolvedValue({});
});

describe('WalletProvider (real) — carregamento e escopo', () => {
  it('nada escopado sai antes de GET /wallets; depois busca UMA vez com o id ativo', async () => {
    let resolveList: (v: typeof WALLETS) => void = () => {};
    api.wallets.list.mockReturnValue(new Promise(r => { resolveList = r; }));
    const { result } = renderWallet();

    expect(result.current.isWalletScopeReady).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isWalletsLoading).toBe(true);
    expect(result.current.activeWalletId).toBeUndefined();
    expect(result.current.activeWalletName).toBe('Minha Carteira');
    expect(result.current.wallets).toEqual([]);
    expect(api.wallet.getWallet).not.toHaveBeenCalled();
    expect(api.wallet.getHistory).not.toHaveBeenCalled();

    await act(async () => { resolveList(WALLETS); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));

    expect(api.wallets.list).toHaveBeenCalledTimes(1);
    expect(api.wallet.getWallet).toHaveBeenCalledTimes(1);
    expect(api.wallet.getWallet).toHaveBeenCalledWith('w-1');
    expect(api.wallet.getHistory).toHaveBeenCalledTimes(1);
    expect(api.wallet.getHistory).toHaveBeenCalledWith('w-1');
  });

  it('expõe dados do servidor: ativos, histórico, KPIs híbridos, carteiras e nome', async () => {
    const { result } = await renderLoaded();
    const v = result.current;
    expect(v.assets).toEqual(SERVER_ASSETS);
    expect(v.history).toEqual(SERVER_HISTORY);
    expect(v.kpis).toEqual(computeWalletKpis(SERVER_ASSETS, SERVER_KPIS));
    expect(v.usdRate).toBe(5.4);
    expect(v.wallets).toEqual(WALLETS.wallets);
    expect(v.activeWalletId).toBe('w-1');
    expect(v.activeWalletName).toBe('Principal');
    expect(v.isWalletScopeReady).toBe(true);
    expect(v.isWalletsLoading).toBe(false);
    expect(v.isSwitchingWallet).toBe(false);
    expect(v.isReadOnly).toBe(false);
    expect(v.isValuesLocked).toBe(false);
    expect(v.isPrivacyMode).toBe(false);
    expect(v.targetReserve).toBe(DEFAULT_WALLET_TARGETS.targetReserve);
    expect(v.targetAllocation).toEqual(DEFAULT_WALLET_TARGETS.targetAllocation);
  });

  it('id ativo fora da lista cai no nome "Minha Carteira"', async () => {
    api.wallets.list.mockResolvedValue({ wallets: WALLETS.wallets, activeWalletId: 'w-9' });
    const { result } = await renderLoaded();
    expect(result.current.activeWalletId).toBe('w-9');
    expect(result.current.activeWalletName).toBe('Minha Carteira');
  });

  it('resposta sem `assets`/histórico vira lista vazia e KPIs zerados', async () => {
    api.wallet.getWallet.mockResolvedValue({});
    api.wallet.getHistory.mockResolvedValue(undefined);
    const { result } = await renderLoaded();
    expect(result.current.assets).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.kpis).toEqual(computeWalletKpis([], undefined));
    expect(result.current.usdRate).toBeNull();
  });

  it('erro em GET /wallet: sai do loading com carteira vazia', async () => {
    api.wallet.getWallet.mockRejectedValue(new Error('500'));
    const { result } = await renderLoaded();
    expect(result.current.assets).toEqual([]);
    expect(result.current.kpis.totalEquity).toBe(0);
    expect(api.wallet.getWallet).toHaveBeenCalledTimes(1);
  });

  it('sem usuário: não busca nada, não fica em loading e o escopo não fica pronto', () => {
    env.user = null;
    const { result } = renderWallet();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.isWalletScopeReady).toBe(false);
    expect(result.current.isWalletsLoading).toBe(false);
    expect(result.current.assets).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(api.wallets.list).not.toHaveBeenCalled();
    expect(api.wallet.getWallet).not.toHaveBeenCalled();
  });

  it('refreshWallet busca a carteira de novo (mesmo escopo)', async () => {
    const { result } = await renderLoaded();
    await act(async () => { await result.current.refreshWallet(); });
    await waitFor(() => expect(api.wallet.getWallet).toHaveBeenCalledTimes(2));
    expect(api.wallet.getWallet).toHaveBeenLastCalledWith('w-1');
  });

  it('dataSource embute o escopo da carteira ativa', async () => {
    const { result } = await renderLoaded();
    await result.current.dataSource.getPerformance();
    await result.current.dataSource.getDividends();
    await result.current.dataSource.getCashFlow(2, 10, 'BUY');
    expect(api.wallet.getPerformance).toHaveBeenCalledWith('w-1');
    expect(api.wallet.getDividends).toHaveBeenCalledWith('w-1');
    expect(api.wallet.getCashFlow).toHaveBeenCalledWith(2, 10, 'BUY', 'w-1');
  });
});

describe('WalletProvider (real) — privacidade', () => {
  it('lê o valor salvo e alterna gravando no localStorage', async () => {
    localStorage.setItem('isPrivacyMode', 'true');
    const { result } = await renderLoaded();
    expect(result.current.isPrivacyMode).toBe(true);
    act(() => { result.current.togglePrivacyMode(); });
    expect(result.current.isPrivacyMode).toBe(false);
    expect(localStorage.getItem('isPrivacyMode')).toBe('false');
  });
});

describe('WalletProvider (real) — mutações chamam a API com o escopo', () => {
  it('addAsset/updateAsset/removeAsset/resetWallet', async () => {
    api.wallet.addAsset.mockResolvedValue({});
    api.wallet.updateAsset.mockResolvedValue({});
    api.wallet.removeAsset.mockResolvedValue({});
    api.wallet.resetWallet.mockResolvedValue({});
    const { result } = await renderLoaded();

    await act(async () => { await result.current.addAsset({ ticker: 'VALE3' }); });
    await act(async () => { await result.current.updateAsset('a-1', { quantity: 5 }); });
    await act(async () => { await result.current.removeAsset('a-1'); });
    await act(async () => { await result.current.resetWallet(); });

    expect(api.wallet.addAsset).toHaveBeenCalledWith({ ticker: 'VALE3' }, 'w-1');
    expect(api.wallet.updateAsset).toHaveBeenCalledWith('a-1', { quantity: 5 }, 'w-1');
    expect(api.wallet.removeAsset).toHaveBeenCalledWith('a-1', 'w-1');
    expect(api.wallet.resetWallet).toHaveBeenCalledWith('w-1');
    expect(env.toast).toHaveBeenCalledWith('Ativo removido da carteira.', 'success');
    expect(env.toast).toHaveBeenCalledWith('Carteira resetada com sucesso.', 'success');
  });

  it('falha ao atualizar/remover vira toast com a mensagem do erro ou o padrão', async () => {
    api.wallet.updateAsset.mockRejectedValue(new Error('quantidade inválida'));
    api.wallet.removeAsset.mockRejectedValue({});
    const { result } = await renderLoaded();
    await act(async () => { await result.current.updateAsset('a-1', {}).catch(() => {}); });
    await act(async () => { await result.current.removeAsset('a-1').catch(() => {}); });
    expect(env.toast).toHaveBeenCalledWith('quantidade inválida', 'error');
    expect(env.toast).toHaveBeenCalledWith('Erro ao remover ativo.', 'error');
  });

  it('isRefreshing liga enquanto addAsset está pendente', async () => {
    let finish: (v: unknown) => void = () => {};
    api.wallet.addAsset.mockReturnValue(new Promise(r => { finish = r; }));
    const { result } = await renderLoaded();
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.addAsset({ ticker: 'X' }); });
    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    await act(async () => { finish({}); await pending; });
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  it('importCommit devolve o resultado; importUndo passa o lote', async () => {
    api.wallet.importCommit.mockResolvedValue({ batchId: 'b-1', inserted: 3 });
    api.wallet.importUndo.mockResolvedValue({});
    const { result } = await renderLoaded();
    let out: unknown;
    await act(async () => { out = await result.current.importCommit('B3', [{ a: 1 }]); });
    await act(async () => { await result.current.importUndo('b-1'); });
    expect(out).toEqual({ batchId: 'b-1', inserted: 3 });
    expect(api.wallet.importCommit).toHaveBeenCalledWith('B3', [{ a: 1 }], 'w-1');
    expect(api.wallet.importUndo).toHaveBeenCalledWith('b-1', 'w-1');
  });

  it('updateTargets grava com sub-meta e meta de proventos, no escopo ativo', async () => {
    api.wallet.updateTargets.mockResolvedValue({});
    const { result } = await renderLoaded();
    const sub = { ...DEFAULT_WALLET_TARGETS.targetSubAllocation, STOCK: { STOCK: 60, ETF: 40 } };
    await act(async () => { await result.current.updateTargets({ STOCK: 100 }, 2000, sub, 300); });
    expect(api.wallet.updateTargets).toHaveBeenCalledWith({ STOCK: 100 }, 2000, sub, 300, 'w-1');
  });

  it('setActiveWallet: mesma carteira é no-op; outra troca o escopo e rebusca uma vez', async () => {
    api.wallets.setActive.mockResolvedValue({ activeWalletId: 'w-2' });
    const { result } = await renderLoaded();
    await act(async () => { await result.current.setActiveWallet('w-1'); });
    expect(api.wallets.setActive).not.toHaveBeenCalled();

    await act(async () => { await result.current.setActiveWallet('w-2'); });
    expect(api.wallets.setActive).toHaveBeenCalledWith('w-2');
    await waitFor(() => expect(result.current.activeWalletId).toBe('w-2'));
    await waitFor(() => expect(api.wallet.getWallet).toHaveBeenCalledWith('w-2'));
    expect(api.wallet.getWallet.mock.calls.filter(c => c[0] === 'w-2')).toHaveLength(1);
    expect(result.current.activeWalletName).toBe('Cripto');
  });

  it('falha ao trocar de carteira vira toast', async () => {
    api.wallets.setActive.mockRejectedValue(new Error('negado'));
    const { result } = await renderLoaded();
    await act(async () => { await result.current.setActiveWallet('w-2').catch(() => {}); });
    expect(env.toast).toHaveBeenCalledWith('negado', 'error');
    expect(result.current.activeWalletId).toBe('w-1');
  });

  it('createWallet cria, ativa a nova e devolve a carteira', async () => {
    const created = { id: 'w-3', name: 'Nova', isDefault: false, createdAt: '2026-11-01' };
    api.wallets.create.mockResolvedValue({ wallet: created });
    api.wallets.setActive.mockResolvedValue({ activeWalletId: 'w-3' });
    const { result } = await renderLoaded();
    let out: unknown;
    await act(async () => { out = await result.current.createWallet('Nova'); });
    expect(out).toEqual(created);
    expect(api.wallets.create).toHaveBeenCalledWith('Nova');
    expect(api.wallets.setActive).toHaveBeenCalledWith('w-3');
    await waitFor(() => expect(result.current.activeWalletId).toBe('w-3'));
  });

  it('renameWallet renomeia; deleteWallet da ativa adota o id devolvido pelo servidor', async () => {
    api.wallets.rename.mockResolvedValue({});
    api.wallets.remove.mockResolvedValue({ activeWalletId: 'w-2' });
    const { result } = await renderLoaded();
    await act(async () => { await result.current.renameWallet('w-1', 'Renomeada'); });
    expect(api.wallets.rename).toHaveBeenCalledWith('w-1', 'Renomeada');
    await act(async () => { await result.current.deleteWallet('w-1'); });
    expect(api.wallets.remove).toHaveBeenCalledWith('w-1');
    await waitFor(() => expect(result.current.activeWalletId).toBe('w-2'));
  });

  it('deleteWallet de outra carteira não mexe na ativa', async () => {
    api.wallets.remove.mockResolvedValue({ activeWalletId: 'w-1' });
    const { result } = await renderLoaded();
    await act(async () => { await result.current.deleteWallet('w-2'); });
    expect(result.current.activeWalletId).toBe('w-1');
  });
});

describe('WalletProvider (demo)', () => {
  beforeEach(() => { env.demo = true; });

  it('injeta dados de demonstração e nunca busca nada', () => {
    localStorage.setItem('isPrivacyMode', 'true');
    const { result } = renderWallet();
    const v = result.current;
    expect(v.assets).toBe(DEMO_ASSETS);
    expect(v.history).toBe(DEMO_HISTORY);
    expect(v.kpis).toEqual({ ...DEMO_KPIS, dataQuality: 'AUDITED', sharpeRatio: 1.8, beta: 0.85 });
    expect(v.wallets).toHaveLength(1);
    expect(v.wallets[0]).toMatchObject({ id: 'demo', name: 'Demo', isDefault: true });
    expect(v.activeWalletName).toBe('Demo');
    expect(v.activeWalletId).toBeUndefined();
    expect(v.isWalletScopeReady).toBe(true);
    expect(v.isLoading).toBe(false);
    expect(v.isRefreshing).toBe(false);
    expect(v.isWalletsLoading).toBe(false);
    expect(v.isPrivacyMode).toBe(false); // demo sempre visível, mesmo com privacidade salva
    expect(v.usdRate).toBeNull();
    allApiFns().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it('demo sem usuário também fica pronto e fora do loading', () => {
    env.user = null;
    const { result } = renderWallet();
    expect(result.current.isWalletScopeReady).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('toda mutação é no-op e não chama a API', async () => {
    const { result } = renderWallet();
    const v = result.current;
    let commit: unknown = 'x';
    let created: unknown = 'x';
    await act(async () => {
      await v.addAsset({ ticker: 'PETR4' });
      await v.updateAsset('a', {});
      await v.removeAsset('a');
      await v.resetWallet();
      commit = await v.importCommit('B3', []);
      await v.importUndo('b');
      await v.setActiveWallet('w-2');
      created = await v.createWallet('Nova');
      await v.renameWallet('w-1', 'X');
      await v.deleteWallet('w-1');
    });
    expect(commit).toBeUndefined();
    expect(created).toBeUndefined();
    allApiFns().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it('updateTargets só muda as metas locais, sem gravar', async () => {
    const { result } = renderWallet();
    await act(async () => { await result.current.updateTargets({ STOCK: 100 }, 1234, undefined, 50); });
    expect(result.current.targetAllocation).toEqual({ STOCK: 100 });
    expect(result.current.targetReserve).toBe(1234);
    expect(result.current.targetMonthlyDividendIncome).toBe(50);
    expect(result.current.targetSubAllocation).toEqual(DEFAULT_WALLET_TARGETS.targetSubAllocation);
    expect(api.wallet.updateTargets).not.toHaveBeenCalled();
  });

  it('dataSource NÃO é bloqueado no demo: chama o serviço sem escopo', async () => {
    const { result } = renderWallet();
    await result.current.dataSource.getPerformance();
    expect(api.wallet.getPerformance).toHaveBeenCalledWith(undefined);
  });
});
