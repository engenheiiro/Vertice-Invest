import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  buildTargetsPatch, computeIsLoading, computeIsRefreshing, invalidateKeys, isScopeReady, resolveActiveWalletId,
  selectActiveWalletName, selectAssets, selectHistory, selectKpis, selectWallets, walletInvalidations,
} from './walletContextState';
import { DEMO_ASSETS, DEMO_HISTORY, DEMO_KPIS } from '../data/DEMO_DATA';
import { computeWalletKpis } from '../utils/kpiCalculations';
import type { Asset } from './WalletContext';

const idle = { isLoading: false, isFetching: false };
const loading = { isLoading: true, isFetching: true };
const background = { isLoading: false, isFetching: true };

describe('resolveActiveWalletId', () => {
  it('a escolha explícita do mesmo usuário vence a do servidor', () => {
    expect(resolveActiveWalletId({ userId: 'u', walletId: 'w-2' }, 'u', 'w-1')).toBe('w-2');
  });
  it('sem escolha (walletId vazio) cai na do servidor', () => {
    expect(resolveActiveWalletId({ userId: 'u' }, 'u', 'w-1')).toBe('w-1');
  });
  it('escolha de outra conta não vaza após troca de usuário', () => {
    expect(resolveActiveWalletId({ userId: 'outro', walletId: 'w-x' }, 'u', 'w-1')).toBe('w-1');
  });
});

describe('isScopeReady', () => {
  it('demo está sempre pronto', () => expect(isScopeReady(true, undefined, true)).toBe(true));
  it('sem usuário não está pronto', () => expect(isScopeReady(false, undefined, false)).toBe(false));
  it('com usuário, espera GET /wallets sair de pending', () => {
    expect(isScopeReady(false, 'u', true)).toBe(false);
    expect(isScopeReady(false, 'u', false)).toBe(true);
  });
});

describe('seletores demo × real', () => {
  const assets = [{ id: 'a' }] as unknown as Asset[];
  it('ativos e histórico do demo ignoram o servidor', () => {
    expect(selectAssets(true, assets)).toBe(DEMO_ASSETS);
    expect(selectHistory(true, [])).toBe(DEMO_HISTORY);
  });
  it('real usa o servidor e cai em lista vazia sem dado', () => {
    expect(selectAssets(false, assets)).toBe(assets);
    expect(selectAssets(false, undefined)).toEqual([]);
    expect(selectHistory(false, undefined)).toEqual([]);
  });
  it('KPIs do demo são fixos; os reais vêm de computeWalletKpis', () => {
    expect(selectKpis(true, [], undefined)).toEqual({ ...DEMO_KPIS, dataQuality: 'AUDITED', sharpeRatio: 1.8, beta: 0.85 });
    expect(selectKpis(false, [], { totalDividends: 9 })).toEqual(computeWalletKpis([], { totalDividends: 9 }));
  });
  it('carteiras e nome ativo', () => {
    const list = [{ id: 'w-1', name: 'Principal', isDefault: true, createdAt: '2026-01-01' }];
    expect(selectWallets(true, undefined)).toHaveLength(1);
    expect(selectWallets(true, undefined)[0].id).toBe('demo');
    expect(selectWallets(false, undefined)).toEqual([]);
    expect(selectWallets(false, { wallets: list, activeWalletId: 'w-1' })).toBe(list);
    expect(selectActiveWalletName(true, list, 'w-1')).toBe('Demo');
    expect(selectActiveWalletName(false, list, 'w-1')).toBe('Principal');
    expect(selectActiveWalletName(false, list, 'w-9')).toBe('Minha Carteira');
  });
});

describe('computeIsLoading', () => {
  const base = { isDemoMode: false, userId: 'u', isWalletScopeReady: true, wallet: idle, history: idle };
  it('demo ou sem usuário nunca carrega', () => {
    expect(computeIsLoading({ ...base, isDemoMode: true, wallet: loading })).toBe(false);
    expect(computeIsLoading({ ...base, userId: undefined, isWalletScopeReady: false })).toBe(false);
  });
  it('escopo pendente conta como carregando (query desligada tem isLoading=false)', () => {
    expect(computeIsLoading({ ...base, isWalletScopeReady: false })).toBe(true);
  });
  it('carrega enquanto carteira ou histórico carregam', () => {
    expect(computeIsLoading({ ...base, wallet: loading })).toBe(true);
    expect(computeIsLoading({ ...base, history: loading })).toBe(true);
    expect(computeIsLoading(base)).toBe(false);
  });
});

describe('computeIsRefreshing', () => {
  const base = { isDemoMode: false, wallet: idle, history: idle, mutationsPending: [false, false] };
  it('busca em segundo plano liga; o primeiro carregamento não', () => {
    expect(computeIsRefreshing({ ...base, wallet: background })).toBe(true);
    expect(computeIsRefreshing({ ...base, history: background })).toBe(true);
    expect(computeIsRefreshing({ ...base, wallet: loading })).toBe(false);
  });
  it('mutação pendente liga; demo nunca', () => {
    expect(computeIsRefreshing({ ...base, mutationsPending: [false, true] })).toBe(true);
    expect(computeIsRefreshing({ ...base, isDemoMode: true, wallet: background, mutationsPending: [true] })).toBe(false);
    expect(computeIsRefreshing(base)).toBe(false);
  });
});

describe('buildTargetsPatch', () => {
  it('sem sub-meta nem meta de proventos, não as sobrescreve', () => {
    expect(buildTargetsPatch({ STOCK: 100 }, 10)).toEqual({ targetAllocation: { STOCK: 100 }, targetReserve: 10 });
  });
  it('meta de proventos 0 é informada (≠ ausente)', () => {
    const sub = { STOCK: { STOCK: 1, ETF: 0 }, FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 }, STOCK_US: { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 } };
    expect(buildTargetsPatch({}, 0, sub, 0)).toEqual({ targetAllocation: {}, targetReserve: 0, targetSubAllocation: sub, targetMonthlyDividendIncome: 0 });
  });
});

describe('invalidações', () => {
  it('invalida cada chave, na ordem', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    invalidateKeys(client, walletInvalidations.remove('u'));
    expect(spy.mock.calls.map(c => c[0]?.queryKey)).toEqual([['wallet', 'u'], ['walletHistory', 'u'], ['cashFlow'], ['goals']]);
  });
  it('adição/importação também derruba o research do dashboard; reset não', () => {
    expect(walletInvalidations.add('u')).toContainEqual(['dashboardResearch']);
    expect(walletInvalidations.reset('u')).not.toContainEqual(['dashboardResearch']);
    expect(walletInvalidations.update('u')).toEqual([['wallet', 'u'], ['cashFlow']]);
    expect(walletInvalidations.wallets('u')).toEqual([['wallets', 'u']]);
  });
});
