import React, { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    WalletContext, DEFAULT_SUB_ALLOCATION,
    type WalletContextType, type WalletDataSource, type HistoryPoint,
} from './WalletContext';
import { publicWalletService, publicWalletQueryOptions, type PublicWalletData } from '../services/publicWallet';
import { computeWalletKpis } from '../utils/kpiCalculations';

/**
 * (C4) Provider IRMÃO do WalletProvider para o link público.
 *
 * Preenche o MESMO contexto a partir das rotas públicas por token, para que a
 * página Carteira renderize com os mesmos componentes numa visita anônima. Duas
 * diferenças, ambas expressas por flags do contexto e não por outra página:
 *
 *  - `isReadOnly`: nenhuma ação de escrita aparece; toda mutação é no-op (o
 *    caminho nem existe no backend público, mas o contrato do contexto pede
 *    as funções).
 *  - `isValuesLocked`: quando o dono não liberou os R$, o servidor manda os
 *    monetários normalizados (patrimônio = 100) e a privacidade fica travada —
 *    nenhum valor real existe para ser revelado.
 */

interface PublicWalletProviderProps {
    token: string;
    children: ReactNode;
}

const noop = async () => { /* leitura pública: sem escrita */ };

export const PublicWalletProvider: React.FC<PublicWalletProviderProps> = ({ token, children }) => {
    // Mesma config (e mesma chave) que a página usa para carregando/erro: uma só
    // requisição alimenta os dois.
    const walletQuery = useQuery<PublicWalletData>(publicWalletQueryOptions(token));

    const historyQuery = useQuery<HistoryPoint[]>({
        queryKey: ['publicWalletHistory', token],
        queryFn: () => publicWalletService.getHistory(token),
        enabled: walletQuery.isSuccess,
        staleTime: 60_000,
    });

    const showValues = !!walletQuery.data?.showValues;
    // Com valores liberados o visitante ainda pode ocultá-los na própria tela;
    // sem eles, a privacidade é imposta (não há o que revelar).
    const [isPrivacyMode, setIsPrivacyMode] = useState(false);

    const assets = useMemo(() => walletQuery.data?.assets || [], [walletQuery.data?.assets]);
    const kpis = useMemo(
        () => computeWalletKpis(assets, walletQuery.data?.kpis),
        [assets, walletQuery.data?.kpis],
    );

    const dataSource = useMemo<WalletDataSource>(() => ({
        getPerformance: () => publicWalletService.getPerformance(token),
        getDividends: () => publicWalletService.getDividends(token),
        getCashFlow: (page, limit, filterType) => publicWalletService.getCashFlow(token, page, limit, filterType),
    }), [token]);

    const value = useMemo<WalletContextType>(() => ({
        assets,
        kpis,
        history: historyQuery.data || [],
        // A Carteira Ideal é o PLANO do dono, não a carteira dele: não é
        // publicada. Em modo leitura a Distribuição fica travada em "Atual".
        targetAllocation: {},
        targetReserve: 0,
        targetMonthlyDividendIncome: 0,
        targetSubAllocation: DEFAULT_SUB_ALLOCATION,
        usdRate: walletQuery.data?.meta?.usdRate || 5.75,
        isLoading: walletQuery.isLoading || historyQuery.isLoading,
        isRefreshing: walletQuery.isFetching && !walletQuery.isLoading,
        isPrivacyMode: showValues ? isPrivacyMode : true,
        togglePrivacyMode: () => { if (showValues) setIsPrivacyMode(prev => !prev); },
        isReadOnly: true,
        isValuesLocked: !showValues,
        dataSource,
        refreshWallet: () => { walletQuery.refetch(); },
        addAsset: noop,
        updateAsset: noop,
        removeAsset: noop,
        resetWallet: noop,
        updateTargets: () => { /* leitura pública: sem escrita */ },
        importCommit: async () => undefined,
        importUndo: noop,
        wallets: [],
        // Prefixo `public:` isola as chaves de query desta visita das da área
        // logada (mesmo navegador, mesmo QueryClient).
        activeWalletId: `public:${token}`,
        isWalletScopeReady: true,
        activeWalletName: walletQuery.data?.wallet?.name || 'Carteira',
        isWalletsLoading: false,
        isSwitchingWallet: false,
        setActiveWallet: noop,
        createWallet: async () => undefined,
        renameWallet: noop,
        deleteWallet: noop,
    }), [assets, kpis, historyQuery.data, historyQuery.isLoading, walletQuery, showValues, isPrivacyMode, dataSource, token]);

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
