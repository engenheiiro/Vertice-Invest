
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '../config/queryConfig';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { SkeletonKpiGrid, SkeletonCard } from '../components/ui';
import { IndicatorCard } from '../components/indicators/IndicatorCard';
import { TreasuryPanel } from '../components/indicators/TreasuryPanel';
import { PrivateFixedPanel } from '../components/indicators/PrivateFixedPanel';
import { Activity, TrendingUp, Target, Percent, Clock, AlertTriangle } from 'lucide-react';
import {
    deriveFreshness, filterAndSortBonds, fmtLastUpdated, nextSort, type FilterType, type MacroView, type SortConfig,
} from './indicatorsView';

const LoadingSkeleton = () => (
    <div className="space-y-6" role="status" aria-label="Carregando indicadores">
        <SkeletonKpiGrid count={7} />
        <SkeletonCard className="h-56" />
        <SkeletonCard className="h-56" />
    </div>
);

const PageTitle = ({ lastUpdated }: { lastUpdated?: string }) => (
    <div className="flex items-center justify-between mb-8">
        <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Activity className="text-blue-500" />
                Painel de Indicadores
            </h1>
            <p className="text-slate-400 text-sm mt-1">Monitoramento em tempo real dos principais índices e taxas.</p>
            {lastUpdated ? (
                <p className="text-slate-500 text-[10px] mt-0.5 flex items-center gap-1">
                    <Clock size={9} />
                    Atualizado: {fmtLastUpdated(lastUpdated)} · Refresh automático a cada 15 min
                </p>
            ) : (
                <p className="text-slate-600 text-[10px] mt-0.5">Atualização automática a cada 15 minutos.</p>
            )}
        </div>
    </div>
);

/** Aviso de confiabilidade: taxa em fallback e/ou painel parado há mais de 1h. */
const StaleNotice = ({ staleMetrics, isPanelStale }: { staleMetrics: string[]; isPanelStale: boolean }) => {
    if (staleMetrics.length === 0 && !isPanelStale) return null;
    return (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
            <AlertTriangle size={18} className="text-yellow-400 mt-0.5 shrink-0" />
            <div className="text-sm text-yellow-200/90 space-y-1">
                {staleMetrics.length > 0 && (
                    <p>
                        <span className="font-bold">{staleMetrics.join(', ')} em fallback.</span> Nem o Banco Central nem a fonte secundária responderam — esses valores usam o último fallback conhecido, não dados oficiais. Os demais indicadores são reais.
                    </p>
                )}
                {isPanelStale && (
                    <p>Painel sem atualização há mais de 1 hora. A sincronização automática pode estar interrompida.</p>
                )}
            </div>
        </div>
    );
};

type Freshness = { selicStale: boolean; ipcaStale: boolean };

const RateCards = ({ data, selicStale, ipcaStale }: Freshness & { data: MacroView | null }) => (
    <>
        <IndicatorCard label="SELIC" value={data?.selic?.value} suffix="%" desc="Meta BCB" color="text-emerald-400" icon={<Target size={16} />} stale={selicStale} />
        <IndicatorCard label="CDI" value={data?.cdi?.value} suffix="%" desc="Taxa DI (≈ Selic − 0,10)" color="text-emerald-400" icon={<TrendingUp size={16} />} stale={selicStale} />
        <IndicatorCard label="IPCA (12m)" value={data?.ipca?.value} suffix="%" desc="Inflação" color="text-yellow-400" icon={<Percent size={16} />} stale={ipcaStale} />
    </>
);

const MarketCards = ({ ibov, usd, spx, btc }: Pick<MacroView, 'ibov' | 'usd' | 'spx' | 'btc'>) => (
    <>
        <IndicatorCard label="Ibovespa" value={ibov?.value} isCurrency={false} desc="Pts" change={ibov?.change} />
        <IndicatorCard label="Dólar Comercial" value={usd?.value} isCurrency={true} desc="BRL/USD" change={usd?.change} />
        <IndicatorCard label="S&P 500" value={spx?.value} isCurrency={false} desc="US Pts" change={spx?.change} />
        <IndicatorCard label="Bitcoin" value={btc?.value} isCurrency={true} currencyPrefix="$" desc="USD" color="text-purple-400" change={btc?.change} />
    </>
);

const IndicatorGrid = ({ data, selicStale, ipcaStale }: Freshness & { data: MacroView | null }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-10">
        <RateCards data={data} selicStale={selicStale} ipcaStale={ipcaStale} />
        <MarketCards ibov={data?.ibov} usd={data?.usd} spx={data?.spx} btc={data?.btc} />
    </div>
);

export const Indicators = () => {
    // Mesma chave do Dashboard (useDashboardData): vindo de lá, a tela abre com o
    // dado em cache em vez de buscar tudo de novo. O refetchInterval do React
    // Query pausa com a aba em segundo plano — o setInterval de antes, não.
    const macroQuery = useQuery({
        queryKey: ['macroData'],
        queryFn: researchService.getMacroData,
        staleTime: STALE_TIME.LONG,
        refetchInterval: STALE_TIME.LONG,
    });
    const data: MacroView | null = macroQuery.data ?? null;
    const isFirstLoad = macroQuery.isLoading && !data;
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'type', direction: 'asc' });
    const [filterType, setFilterType] = useState<FilterType>('ALL');
    // Estado dos painéis mora aqui: abrir re-renderiza a página, que lê o dado mais recente da query.
    const [isTreasuryOpen, setIsTreasuryOpen] = useState(false);
    const [isPrivateFixedOpen, setIsPrivateFixedOpen] = useState(false);
    const sortedBonds = useMemo(() => filterAndSortBonds(data?.bonds, filterType, sortConfig), [data?.bonds, sortConfig, filterType]);
    const { selicStale, ipcaStale, staleMetrics, isPanelStale } = deriveFreshness(data, Date.now());

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30 pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto p-4 md:p-6 animate-fade-in">
                {/* Skeleton de carregamento inicial */}
                {isFirstLoad && <LoadingSkeleton />}

                {/* Conteúdo principal — oculto enquanto carrega pela primeira vez */}
                <div className={isFirstLoad ? 'hidden' : ''}>
                    <PageTitle lastUpdated={data?.lastUpdated} />
                    <StaleNotice staleMetrics={staleMetrics} isPanelStale={isPanelStale} />
                    <IndicatorGrid data={data} selicStale={selicStale} ipcaStale={ipcaStale} />
                    <TreasuryPanel
                        bondCount={data?.bonds?.length || 0}
                        sortedBonds={sortedBonds}
                        lastUpdated={data?.lastUpdated}
                        isOpen={isTreasuryOpen}
                        onToggle={() => setIsTreasuryOpen(!isTreasuryOpen)}
                        sortConfig={sortConfig}
                        onSort={(key) => setSortConfig(nextSort(sortConfig, key))}
                        filterType={filterType}
                        onFilter={setFilterType}
                    />
                    <PrivateFixedPanel isOpen={isPrivateFixedOpen} onToggle={() => setIsPrivateFixedOpen(!isPrivateFixedOpen)} />
                </div>
            </main>
        </div>
    );
};
