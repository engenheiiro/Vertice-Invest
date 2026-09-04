import React, { useMemo, useState } from 'react';
import {
    AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Radio, XCircle,
} from 'lucide-react';
import type { DataSource, SourceStatus, SourceSummary } from '../../services/health';

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
 * A régua de escrita aqui é uma só: quem não conhece o sistema tem que entender a
 * linha. Nome da fonte, o que ela alimenta, e uma frase de estado. Número de
 * chamada e mensagem de erro ficam atrás do clique.
 */

const STATUS_UI: Record<SourceStatus, {
    dot: string; text: string; label: string; Icon: React.ElementType;
}> = {
    OK: { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'Recebendo', Icon: CheckCircle2 },
    WARN: { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Instável', Icon: AlertTriangle },
    CRITICAL: { dot: 'bg-red-500', text: 'text-red-400', label: 'Sem receber', Icon: XCircle },
    UNKNOWN: { dot: 'bg-slate-600', text: 'text-slate-500', label: 'Sem uso ainda', Icon: HelpCircle },
};

const ORDER: Record<SourceStatus, number> = { CRITICAL: 0, WARN: 1, OK: 2, UNKNOWN: 3 };

const sinceLabel = (hours: number | null) => {
    if (hours === null) return 'sem registro';
    if (hours < 0.02) return 'agora';
    if (hours < 1) return `há ${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `há ${Math.round(hours)}h`;
    return `há ${Math.round(hours / 24)} dias`;
};

const SourceRow = ({ source }: { source: DataSource }) => {
    const [open, setOpen] = useState(false);
    const ui = STATUS_UI[source.status];
    const temDetalhe = source.attempts > 0 || !!source.lastError;

    return (
        <div className={`rounded-xl border ${source.status === 'OK' || source.status === 'UNKNOWN'
            ? 'border-slate-800 bg-panel'
            : source.status === 'CRITICAL' ? 'border-red-900/40 bg-red-900/10' : 'border-yellow-900/40 bg-yellow-900/10'}`}
        >
            <button
                type="button"
                onClick={() => temDetalhe && setOpen((v) => !v)}
                className={`w-full flex items-center gap-3 p-3 text-left ${temDetalhe ? 'hover:bg-elevated/40' : 'cursor-default'} transition-colors rounded-xl`}
                aria-expanded={open}
            >
                <span className={`w-2 h-2 rounded-full shrink-0 ${ui.dot} ${source.status === 'OK' ? 'animate-pulse' : ''}`} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white">{source.label}</span>
                        {source.critical && (
                            <span className="text-[9px] font-bold uppercase text-slate-500 bg-elevated px-1.5 py-0.5 rounded">
                                essencial
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{source.feeds}</p>
                </div>
                <div className="text-right shrink-0">
                    <p className={`text-[11px] font-bold ${ui.text}`}>{ui.label}</p>
                    <p className="text-[10px] text-slate-500">{sinceLabel(source.lastDeliveryHours)}</p>
                </div>
                {temDetalhe && (open
                    ? <ChevronDown size={13} className="text-slate-600 shrink-0" />
                    : <ChevronRight size={13} className="text-slate-600 shrink-0" />)}
            </button>

            {open && (
                <div className="px-3 pb-3 pl-8 space-y-1">
                    <p className="text-[11px] text-slate-400">{source.detail}</p>
                    {source.lastError && (
                        <p className="text-[10px] text-slate-500">
                            Último erro: <span className="font-mono text-slate-400">{source.lastError}</span>
                        </p>
                    )}
                    <p className="text-[10px] text-slate-600">
                        Contagem desde o último reinício do servidor.
                    </p>
                </div>
            )}
        </div>
    );
};

export const DataSourcesPanel = ({
    sources, summary,
}: {
    sources: DataSource[];
    summary?: SourceSummary;
}) => {
    const [showAll, setShowAll] = useState(false);

    const { problemas, resto } = useMemo(() => {
        const ordenadas = [...sources].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
        return {
            problemas: ordenadas.filter((s) => s.status === 'CRITICAL' || s.status === 'WARN'),
            resto: ordenadas.filter((s) => s.status === 'OK' || s.status === 'UNKNOWN'),
        };
    }, [sources]);

    if (!sources.length) return null;

    const tudoBem = problemas.length === 0;

    return (
        <section className="bg-base border border-slate-800 rounded-2xl p-4" aria-labelledby="sources-title">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h4 id="sources-title" className="text-xs font-black text-white uppercase flex items-center gap-2">
                        <Radio size={14} className="text-blue-500" />
                        De onde vêm os dados
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xl">
                        {tudoBem
                            ? `As ${summary?.ok ?? sources.length} fontes em uso estão entregando normalmente.`
                            : `${problemas.length} fonte(s) com problema: ${problemas.map((p) => p.label).join(', ')}.`}
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

            {/* Quem está com problema aparece SEMPRE aberto; o resto fica recolhido.
                Um painel que mostra quinze linhas verdes com o mesmo destaque é um
                painel em que a linha vermelha se perde. */}
            {problemas.length > 0 && (
                <div className="space-y-2 mt-4">
                    {problemas.map((s) => <SourceRow key={s.id} source={s} />)}
                </div>
            )}

            <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
            >
                {showAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {showAll ? 'Ocultar as demais' : `Ver as outras ${resto.length} fontes`}
            </button>

            {showAll && (
                <div className="space-y-2 mt-3">
                    {resto.map((s) => <SourceRow key={s.id} source={s} />)}
                </div>
            )}
        </section>
    );
};
