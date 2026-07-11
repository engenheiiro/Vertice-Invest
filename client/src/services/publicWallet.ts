/**
 * (C4) Cliente da carteira PÚBLICA — rota não-autenticada. Usa `fetch` cru (sem
 * authService/token): o visitante do link não está logado. O backend só devolve
 * um subconjunto seguro (composição %, curva de performance %, R$ mascarado
 * salvo se o dono liberou).
 */

export interface PublicCompositionItem {
    ticker: string;
    name: string;
    type: string;
    weightPct: number;
    value?: number; // presente só quando showValues
}

export interface PublicAllocationItem {
    class: string;
    weightPct: number;
}

export interface PublicCurvePoint {
    date: string;
    returnPct: number;
}

export interface PublicWalletData {
    wallet: { name: string; ownerFirstName: string | null };
    showValues: boolean;
    composition: PublicCompositionItem[];
    allocation: PublicAllocationItem[];
    performance: {
        totalReturnPct: number;
        dayVariationPercent: number;
        curve: PublicCurvePoint[];
    };
    kpis: { totalEquity: number; totalInvested: number; totalResult: number } | null;
    meta: { updatedAt: string; assetCount: number };
}

export const publicWalletService = {
    async get(token: string): Promise<PublicWalletData> {
        const response = await fetch(`/api/public/wallet/${encodeURIComponent(token)}`);
        if (response.status === 404) throw new Error('NOT_FOUND');
        if (!response.ok) throw new Error('Falha ao carregar carteira pública');
        return await response.json();
    },
};
