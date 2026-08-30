import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity, AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronRight,
    Clock, RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react';
import {
    healthService,
    type BackendError,
    type DataHealthResponse,
    type HealthCheck,
    type HealthStatus,
    type JobStatus,
} from '../../services/health';
import { useToast } from '../../contexts/ToastContext';
import { getErrorMessage } from '../../utils/errorMessages';

/**
 * Aba "Saúde" do Admin.
 *
 * Regra de leitura da tela: o que está QUEBRADO aparece primeiro e já explica
 * onde olhar (`hint`). O resto fica recolhido — um painel que mostra 60 checks
 * verdes com igual destaque é um painel que ninguém lê.
 */

const STATUS_UI: Record<HealthStatus, { text: string; bg: string; border: string; label: string; Icon: React.ElementType }> = {
    OK: { text: 'text-emerald-400', bg: 'bg-emerald-900/10', border: 'border-emerald-900/40', label: 'Tudo certo', Icon: CheckCircle2 },
    WARN: { text: 'text-yellow-400', bg: 'bg-yellow-900/10', border: 'border-yellow-900/40', label: 'Atenção', Icon: AlertTriangle },
    CRITICAL: { text: 'text-red-400', bg: 'bg-red-900/10', border: 'border-red-900/40', label: 'Crítico', Icon: XCircle },
};

const relativeTime = (iso: string | null | undefined) => {
    if (!iso) return 'nunca';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return '—';
    const min = Math.round(diffMs / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `há ${h}h`;
    return `há ${Math.round(h / 24)} dias`;
};

/**
 * Checks de `plausibility.*` publicam FRAÇÃO do universo, menos este: o catálogo do
 * Tesouro tem ~37 documentos e o que interessa é quantos estão defeituosos. Sem a
 * exceção, 4 duplicatas apareceriam no painel como "400,0%".
 */
const COUNT_VALUE_CHECKS = new Set(['plausibility.treasuryCatalog']);

/** Só valores fracionários viram %. Idade em horas e contagem ficam como estão. */
const formatValue = (check: HealthCheck) => {
    if (check.value === null) return '—';
    if (COUNT_VALUE_CHECKS.has(check.id)) return null;
    if (check.id.startsWith('coverage.') || check.id.startsWith('freshness.price.')
        || check.id.startsWith('plausibility.') || check.id === 'ingestion.inactiveAssets'
        || check.id === 'freshness.timeSeriesUniverse') {
        return `${(check.value * 100).toFixed(1)}%`;
    }
    return null;
};

const StatusPill = ({ status }: { status: HealthStatus }) => {
    const ui = STATUS_UI[status];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${ui.bg} ${ui.text} border ${ui.border}`}>
            <ui.Icon size={11} />
            {status}
        </span>
    );
};

const CheckRow = ({ check }: { check: HealthCheck }) => {
    const ui = STATUS_UI[check.status];
    const value = formatValue(check);
    return (
        <div className={`p-3 rounded-xl border ${check.status === 'OK' ? 'border-slate-800 bg-panel' : `${ui.border} ${ui.bg}`}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <ui.Icon size={13} className={`${ui.text} shrink-0`} />
                        <span className="text-xs font-bold text-white">{check.label}</span>
                        <span className="text-[9px] font-bold uppercase text-slate-500 bg-elevated px-1.5 py-0.5 rounded">
                            {check.category}
                        </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{check.detail}</p>
                    {check.status !== 'OK' && check.hint && (
                        <p className="text-[10px] text-slate-500 mt-1.5 italic">↳ {check.hint}</p>
                    )}
                </div>
                {value && <span className={`text-sm font-mono font-bold shrink-0 ${ui.text}`}>{value}</span>}
            </div>
        </div>
    );
};

const JobRow = ({ job }: { job: JobStatus }) => {
    const failed = job.lastStatus === 'FAILED';
    const overdue = job.monitored && job.maxSilenceHours !== null && job.lastRunAt
        ? (Date.now() - new Date(job.lastRunAt).getTime()) / 3600000 > job.maxSilenceHours
        : job.monitored && !job.lastRunAt;
    const bad = failed || overdue;

    return (
        <tr className="border-t border-slate-800">
            <td className="py-2 pr-3">
                <span className="text-xs font-bold text-white">{job.label}</span>
                {!job.monitored && (
                    <span className="ml-2 text-[9px] text-slate-600 font-bold uppercase">sob demanda</span>
                )}
                {failed && job.lastError && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate max-w-md">{job.lastError}</p>
                )}
            </td>
            <td className="py-2 pr-3 text-[11px] text-slate-400 whitespace-nowrap">{relativeTime(job.lastRunAt)}</td>
            <td className="py-2 pr-3 text-[11px] text-slate-500 whitespace-nowrap">
                {job.runs24h}× / 24h
                {job.failures24h > 0 && <span className="text-red-400 font-bold"> ({job.failures24h} falha)</span>}
            </td>
            <td className="py-2 text-right">
                {bad
                    ? <StatusPill status={job.severity === 'CRITICAL' ? 'CRITICAL' : 'WARN'} />
                    : <StatusPill status="OK" />}
            </td>
        </tr>
    );
};

const ErrorRow = ({ error, onResolve }: { error: BackendError; onResolve: (id: string) => void }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-slate-800 rounded-xl bg-panel overflow-hidden">
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-start gap-3 p-3 text-left hover:bg-elevated/50 transition-colors"
            >
                {open ? <ChevronDown size={14} className="text-slate-500 mt-0.5 shrink-0" />
                    : <ChevronRight size={14} className="text-slate-500 mt-0.5 shrink-0" />}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-bold uppercase text-slate-400 bg-elevated px-1.5 py-0.5 rounded">
                            {error.origin}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 truncate">{error.source}</span>
                        {error.count > 1 && (
                            <span className="text-[10px] font-bold text-red-400 bg-red-900/20 px-1.5 py-0.5 rounded">
                                {error.count}×
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-white mt-1 break-words">{error.message}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                        {error.code} · último {relativeTime(error.lastSeenAt)} · primeiro {relativeTime(error.firstSeenAt)}
                    </p>
                </div>
            </button>
            {open && (
                <div className="px-3 pb-3 pl-10">
                    {error.stack && (
                        <pre className="text-[10px] text-slate-500 bg-deep p-2 rounded-lg overflow-x-auto max-h-48 whitespace-pre-wrap">
                            {error.stack}
                        </pre>
                    )}
                    <button
                        onClick={() => onResolve(error._id)}
                        className="mt-2 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                        Marcar como tratado
                    </button>
                </div>
            )}
        </div>
    );
};

export const AdminSaudeTab = () => {
    const { addToast } = useToast();
    const [data, setData] = useState<DataHealthResponse | null>(null);
    const [errors, setErrors] = useState<BackendError[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRunning, setIsRunning] = useState(false);
    const [showAllChecks, setShowAllChecks] = useState(false);

    const load = async () => {
        try {
            const [health, errorList] = await Promise.all([
                healthService.getDataHealth(),
                healthService.listErrors(),
            ]);
            setData(health);
            setErrors(errorList.errors);
        } catch (e) {
            addToast(getErrorMessage(e, 'Falha ao carregar a saúde dos dados.'), 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        load();
        // A sentinela grava de hora em hora — a única parte que se move rápido é a
        // lista de erros. 2 min acompanha isso sem o painel virar fonte de carga
        // (cada ciclo custa 2 chamadas dentro do orçamento do adminLimiter).
        const timer = setInterval(load, 120000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRunNow = async () => {
        setIsRunning(true);
        try {
            await healthService.runNow();
            await load();
            addToast('Saúde dos dados reavaliada.', 'success');
        } catch (e) {
            addToast(getErrorMessage(e, 'Falha ao reavaliar a saúde dos dados.'), 'error');
        } finally {
            setIsRunning(false);
        }
    };

    const handleResolve = async (id: string) => {
        try {
            await healthService.resolveError(id);
            setErrors((prev) => prev.filter((e) => e._id !== id));
            addToast('Erro marcado como tratado.', 'success');
        } catch (e) {
            addToast(getErrorMessage(e, 'Falha ao marcar erro como tratado.'), 'error');
        }
    };

    const report = data?.report ?? null;

    const { failing, healthy } = useMemo(() => {
        const checks = report?.checks ?? [];
        const rank = { CRITICAL: 0, WARN: 1, OK: 2 };
        return {
            failing: checks.filter((c) => c.status !== 'OK')
                .sort((a, b) => rank[a.status] - rank[b.status]),
            healthy: checks.filter((c) => c.status === 'OK'),
        };
    }, [report]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
                <RefreshCw size={16} className="animate-spin" />
                <span className="text-sm">Carregando saúde dos dados…</span>
            </div>
        );
    }

    if (!report) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl p-8 text-center">
                <ShieldAlert size={32} className="text-slate-600 mx-auto mb-3" />
                <p className="text-sm font-bold text-white">Nenhuma avaliação registrada ainda.</p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    A sentinela roda de hora em hora e ao fim de cada sync. Se o servidor
                    acabou de subir, aguarde o próximo ciclo ou avalie agora.
                </p>
                <button
                    onClick={handleRunNow}
                    disabled={isRunning}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs font-bold text-white transition-colors"
                >
                    <RefreshCw size={13} className={isRunning ? 'animate-spin' : ''} />
                    Avaliar agora
                </button>
            </div>
        );
    }

    const ui = STATUS_UI[report.status];

    return (
        <div className="space-y-6">
            {/* Veredito global */}
            <div className={`rounded-2xl border p-5 ${ui.border} ${ui.bg}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${ui.border} bg-base shrink-0`}>
                            <ui.Icon size={26} className={ui.text} />
                        </div>
                        <div>
                            <h3 className={`text-xl font-black ${ui.text}`}>{ui.label}</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                                <Clock size={11} />
                                Avaliado {relativeTime(report.runAt)}
                                {report.trigger && <span className="text-slate-600">· {report.trigger.toLowerCase()}</span>}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 text-center">
                            <div>
                                <p className="text-lg font-black text-red-400">{report.summary.critical}</p>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Crítico</p>
                            </div>
                            <div>
                                <p className="text-lg font-black text-yellow-400">{report.summary.warn}</p>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Alerta</p>
                            </div>
                            <div>
                                <p className="text-lg font-black text-emerald-400">{report.summary.ok}</p>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">OK</p>
                            </div>
                        </div>
                        <button
                            onClick={handleRunNow}
                            disabled={isRunning}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-elevated hover:bg-slate-700 disabled:opacity-50 rounded-lg text-[11px] font-bold text-white transition-colors border border-slate-700"
                        >
                            <RefreshCw size={12} className={isRunning ? 'animate-spin' : ''} />
                            Reavaliar
                        </button>
                    </div>
                </div>
            </div>

            {/* O que está quebrado */}
            {failing.length > 0 && (
                <div>
                    <h4 className="text-xs font-black text-white uppercase mb-3 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-yellow-500" />
                        Precisa de atenção ({failing.length})
                    </h4>
                    <div className="space-y-2">
                        {failing.map((check) => <CheckRow key={check.id} check={check} />)}
                    </div>
                </div>
            )}

            {/* Verificações saudáveis, recolhidas */}
            <div>
                <button
                    onClick={() => setShowAllChecks((v) => !v)}
                    className="text-xs font-black text-slate-400 hover:text-white uppercase flex items-center gap-2 transition-colors"
                >
                    {showAllChecks ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Verificações saudáveis ({healthy.length})
                </button>
                {showAllChecks && (
                    <div className="space-y-2 mt-3">
                        {healthy.map((check) => <CheckRow key={check.id} check={check} />)}
                    </div>
                )}
            </div>

            {/* Rotinas */}
            <div className="bg-base border border-slate-800 rounded-2xl p-4">
                <h4 className="text-xs font-black text-white uppercase mb-3 flex items-center gap-2">
                    <Activity size={14} className="text-blue-500" />
                    Rotinas automáticas
                </h4>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                        <thead>
                            <tr className="text-[9px] text-slate-500 font-bold uppercase text-left">
                                <th className="pb-2 pr-3">Rotina</th>
                                <th className="pb-2 pr-3">Última execução</th>
                                <th className="pb-2 pr-3">Frequência</th>
                                <th className="pb-2 text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data?.jobs ?? []).map((job) => <JobRow key={job.jobId} job={job} />)}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Erros do backend */}
            <div>
                <h4 className="text-xs font-black text-white uppercase mb-3 flex items-center gap-2">
                    <Bug size={14} className="text-red-500" />
                    Erros do backend ({errors.length})
                </h4>
                {errors.length === 0 ? (
                    <div className="bg-base border border-slate-800 rounded-2xl p-6 text-center">
                        <CheckCircle2 size={22} className="text-emerald-500 mx-auto mb-2" />
                        <p className="text-xs text-slate-400">Nenhum erro pendente nos últimos 14 dias.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {errors.map((error) => (
                            <ErrorRow key={error._id} error={error} onResolve={handleResolve} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
