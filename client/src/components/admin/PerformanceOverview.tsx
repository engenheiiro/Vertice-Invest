import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity, AlertTriangle, ChevronDown, ChevronRight, Clock3,
    Database, Gauge, MemoryStick, RefreshCw, ServerCog,
} from 'lucide-react';
import {
    performanceService,
    type PerformanceDurationMetric,
    type PerformanceSnapshot,
} from '../../services/performance';

const formatMs = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (value < 1) return `${value.toFixed(2)} ms`;
    if (value < 1000) return `${Math.round(value)} ms`;
    return `${(value / 1000).toFixed(2)} s`;
};

const formatUptime = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
    const hours = Math.floor(seconds / 3600);
    if (hours < 1) return `${Math.max(1, Math.floor(seconds / 60))} min`;
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)} dias`;
};

const MetricCard = ({
    label, value, detail, Icon,
}: {
    label: string;
    value: string;
    detail: string;
    Icon: React.ElementType;
}) => (
    <div className="rounded-xl border border-slate-800 bg-panel p-3 min-w-0">
        <div className="flex items-center gap-1.5 text-slate-500">
            <Icon size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
        </div>
        <p className="mt-1.5 text-lg font-black text-white font-mono truncate" title={value}>{value}</p>
        <p className="mt-0.5 text-[10px] text-slate-500 truncate" title={detail}>{detail}</p>
    </div>
);

const SlowMetricRow = ({ domain, metric }: { domain: string; metric: PerformanceDurationMetric }) => (
    <tr className="border-t border-slate-800">
        <td className="py-2 pr-3 text-[9px] font-bold uppercase text-slate-500">{domain}</td>
        <td className="py-2 pr-3 text-[11px] font-mono text-slate-300 break-all">{metric.key}</td>
        <td className="py-2 pr-3 text-[11px] font-mono text-white text-right whitespace-nowrap">{formatMs(metric.p95Ms)}</td>
        <td className="py-2 text-[11px] text-slate-500 text-right whitespace-nowrap">
            {metric.sampled}/{metric.count}
        </td>
    </tr>
);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export const PerformanceOverview = ({
    loadSnapshot = performanceService.getSnapshot,
}: {
    loadSnapshot?: () => Promise<PerformanceSnapshot>;
}) => {
    const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const load = useCallback(async () => {
        try {
            setSnapshot(await loadSnapshot());
            setUnavailable(false);
        } catch {
            setUnavailable(true);
        } finally {
            setIsLoading(false);
        }
    }, [loadSnapshot]);

    useEffect(() => {
        load();
        const timer = setInterval(load, 120000);
        return () => clearInterval(timer);
    }, [load]);

    const summary = useMemo(() => {
        const http = snapshot?.durations.http ?? [];
        const sampledHttp = http.filter((metric) => metric.sampled > 0 && metric.p95Ms !== null);
        const slowestHttp = [...sampledHttp].sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))[0];
        const requests = sum(http.map((metric) => metric.count));
        const errors = sum(http.map((metric) => metric.errors));

        const cache = snapshot?.counters.cache ?? {};
        const cacheEntries = Object.entries(cache);
        const cacheHits = sum(cacheEntries.filter(([key]) => key.endsWith('.hit')).map(([, value]) => value));
        const cacheAttempts = sum(cacheEntries
            .filter(([key]) => /\.(hit|miss|expired|fallback|error)$/.test(key))
            .map(([, value]) => value));

        const detailRows = Object.entries(snapshot?.durations ?? {})
            .flatMap(([domain, metrics]) => metrics
                .filter((metric) => metric.sampled > 0)
                .map((metric) => ({ domain, metric })))
            .sort((a, b) => (b.metric.p95Ms ?? 0) - (a.metric.p95Ms ?? 0))
            .slice(0, 12);

        return {
            slowestHttp,
            errorRate: requests > 0 ? errors / requests : null,
            requests,
            errors,
            cacheRate: cacheAttempts > 0 ? cacheHits / cacheAttempts : null,
            cacheAttempts,
            detailRows,
        };
    }, [snapshot]);

    return (
        <section className="bg-base border border-slate-800 rounded-2xl p-4" aria-labelledby="performance-title">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 id="performance-title" className="text-xs font-black text-white uppercase flex items-center gap-2">
                        <Gauge size={14} className="text-blue-500" />
                        Desempenho do sistema
                    </h4>
                    <p className="text-[10px] text-slate-500 mt-1">
                        Leitura desde o último reinício do servidor; atualiza a cada 2 minutos.
                    </p>
                </div>
                {snapshot?.enabled && (
                    <span className="text-[9px] font-bold uppercase text-emerald-400 bg-emerald-900/10 border border-emerald-900/40 px-2 py-1 rounded-full whitespace-nowrap">
                        Medição ativa
                    </span>
                )}
            </div>

            {isLoading && (
                <div className="flex items-center gap-2 py-6 text-slate-500">
                    <RefreshCw size={14} className="animate-spin" />
                    <span className="text-xs">Carregando medidores…</span>
                </div>
            )}

            {!isLoading && unavailable && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-yellow-900/40 bg-yellow-900/10 p-3">
                    <AlertTriangle size={15} className="text-yellow-400 mt-0.5 shrink-0" />
                    <div>
                        <p className="text-xs font-bold text-yellow-400">Medidores indisponíveis</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">A saúde dos dados continua funcionando normalmente. Tente novamente mais tarde.</p>
                    </div>
                </div>
            )}

            {!isLoading && !unavailable && snapshot && !snapshot.enabled && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-800 bg-panel p-3">
                    <ServerCog size={16} className="text-slate-500 mt-0.5 shrink-0" />
                    <div>
                        <p className="text-xs font-bold text-slate-300">Medição contínua desativada</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            A configuração do servidor está com <span className="font-mono text-slate-400">PERF_METRICS_ENABLED=false</span>. Altere para <span className="font-mono text-slate-400">true</span> e reinicie o servidor.
                        </p>
                    </div>
                </div>
            )}

            {!isLoading && snapshot?.enabled && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
                        <MetricCard
                            label="Rota mais lenta (p95)"
                            value={formatMs(summary.slowestHttp?.p95Ms)}
                            detail={summary.slowestHttp?.key ?? 'Aguardando tráfego'}
                            Icon={Activity}
                        />
                        <MetricCard
                            label="Erros HTTP"
                            value={summary.errorRate === null ? '—' : `${(summary.errorRate * 100).toFixed(2)}%`}
                            detail={`${summary.errors} erro(s) em ${summary.requests} requisições`}
                            Icon={AlertTriangle}
                        />
                        <MetricCard
                            label="Memória do servidor"
                            value={snapshot.runtime ? `${snapshot.runtime.memoryMb.rss.toFixed(0)} MB` : '—'}
                            detail={snapshot.runtime ? `Heap ${snapshot.runtime.memoryMb.heapUsed.toFixed(0)} MB` : 'Sem leitura'}
                            Icon={MemoryStick}
                        />
                        <MetricCard
                            label="Atraso interno (p95)"
                            value={formatMs(snapshot.runtime?.eventLoopDelayMs?.p95)}
                            detail="Fila interna do Node.js"
                            Icon={Clock3}
                        />
                        <MetricCard
                            label="Acerto de cache"
                            value={summary.cacheRate === null ? '—' : `${(summary.cacheRate * 100).toFixed(1)}%`}
                            detail={summary.cacheAttempts ? `${summary.cacheAttempts} consultas observadas` : 'Aguardando consultas'}
                            Icon={Database}
                        />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-[10px] text-slate-600">
                            Amostragem {(snapshot.sampleRate * 100).toFixed(0)}% · servidor ativo há {formatUptime(snapshot.runtime?.uptimeSeconds)}
                        </p>
                        <button
                            onClick={() => setShowDetails((value) => !value)}
                            className="text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                        >
                            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {showDetails ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}
                        </button>
                    </div>

                    {showDetails && (
                        <div className="overflow-x-auto mt-3">
                            {summary.detailRows.length === 0 ? (
                                <p className="text-[10px] text-slate-500 py-2">Ainda não há amostras suficientes.</p>
                            ) : (
                                <table className="w-full min-w-[600px]">
                                    <thead>
                                        <tr className="text-[9px] text-slate-500 font-bold uppercase text-left">
                                            <th className="pb-2 pr-3">Origem</th>
                                            <th className="pb-2 pr-3">Operação</th>
                                            <th className="pb-2 pr-3 text-right">p95</th>
                                            <th className="pb-2 text-right">Amostras/total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {summary.detailRows.map(({ domain, metric }) => (
                                            <SlowMetricRow key={`${domain}:${metric.key}`} domain={domain} metric={metric} />
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
};
