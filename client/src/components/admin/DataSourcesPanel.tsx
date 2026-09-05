import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle, CheckCircle2, ChevronRight, GitBranch, HelpCircle, Radio, ShieldCheck,
    SearchCheck, X, XCircle,
} from 'lucide-react';
import type {
    ChainEscalation, ChainFlow, DataSource, QuoteSuspectView, SourceGroup, SourceStatus, SourceSummary,
} from '../../services/health';

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

/**
 * A paleta dos cards, e por que ela é o que é.
 *
 * Todo estado com NOTÍCIA tem tom próprio — borda tingida, fundo lavado na mesma
 * cor, hover que acende a borda. "Recebendo" ficava fora dessa receita: só o ponto
 * e o rótulo eram verdes, o card em si era cinza neutro. Ao lado da reserva em
 * azul, a fonte que está de fato sustentando o dado parecia a mais apagada da
 * tela — exatamente o contrário do que ela é.
 *
 * O PESO é que separa: verde e azul são lavados (fundo /10, sem anel); amarelo e
 * vermelho vêm com fundo mais forte e anel. Se tudo pesasse igual, a cor deixaria
 * de fazer triagem numa grade de quinze cards — que é a razão de a grade existir.
 *
 * O único estado sem cor é o `UNKNOWN` agendado: a fonte que ainda não teve a vez.
 * Ausência de notícia não é notícia, e cinza é o que diz isso. A reserva parada não
 * cai aqui — ela tem cor própria (ver STANDBY_UI).
 */
const STATUS_UI: Record<SourceStatus, {
    dot: string; text: string; label: string; card: string; band: string; Icon: React.ElementType;
}> = {
    OK: {
        dot: 'bg-emerald-500',
        text: 'text-emerald-400',
        label: 'Recebendo',
        card: 'border-emerald-900/50 bg-emerald-900/10 hover:border-emerald-800',
        band: 'border-emerald-900/50 bg-emerald-900/10',
        Icon: CheckCircle2,
    },
    WARN: {
        dot: 'bg-yellow-500',
        text: 'text-yellow-400',
        label: 'Instável',
        card: 'border-yellow-800/60 bg-yellow-900/20 ring-1 ring-yellow-900/30 hover:border-yellow-700',
        band: 'border-yellow-900/50 bg-yellow-900/10',
        Icon: AlertTriangle,
    },
    CRITICAL: {
        dot: 'bg-red-500',
        text: 'text-red-400',
        label: 'Sem receber',
        card: 'border-red-800/60 bg-red-900/20 ring-1 ring-red-900/40 hover:border-red-700',
        band: 'border-red-900/50 bg-red-900/10',
        Icon: XCircle,
    },
    UNKNOWN: {
        dot: 'bg-slate-600',
        text: 'text-slate-500',
        label: 'Aguardando',
        card: 'border-slate-800/70 bg-panel/50 hover:border-slate-700',
        band: 'border-slate-800 bg-base',
        Icon: HelpCircle,
    },
};

/**
 * A RESERVA EM ESPERA TEM COR PRÓPRIA.
 *
 * Ela caía no mesmo cinza de `UNKNOWN` da fonte agendada que ainda não teve a vez,
 * e os dois estados não são a mesma coisa: a agendada é uma pendência (tem hora
 * marcada e ainda não cumpriu), enquanto a reserva parada é o SISTEMA FUNCIONANDO —
 * ninguém precisou dela. Cinza lê como apagado, quase defeito; azul lê como
 * "em posição, sem nada a fazer", que é o que de fato está acontecendo.
 *
 * Azul e não verde de propósito: verde é o "recebendo" de quem está entregando
 * AGORA, e usar o mesmo tom apagaria a diferença entre a fonte que sustenta o dado
 * e a que só está de prontidão.
 */
const STANDBY_UI = {
    dot: 'bg-blue-500',
    text: 'text-blue-400',
    label: 'Em espera',
    card: 'border-blue-900/50 bg-blue-900/10 hover:border-blue-800',
    band: 'border-blue-900/50 bg-blue-900/10',
    Icon: ShieldCheck,
};

/** Reserva que ninguém precisou acionar ≠ fonte sem notícia. Ver STANDBY_UI. */
const isStandby = (source: DataSource) => source.status === 'UNKNOWN' && source.trigger === 'onFailure';

/**
 * Reserva que FOI chamada, e só para ativo que ninguém precificou.
 *
 * Mesma cor da reserva em espera (nada aqui é problema da fonte), rótulo
 * diferente: dizer "Em espera" a quem acabou de ser chamada três vezes é uma
 * mentira pequena que corrói a confiança no painel inteiro. O servidor já decidiu
 * o ESTADO e escreveu a frase em `detail`; aqui só se escolhe o rótulo curto do
 * rodapé, que é onde o card não tem espaço para a frase.
 */
const isSemAlvoVivo = (source: DataSource) =>
    isStandby(source) && (source.escalated?.reached ?? 0) > 0;

const visualFor = (source: DataSource) => (isStandby(source) ? STANDBY_UI : STATUS_UI[source.status]);

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
    if (source.status !== 'UNKNOWN') {
        return { label: STATUS_UI[source.status].label, time: sinceLabel(source.lastDeliveryHours) };
    }
    if (isSemAlvoVivo(source)) {
        return { label: 'Sem alvo vivo', time: 'reserva' };
    }
    if (isStandby(source)) {
        return { label: STANDBY_UI.label, time: 'reserva' };
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

/** "1ª", "2ª"… O ordinal só existe dentro de uma cadeia; fora dela não há ordem. */
const ORDINAL = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'];

const SourceCard = ({
    source, selected, onSelect, className = '',
}: {
    source: DataSource;
    selected: boolean;
    onSelect: () => void;
    className?: string;
}) => {
    const ui = visualFor(source);
    const footer = footerInfo(source);
    const ordinal = source.chainPosition ? ORDINAL[source.chainPosition - 1] : null;
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={`text-left p-2.5 rounded-xl border transition-colors min-w-0 ${ui.card} ${
                selected ? 'outline outline-1 outline-blue-500/60' : ''
            } ${className}`}
        >
            <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ui.dot} ${source.status === 'OK' ? 'animate-pulse' : ''}`} />
                {ordinal && (
                    <span className="text-[9px] font-black text-slate-400 bg-elevated px-1 rounded shrink-0">
                        {ordinal}
                    </span>
                )}
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

/**
 * Uma cadeia de cobertura, desenhada como sequência: `1ª → 2ª → 3ª`.
 *
 * A grade uniforme anterior mentia por omissão. Cards lado a lado leem-se como
 * lista de alternativas equivalentes, e nem a ordem de tentativa nem a fronteira
 * entre cadeias estavam na tela: no bloco de cotações, a B3 aparecia colada na
 * Google Finance como se fosse o 4º elo, quando é uma fonte independente que
 * cobre outra coisa (o fechamento oficial do pregão). Setas só entre quem
 * realmente se cobre; quem não tem cadeia sai fora da sequência.
 */
const ChainRow = ({
    itens, selectedId, onSelect,
}: {
    itens: DataSource[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}) => (
    <div className="flex flex-wrap items-stretch gap-1.5">
        {itens.map((s, i) => (
            <React.Fragment key={s.id}>
                {i > 0 && (
                    <div className="flex items-center shrink-0" aria-hidden="true">
                        <ChevronRight size={14} className="text-slate-600" />
                    </div>
                )}
                <SourceCard
                    source={s}
                    selected={selectedId === s.id}
                    onSelect={() => onSelect(s.id)}
                    className="basis-[132px] grow max-w-[200px]"
                />
            </React.Fragment>
        ))}
    </div>
);

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
 * Uma lista de tickers, com teto.
 *
 * Some quando não tem ninguém, em vez de mostrar "nenhum": três rótulos vazios
 * empilhados no detalhe de toda fonte saudável seriam ruído puro, e o que
 * importa aqui é justamente o grupo que TEM nome dentro.
 *
 * `total` vem da contagem exata do servidor e pode ser maior que a lista, que é
 * transportada com teto. O "+ N" existe para a tela não afirmar, por omissão,
 * que os quinze mostrados são todos.
 */
const TickerGroup = ({
    rotulo, tickers, total, tone,
}: {
    rotulo: string;
    tickers: string[];
    total: number;
    tone: string;
}) => {
    if (total === 0) return null;
    const MOSTRA = 14;
    const visiveis = tickers.slice(0, MOSTRA);
    const restante = total - visiveis.length;
    return (
        <div>
            <p className="text-[9px] uppercase font-bold tracking-wide text-slate-600">{rotulo}</p>
            <div className="flex flex-wrap gap-1 mt-1">
                {visiveis.map((t) => (
                    <span key={t} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>
                        {t}
                    </span>
                ))}
                {restante > 0 && (
                    <span className="text-[10px] text-slate-500 self-center">+ {restante}</span>
                )}
            </div>
        </div>
    );
};

/**
 * O CAMINHO DE UM ATIVO, desenhado como ele aconteceu.
 *
 * O painel dizia "a Brapi está instável, 80 chamadas, 24 sem dado" e parava aí.
 * A pergunta seguinte — *quais ativos* chegaram até ela? — não tinha resposta em
 * lugar nenhum, e sem ela os dois diagnósticos possíveis são indistinguíveis: 24
 * falhas podem ser 24 ativos diferentes (fonte degradada) ou o mesmo papel morto
 * tentado 24 vezes (ticker para aposentar). São ações opostas.
 *
 * Cada elo é pintado pelo que ele FEZ com este ativo, não pelo estado geral da
 * fonte: quem trouxe o preço fica verde, quem foi tentado e não trouxe fica
 * riscado. É a mesma fonte podendo aparecer verde numa linha e riscada na de
 * baixo — que é exatamente a verdade que faltava.
 */
const EscalationPath = ({ item, labelOf }: { item: ChainEscalation; labelOf: (id: string) => string }) => (
    <div className="flex items-center gap-1 flex-wrap">
        {item.tried.map((id, i) => {
            const entregou = item.resolvedBy === id;
            return (
                <React.Fragment key={id}>
                    {i > 0 && <ChevronRight size={10} className="text-slate-700 shrink-0" aria-hidden="true" />}
                    <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            entregou
                                ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-900/60'
                                : 'bg-elevated text-slate-500 line-through decoration-slate-600'
                        }`}
                    >
                        {labelOf(id)}
                    </span>
                </React.Fragment>
            );
        })}
        {!item.resolvedBy && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-900/25 text-red-400 border border-red-900/50">
                sem preço
            </span>
        )}
    </div>
);

/**
 * Linha de resumo embaixo da cadeia.
 *
 * Fica aqui, e não só dentro do card, porque a informação é da CADEIA: nenhum
 * card sozinho sabe dizer quantos ativos desceram até o último elo. E precisa
 * aparecer sem clique — o painel é lido de relance, e "3 ativos sem preço em
 * fonte nenhuma" é a frase que não pode depender de alguém abrir um modal.
 *
 * Zero também é notícia, e por isso tem texto próprio: significa que a fonte
 * principal cobriu o universo inteiro e as reservas nem foram chamadas.
 */
const ChainFlowLine = ({ flow, onOpen }: { flow: ChainFlow; onOpen: () => void }) => {
    if (flow.total === 0) {
        return (
            <p className="text-[10px] text-slate-600">
                Nenhum ativo precisou de reserva desde o último reinício do servidor.
            </p>
        );
    }
    return (
        <button
            type="button"
            onClick={onOpen}
            className="w-full text-left flex items-center gap-2 flex-wrap px-2 py-1.5 rounded-lg border border-slate-800 bg-panel/40 hover:border-slate-700 transition-colors"
        >
            <GitBranch size={11} className="text-slate-500 shrink-0" />
            <span className="text-[10px] text-slate-300">
                <span className="font-bold text-white">{flow.total}</span> ativo(s) precisaram de reserva
            </span>
            {flow.byResolver.map((r) => (
                <span
                    key={r.id ?? 'nenhuma'}
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                        r.id
                            ? 'bg-elevated text-slate-300'
                            : 'bg-red-900/25 text-red-400 font-bold border border-red-900/50'
                    }`}
                >
                    {r.count} {r.id ? `por ${r.label}` : 'sem preço em nenhuma'}
                </span>
            ))}
            <span className="text-[10px] text-blue-400 ml-auto shrink-0">ver ativos →</span>
        </button>
    );
};

/**
 * "O PREÇO CHEGOU" NÃO É "O PREÇO ESTÁ CERTO".
 *
 * A linha de cima da cadeia responde a primeira pergunta e para ali. Fonte que
 * não responde deixa rastro em todo lugar — failCount, ativo envelhecendo, card
 * vermelho. Fonte que responde o número ERRADO não deixa rastro nenhum: entra no
 * ranking e na carteira com carimbo de sucesso.
 *
 * Por isso esta linha fica ao lado da outra, sem clique: são as duas metades da
 * mesma pergunta. E o texto diz, com todas as letras, que o preço FOI gravado —
 * senão a linha se lê como falha, e alguém vai procurar um ativo sem cotação
 * que não existe.
 *
 * Zero tem texto próprio: é a afirmação de que ninguém chegou torto, e ela vale
 * tanto quanto o alarme.
 */
const SuspectLine = ({ suspects, onOpen }: { suspects: QuoteSuspectView; onOpen: () => void }) => {
    if (suspects.total === 0) {
        return (
            <p className="text-[10px] text-slate-600">
                Nenhum preço fora do esperado desde o último reinício do servidor.
            </p>
        );
    }
    return (
        <button
            type="button"
            onClick={onOpen}
            className="w-full text-left flex items-center gap-2 flex-wrap px-2 py-1.5 rounded-lg border border-yellow-900/50 bg-yellow-900/10 hover:border-yellow-800 transition-colors"
        >
            <SearchCheck size={11} className="text-yellow-500 shrink-0" />
            <span className="text-[10px] text-slate-300">
                <span className="font-bold text-white">{suspects.total}</span> ativo(s) chegaram com preço fora
                do esperado
            </span>
            <span className="text-[10px] text-slate-500">— gravados, para conferir</span>
            <span className="text-[10px] text-blue-400 ml-auto shrink-0">ver ativos →</span>
        </button>
    );
};

/**
 * A lista dos preços suspeitos.
 *
 * Cada linha carrega a FRASE inteira do motivo, escrita no servidor ("+108%
 * contra o fechamento anterior da própria fonte"), e não um código: quem abre
 * este modal quer decidir se aquilo foi grupamento ou erro de fonte, e para isso
 * precisa dos dois números, não da etiqueta.
 */
const SuspectModal = ({ suspects, onClose }: { suspects: QuoteSuspectView; onClose: () => void }) => {
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
                aria-label="Cotações com valor fora do esperado"
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-panel border border-slate-700 rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-black text-white flex items-center gap-2">
                            <SearchCheck size={14} className="text-yellow-500" />
                            Preços fora do esperado
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {suspects.total} ativo(s) desde o último reinício · o preço foi gravado
                        </p>
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

                <div className="mt-4 divide-y divide-slate-800/70">
                    {suspects.items.map((item) => (
                        <div key={item.subject} className="py-2.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold text-white font-mono">{item.subject}</span>
                                {item.type && (
                                    <span className="text-[9px] uppercase font-bold text-slate-500 bg-elevated px-1 rounded">
                                        {item.type}
                                    </span>
                                )}
                                {item.source && (
                                    <span className="text-[9px] font-mono text-slate-600">via {item.source}</span>
                                )}
                                {item.count > 1 && (
                                    <span className="text-[9px] text-slate-500 font-mono">{item.count}×</span>
                                )}
                                <span className="text-[9px] font-mono text-slate-600 ml-auto">{shortTime(item.at)}</span>
                            </div>
                            <ul className="mt-1 space-y-0.5">
                                {item.findings.map((f) => (
                                    <li key={f.code} className="text-[11px] text-slate-300">
                                        <span className="text-yellow-500/80">↳</span> {f.detail}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {suspects.truncated > 0 && (
                    <p className="text-[10px] text-slate-500 mt-3">
                        + {suspects.truncated} ativo(s) não listados — a tela mostra os {suspects.items.length}{' '}
                        mais recentes.
                    </p>
                )}

                <p className="text-[10px] text-slate-600 mt-4">
                    O preço é gravado mesmo assim, de propósito: grupamento e desdobramento produzem a mesma
                    assinatura de um erro de fonte, e recusar por magnitude congelaria o ativo no valor
                    anterior ao evento. Esta lista existe para você olhar e decidir — ela zera a cada reinício
                    do servidor.
                </p>
            </div>
        </div>,
        document.body,
    );
};

/** Data curta com hora — o ledger vive no processo, então o dia raramente varia. */
const shortTime = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * A lista completa de quem escalou, por cadeia.
 *
 * Ordem vinda do servidor, e ela é opinativa: **quem ficou sem preço vem
 * primeiro**. É a única categoria com consequência real — ativo sem cotação
 * carrega preço velho para a carteira do usuário —, enquanto "recuperado pela
 * reserva" é o sistema fazendo o que foi desenhado para fazer.
 */
const ChainFlowModal = ({
    flow, labelOf, onClose,
}: {
    flow: ChainFlow;
    labelOf: (id: string) => string;
    onClose: () => void;
}) => {
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
                aria-label="Ativos que precisaram de fonte de reserva"
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xl bg-panel border border-slate-700 rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-black text-white flex items-center gap-2">
                            <GitBranch size={14} className="text-blue-500" />
                            Quem precisou de reserva
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {flow.total} ativo(s) desceram a cadeia · {flow.unresolved} ficaram sem preço em
                            fonte nenhuma
                        </p>
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

                <div className="mt-4 divide-y divide-slate-800/70">
                    {flow.items.map((item) => (
                        <div key={item.subject} className="py-2 flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-white font-mono">{item.subject}</span>
                                    {item.count > 1 && (
                                        <span className="text-[9px] text-slate-500 font-mono">{item.count}×</span>
                                    )}
                                    {/* Escalada conhecida sai do caminho da atenção: é ruído
                                        permanente, e misturá-la com a novidade é o que ensina
                                        o operador a ignorar a lista inteira. */}
                                    {item.expected && (
                                        <span className="text-[9px] uppercase font-bold text-slate-500 bg-elevated px-1 rounded">
                                            esperado
                                        </span>
                                    )}
                                </div>
                                {item.reason && (
                                    <p className="text-[10px] text-slate-500 mt-0.5">{item.reason}</p>
                                )}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                                <EscalationPath item={item} labelOf={labelOf} />
                                <span className="text-[9px] font-mono text-slate-600">{shortTime(item.at)}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {flow.truncated > 0 && (
                    <p className="text-[10px] text-slate-500 mt-3">
                        + {flow.truncated} ativo(s) não listados — a tela mostra os {flow.items.length} mais
                        relevantes (sem preço primeiro, depois os mais recentes).
                    </p>
                )}

                <p className="text-[10px] text-slate-600 mt-4">
                    A lista zera a cada reinício do servidor e guarda uma linha por ativo: repetir a mesma
                    escalada atualiza a linha em vez de criar outra.
                </p>
            </div>
        </div>,
        document.body,
    );
};

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
const SourceDetailModal = ({
    source, flow, onClose,
}: {
    source: DataSource;
    /** Trajeto dos ativos na cadeia desta fonte; ausente = cadeia sem medição. */
    flow?: ChainFlow;
    onClose: () => void;
}) => {
    const ui = visualFor(source);
    const footer = footerInfo(source);
    const entrega = absoluteTime(source.lastDeliveryAt);
    const falha = absoluteTime(source.lastFailAt);
    const semReserva = (source.backups?.length ?? 0) === 0 && !source.covers;
    // Três destinos possíveis para quem passou por esta fonte, e eles se leem
    // por LINHA do ledger, não pelo estado geral da fonte: a mesma Brapi salva
    // um ticker e falha no seguinte no mesmo minuto.
    const passaram = (flow?.items ?? []).filter((i) => i.tried.includes(source.id));
    const salvos = passaram.filter((i) => i.resolvedBy === source.id).map((i) => i.subject);
    const seguiram = passaram.filter((i) => i.resolvedBy && i.resolvedBy !== source.id).map((i) => i.subject);
    const semPreco = passaram.filter((i) => !i.resolvedBy).map((i) => i.subject);

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
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {source.chainPosition && source.chainSize && (
                                <span className="text-slate-400 font-bold">
                                    {ORDINAL[source.chainPosition - 1]} de {source.chainSize} ·{' '}
                                </span>
                            )}
                            {source.role}
                        </p>
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

                {/* A faixa vem da MESMA paleta do card. Era um ternário paralelo, e
                    dois lugares decidindo a cor do mesmo estado divergem — o card
                    ficaria verde e a faixa continuaria cinza. */}
                <div className={`mt-4 rounded-xl border p-3 ${ui.band}`}>
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

                {/* Quais ATIVOS passaram por aqui. A seção acima diz quem cobre
                    esta fonte no papel; esta diz o que aconteceu de verdade —
                    e as duas discordam com frequência, porque cobertura
                    declarada não é cobertura exercida. */}
                {source.escalated && (
                    <div className="mt-4 pt-3 border-t border-slate-800">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                            <GitBranch size={11} />
                            Ativos que passaram por aqui
                        </p>
                        {source.escalated.reached === 0 ? (
                            <p className="text-[11px] text-slate-400 mt-1.5">
                                {source.chainPosition === 1
                                    ? 'Nenhum ativo precisou de reserva: esta fonte trouxe o preço de todos.'
                                    : 'Nenhum ativo chegou até aqui — a fonte anterior deu conta de todos.'}
                            </p>
                        ) : (
                            <>
                                <p className="text-[11px] text-slate-300 mt-1.5">
                                    <span className="font-bold text-white">{source.escalated.reached}</span>
                                    {source.chainPosition === 1
                                        ? ' ativo(s) não tiveram preço aqui e desceram para a reserva'
                                        : ` ativo(s) chegaram até aqui · ${source.escalated.rescued} tiveram o preço trazido por esta fonte · ${source.escalated.missed} não`}
                                </p>
                                <div className="mt-2 space-y-1.5">
                                    <TickerGroup
                                        rotulo="Trouxe o preço"
                                        tickers={salvos}
                                        total={source.escalated.rescued}
                                        tone="text-emerald-300 bg-emerald-900/20 border-emerald-900/50"
                                    />
                                    <TickerGroup
                                        rotulo="Seguiu para a próxima fonte"
                                        tickers={seguiram}
                                        total={seguiram.length}
                                        tone="text-slate-400 bg-elevated border-slate-700"
                                    />
                                    <TickerGroup
                                        rotulo="Ficou sem preço em fonte nenhuma"
                                        tickers={semPreco}
                                        total={semPreco.length}
                                        tone="text-red-400 bg-red-900/20 border-red-900/50"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}

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
    sources, summary, groups, chains, suspects,
}: {
    sources: DataSource[];
    summary?: SourceSummary;
    groups?: SourceGroup[];
    /**
     * Trajeto por ativo, por cadeia. Chave AUSENTE significa "não medimos" — não
     * "nada escalou". Por isso a tela não inventa um zero quando o servidor cala:
     * ela simplesmente não fala pela cadeia que não tem registro.
     */
    chains?: Record<string, ChainFlow>;
    /**
     * Preços que chegaram fora da magnitude esperada. Ausente = servidor sem a
     * medição (versão anterior), e aí a linha some em vez de afirmar zero — a
     * mesma regra do trajeto por ativo, pela mesma razão.
     */
    suspects?: QuoteSuspectView;
}) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [openChain, setOpenChain] = useState<string | null>(null);
    const [openSuspects, setOpenSuspects] = useState(false);

    // Agrupa preservando a ordem que o servidor mandou e, dentro do bloco, separa
    // as CADEIAS (que viram sequência com seta) das fontes independentes. A
    // distinção vem do campo `chain`, nunca da vizinhança na tela.
    const blocos = useMemo(() => {
        const lista = groups?.length
            ? groups
            : [{ id: '__all', label: 'Fontes', hint: '' }];
        return lista
            .map((g) => {
                const itens = sources.filter((s) => (g.id === '__all' ? true : s.group === g.id));
                const cadeias = new Map<string, DataSource[]>();
                const avulsas: DataSource[] = [];
                for (const s of itens) {
                    if (!s.chain) { avulsas.push(s); continue; }
                    if (!cadeias.has(s.chain)) cadeias.set(s.chain, []);
                    cadeias.get(s.chain)!.push(s);
                }
                // Servidor antigo não manda `chain`: sem cadeia nenhuma, tudo cai em
                // `avulsas` e o bloco volta a ser a grade de antes — sem seta, que é
                // o correto quando a ordem não é conhecida.
                return { ...g, itens, cadeias: [...cadeias.values()], avulsas };
            })
            .filter((g) => g.itens.length > 0);
    }, [sources, groups]);

    const selected = useMemo(
        () => sources.find((s) => s.id === selectedId) ?? null,
        [sources, selectedId],
    );

    // O ledger transporta IDS; o nome curto de cada fonte já vem no catálogo, e
    // duplicá-lo em cada linha do trajeto só engordaria o payload.
    const labelOf = useMemo(() => {
        const mapa = new Map(sources.map((s) => [s.id, s.short ?? s.label]));
        return (id: string) => mapa.get(id) ?? id;
    }, [sources]);

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
                        <div className="space-y-2">
                            {bloco.cadeias.map((cadeia) => {
                                const fluxo = cadeia[0].chain ? chains?.[cadeia[0].chain] : undefined;
                                return (
                                    <div key={cadeia[0].id} className="space-y-1.5">
                                        <ChainRow
                                            itens={cadeia}
                                            selectedId={selectedId}
                                            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
                                        />
                                        {fluxo && (
                                            <ChainFlowLine flow={fluxo} onOpen={() => setOpenChain(fluxo.chain)} />
                                        )}
                                        {/* Só na cadeia de cotações: é a única com
                                            julgamento de valor hoje, e afirmar
                                            "nenhum preço fora do esperado" embaixo
                                            de uma cadeia que ninguém julga seria
                                            mentir por omissão. */}
                                        {suspects && cadeia[0].chain === 'quotes' && (
                                            <SuspectLine suspects={suspects} onOpen={() => setOpenSuspects(true)} />
                                        )}
                                    </div>
                                );
                            })}
                            {bloco.avulsas.length > 0 && (
                                <div>
                                    {/* Só quando há cadeia no mesmo bloco: aí a proximidade
                                        engana, e a legenda desfaz. Bloco sem cadeia nenhuma
                                        não precisa avisar que não tem sequência. */}
                                    {bloco.cadeias.length > 0 && (
                                        <p className="text-[9px] text-slate-600 uppercase font-bold tracking-wide mb-1.5">
                                            Independente — não substitui as de cima
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-stretch gap-1.5">
                                        {bloco.avulsas.map((s) => (
                                            <SourceCard
                                                key={s.id}
                                                source={s}
                                                selected={selectedId === s.id}
                                                onSelect={() => setSelectedId((cur) => (cur === s.id ? null : s.id))}
                                                className="basis-[132px] grow max-w-[200px]"
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {selected && (
                <SourceDetailModal
                    source={selected}
                    flow={selected.chain ? chains?.[selected.chain] : undefined}
                    onClose={() => setSelectedId(null)}
                />
            )}
            {openChain && chains?.[openChain] && (
                <ChainFlowModal
                    flow={chains[openChain]}
                    labelOf={labelOf}
                    onClose={() => setOpenChain(null)}
                />
            )}
            {openSuspects && suspects && (
                <SuspectModal suspects={suspects} onClose={() => setOpenSuspects(false)} />
            )}
        </section>
    );
};
