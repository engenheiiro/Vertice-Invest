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
    totalValue: number;
    profit: number;
    profitPercent: number;
    currency: 'BRL' | 'USD';
    name?: string;
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

export type AllocationMap = Partial<Record<AssetType, number>>;

interface WalletContextType {
    assets: Asset[];
    kpis: WalletKPIs;
    targetAllocation: AllocationMap;
    targetReserve: number;
    isLoading: boolean;
    refreshWallet: () => Promise<void>;
    addAsset: (asset: any) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [kpis, setKpis] = useState<WalletKPIs>({
        totalEquity: 0, totalInvested: 0, totalResult: 0, 
        totalResultPercent: 0, dayVariation: 0, dayVariationPercent: 0, totalDividends: 0
    });
    const [isLoading, setIsLoading] = useState(true);

    const [targetAllocation] = useState<AllocationMap>({ STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10 });
    const [targetReserve] = useState(10000);

    const refreshWallet = async () => {
        try {
            const data = await walletService.getWallet();
            setAssets(data.assets || []);
            setKpis({ ...data.kpis, totalDividends: 0 });
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

    return (
        <WalletContext.Provider value={{ 
            assets, kpis, targetAllocation, targetReserve, 
            isLoading, refreshWallet, addAsset, removeAsset 
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