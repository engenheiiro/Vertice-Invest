import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, ShieldCheck, X } from 'lucide-react';
import { onBackdropClick } from '../../utils/a11yEvents';
import type { ChainFlow, DataSource } from '../../services/health';
import {
    ORDINAL, VOCAB_PADRAO, absoluteTime, capitalizar, chainPassage, footerInfo, hasNoBackup,
    quietPassageText, reachedPassageText, sinceLabel, visualFor, type ChainVocab,
} from './dataSourcesPanelView';

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

const DetailHeader = ({ source, onClose }: { source: DataSource; onClose: () => void }) => {
    const ui = visualFor(source);
    return (
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
    );
};

/**
 * A faixa vem da MESMA paleta do card. Era um ternário paralelo, e dois lugares
 * decidindo a cor do mesmo estado divergem — o card ficaria verde e a faixa
 * continuaria cinza.
 */
const StatusBand = ({ source }: { source: DataSource }) => {
    const ui = visualFor(source);
    return (
        <div className={`mt-4 rounded-xl border p-3 ${ui.band}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${ui.text}`}>{footerInfo(source).label}</p>
            <p className="text-xs text-slate-200 mt-1">{source.detail}</p>
        </div>
    );
};

/**
 * Fonte com carimbo de entrega e carimbo vazio não é fonte sem informação: é uma
 * fonte que respondeu e não é a origem do dado que está gravado agora. Era
 * exatamente esse o caso da PTAX em 07/09/2026, e o card dizia o oposto.
 */
const DeliveryLine = ({ source }: { source: DataSource }) => {
    if (source.deliveryTracked === false) return null;
    const entrega = absoluteTime(source.lastDeliveryAt);
    return (
        <Linha rotulo="Última entrega">
            {entrega
                ? <>{entrega} <span className="text-slate-500">({sinceLabel(source.lastDeliveryHours)})</span></>
                : <span className="text-slate-400">nada gravado veio desta fonte agora</span>}
        </Linha>
    );
};

const ResponseLine = ({ source }: { source: DataSource }) => {
    const resposta = absoluteTime(source.lastResponseAt ?? source.lastOkAt ?? null);
    return (
        <Linha rotulo="Última resposta">
            {resposta
                ? <>{resposta} <span className="text-slate-500">({sinceLabel(source.lastResponseHours ?? null)})</span></>
                : 'sem registro'}
        </Linha>
    );
};

/**
 * Ancorado no ERRO, não na data: o registro sempre grava os dois juntos, mas se
 * um dia faltar o carimbo, a mensagem ainda é o que resolve o problema — esconder
 * por falta do relógio seria perder a única pista.
 */
const FailureLine = ({ source }: { source: DataSource }) => {
    const falha = absoluteTime(source.lastFailAt);
    if (!source.lastError && !falha) return null;
    return (
        <Linha rotulo="Última falha">
            {falha ?? 'sem data'}
            {source.lastError && <span className="text-slate-500"> — <span className="font-mono">{source.lastError}</span></span>}
        </Linha>
    );
};

const SourceFacts = ({ source }: { source: DataSource }) => (
    <div className="mt-4 space-y-2">
        <Linha rotulo="Alimenta">{source.feeds}</Linha>
        {source.cadence && (
            <Linha rotulo="Quando roda">
                {source.cadence}
                {source.nextRun && <span className="text-slate-500"> · próxima {source.nextRun}</span>}
            </Linha>
        )}
        <DeliveryLine source={source} />
        <ResponseLine source={source} />
        {(source.attempts ?? 0) > 0 && (
            <Linha rotulo="Chamadas">
                {source.attempts} desde o reinício · {source.ok ?? 0} com dado · {source.failures} sem
            </Linha>
        )}
        {(source.skipped ?? 0) > 0 && (
            <Linha rotulo="Não chamada">
                {source.skipped}× por decisão nossa
                {source.lastSkipReason && <span className="text-slate-500"> — {source.lastSkipReason}</span>}
            </Linha>
        )}
        <FailureLine source={source} />
    </div>
);

/** A pergunta seguinte à do painel: caiu, e agora? */
const FallbackSection = ({ source, vocab }: { source: DataSource; vocab: ChainVocab }) => (
    <div className="mt-4 pt-3 border-t border-slate-800">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <ShieldCheck size={11} />
            Se esta fonte falhar
        </p>
        {hasNoBackup(source) ? (
            <p className="text-[11px] text-yellow-400/90 mt-1.5">
                Não há fonte alternativa. Se ela parar, o dado que ela alimenta deixa de ser
                atualizado até a fonte voltar.
            </p>
        ) : (
            <div className="mt-1.5 space-y-1">
                {source.covers && (
                    <p className="text-[11px] text-slate-400">
                        {vocab.backupOf ?? VOCAB_PADRAO.backupOf}{' '}
                        <span className="text-slate-200">{source.covers}</span>.
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
);

/**
 * Quais ATIVOS passaram por aqui. A seção de cobertura diz quem cobre esta fonte
 * no papel; esta diz o que aconteceu de verdade — e as duas discordam com
 * frequência, porque cobertura declarada não é cobertura exercida.
 */
const PassageSection = ({
    source, escalated, flow, vocab,
}: {
    source: DataSource;
    escalated: NonNullable<DataSource['escalated']>;
    flow?: ChainFlow;
    vocab: ChainVocab;
}) => {
    const naoPerguntados = escalated.skipped ?? 0;
    const { salvos, seguiram, semPreco } = chainPassage(source, flow);
    return (
        <div className="mt-4 pt-3 border-t border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <GitBranch size={11} />
                {capitalizar(vocab.noun)}s que passaram por aqui
            </p>
            {escalated.reached === 0 ? (
                <p className="text-[11px] text-slate-400 mt-1.5">
                    {quietPassageText(source, vocab, naoPerguntados)}
                </p>
            ) : (
                <>
                    <p className="text-[11px] text-slate-300 mt-1.5">
                        <span className="font-bold text-white">{escalated.reached}</span>
                        {reachedPassageText(source, vocab, escalated)}
                        {naoPerguntados > 0 && ` · ${naoPerguntados} nem foram perguntados`}
                    </p>
                    <div className="mt-2 space-y-1.5">
                        <TickerGroup
                            rotulo="Resolvido por esta fonte"
                            tickers={salvos}
                            total={escalated.rescued}
                            tone="text-emerald-300 bg-emerald-900/20 border-emerald-900/50"
                        />
                        <TickerGroup
                            rotulo="Seguiu para a próxima fonte"
                            tickers={seguiram}
                            total={seguiram.length}
                            tone="text-slate-400 bg-elevated border-slate-700"
                        />
                        <TickerGroup
                            rotulo={`Ficou ${vocab.missingBadge} em fonte nenhuma`}
                            tickers={semPreco}
                            total={semPreco.length}
                            tone="text-red-400 bg-red-900/20 border-red-900/50"
                        />
                    </div>
                </>
            )}
        </div>
    );
};

/**
 * Detalhe da fonte, em modal.
 *
 * Em janela, e não numa faixa embaixo da grade, porque o conteúdo cresceu além do
 * que cabe sem empurrar os cards para fora da tela — e porque a leitura aqui é um
 * desvio do fluxo: você abre para investigar uma fonte, não para comparar quinze.
 *
 * A informação que faltava e que mais importa é a seção "Se esta fonte falhar":
 * **quem cobre se esta cair**. Sem ela, o painel dizia que a fonte quebrou e
 * deixava a pergunta seguinte sem resposta. E quando não há ninguém atrás, dizer
 * isso em voz alta é mais valioso ainda: é o mapa dos pontos únicos de falha.
 */
export const SourceDetailModal = ({
    source, flow, onClose,
}: {
    source: DataSource;
    /** Trajeto dos ativos na cadeia desta fonte; ausente = cadeia sem medição. */
    flow?: ChainFlow;
    onClose: () => void;
}) => {
    // As palavras vêm da CADEIA: este mesmo bloco descreve ativo e preço em
    // cotações, moeda e cotação no câmbio, indicador e valor nas taxas.
    const vocab = flow?.vocabulary ?? VOCAB_PADRAO;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 z-[100] backdrop-blur-md bg-black/95 flex items-center justify-center p-4"
            onClick={onBackdropClick(onClose)}
            role="presentation"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`Detalhes da fonte ${source.label}`}
                className="w-full max-w-lg bg-panel border border-slate-700 rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            >
                <DetailHeader source={source} onClose={onClose} />
                <StatusBand source={source} />
                <SourceFacts source={source} />
                <FallbackSection source={source} vocab={vocab} />
                {source.escalated && (
                    <PassageSection source={source} escalated={source.escalated} flow={flow} vocab={vocab} />
                )}

                <p className="text-[10px] text-slate-600 mt-4">
                    São dois relógios diferentes: <b>última resposta</b> é a última chamada que voltou (vive
                    no processo e zera a cada reinício); <b>última entrega</b> é quando o dado desta fonte foi
                    o gravado no banco — vem do banco e sobrevive ao reinício. Uma fonte pode responder
                    perfeitamente e não estar entregando nada, e é essa diferença que a linha mostra.
                </p>
            </div>
        </div>,
        document.body,
    );
};
