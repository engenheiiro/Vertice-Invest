
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { walletService } from '../services/wallet';

export type AssetType = 'STOCK' | 'FII' | 'CRYPTO' | 'STOCK_US' | 'FIXED_INCOME' | 'CASH';

export interface Asset {
    id: string;
    ticker: string;
    type: AssetType;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    totalValue: number; // Agora vem do backend em BRL
    totalCost: number;  // Agora vem do backend em BRL
    profit: number;
    profitPercent: number;
    currency: 'BRL' | 'USD';
    name?: string;
    sector?: string; 
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
    usdRate: number; // Taxa de câmbio oficial
    isLoading: boolean;
    refreshWallet: () => Promise<void>;
    addAsset: (asset: any) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    resetWallet: () => Promise<void>;
    updateTargets: (newTargets: AllocationMap, newReserveTarget: number) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [history, setHistory] = useState<HistoryPoint[]>([]);
    const [usdRate, setUsdRate] = useState(5.75); // Fallback inicial
    
    const [kpis, setKpis] = useState<WalletKPIs>({
        totalEquity: 0, totalInvested: 0, totalResult: 0, 
        totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0
    });
    const [isLoading, setIsLoading] = useState(true);

    const [targetAllocation, setTargetAllocation] = useState<AllocationMap>({ STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10 });
    const [targetReserve, setTargetReserve] = useState(10000);

    const refreshWallet = async () => {
        try {
            const [data, historyData] = await Promise.all([
                walletService.getWallet(),
                walletService.getHistory()
            ]);
            
            // O Backend agora retorna os dados calculados e o câmbio usado
            if (data.meta?.usdRate) setUsdRate(data.meta.usdRate);

            setAssets(data.assets || []);
            setHistory(historyData || []);
            
            // KPIs vêm prontos do backend
            setKpis(data.kpis || {
                totalEquity: 0, totalInvested: 0, totalResult: 0, 
                totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0
            });

        } catch (e) {
            console.error("Erro ao sincronizar carteira", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshWallet();
    }, []);

    const addAsset = async (newAsset: any) => {
        setIsLoading(true);
        try {
            await walletService.addAsset(newAsset);
            await refreshWallet();
        } catch (e) {
            alert("Erro ao adicionar ativo.");
        } finally {
            setIsLoading(false);
        }
    };

    const removeAsset = async (id: string) => {
        setIsLoading(true);
        try {
            await walletService.removeAsset(id);
            await refreshWallet();
        } catch (e) {
            alert("Erro ao remover ativo.");
        } finally {
            setIsLoading(false);
        }
    };

    const resetWallet = async () => {
        setIsLoading(true);
        try {
            await walletService.resetWallet();
            setAssets([]);
            setHistory([]);
            setKpis({
                totalEquity: 0, totalInvested: 0, totalResult: 0, 
                totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0
            });
        } catch (e) {
            alert("Erro ao resetar carteira.");
            await refreshWallet();
        } finally {
            setIsLoading(false);
        }
    };

    const updateTargets = (newTargets: AllocationMap, newReserveTarget: number) => {
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
    };

    return (
        <WalletContext.Provider value={{ 
            assets, kpis, history, targetAllocation, targetReserve, usdRate,
            isLoading, refreshWallet, addAsset, removeAsset, resetWallet,
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
