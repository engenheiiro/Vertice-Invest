
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletService } from '../services/wallet';
import { useAuth } from './AuthContext';
import { useDemo } from './DemoContext'; // Importar DemoContext
import { DEMO_ASSETS, DEMO_KPIS, DEMO_HISTORY } from '../data/DEMO_DATA'; // Importar Dados Mock

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
    dayChangePct?: number; 
}

export interface WalletKPIs {
    totalEquity: number;
    totalInvested: number;
    totalResult: number;
    totalResultPercent: number;
    dayVariation: number;
    dayVariationPercent: number;
    totalDividends: number;
    projectedDividends: number;
    weightedRentability: number;
    dataQuality?: 'AUDITED' | 'ESTIMATED'; 
    sharpeRatio?: number; // Novo
    beta?: number; // Novo
}

export interface HistoryPoint {
    date: string;
    totalEquity: number;
    totalInvested: number;
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
    const { isDemoMode } = useDemo(); // Hook do Modo Demo
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
        enabled: !!user?.id && !isDemoMode, // Não busca se estiver em Demo
        staleTime: 1000 * 60 * 2,
    });

    const historyQuery = useQuery({
        queryKey: ['walletHistory', user?.id],
        queryFn: walletService.getHistory,
        enabled: !!user?.id && !isDemoMode,
        staleTime: 1000 * 60 * 10,
    });

    // --- FORCE REFRESH ON MOUNT ---
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
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] }); 
            queryClient.invalidateQueries({ queryKey: ['dashboardResearch'] });
        }
    });

    const removeAssetMutation = useMutation({
        mutationFn: walletService.removeAsset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
        }
    });

    const resetWalletMutation = useMutation({
        mutationFn: walletService.resetWallet,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['dividends'] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
        }
    });

    // --- ACTIONS ---
    const addAsset = async (newAsset: any) => {
        if (isDemoMode) return; // Bloqueia ações no demo
        await addAssetMutation.mutateAsync(newAsset);
    };

    const removeAsset = async (id: string) => {
        if (isDemoMode) return;
        await removeAssetMutation.mutateAsync(id);
    };

    const resetWallet = async () => {
        if (isDemoMode) return;
        await resetWalletMutation.mutateAsync();
    };

    const updateTargets = (newTargets: AllocationMap, newReserveTarget: number) => {
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
    };

    // --- STATES & MEMOIZED CALCULATIONS ---
    
    // LÓGICA DE INJEÇÃO DO MODO DEMO
    const assets = isDemoMode ? DEMO_ASSETS : (walletQuery.data?.assets || []);
    const history = isDemoMode ? DEMO_HISTORY : (historyQuery.data || []);
    const serverKpis = isDemoMode ? DEMO_KPIS : walletQuery.data?.kpis;
    
    // KPIs híbridos
    const kpis = useMemo(() => {
        // Se estiver em demo, retorna os KPIs fixos do demo
        if (isDemoMode) return { ...DEMO_KPIS, dataQuality: 'AUDITED' as const, sharpeRatio: 1.8, beta: 0.85 };

        if (assets.length === 0) {
            return {
                totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0,
                dayVariation: 0, dayVariationPercent: 0, 
                totalDividends: serverKpis?.totalDividends || 0,
                projectedDividends: serverKpis?.projectedDividends || 0,
                weightedRentability: 0,
                dataQuality: 'AUDITED' as const,
                sharpeRatio: 0,
                beta: 0
            };
        }

        let equity = 0;
        let invested = 0;
        let dayVar = 0;

        assets.forEach((asset: Asset) => {
            equity += asset.totalValue;
            invested += asset.totalCost;
            
            const changePct = asset.dayChangePct || 0;
            const changeValue = asset.totalValue * (changePct / 100);
            dayVar += changeValue;
        });

        const result = equity - invested;
        const resultPercent = invested > 0 ? (result / invested) * 100 : 0;
        const dayVarPercent = equity > 0 ? (dayVar / equity) * 100 : 0;

        return {
            totalEquity: equity,
            totalInvested: invested,
            totalResult: result,
            totalResultPercent: resultPercent, 
            dayVariation: dayVar,
            dayVariationPercent: dayVarPercent,
            totalDividends: serverKpis?.totalDividends || 0,
            projectedDividends: serverKpis?.projectedDividends || 0,
            weightedRentability: serverKpis?.weightedRentability || resultPercent,
            dataQuality: serverKpis?.dataQuality || 'ESTIMATED',
            sharpeRatio: serverKpis?.sharpeRatio || 0,
            beta: serverKpis?.beta || 0
        };
    }, [assets, serverKpis, isDemoMode]);
    
    const usdRate = walletQuery.data?.meta?.usdRate || 5.75;
    const isLoading = !isDemoMode && (walletQuery.isLoading || historyQuery.isLoading);

    const isRefreshing = !isDemoMode && (
                         (walletQuery.isFetching && !walletQuery.isLoading) || 
                         (historyQuery.isFetching && !historyQuery.isLoading) ||
                         addAssetMutation.isPending || 
                         removeAssetMutation.isPending);

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
            isPrivacyMode: isDemoMode ? false : isPrivacyMode, // Demo sempre visível
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
