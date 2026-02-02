
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletService } from '../services/wallet';
import { useAuth } from './AuthContext';

export type AssetType = 'STOCK' | 'FII' | 'CRYPTO' | 'STOCK_US' | 'FIXED_INCOME' | 'CASH';

export interface Asset {
    id: string;
    ticker: string;
    type: AssetType;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    totalValue: number;
    totalCost: number;
    profit: number;
    profitPercent: number;
    currency: 'BRL' | 'USD';
    name?: string;
    sector?: string;
    fixedIncomeRate?: number;
}

export interface WalletKPIs {
    totalEquity: number;
    totalInvested: number;
    totalResult: number;
    totalResultPercent: number;
    dayVariation: number;
    dayVariationPercent: number;
    totalDividends: number;
}

export interface HistoryPoint {
    date: string;
    totalEquity: number;
    profit: number;
}

export type AllocationMap = Partial<Record<AssetType, number>>;

interface WalletContextType {
    assets: Asset[];
    kpis: WalletKPIs;
    history: HistoryPoint[];
    targetAllocation: AllocationMap;
    targetReserve: number;
    usdRate: number;
    isLoading: boolean;
    isRefreshing: boolean;
    isPrivacyMode: boolean; 
    togglePrivacyMode: () => void;
    refreshWallet: () => void;
    addAsset: (asset: any) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    resetWallet: () => Promise<void>;
    updateTargets: (newTargets: AllocationMap, newReserveTarget: number) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    
    const [targetAllocation, setTargetAllocation] = useState<AllocationMap>({ STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10 });
    const [targetReserve, setTargetReserve] = useState(10000);

    const [isPrivacyMode, setIsPrivacyMode] = useState(() => {
        const saved = localStorage.getItem('isPrivacyMode');
        return saved === 'true';
    });

    const togglePrivacyMode = () => {
        setIsPrivacyMode(prev => {
            const newValue = !prev;
            localStorage.setItem('isPrivacyMode', String(newValue));
            return newValue;
        });
    };

    // --- QUERIES ---
    const walletQuery = useQuery({
        queryKey: ['wallet', user?.id],
        queryFn: walletService.getWallet,
        enabled: !!user?.id, 
        staleTime: 1000 * 60 * 2,
    });

    const historyQuery = useQuery({
        queryKey: ['walletHistory', user?.id],
        queryFn: walletService.getHistory,
        enabled: !!user?.id,
        staleTime: 1000 * 60 * 10,
    });

    // --- FORCE REFRESH ON MOUNT ---
    // Garante que, ao abrir o app, se o usuário tem saldo mas o histórico está vazio/inconsistente,
    // forçamos um refetch. Isso resolve o problema de precisar "adicionar algo" para destravar.
    useEffect(() => {
        if (user?.id) {
            queryClient.invalidateQueries({ queryKey: ['wallet', user.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user.id] });
        }
    }, [user?.id, queryClient]);

    // --- MUTATIONS ---
    const addAssetMutation = useMutation({
        mutationFn: walletService.addAsset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['dividends'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardResearch'] });
        }
    });

    const removeAssetMutation = useMutation({
        mutationFn: walletService.removeAsset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
        }
    });

    const resetWalletMutation = useMutation({
        mutationFn: walletService.resetWallet,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['dividends'] });
        }
    });

    // --- ACTIONS ---
    const addAsset = async (newAsset: any) => {
        await addAssetMutation.mutateAsync(newAsset);
    };

    const removeAsset = async (id: string) => {
        await removeAssetMutation.mutateAsync(id);
    };

    const resetWallet = async () => {
        await resetWalletMutation.mutateAsync();
    };

    const updateTargets = (newTargets: AllocationMap, newReserveTarget: number) => {
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
    };

    // --- STATES ---
    const assets = walletQuery.data?.assets || [];
    
    const kpis = walletQuery.data?.kpis || {
        totalEquity: 0, 
        totalInvested: 0, 
        totalResult: 0, 
        totalResultPercent: 0, 
        dayVariation: 0, 
        dayVariationPercent: 0, 
        totalDividends: 0
    };
    
    const usdRate = walletQuery.data?.meta?.usdRate || 5.75;
    const history = historyQuery.data || [];

    const isLoading = walletQuery.isLoading || historyQuery.isLoading;

    const isRefreshing = (walletQuery.isFetching && !walletQuery.isLoading) || 
                         (historyQuery.isFetching && !historyQuery.isLoading) ||
                         addAssetMutation.isPending || 
                         removeAssetMutation.isPending;

    return (
        <WalletContext.Provider value={{ 
            assets, 
            kpis, 
            history, 
            targetAllocation, 
            targetReserve, 
            usdRate,
            isLoading, 
            isRefreshing,
            isPrivacyMode, 
            togglePrivacyMode,
            refreshWallet: () => queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] }),
            addAsset, 
            removeAsset, 
            resetWallet,
            updateTargets
        }}>
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) throw new Error('useWallet deve ser usado dentro de um WalletProvider');
    return context;
};
