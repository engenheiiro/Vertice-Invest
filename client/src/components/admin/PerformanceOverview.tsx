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

/**
 * Teto de memória da instância. Sem um denominador, "180 MB" não diz nada — o
 * mesmo número é folgado num plano e é véspera de reinício em outro. O processo
 * sobe com `--max-old-space-size=400` dentro de uma instância de 512 MB, e é
 * contra esse teto que o alerta faz sentido.
 */
const MEMORY_LIMIT_MB = 512;

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

/**
 * Veredito de um medidor.
 *
 * Existe porque a versão anterior exibia cinco números sem régua nenhuma: "412 ms",
 * "0,80%", "180 MB" — informação para quem já sabe o que é bom, ruído para todos os
 * outros. Um painel de saúde que obriga o leitor a saber os limiares de cor não
 * está medindo saúde, está imprimindo telemetria.
 *
 * `null` = sem amostra suficiente para julgar (nunca "ruim").
 */
type Verdict = 'GOOD' | 'WATCH' | 'BAD' | null;

const VERDICT_UI: Record<Exclude<Verdict, null>, { value: string; chip: string; label: string }> = {
    GOOD: { value: 'text-emerald-400', chip: 'bg-emerald-900/20 text-emerald-400', label: 'normal' },
    WATCH: { value: 'text-yellow-400', chip: 'bg-yellow-900/20 text-yellow-400', label: 'atenção' },
    BAD: { value: 'text-red-400', chip: 'bg-red-900/20 text-red-400', label: 'ruim' },
};

/** Compara contra limiares crescentes (quanto MENOR, melhor). */
const gradeAscending = (value: number | null | undefined, watch: number, bad: number): Verdict => {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    if (value >= bad) return 'BAD';
    if (value >= watch) return 'WATCH';
    return 'GOOD';
};

/** Compara contra limiares decrescentes (quanto MAIOR, melhor). */
const gradeDescending = (value: number | null | undefined, watch: number, bad: number): Verdict => {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    if (value <= bad) return 'BAD';
    if (value <= watch) return 'WATCH';
    return 'GOOD';
};

const MetricCard = ({
    label, value, detail, Icon, verdict, meaning,
}: {
    label: string;
    value: string;
    detail: string;
    Icon: React.ElementType;
    verdict?: Verdict;
    /** Uma frase dizendo o que o número significa. É o que torna o card legível. */
    meaning?: string;
}) => {
    const ui = verdict ? VERDICT_UI[verdict] : null;
    return (
        <div className="rounded-xl border border-slate-800 bg-panel p-3 min-w-0">
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                    <Icon size={12} className="shrink-0" />
                    <span className="text-[9px] font-bold uppercase tracking-wide truncate">{label}</span>
                </div>
                {ui && (
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${ui.chip}`}>
                        {ui.label}
                    </span>
                )}
            </div>
            <p className={`mt-1.5 text-lg font-black font-mono truncate ${ui ? ui.value : 'text-white'}`} title={value}>
                {value}
            </p>
            {meaning && <p className="mt-0.5 text-[10px] text-slate-400 leading-snug">{meaning}</p>}
            <p className="mt-0.5 text-[10px] text-slate-500 truncate" title={detail}>{detail}</p>
        </div>
    );
};

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

        const errorRate = requests > 0 ? errors / requests : null;
        const cacheRate = cacheAttempts > 0 ? cacheHits / cacheAttempts : null;
        const memoryMb = snapshot?.runtime ? snapshot.runtime.memoryMb.rss : null;

        // Uma frase no lugar de cinco números soltos: quem abre a aba quer saber
        // se precisa agir, não interpretar percentis.
        const verdicts = [
            gradeAscending(slowestHttp?.p95Ms, 1000, 3000),
            gradeAscending(errorRate, 0.01, 0.05),
            gradeAscending(memoryMb, MEMORY_LIMIT_MB * 0.75, MEMORY_LIMIT_MB * 0.9),
            gradeAscending(snapshot?.runtime?.eventLoopDelayMs?.p95, 100, 500),
            gradeDescending(cacheRate, 0.5, 0.2),
        ];
        const ruins = verdicts.filter((v) => v === 'BAD').length;
        const atencao = verdicts.filter((v) => v === 'WATCH').length;
        const verdictLabel = ruins > 0
            ? `${ruins} medidor(es) fora do aceitável — o site pode estar lento ou falhando para o usuário.`
            : atencao > 0
                ? `${atencao} medidor(es) merecendo o olho, mas nada quebrado.`
                : 'Tudo dentro do normal — o site está respondendo bem e o servidor tem folga.';

        return {
            slowestHttp,
            errorRate,
            requests,
            errors,
            cacheRate,
            cacheAttempts,
            detailRows,
            verdictLabel,
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
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xl">
                        {summary.verdictLabel}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                        Quanto o site demora a responder e quanto fôlego o servidor tem. Leitura desde
                        o último reinício; atualiza a cada 2 minutos.
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
                            label="Página mais lenta"
                            value={formatMs(summary.slowestHttp?.p95Ms)}
                            meaning="Espera do usuário na tela mais pesada"
                            detail={summary.slowestHttp?.key ?? 'Aguardando tráfego'}
                            Icon={Activity}
                            verdict={gradeAscending(summary.slowestHttp?.p95Ms, 1000, 3000)}
                        />
                        <MetricCard
                            label="Requisições com erro"
                            value={summary.errorRate === null ? '—' : `${(summary.errorRate * 100).toFixed(2)}%`}
                            meaning="Telas que falharam ao carregar"
                            detail={`${summary.errors} erro(s) em ${summary.requests} requisições`}
                            Icon={AlertTriangle}
                            verdict={gradeAscending(summary.errorRate, 0.01, 0.05)}
                        />
                        <MetricCard
                            label="Memória do servidor"
                            value={snapshot.runtime ? `${snapshot.runtime.memoryMb.rss.toFixed(0)} MB` : '—'}
                            meaning={`De ${MEMORY_LIMIT_MB} MB disponíveis no plano`}
                            detail={snapshot.runtime ? `Heap ${snapshot.runtime.memoryMb.heapUsed.toFixed(0)} MB` : 'Sem leitura'}
                            Icon={MemoryStick}
                            verdict={gradeAscending(
                                snapshot.runtime ? snapshot.runtime.memoryMb.rss : null,
                                MEMORY_LIMIT_MB * 0.75,
                                MEMORY_LIMIT_MB * 0.9,
                            )}
                        />
                        <MetricCard
                            label="Congestionamento"
                            value={formatMs(snapshot.runtime?.eventLoopDelayMs?.p95)}
                            meaning="Fila de espera dentro do servidor"
                            detail="Alto = o servidor está engasgando"
                            Icon={Clock3}
                            verdict={gradeAscending(snapshot.runtime?.eventLoopDelayMs?.p95, 100, 500)}
                        />
                        <MetricCard
                            label="Aproveitamento de cache"
                            value={summary.cacheRate === null ? '—' : `${(summary.cacheRate * 100).toFixed(1)}%`}
                            meaning="Respostas servidas sem ir ao banco"
                            detail={summary.cacheAttempts ? `${summary.cacheAttempts} consultas observadas` : 'Aguardando consultas'}
                            Icon={Database}
                            verdict={gradeDescending(summary.cacheRate, 0.5, 0.2)}
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
