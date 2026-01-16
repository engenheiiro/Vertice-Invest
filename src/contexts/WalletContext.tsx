import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Tipos de Ativos Suportados
export type AssetType = 'STOCK' | 'FII' | 'CRYPTO' | 'STOCK_US' | 'FIXED_INCOME' | 'CASH';

export interface Asset {
    id: string;
    ticker: string;
    type: AssetType;
    name: string;
    quantity: number;
    averagePrice: number; // Preço Médio
    currentPrice: number; // Cotação Atual (Simulada ou Real)
    currency: 'BRL' | 'USD';
    
    // Dados Auxiliares
    sector?: string;
    dividendYield?: number; // % projetado 12m
}

export interface WalletKPIs {
    totalEquity: number;
    totalInvested: number;
    totalResult: number; // Lucro/Prejuízo em R$
    totalResultPercent: number; // Lucro/Prejuízo em %
    totalDividends: number; // Proventos recebidos (acumulado)
    dayVariation: number;
    dayVariationPercent: number;
}

// Mapeamento de Porcentagem Ideal por Categoria (Excluindo CASH)
// CASH agora é tratado via targetReserve (valor fixo)
export type AllocationMap = Partial<Record<AssetType, number>>;

interface WalletContextType {
    assets: Asset[];
    kpis: WalletKPIs;
    targetAllocation: AllocationMap;
    targetReserve: number; // Novo: Valor fixo alvo para reserva
    isLoading: boolean;
    addAsset: (asset: Omit<Asset, 'id' | 'currentPrice'>) => void;
    removeAsset: (id: string) => void;
    updateTargets: (newTargets: AllocationMap, newReserveTarget: number) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Dados Mockados Iniciais
const INITIAL_ASSETS: Asset[] = [
    { id: '1', ticker: 'PETR4', type: 'STOCK', name: 'Petrobras PN', quantity: 400, averagePrice: 32.50, currentPrice: 36.80, currency: 'BRL', dividendYield: 12.5 },
    { id: '2', ticker: 'VALE3', type: 'STOCK', name: 'Vale S.A.', quantity: 150, averagePrice: 72.00, currentPrice: 61.20, currency: 'BRL', dividendYield: 5.4 },
    { id: '3', ticker: 'HGLG11', type: 'FII', name: 'CSHG Logística', quantity: 25, averagePrice: 162.00, currentPrice: 168.50, currency: 'BRL', dividendYield: 9.2 },
    { id: '4', ticker: 'NVDA', type: 'STOCK_US', name: 'NVIDIA Corp', quantity: 10, averagePrice: 480.00, currentPrice: 880.00, currency: 'USD', dividendYield: 0.05 }, 
    { id: '5', ticker: 'BTC', type: 'CRYPTO', name: 'Bitcoin', quantity: 0.05, averagePrice: 180000, currentPrice: 345000, currency: 'BRL', dividendYield: 0 },
    { id: '6', ticker: 'SELIC', type: 'FIXED_INCOME', name: 'Tesouro Selic 2027', quantity: 1, averagePrice: 13500, currentPrice: 14200, currency: 'BRL', dividendYield: 13.75 },
    { id: '7', ticker: 'RESERVA', type: 'CASH', name: 'Reserva de Oportunidade', quantity: 1, averagePrice: 15000, currentPrice: 15000, currency: 'BRL', dividendYield: 0 },
];

// Targets agora somam 100% entre si, EXCLUINDO caixa/reserva
const DEFAULT_TARGETS: AllocationMap = {
    STOCK: 35,
    FII: 25,
    STOCK_US: 20,
    FIXED_INCOME: 15,
    CRYPTO: 5,
    // CASH removido daqui, pois é valor fixo
};

const DEFAULT_RESERVE_TARGET = 20000; // Valor fixo em R$

const USD_RATE = 5.00;

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [targetAllocation, setTargetAllocation] = useState<AllocationMap>(DEFAULT_TARGETS);
    const [targetReserve, setTargetReserve] = useState<number>(DEFAULT_RESERVE_TARGET);
    
    const [kpis, setKpis] = useState<WalletKPIs>({
        totalEquity: 0, totalInvested: 0, totalResult: 0, 
        totalResultPercent: 0, totalDividends: 0, dayVariation: 0, dayVariationPercent: 0
    });
    const [isLoading, setIsLoading] = useState(true);

    // Carregamento Inicial
    useEffect(() => {
        setTimeout(() => {
            setAssets(INITIAL_ASSETS);
            setIsLoading(false);
        }, 800);
    }, []);

    // Recálculo de KPIs
    useEffect(() => {
        if (assets.length === 0) {
             setKpis({ totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0, totalDividends: 0, dayVariation: 0, dayVariationPercent: 0 });
             return;
        }

        let equity = 0;
        let invested = 0;
        let dividends = 0;
        let dayVar = 0;

        assets.forEach(asset => {
            const multiplier = asset.currency === 'USD' ? USD_RATE : 1;
            
            const positionEquity = asset.quantity * asset.currentPrice * multiplier;
            const positionInvested = asset.quantity * asset.averagePrice * multiplier;
            
            equity += positionEquity;
            invested += positionInvested;
            dividends += positionEquity * ((asset.dividendYield || 0) / 100);

            // Mock de variação diária (CASH/Fixed Income variam pouco)
            let volatility = 0.015;
            if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') volatility = 0.001;
            
            const randomDailyMove = (Math.sin(asset.ticker.length) * volatility);
            dayVar += positionEquity * randomDailyMove;
        });

        const result = equity - invested;
        const resultPercent = invested > 0 ? (result / invested) * 100 : 0;
        const dayVarPercent = equity > 0 ? (dayVar / equity) * 100 : 0;

        setKpis({
            totalEquity: equity,
            totalInvested: invested,
            totalResult: result,
            totalResultPercent: resultPercent,
            totalDividends: dividends,
            dayVariation: dayVar,
            dayVariationPercent: dayVarPercent
        });

    }, [assets]);

    const addAsset = (newTransaction: Omit<Asset, 'id' | 'currentPrice'>) => {
        setAssets(prev => {
            const existingAssetIndex = prev.findIndex(a => a.ticker === newTransaction.ticker);
            const simulatedCurrentPrice = newTransaction.averagePrice; 

            if (existingAssetIndex >= 0) {
                const existing = prev[existingAssetIndex];
                const totalCost = (existing.quantity * existing.averagePrice) + (newTransaction.quantity * newTransaction.averagePrice);
                const totalQty = existing.quantity + newTransaction.quantity;
                const newAvgPrice = totalCost / totalQty;

                const updatedAssets = [...prev];
                updatedAssets[existingAssetIndex] = {
                    ...existing,
                    quantity: totalQty,
                    averagePrice: newAvgPrice,
                    // Se for CASH/Reserva, atualizamos o currentPrice também para refletir o aporte como valor atual
                    currentPrice: newTransaction.type === 'CASH' ? newAvgPrice : existing.currentPrice 
                };
                
                // Se for CASH, o currentPrice geralmente é 1:1 com o valor, mas aqui simplificamos mantendo a lógica de quantidade * preço
                if(newTransaction.type === 'CASH') {
                     updatedAssets[existingAssetIndex].currentPrice = 1; 
                     updatedAssets[existingAssetIndex].quantity = (existing.quantity * existing.averagePrice) + (newTransaction.quantity * newTransaction.averagePrice);
                     updatedAssets[existingAssetIndex].averagePrice = 1;
                }

                return updatedAssets;
            } else {
                const newAsset: Asset = {
                    ...newTransaction,
                    id: Math.random().toString(36).substr(2, 9),
                    currentPrice: simulatedCurrentPrice,
                    dividendYield: Math.random() * 12 
                };
                return [...prev, newAsset];
            }
        });
    };

    const removeAsset = (id: string) => {
        setAssets(prev => prev.filter(a => a.id !== id));
    };

    const updateTargets = (newTargets: AllocationMap, newReserveTarget: number) => {
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
    };

    return (
        <WalletContext.Provider value={{ 
            assets, 
            kpis, 
            targetAllocation, 
            targetReserve,
            isLoading, 
            addAsset, 
            removeAsset, 
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