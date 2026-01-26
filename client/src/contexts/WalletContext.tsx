
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
            
            // Filtro de Segurança: Remove ativos corrompidos ou sem preço da lista visual principal se necessário,
            // ou apenas garante que eles não quebrem a UI.
            // Aqui optamos por filtrar ativos com preço zerado apenas dos cálculos de KPI para não "sujar" o dashboard,
            // mas mantemos na lista (assets) para que o usuário possa remover/editar.
            const rawAssets: Asset[] = data.assets || [];
            
            // Recálculo Local de KPIs para garantir consistência com o filtro de preço > 0
            let totalEquity = 0;
            let totalInvested = 0;
            let dayVariation = 0;

            const validAssets = rawAssets.map(asset => {
                // Se preço for inválido, forçamos 0 para não quebrar a UI
                const safePrice = asset.currentPrice > 0 ? asset.currentPrice : 0;
                const safeTotal = asset.quantity * safePrice * (asset.currency === 'USD' ? 5.65 : 1); // Mock USD Rate fallback
                const safeInvested = asset.quantity * asset.averagePrice * (asset.currency === 'USD' ? 5.65 : 1);
                
                if (safePrice > 0) {
                    totalEquity += safeTotal;
                    totalInvested += safeInvested;
                    // dayVariation viria do backend, aqui assumimos que o backend mandou calculado ou 0
                }

                return { ...asset, currentPrice: safePrice, totalValue: safeTotal };
            });

            // Recalcula KPIs baseados apenas em ativos válidos
            const totalResult = totalEquity - totalInvested;
            const totalResultPercent = totalInvested > 0 ? (totalResult / totalInvested) * 100 : 0;
            
            // Mantemos dayVariation do backend se disponível, senão 0
            const backendKpis = data.kpis || {};

            setAssets(validAssets);
            setKpis({
                totalEquity,
                totalInvested,
                totalResult,
                totalResultPercent,
                dayVariation: backendKpis.dayVariation || 0,
                dayVariationPercent: backendKpis.dayVariationPercent || 0,
                totalDividends: backendKpis.totalDividends || 0
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
