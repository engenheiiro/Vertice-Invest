import React, { useMemo, useState } from 'react';
import {
    AlertTriangle, CheckCircle2, HelpCircle, Radio, X, XCircle,
} from 'lucide-react';
import type { DataSource, SourceGroup, SourceStatus, SourceSummary } from '../../services/health';

/**
 * "De onde vêm os dados" — a pergunta que o painel não respondia.
 *
 * Em 04/09/2026 o dólar ficou um dia inteiro congelado e, depois de consertado,
 * passou a ser sustentado por duas fontes de reserva. Nada na tela dizia nem uma
 * coisa nem outra: existiam checks por SINTOMA ("idade do câmbio") e nenhum por
 * ORIGEM. Quando o Yahoo passou a falhar só na chamada de câmbio — servindo
 * cotações e índices normalmente no mesmo minuto —, não havia como ver isso sem
 * abrir o banco.
 *
 * Layout em GRADE, agrupado por função. Quinze linhas empilhadas viravam uma
 * lista que ninguém varre até o fim; em cards, o bloco inteiro cabe num olhar e
 * a cor faz a triagem. Por isso a ordem é FIXA (função, e dentro dela a ordem da
 * cadeia) em vez de ordenada por gravidade: card que muda de lugar a cada
 * carregamento não se acha de memória, e a cor já resolve o "onde olhar". A
 * ordem da cadeia ainda carrega informação — a 3ª fonte acesa com a 1ª vermelha
 * conta, de relance, que a reserva está segurando o sistema.
 */

const STATUS_UI: Record<SourceStatus, {
    dot: string; text: string; label: string; card: string; Icon: React.ElementType;
}> = {
    OK: {
        dot: 'bg-emerald-500',
        text: 'text-emerald-400',
        label: 'Recebendo',
        card: 'border-slate-800 bg-panel hover:border-slate-700',
        Icon: CheckCircle2,
    },
    WARN: {
        dot: 'bg-yellow-500',
        text: 'text-yellow-400',
        label: 'Instável',
        card: 'border-yellow-800/60 bg-yellow-900/10 ring-1 ring-yellow-900/30',
        Icon: AlertTriangle,
    },
    CRITICAL: {
        dot: 'bg-red-500',
        text: 'text-red-400',
        label: 'Sem receber',
        card: 'border-red-800/60 bg-red-900/10 ring-1 ring-red-900/40',
        Icon: XCircle,
    },
    UNKNOWN: {
        dot: 'bg-slate-600',
        text: 'text-slate-500',
        label: 'Sem uso',
        card: 'border-slate-800/70 bg-panel/50 hover:border-slate-700',
        Icon: HelpCircle,
    },
};

const sinceLabel = (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 0.02) return 'agora';
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
};

const SourceCard = ({
    source, selected, onSelect,
}: {
    source: DataSource;
    selected: boolean;
    onSelect: () => void;
}) => {
    const ui = STATUS_UI[source.status];
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={`text-left p-2.5 rounded-xl border transition-colors min-w-0 ${ui.card} ${
                selected ? 'outline outline-1 outline-blue-500/60' : ''
            }`}
        >
            <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ui.dot} ${source.status === 'OK' ? 'animate-pulse' : ''}`} />
                <span className="text-[11px] font-bold text-white truncate">{source.short ?? source.label}</span>
            </div>
            <p className="text-[9px] text-slate-500 mt-0.5 truncate" title={source.role}>{source.role}</p>
            <div className="flex items-baseline justify-between gap-1 mt-1.5">
                <span className={`text-[9px] font-bold uppercase tracking-wide ${ui.text} truncate`}>
                    {ui.label}
                </span>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {sinceLabel(source.lastDeliveryHours)}
                </span>
            </div>
        </button>
    );
};

/** Detalhe da fonte escolhida. Fora da grade: dentro do card ele quebraria o alinhamento. */
const SourceDetail = ({ source, onClose }: { source: DataSource; onClose: () => void }) => {
    const ui = STATUS_UI[source.status];
    return (
        <div className="mt-3 rounded-xl border border-slate-700 bg-elevated/60 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <ui.Icon size={13} className={ui.text} />
                        <span className="text-xs font-bold text-white">{source.label}</span>
                        {source.critical && (
                            <span className="text-[9px] font-bold uppercase text-slate-500 bg-base px-1.5 py-0.5 rounded">
                                essencial
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{source.feeds}</p>
                    <p className="text-[11px] text-slate-300 mt-1.5">{source.detail}</p>
                    {source.lastError && (
                        <p className="text-[10px] text-slate-500 mt-1">
                            Último erro: <span className="font-mono text-slate-400">{source.lastError}</span>
                        </p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">
                        Contagem de chamadas desde o último reinício do servidor.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar detalhe"
                    className="text-slate-500 hover:text-white transition-colors shrink-0"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};

export const DataSourcesPanel = ({
    sources, summary, groups,
}: {
    sources: DataSource[];
    summary?: SourceSummary;
    groups?: SourceGroup[];
}) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Agrupa preservando a ordem que o servidor mandou — dentro de cada bloco, a
    // ordem do catálogo É a ordem da cadeia de fallback.
    const blocos = useMemo(() => {
        const lista = groups?.length
            ? groups
            : [{ id: '__all', label: 'Fontes', hint: '' }];
        return lista
            .map((g) => ({
                ...g,
                itens: sources.filter((s) => (g.id === '__all' ? true : s.group === g.id)),
            }))
            .filter((g) => g.itens.length > 0);
    }, [sources, groups]);

    const selected = useMemo(
        () => sources.find((s) => s.id === selectedId) ?? null,
        [sources, selectedId],
    );

    if (!sources.length) return null;

    const problemas = summary?.degradedLabels ?? [];
    const tudoBem = problemas.length === 0;

    return (
        <section className="bg-base border border-slate-800 rounded-2xl p-4" aria-labelledby="sources-title">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h4 id="sources-title" className="text-xs font-black text-white uppercase flex items-center gap-2">
                        <Radio size={14} className="text-blue-500" />
                        De onde vêm os dados
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-2xl">
                        {tudoBem
                            ? 'Todas as fontes em uso estão entregando normalmente. Clique num card para ver os detalhes.'
                            : `${problemas.length} fonte(s) com problema: ${problemas.join(', ')}.`}
                    </p>
                </div>
                <span className={`text-[9px] font-bold uppercase px-2 py-1 rounded-full whitespace-nowrap border ${
                    tudoBem
                        ? 'text-emerald-400 bg-emerald-900/10 border-emerald-900/40'
                        : 'text-yellow-400 bg-yellow-900/10 border-yellow-900/40'
                }`}
                >
                    {tudoBem ? 'Tudo chegando' : 'Atenção'}
                </span>
            </div>

            <div className="mt-4 space-y-4">
                {blocos.map((bloco) => (
                    <div key={bloco.id}>
                        <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                            <h5 className="text-[10px] font-black text-slate-300 uppercase tracking-wide">
                                {bloco.label}
                            </h5>
                            {bloco.hint && <span className="text-[10px] text-slate-500">· {bloco.hint}</span>}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                            {bloco.itens.map((s) => (
                                <SourceCard
                                    key={s.id}
                                    source={s}
                                    selected={selectedId === s.id}
                                    onSelect={() => setSelectedId((cur) => (cur === s.id ? null : s.id))}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {selected && <SourceDetail source={selected} onClose={() => setSelectedId(null)} />}
        </section>
    );
};
