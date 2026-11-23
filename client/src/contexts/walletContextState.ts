import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { WalletListResponse, WalletSummary } from '../services/wallets';
import { DEMO_ASSETS, DEMO_KPIS, DEMO_HISTORY } from '../data/DEMO_DATA';
import { computeWalletKpis } from '../utils/kpiCalculations';
import type { AllocationMap, Asset, HistoryPoint, SubAllocationMap, WalletKPIs, WalletTargets } from './WalletContext';

// Regras puras do WalletProvider: o que ele decide a partir do estado das
// queries, do modo demo e do usuário. O provider só liga os hooks a elas.

// Pseudo-carteira única usada só em modo demo — o seletor real fica oculto.
const DEMO_WALLETS: WalletSummary[] = [{ id: 'demo', name: 'Demo', isDefault: true, createdAt: new Date().toISOString() }];

/** Seleção explícita de carteira, guardada junto do dono (não vaza entre contas). */
export interface WalletSelection { userId?: string; walletId?: string }

/**
 * Carteira ativa DERIVADA: a escolha explícita do usuário corrente vence; senão,
 * a que o servidor resolveu (User.activeWalletId). Seleção de outra conta é ignorada.
 */
export const resolveActiveWalletId = (selection: WalletSelection, userId: string | undefined, serverActiveId: string | undefined) =>
    selection.userId === userId ? (selection.walletId ?? serverActiveId) : serverActiveId;

/** Portão das queries escopadas: GET /wallets respondeu (sucesso OU erro), ou demo. */
export const isScopeReady = (isDemoMode: boolean, userId: string | undefined, isWalletsPending: boolean) =>
    isDemoMode || (!!userId && !isWalletsPending);

export const selectAssets = (isDemoMode: boolean, serverAssets: Asset[] | undefined): Asset[] =>
    isDemoMode ? DEMO_ASSETS : (serverAssets || []);

export const selectHistory = (isDemoMode: boolean, serverHistory: HistoryPoint[] | undefined): HistoryPoint[] =>
    isDemoMode ? DEMO_HISTORY : (serverHistory || []);

/** KPIs híbridos: demo é fixo; no real, soma client-side + campos do servidor. */
export const selectKpis = (isDemoMode: boolean, assets: Asset[], serverKpis: Partial<WalletKPIs> | undefined): WalletKPIs => {
    if (isDemoMode) return { ...DEMO_KPIS, dataQuality: 'AUDITED' as const, sharpeRatio: 1.8, beta: 0.85 };
    return computeWalletKpis(assets, serverKpis);
};

export const selectWallets = (isDemoMode: boolean, data: WalletListResponse | undefined): WalletSummary[] =>
    isDemoMode ? DEMO_WALLETS : (data?.wallets || []);

export const selectActiveWalletName = (isDemoMode: boolean, wallets: WalletSummary[], activeWalletId: string | undefined) =>
    isDemoMode ? 'Demo' : (wallets.find(w => w.id === activeWalletId)?.name || 'Minha Carteira');

interface QueryFlags { isLoading: boolean; isFetching: boolean }

/**
 * `!isWalletScopeReady` conta como carregando: enquanto GET /wallets não responde
 * as queries estão desligadas, e query desligada tem isLoading=false — sem isso a
 * carteira piscaria "vazia" antes de começar a carregar.
 */
export const computeIsLoading = (p: { isDemoMode: boolean; userId?: string; isWalletScopeReady: boolean; wallet: QueryFlags; history: QueryFlags }) =>
    !p.isDemoMode && !!p.userId && (!p.isWalletScopeReady || p.wallet.isLoading || p.history.isLoading);

const isBackgroundFetch = (q: QueryFlags) => q.isFetching && !q.isLoading;

export const computeIsRefreshing = (p: { isDemoMode: boolean; wallet: QueryFlags; history: QueryFlags; mutationsPending: boolean[] }) =>
    !p.isDemoMode && (isBackgroundFetch(p.wallet) || isBackgroundFetch(p.history) || p.mutationsPending.some(Boolean));

/** Patch das metas: sub-meta e meta de proventos só entram quando informadas. */
export const buildTargetsPatch = (
    targetAllocation: AllocationMap, targetReserve: number, targetSubAllocation?: SubAllocationMap, targetMonthlyDividendIncome?: number,
): Partial<WalletTargets> => ({
    targetAllocation,
    targetReserve,
    ...(targetSubAllocation ? { targetSubAllocation } : {}),
    ...(targetMonthlyDividendIncome !== undefined ? { targetMonthlyDividendIncome } : {}),
});

/** Chaves invalidadas depois de cada escrita — o efeito de cada uma no que a tela mostra. */
export const walletInvalidations = {
    // Adição e importação: a carteira inteira pode mudar, inclusive o research do dashboard.
    add: (userId?: string): QueryKey[] =>
        [['wallet', userId], ['walletHistory', userId], ['dividends'], ['cashFlow'], ['dashboardResearch'], ['goals']],
    update: (userId?: string): QueryKey[] => [['wallet', userId], ['cashFlow']],
    remove: (userId?: string): QueryKey[] => [['wallet', userId], ['walletHistory', userId], ['cashFlow'], ['goals']],
    reset: (userId?: string): QueryKey[] => [['wallet', userId], ['walletHistory', userId], ['dividends'], ['cashFlow'], ['goals']],
    wallets: (userId?: string): QueryKey[] => [['wallets', userId]],
};

export const invalidateKeys = (queryClient: QueryClient, keys: QueryKey[]) =>
    keys.forEach(queryKey => { queryClient.invalidateQueries({ queryKey }); });
