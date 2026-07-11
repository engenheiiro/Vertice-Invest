
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletService, type UpdateAssetPayload } from '../services/wallet';
import { walletsService, WalletSummary } from '../services/wallets';
import { useAuth } from './AuthContext';
import { useDemo } from './DemoContext'; // Importar DemoContext
import { useToast } from './ToastContext';
import { DEMO_ASSETS, DEMO_KPIS, DEMO_HISTORY } from '../data/DEMO_DATA'; // Importar Dados Mock
import { STALE_TIME } from '../config/queryConfig';
import { computeWalletKpis } from '../utils/kpiCalculations';
import { getErrorMessage } from '../utils/errorMessages';

// ETF: classe própria para fundos de índice nacionais (BRL) e internacionais (USD).
// OURO mantido só por compatibilidade com carteiras antigas (não oferecido na UI;
// ouro entra como ETF lastreado, ex. GLD/GOLD11).
export type AssetType = 'STOCK' | 'FII' | 'CRYPTO' | 'STOCK_US' | 'ETF' | 'FIXED_INCOME' | 'CASH' | 'OURO';

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
    // Proventos recebidos (all-time, BRL) deste ativo — compõe a Rentabilidade
    // total (preço + proventos), distinta da Variação (só preço).
    dividendsReceived?: number;
    // Sub-tipos usados pela ramificação da Carteira Ideal (real vs meta):
    fixedIncomeIndex?: 'SELIC' | 'CDI' | 'IPCA' | 'PRE' | null;
    // ETF/GOLD: holdings de Exterior que são ETFs internacionais (ou ouro lastreado);
    // contam no Exterior, sub-tipo ETF.
    usSubType?: 'STOCK' | 'REIT' | 'DOLLAR' | 'ETF' | 'GOLD' | null;
    // C1: Reserva separada. true → sai da base de alocação e lista em "Caixa/Reserva".
    // Pode vir ausente em posições antigas (ver isReserveAsset em utils/allocation).
    isReserve?: boolean;
    // C2: vencimento da RF (ISO) e flag VENCIDO (accrual congelado; sugere resgate).
    maturityDate?: string | null;
    matured?: boolean;
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

// Sub-metas (ramificação) por classe. Percentuais RELATIVOS à fatia da classe
// (somam ~100% DENTRO da classe). Tudo 0 = sem sub-meta (classe em bloco).
export type FixedIncomeSubKey = 'IPCA' | 'POS' | 'PRE';
// Exterior ramifica em Stocks/REITs/ETFs/Dólar. ETFs internacionais (e ouro lastreado)
// contam aqui no sub-tipo ETF; a classe própria 'ETF' (AssetType) é só p/ ETFs nacionais.
export type UsSubKey = 'STOCK' | 'REIT' | 'ETF' | 'DOLLAR';
export interface SubAllocationMap {
    FIXED_INCOME: Record<FixedIncomeSubKey, number>;
    STOCK_US: Record<UsSubKey, number>;
}

export const DEFAULT_SUB_ALLOCATION: SubAllocationMap = {
    FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
    STOCK_US: { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 },
};

// Pseudo-carteira única usada só em modo demo — o seletor real fica oculto.
const DEMO_WALLETS: WalletSummary[] = [{ id: 'demo', name: 'Demo', isDefault: true, createdAt: new Date().toISOString() }];

interface WalletContextType {
    assets: Asset[];
    kpis: WalletKPIs;
    history: HistoryPoint[];
    targetAllocation: AllocationMap;
    targetReserve: number;
    targetMonthlyDividendIncome: number;
    targetSubAllocation: SubAllocationMap;
    usdRate: number;
    isLoading: boolean;
    isRefreshing: boolean;
    isPrivacyMode: boolean;
    togglePrivacyMode: () => void;
    refreshWallet: () => void;
    addAsset: (asset: any) => Promise<void>;
    updateAsset: (id: string, data: UpdateAssetPayload) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    resetWallet: () => Promise<void>;
    updateTargets: (newTargets: AllocationMap, newReserveTarget: number, newSubAllocation?: SubAllocationMap, newDividendGoal?: number) => void;
    // --- Fase 2: múltiplas carteiras ---
    wallets: WalletSummary[];
    activeWalletId: string | undefined;
    activeWalletName: string;
    isWalletsLoading: boolean;
    isSwitchingWallet: boolean;
    setActiveWallet: (walletId: string) => Promise<void>;
    createWallet: (name: string) => Promise<WalletSummary | undefined>;
    renameWallet: (walletId: string, name: string) => Promise<void>;
    deleteWallet: (walletId: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { isDemoMode } = useDemo(); // Hook do Modo Demo
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    const [targetAllocation, setTargetAllocation] = useState<AllocationMap>({ STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10 });
    const [targetReserve, setTargetReserve] = useState(10000);
    const [targetMonthlyDividendIncome, setTargetMonthlyDividendIncome] = useState(0);
    const [targetSubAllocation, setTargetSubAllocation] = useState<SubAllocationMap>(DEFAULT_SUB_ALLOCATION);
    const [activeWalletId, setActiveWalletId] = useState<string | undefined>(undefined);

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
    const walletsQuery = useQuery({
        queryKey: ['wallets', user?.id],
        queryFn: walletsService.list,
        enabled: !!user?.id && !isDemoMode,
        staleTime: STALE_TIME.MEDIUM,
    });

    // A carteira ativa é resolvida pelo servidor (User.activeWalletId) e sincronizada
    // aqui; a partir daí, cada troca via setActiveWallet atualiza o estado local
    // otimisticamente, e as queries wallet-scoped (chave inclui activeWalletId)
    // buscam de novo sozinhas — sem precisar de invalidação manual em cada uma.
    useEffect(() => {
        if (isDemoMode) return;
        const serverActive = walletsQuery.data?.activeWalletId;
        if (serverActive && serverActive !== activeWalletId) setActiveWalletId(serverActive);
    }, [walletsQuery.data?.activeWalletId, isDemoMode]); // eslint-disable-line react-hooks/exhaustive-deps

    const walletQuery = useQuery({
        queryKey: ['wallet', user?.id, activeWalletId],
        queryFn: () => walletService.getWallet(activeWalletId),
        enabled: !!user?.id && !isDemoMode, // Não busca se estiver em Demo
        staleTime: STALE_TIME.REALTIME,
    });

    const historyQuery = useQuery({
        queryKey: ['walletHistory', user?.id, activeWalletId],
        queryFn: () => walletService.getHistory(activeWalletId),
        enabled: !!user?.id && !isDemoMode,
        staleTime: STALE_TIME.MEDIUM,
    });

    // --- HIDRATA CARTEIRA IDEAL DO SERVIDOR ---
    // O backend retorna targetAllocation/targetReserve persistidos na carteira ativa.
    // Sincroniza sempre que a carteira recarregar (login, refresh, troca de conta/carteira).
    useEffect(() => {
        if (isDemoMode) return;
        const data = walletQuery.data;
        if (data?.targetAllocation) setTargetAllocation(data.targetAllocation);
        if (typeof data?.targetReserve === 'number') setTargetReserve(data.targetReserve);
        if (typeof data?.targetMonthlyDividendIncome === 'number') setTargetMonthlyDividendIncome(data.targetMonthlyDividendIncome);
        if (data?.targetSubAllocation) {
            setTargetSubAllocation({
                FIXED_INCOME: { ...DEFAULT_SUB_ALLOCATION.FIXED_INCOME, ...data.targetSubAllocation.FIXED_INCOME },
                STOCK_US: { ...DEFAULT_SUB_ALLOCATION.STOCK_US, ...data.targetSubAllocation.STOCK_US },
            });
        }
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
        mutationFn: (asset: any) => walletService.addAsset(asset, activeWalletId),
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
        mutationFn: ({ id, data }: { id: string; data: UpdateAssetPayload }) =>
            walletService.updateAsset(id, data, activeWalletId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wallet', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['cashFlow'] });
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao atualizar ativo.', 'error')
    });

    const removeAssetMutation = useMutation({
        mutationFn: (id: string) => walletService.removeAsset(id, activeWalletId),
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
        mutationFn: () => walletService.resetWallet(activeWalletId),
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

    const setActiveWalletMutation = useMutation({
        mutationFn: (walletId: string) => walletsService.setActive(walletId),
        onSuccess: (_data, walletId) => {
            setActiveWalletId(walletId);
            queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
        },
        onError: (err: any) => addToast(err?.message || 'Erro ao trocar de carteira.', 'error')
    });

    // --- ACTIONS ---
    const addAsset = async (newAsset: any) => {
        if (isDemoMode) return; // Bloqueia ações no demo
        await addAssetMutation.mutateAsync(newAsset);
    };

    const updateAsset = async (id: string, data: UpdateAssetPayload) => {
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

    const updateTargets = async (newTargets: AllocationMap, newReserveTarget: number, newSubAllocation?: SubAllocationMap, newDividendGoal?: number) => {
        // Atualização otimista (UI responde na hora); persiste no backend logo em seguida.
        setTargetAllocation(newTargets);
        setTargetReserve(newReserveTarget);
        if (newSubAllocation) setTargetSubAllocation(newSubAllocation);
        if (newDividendGoal !== undefined) setTargetMonthlyDividendIncome(newDividendGoal);
        if (isDemoMode) return; // Demo não persiste
        try {
            await walletService.updateTargets(newTargets as Record<string, number>, newReserveTarget, newSubAllocation, newDividendGoal, activeWalletId);
        } catch (err: unknown) {
            addToast(getErrorMessage(err, 'Erro ao salvar carteira ideal.'), 'error');
        }
    };

    const setActiveWallet = async (walletId: string) => {
        if (isDemoMode || walletId === activeWalletId) return;
        await setActiveWalletMutation.mutateAsync(walletId);
    };

    const createWallet = async (name: string) => {
        if (isDemoMode) return undefined;
        const res = await walletsService.create(name);
        queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
        if (res?.wallet?.id) await setActiveWalletMutation.mutateAsync(res.wallet.id);
        return res.wallet;
    };

    const renameWallet = async (walletId: string, name: string) => {
        if (isDemoMode) return;
        await walletsService.rename(walletId, name);
        queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
    };

    const deleteWallet = async (walletId: string) => {
        if (isDemoMode) return;
        const res = await walletsService.remove(walletId);
        queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
        // O backend já realoca a carteira ativa (na mesma transação) quando a
        // apagada era a corrente, e devolve o novo id — seta direto em vez de
        // esperar o próximo GET /wallets, senão a query key ['wallet', undefined]
        // busca uma vez e depois refaz pra ['wallet', novoId] (flash de loading).
        if (walletId === activeWalletId) setActiveWalletId(res.activeWalletId || undefined);
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

    const wallets = isDemoMode ? DEMO_WALLETS : (walletsQuery.data?.wallets || []);
    const activeWalletName = isDemoMode ? 'Demo' : (wallets.find(w => w.id === activeWalletId)?.name || 'Minha Carteira');

    return (
        <WalletContext.Provider value={{
            assets,
            kpis,
            history,
            targetAllocation,
            targetReserve,
            targetMonthlyDividendIncome,
            targetSubAllocation,
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
            updateTargets,
            wallets,
            activeWalletId,
            activeWalletName,
            isWalletsLoading: !isDemoMode && walletsQuery.isLoading,
            isSwitchingWallet: setActiveWalletMutation.isPending,
            setActiveWallet,
            createWallet,
            renameWallet,
            deleteWallet,
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
