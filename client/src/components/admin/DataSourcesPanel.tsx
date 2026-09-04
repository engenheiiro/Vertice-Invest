import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle, CheckCircle2, HelpCircle, Radio, ShieldCheck, X, XCircle,
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
        label: 'Aguardando',
        card: 'border-slate-800/70 bg-panel/50 hover:border-slate-700',
        Icon: HelpCircle,
    },
};

/**
 * O rodapé do card responde "e agora?" — e a resposta depende da natureza da
 * fonte, não só do estado dela.
 *
 * Cinza escondia duas coisas opostas: a fonte agendada que ainda não teve a vez
 * (pendência, com hora marcada) e a de reserva, que só é chamada quando a
 * anterior falha (silêncio ali é o sistema funcionando). Sem separar, "que horas
 * isso roda?" não tinha resposta — e metade dos cards nem tem horário para dar.
 */
const footerInfo = (source: DataSource): { label: string; time: string } => {
    const ui = STATUS_UI[source.status];
    if (source.status !== 'UNKNOWN') {
        return { label: ui.label, time: sinceLabel(source.lastDeliveryHours) };
    }
    if (source.trigger === 'onFailure') {
        return { label: 'Em espera', time: 'reserva' };
    }
    return { label: 'Aguardando', time: source.nextRun ?? '—' };
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
    const footer = footerInfo(source);
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
                    {footer.label}
                </span>
                <span className="text-[10px] font-mono text-slate-400 shrink-0 truncate" title={footer.time}>
                    {footer.time}
                </span>
            </div>
        </button>
    );
};

/** Data e hora absolutas, no fuso de quem lê. Relativo sozinho ("há 3h") perde o dia. */
const absoluteTime = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
};

const Linha = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
    <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 shrink-0">{rotulo}</span>
        <span className="text-[11px] text-slate-300 min-w-0">{children}</span>
    </div>
);

/**
 * Detalhe da fonte, em modal.
 *
 * Em janela, e não numa faixa embaixo da grade, porque o conteúdo cresceu além do
 * que cabe sem empurrar os cards para fora da tela — e porque a leitura aqui é um
 * desvio do fluxo: você abre para investigar uma fonte, não para comparar quinze.
 *
 * A informação que faltava e que mais importa é a última seção: **quem cobre se
 * esta cair**. Sem ela, o painel dizia que a fonte quebrou e deixava a pergunta
 * seguinte sem resposta. E quando não há ninguém atrás, dizer isso em voz alta é
 * mais valioso ainda: é o mapa dos pontos únicos de falha do sistema.
 */
const SourceDetailModal = ({ source, onClose }: { source: DataSource; onClose: () => void }) => {
    const ui = STATUS_UI[source.status];
    const footer = footerInfo(source);
    const entrega = absoluteTime(source.lastDeliveryAt);
    const falha = absoluteTime(source.lastFailAt);
    const semReserva = (source.backups?.length ?? 0) === 0 && !source.covers;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 z-[100] backdrop-blur-md bg-black/95 flex items-center justify-center p-4"
            onClick={onClose}
            role="presentation"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`Detalhes da fonte ${source.label}`}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-panel border border-slate-700 rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <ui.Icon size={16} className={ui.text} />
                            <h3 className="text-sm font-black text-white">{source.label}</h3>
                            {source.critical && (
                                <span className="text-[9px] font-bold uppercase text-slate-400 bg-elevated px-1.5 py-0.5 rounded">
                                    essencial
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{source.role}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="text-slate-500 hover:text-white transition-colors shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className={`mt-4 rounded-xl border p-3 ${
                    source.status === 'CRITICAL' ? 'border-red-900/50 bg-red-900/10'
                        : source.status === 'WARN' ? 'border-yellow-900/50 bg-yellow-900/10'
                            : 'border-slate-800 bg-base'
                }`}
                >
                    <p className={`text-[10px] font-bold uppercase tracking-wide ${ui.text}`}>{footer.label}</p>
                    <p className="text-xs text-slate-200 mt-1">{source.detail}</p>
                </div>

                <div className="mt-4 space-y-2">
                    <Linha rotulo="Alimenta">{source.feeds}</Linha>
                    {source.cadence && (
                        <Linha rotulo="Quando roda">
                            {source.cadence}
                            {source.nextRun && <span className="text-slate-500"> · próxima {source.nextRun}</span>}
                        </Linha>
                    )}
                    <Linha rotulo="Última entrega">
                        {entrega ? <>{entrega} <span className="text-slate-500">({sinceLabel(source.lastDeliveryHours)})</span></> : 'sem registro'}
                    </Linha>
                    {(source.attempts ?? 0) > 0 && (
                        <Linha rotulo="Chamadas">
                            {source.attempts} desde o reinício · {source.ok ?? 0} com dado · {source.failures} sem
                        </Linha>
                    )}
                    {/* Ancorado no ERRO, não na data: o registro sempre grava os dois
                        juntos, mas se um dia faltar o carimbo, a mensagem ainda é o
                        que resolve o problema — esconder por falta do relógio seria
                        perder a única pista. */}
                    {(source.lastError || falha) && (
                        <Linha rotulo="Última falha">
                            {falha ?? 'sem data'}
                            {source.lastError && <span className="text-slate-500"> — <span className="font-mono">{source.lastError}</span></span>}
                        </Linha>
                    )}
                </div>

                {/* A pergunta seguinte à do painel: caiu, e agora? */}
                <div className="mt-4 pt-3 border-t border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                        <ShieldCheck size={11} />
                        Se esta fonte falhar
                    </p>
                    {semReserva ? (
                        <p className="text-[11px] text-yellow-400/90 mt-1.5">
                            Não há fonte alternativa. Se ela parar, o dado que ela alimenta deixa de ser
                            atualizado até a fonte voltar.
                        </p>
                    ) : (
                        <div className="mt-1.5 space-y-1">
                            {source.covers && (
                                <p className="text-[11px] text-slate-400">
                                    Esta é reserva de <span className="text-slate-200">{source.covers}</span>.
                                </p>
                            )}
                            {(source.backups?.length ?? 0) > 0 ? (
                                <p className="text-[11px] text-slate-300">
                                    Assumem, nesta ordem:{' '}
                                    <span className="text-slate-200">{source.backups?.join(' → ')}</span>
                                </p>
                            ) : (
                                <p className="text-[11px] text-yellow-400/90">
                                    É a última da cadeia — depois dela não há mais ninguém.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <p className="text-[10px] text-slate-600 mt-4">
                    A contagem de chamadas zera a cada reinício do servidor; a data de entrega vem do banco
                    e sobrevive a ele.
                </p>
            </div>
        </div>,
        document.body,
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

            {selected && <SourceDetailModal source={selected} onClose={() => setSelectedId(null)} />}
        </section>
    );
};
