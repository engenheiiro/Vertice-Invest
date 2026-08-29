/**
 * (C4) Cliente da carteira PÚBLICA — rotas não-autenticadas. Usa `fetch` cru
 * (sem authService/token): o visitante do link não está logado.
 *
 * O conjunto espelha, uma a uma, as chamadas que a página Carteira faz na área
 * logada — porque o link renderiza exatamente aquela página em modo leitura. O
 * backend devolve os MESMOS números; quando o dono mantém "exibir valores em
 * R$" desligado, os campos monetários chegam normalizados (patrimônio = 100) e
 * a página entra em modo privacidade, mascarando todo R$.
 */

import type { Asset, WalletKPIs, HistoryPoint } from '../contexts/WalletContext';

export interface PublicWalletData {
    wallet: { name: string; ownerFirstName: string | null };
    /** `false` → nenhum valor real trafegou; a página mascara os R$. */
    showValues: boolean;
    assets: Asset[];
    kpis: WalletKPIs;
    meta: { usdRate: number; lastUpdate: string };
}

const base = (token: string) => `/api/public/wallet/${encodeURIComponent(token)}`;

const get = async <T>(url: string, fallback?: T): Promise<T> => {
    const response = await fetch(url);
    if (response.status === 404) throw new Error('NOT_FOUND');
    if (!response.ok) {
        if (fallback !== undefined) return fallback;
        throw new Error('Falha ao carregar carteira pública');
    }
    return (await response.json()) as T;
};

/**
 * Config da query da carteira pública. Fica aqui (e não no provider) para que
 * provider e página usem a MESMA chave — uma só ida ao servidor, deduplicada
 * pelo React Query.
 */
export const publicWalletQueryOptions = (token: string) => ({
    queryKey: ['publicWallet', token],
    queryFn: () => publicWalletService.getWallet(token),
    retry: (count: number, err: any) => err?.message !== 'NOT_FOUND' && count < 2,
    staleTime: 60_000,
});

export const publicWalletService = {
    getWallet: (token: string) => get<PublicWalletData>(base(token)),
    getHistory: (token: string) => get<HistoryPoint[]>(`${base(token)}/history`, []),
    getPerformance: (token: string) => get<any>(`${base(token)}/performance`, []),
    getDividends: (token: string) => get<any>(`${base(token)}/dividends`, null),
    getCashFlow: (token: string, page = 1, limit = 15, filterType = 'ALL') =>
        get<any>(`${base(token)}/cashflow?page=${page}&limit=${limit}&filterType=${encodeURIComponent(filterType)}`),
};
