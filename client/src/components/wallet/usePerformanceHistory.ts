import { useEffect, useState } from 'react';
import { useDemo } from '../../contexts/DemoContext';
import { useWallet } from '../../contexts/WalletContext';
import { DEMO_PERFORMANCE } from '../../data/DEMO_DATA';
import { sortPerformanceHistory, type PerformancePoint } from './performanceChartView';

/**
 * Histórico de performance da carteira ativa. Em demo usa os dados de
 * demonstração e não lê a API; falha da API vira série vazia.
 */
export function usePerformanceHistory() {
    const [data, setData] = useState<PerformancePoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { isDemoMode } = useDemo();
    const { activeWalletId, isWalletScopeReady, dataSource } = useWallet();

    const loadPerformance = async () => {
        setIsLoading(true);

        if (isDemoMode) {
            setTimeout(() => {
                setData(DEMO_PERFORMANCE);
                setIsLoading(false);
            }, 600);
            return;
        }

        try {
            const res = await dataSource.getPerformance();
            setData(sortPerformanceHistory(res));
        } catch (e) {
            console.error('Erro carregando performance:', e);
            setData([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        // Espera a carteira ativa ser resolvida: buscar antes traria a performance
        // sem escopo e o efeito rodaria de novo com o id (duas chamadas caras).
        if (!isWalletScopeReady) return;
        loadPerformance();
        // `loadPerformance` é recriada a cada render; como dependência ela anularia
        // justamente o cuidado descrito acima, refazendo a chamada cara a cada
        // render em vez de só quando o escopo/carteira muda.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPerformance recriada a cada render refaria a chamada cara
    }, [isDemoMode, activeWalletId, isWalletScopeReady]);

    return { data, isLoading, isDemoMode };
}
