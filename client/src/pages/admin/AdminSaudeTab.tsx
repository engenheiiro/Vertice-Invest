import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronRight,
    Clock, RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react';
import {
    healthService,
    type BackendError,
    type DataHealthResponse,
    type HealthCheck,
    type HealthStatus,
} from '../../services/health';
import { useToast } from '../../contexts/ToastContext';
import { getErrorMessage } from '../../utils/errorMessages';
import { PerformanceOverview } from '../../components/admin/PerformanceOverview';
import { DataSourcesPanel } from '../../components/admin/DataSourcesPanel';
import { JobsPanel } from '../../components/admin/JobsPanel';
import { formatRelativeTime } from '../../utils/format';

/**
 * Aba "Saúde" do Admin.
 *
 * Duas regras de leitura, nessa ordem:
 *
 * 1. **O que está QUEBRADO aparece primeiro** e já explica onde olhar (`hint`).
 *    O resto fica recolhido — um painel que mostra 60 checks verdes com igual
 *    destaque é um painel que ninguém lê.
 * 2. **Toda seção começa por uma frase, não por um número.** O leitor desta tela
 *    é o dono do produto, não quem escreveu o coletor: "3 de 346 ações sem preço
 *    fresco" é informação; "0,87%" é telemetria. Sempre que a escolha for entre
 *    precisão técnica e a frase que responde "preciso agir?", ganha a frase — o
 *    número continua ali do lado.
 */

const STATUS_UI: Record<HealthStatus, { text: string; bg: string; border: string; label: string; Icon: React.ElementType }> = {
    OK: { text: 'text-emerald-400', bg: 'bg-emerald-900/10', border: 'border-emerald-900/40', label: 'Está tudo funcionando', Icon: CheckCircle2 },
    WARN: { text: 'text-yellow-400', bg: 'bg-yellow-900/10', border: 'border-yellow-900/40', label: 'Alguma coisa merece atenção', Icon: AlertTriangle },
    CRITICAL: { text: 'text-red-400', bg: 'bg-red-900/10', border: 'border-red-900/40', label: 'Tem coisa quebrada', Icon: XCircle },
};

/**
 * Tradução das categorias técnicas para o que elas significam na prática. A chave
 * é o `category` que o backend manda; sem isso a tela mostra "PLAUSIBILITY" e
 * "FRESHNESS" para quem só quer saber se o preço da carteira está certo.
 */
const CATEGORY_LABEL: Record<string, string> = {
    FRESHNESS: 'Dado atualizado',
    COVERAGE: 'Dado completo',
    PLAUSIBILITY: 'Dado plausível',
    MACRO: 'Indicadores',
    JOBS: 'Rotinas',
    ERRORS: 'Erros',
    INGESTION: 'Coleta',
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
                            {CATEGORY_LABEL[check.category] ?? check.category}
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
                        {error.code} · último {formatRelativeTime(error.lastSeenAt)} · primeiro {formatRelativeTime(error.firstSeenAt)}
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

    // A frase que substitui a contagem. "2 crítico · 1 alerta · 57 ok" obriga o
    // leitor a somar e concluir sozinho; a frase já entrega a conclusão, e os
    // números seguem ao lado para quem quiser conferir.
    const verdictSentence = useMemo(() => {
        const criticos = failing.filter((c) => c.status === 'CRITICAL');
        const alertas = failing.filter((c) => c.status === 'WARN');
        if (criticos.length) {
            return `${criticos.length} verificação(ões) em estado crítico: ${criticos.slice(0, 2).map((c) => c.label).join(', ')}`
                + `${criticos.length > 2 ? ' e outras' : ''}. Isso afeta o que o usuário vê.`;
        }
        if (alertas.length) {
            return `${alertas.length} ponto(s) de atenção: ${alertas.slice(0, 2).map((c) => c.label).join(', ')}`
                + `${alertas.length > 2 ? ' e outros' : ''}. Nada quebrado, mas vale acompanhar.`;
        }
        return 'Todas as verificações passaram: dados atualizados, completos e dentro das faixas esperadas.';
    }, [failing]);

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
            <div className="space-y-6">
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
                <PerformanceOverview />
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
                            <p className="text-xs text-slate-300 mt-1 max-w-lg">{verdictSentence}</p>
                            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
                                <Clock size={11} />
                                Avaliado {formatRelativeTime(report.runAt)}
                                {report.trigger && <span className="text-slate-600">· {report.trigger.toLowerCase()}</span>}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 text-center">
                            <div>
                                <p className="text-lg font-black text-red-400">{report.summary.critical}</p>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Quebrado</p>
                            </div>
                            <div>
                                <p className="text-lg font-black text-yellow-400">{report.summary.warn}</p>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Atenção</p>
                            </div>
                            <div>
                                <p className="text-lg font-black text-emerald-400">{report.summary.ok}</p>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Certo</p>
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

            {/* Fontes ANTES dos sintomas: quando algo está errado, a primeira
                pergunta é de onde o dado deveria ter vindo. */}
            <DataSourcesPanel
                sources={data?.sources ?? []}
                summary={data?.sourceSummary}
                groups={data?.sourceGroups}
            />

            <PerformanceOverview />

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
            <JobsPanel jobs={data?.jobs ?? []} />

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
