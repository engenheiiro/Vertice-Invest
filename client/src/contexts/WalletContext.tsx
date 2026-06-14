
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletService } from '../services/wallet';
import { useAuth } from './AuthContext';
import { useDemo } from './DemoContext'; // Importar DemoContext
import { useToast } from './ToastContext';
import { DEMO_ASSETS, DEMO_KPIS, DEMO_HISTORY } from '../data/DEMO_DATA'; // Importar Dados Mock
import { STALE_TIME } from '../config/queryConfig';
import { computeWalletKpis } from '../utils/kpiCalculations';

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
    updateAsset: (id: string, data: { name?: string; tags?: string[] }) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    resetWallet: () => Promise<void>;
    updateTargets: (newTargets: AllocationMap, newReserveTarget: number) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { isDemoMode } = useDemo(); // Hook do Modo Demo
    const { addToast } = useToast();
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
        staleTime: STALE_TIME.REALTIME,
    });

    const historyQuery = useQuery({
        queryKey: ['walletHistory', user?.id],
        queryFn: walletService.getHistory,
        enabled: !!user?.id && !isDemoMode,
        staleTime: STALE_TIME.MEDIUM,
    });

    // --- HIDRATA CARTEIRA IDEAL DO SERVIDOR ---
    // O backend retorna targetAllocation/targetReserve persistidos no usuário.
    // Sincroniza sempre que a carteira recarregar (login, refresh, troca de conta).
    useEffect(() => {
        if (isDemoMode) return;
        const data = walletQuery.data;
        if (data?.targetAllocation) setTargetAllocation(data.targetAllocation);
        if (typeof data?.targetReserve === 'number') setTargetReserve(data.targetReserve);
    }, [walletQuery.data, isDemoMode]);

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
            queryClient.invalidateQueries({ queryKey: ['goals'] });
        }
        // Feedback de sucesso/erro do "add" é tratado no AddAssetModal (evita toast duplicado).
    });

    const updateAssetMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { name?: string; tags?: string[] } }) =>
            walletService.updateAsset(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao atualizar ativo.', 'error')
    });

    const removeAssetMutation = useMutation({
        mutationFn: walletService.removeAsset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
            queryClient.invalidateQueries({ queryKey: ['goals'] });
            addToast('Ativo removido da carteira.', 'success');
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao remover ativo.', 'error')
    });

    const resetWalletMutation = useMutation({
        mutationFn: walletService.resetWallet,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['walletHistory', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['dividends'] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
            queryClient.invalidateQueries({ queryKey: ['goals'] });
            addToast('Carteira resetada com sucesso.', 'success');
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao resetar carteira.', 'error')
    });

    // --- ACTIONS ---
    const addAsset = async (newAsset: any) => {
        if (isDemoMode) return; // Bloqueia ações no demo
        await addAssetMutation.mutateAsync(newAsset);
    };

    const updateAsset = async (id: string, data: { name?: string; tags?: string[] }) => {
        if (isDemoMode) return;
        await updateAssetMutation.mutateAsync({ id, data });
    };

    const removeAsset = async (id: string) => {
        if (isDemoMode) return;
        await removeAssetMutation.mutateAsync(id);
    };

    const resetWallet = async () => {
        if (isDemoMode) return;
        await resetWalletMutation.mutateAsync();
    };

    const updateTargets = async (newTargets: AllocationMap, newReserveTarget: number) => {
        // Atualização otimista (UI responde na hora); persiste no backend logo em seguida.
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
        if (isDemoMode) return; // Demo não persiste
        try {
            await walletService.updateTargets(newTargets as Record<string, number>, newReserveTarget);
        } catch (err: any) {
            addToast(err?.message || 'Erro ao salvar carteira ideal.', 'error');
        }
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

        // Cálculo puro extraído para utils/kpiCalculations.ts (M5, testável).
        return computeWalletKpis(assets, serverKpis);
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
            updateAsset,
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
