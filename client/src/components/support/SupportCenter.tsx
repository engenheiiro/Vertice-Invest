import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertCircle, ArrowLeft, ImagePlus, Loader2, MessageSquarePlus, Paperclip,
    Send, Ticket as TicketIcon, X,
} from 'lucide-react';
import {
    supportService, SupportRequestError,
    type Ticket, type TicketCategory, type TicketSummary,
} from '../../services/support';
import { compressImage } from '../../utils/imageCompress';
import { useToast } from '../../contexts/ToastContext';
import { CATEGORY_LABEL, STATUS_UI, relativeTime } from './categories';
import { AttachmentImage } from './AttachmentImage';

/**
 * Central de atendimento do usuário: abrir ticket, acompanhar, responder.
 *
 * Mora num componente próprio (e não dentro do botão flutuante) porque as duas
 * portas mostram exatamente a mesma coisa — o painel flutuante e a rota
 * `/suporte`, que é onde o link do e-mail aterrissa. Duplicar a tela seria
 * garantir que uma das duas ficasse para trás na primeira mudança.
 */

const MAX_FILES = 3;

interface Props {
    /** Código vindo do link do e-mail (`?ticket=VT-0042`) — abre a thread direto. */
    initialTicketCode?: string | null;
    /** Altura do corpo rolável: o modal é fixo, a página acompanha a janela. */
    variant?: 'panel' | 'page';
    onClose?: () => void;
}

export const SupportCenter: React.FC<Props> = ({ initialTicketCode, variant = 'panel', onClose }) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    const [view, setView] = useState<'list' | 'new' | 'thread'>('list');
    const [openTicketId, setOpenTicketId] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<string | null>(null);
    // Ticket encerrado de onde veio a continuação — o novo nasce apontando para
    // ele, para o atendimento ler os dois lados da mesma história.
    const [continuingFrom, setContinuingFrom] = useState<string | null>(null);

    const { data: tickets = [], isLoading: loadingList, isError: listFailed } = useQuery({
        queryKey: ['support', 'tickets'],
        queryFn: supportService.listMyTickets,
        staleTime: 30_000,
    });

    const { data: thread, isLoading: loadingThread } = useQuery({
        queryKey: ['support', 'ticket', openTicketId],
        queryFn: () => supportService.getTicket(openTicketId as string),
        enabled: Boolean(openTicketId),
    });

    // Link do e-mail traz o CÓDIGO (legível), não o id — o usuário precisa poder
    // reconhecer o ticket no assunto da mensagem.
    useEffect(() => {
        if (!initialTicketCode || !tickets.length) return;
        const match = tickets.find((t) => t.code === initialTicketCode);
        if (match) {
            setOpenTicketId(match._id);
            setView('thread');
        }
    }, [initialTicketCode, tickets]);

    const openThread = (ticket: TicketSummary) => {
        setOpenTicketId(ticket._id);
        setView('thread');
        // Abrir a thread zera a bolinha no servidor; a lista precisa saber disso.
        queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
    };

    const backToList = () => {
        setView('list');
        setOpenTicketId(null);
        queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
    };

    const bodyHeight = variant === 'panel' ? 'h-[min(70vh,560px)]' : 'min-h-[60vh]';

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    {view !== 'list' && (
                        <button
                            onClick={backToList}
                            className="p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            aria-label="Voltar para a lista"
                        >
                            <ArrowLeft size={16} />
                        </button>
                    )}
                    <TicketIcon size={16} className="text-blue-400 shrink-0" />
                    <h2 className="text-sm font-bold text-slate-100 truncate">
                        {view === 'new' ? 'Abrir um ticket'
                            : view === 'thread' ? (thread?.code ? `${thread.code} · ${thread.subject}` : 'Atendimento')
                                : 'Suporte'}
                    </h2>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                        aria-label="Fechar suporte"
                    >
                        <X size={16} />
                    </button>
                )}
            </header>

            <div className={`flex-1 overflow-y-auto ${bodyHeight}`}>
                {view === 'list' && (
                    <TicketList
                        tickets={tickets}
                        isLoading={loadingList}
                        hasFailed={listFailed}
                        onOpen={openThread}
                        onNew={() => { setContinuingFrom(null); setView('new'); }}
                    />
                )}

                {view === 'new' && (
                    <NewTicketForm
                        relatedTicket={continuingFrom}
                        onCreated={(ticket) => {
                            addToast(`Ticket ${ticket.code} aberto. Respondemos por aqui e por e-mail.`, 'success');
                            queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
                            setOpenTicketId(ticket._id);
                            setView('thread');
                        }}
                        onCancel={backToList}
                    />
                )}

                {view === 'thread' && (
                    <TicketThread
                        ticket={thread}
                        isLoading={loadingThread}
                        onImage={setLightbox}
                        onNeedsNewTicket={() => { setContinuingFrom(openTicketId); setView('new'); }}
                    />
                )}
            </div>

            {/* Portal + fixed, como todo modal do projeto. Como `absolute` dentro
                da árvore, a ampliação ficava presa ao painel de 420px — e na
                rota /suporte, dentro de um card com `overflow-hidden`, mostrava
                a imagem recortada. Ampliar é justamente o caso em que ela não
                pode caber no container. */}
            {lightbox && createPortal(
                <div
                    className="fixed inset-0 z-[110] backdrop-blur-md bg-black/95 flex items-center justify-center p-6 cursor-zoom-out"
                    onClick={() => setLightbox(null)}
                >
                    <img src={lightbox} alt="Anexo ampliado" className="max-w-full max-h-full rounded-lg" />
                </div>,
                document.body,
            )}
        </div>
    );
};

// ─── Lista ───────────────────────────────────────────────────────────────────

const TicketList: React.FC<{
    tickets: TicketSummary[];
    isLoading: boolean;
    hasFailed: boolean;
    onOpen: (t: TicketSummary) => void;
    onNew: () => void;
}> = ({ tickets, isLoading, hasFailed, onOpen, onNew }) => (
    <div className="p-4 space-y-3">
        <button
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
        >
            <MessageSquarePlus size={16} />
            Relatar um problema
        </button>

        {isLoading && (
            <div className="flex justify-center py-10">
                <Loader2 size={20} className="animate-spin text-slate-600" />
            </div>
        )}

        {/* "Você não tem tickets" só pode ser dito quando a pergunta foi
            respondida. Com a leitura falhando, dizer isso apagaria da tela uma
            conversa em andamento — e o botão de abrir continua ali, convidando a
            pessoa a relatar de novo o que ela já relatou. */}
        {hasFailed && (
            <p className="text-center text-xs text-red-400 py-10 px-6 leading-relaxed">
                Não consegui carregar seus tickets agora.<br />
                <span className="text-slate-500">Se você já abriu algum, ele continua lá — tente novamente em instantes.</span>
            </p>
        )}

        {!isLoading && !hasFailed && tickets.length === 0 && (
            <p className="text-center text-xs text-slate-500 py-10 px-6 leading-relaxed">
                Você ainda não abriu nenhum ticket.<br />
                Encontrou um erro, um número estranho ou tem uma dúvida? Conte aqui.
            </p>
        )}

        {tickets.map((ticket) => {
            const status = STATUS_UI[ticket.status];
            return (
                <button
                    key={ticket._id}
                    onClick={() => onOpen(ticket)}
                    className="w-full text-left p-3 rounded-xl border border-slate-800 bg-card hover:border-slate-700 transition-colors"
                >
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-slate-200 leading-tight line-clamp-2">{ticket.subject}</span>
                        {ticket.hasUnreadForUser && (
                            <span className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-emerald-500" title="Resposta nova" />
                        )}
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${status.className}`}>
                            {status.label}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">{ticket.code}</span>
                        <span className="text-[10px] text-slate-600">· {relativeTime(ticket.updatedAt)}</span>
                    </div>
                </button>
            );
        })}
    </div>
);

// ─── Anexos (compartilhado entre abertura e resposta) ────────────────────────

/**
 * Seletor de imagens com compressão no navegador.
 *
 * Comprimir aqui, e não no servidor, é o que faz o print de tela cheia caber:
 * o arquivo bruto de 6 MB sequer chegaria à rota (o Express rejeita o corpo
 * antes) e o usuário levaria um erro sem explicação.
 */
const AttachmentPicker: React.FC<{
    files: string[];
    onChange: (files: string[]) => void;
    disabled?: boolean;
}> = ({ files, onChange, disabled }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const { addToast } = useToast();

    const handleFiles = async (list: FileList | null) => {
        if (!list?.length) return;
        const room = MAX_FILES - files.length;
        if (room <= 0) {
            addToast(`Máximo de ${MAX_FILES} imagens.`, 'error');
            return;
        }

        setBusy(true);
        const accepted: string[] = [];
        for (const file of Array.from(list).slice(0, room)) {
            try {
                accepted.push(await compressImage(file));
            } catch (err) {
                addToast(err instanceof Error ? err.message : 'Não foi possível ler a imagem.', 'error');
            }
        }
        setBusy(false);
        if (accepted.length) onChange([...files, ...accepted]);
        if (inputRef.current) inputRef.current.value = '';
    };

    return (
        <div>
            <div className="flex items-center gap-2 flex-wrap">
                {files.map((data, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-800">
                        <img src={data} alt={`Anexo ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                            type="button"
                            onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                            className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-slate-300 hover:text-white"
                            aria-label="Remover anexo"
                        >
                            <X size={11} />
                        </button>
                    </div>
                ))}

                {files.length < MAX_FILES && (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={disabled || busy}
                        className="w-16 h-16 rounded-lg border border-dashed border-slate-700 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                        <span className="text-[9px]">print</span>
                    </button>
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => handleFiles(e.target.files)}
            />
        </div>
    );
};

// ─── Abertura ────────────────────────────────────────────────────────────────

const NewTicketForm: React.FC<{
    onCreated: (ticket: Ticket) => void;
    onCancel: () => void;
    relatedTicket?: string | null;
}> = ({ onCreated, onCancel, relatedTicket }) => {
    const { addToast } = useToast();
    const [category, setCategory] = useState<TicketCategory>('BUG');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);

    const mutation = useMutation({
        mutationFn: () => supportService.createTicket({ category, subject, body, attachments, relatedTicket }),
        onSuccess: onCreated,
        onError: (err: unknown) => {
            addToast(err instanceof SupportRequestError ? err.message : 'Não foi possível abrir o ticket.', 'error');
        },
    });

    const canSubmit = subject.trim().length >= 3 && body.trim().length >= 10 && !mutation.isPending;

    return (
        <form
            className="p-4 space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
        >
            <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Sobre o que é?
                </label>
                <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setCategory(key)}
                            className={`p-2.5 rounded-lg border text-left transition-colors ${
                                category === key
                                    ? 'border-blue-700 bg-blue-900/20'
                                    : 'border-slate-800 bg-card hover:border-slate-700'
                            }`}
                        >
                            <span className={`block text-[11px] font-bold ${category === key ? 'text-blue-300' : 'text-slate-300'}`}>
                                {CATEGORY_LABEL[key].label}
                            </span>
                        </button>
                    ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">{CATEGORY_LABEL[category].hint}</p>
            </div>

            <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    Resumo
                </label>
                <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={120}
                    placeholder="Ex.: Rentabilidade da carteira zerou hoje"
                    className="w-full px-3 py-2.5 rounded-lg bg-base border border-slate-800 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-700 focus:outline-none"
                />
            </div>

            <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    O que aconteceu?
                </label>
                <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    maxLength={5000}
                    placeholder="Conte o que você estava fazendo e o que esperava ver. Se souber, diga qual ativo ou tela."
                    className="w-full px-3 py-2.5 rounded-lg bg-base border border-slate-800 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-700 focus:outline-none resize-none"
                />
                <p className="text-[10px] text-slate-600 mt-1">{body.trim().length < 10 ? 'Escreva um pouco mais para a gente entender.' : `${body.length}/5000`}</p>
            </div>

            <div>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <Paperclip size={11} /> Print da tela (opcional)
                </label>
                <AttachmentPicker files={attachments} onChange={setAttachments} disabled={mutation.isPending} />
            </div>

            <p className="text-[10px] text-slate-600 leading-relaxed">
                Junto com sua mensagem enviamos dados técnicos da sessão (página aberta, navegador e últimos erros)
                para agilizar o diagnóstico.
            </p>

            <div className="flex gap-2 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2.5 rounded-lg border border-slate-800 text-xs font-bold text-slate-400 hover:text-slate-200 transition-colors"
                >
                    Cancelar
                </button>
                <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                >
                    {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Enviar ticket
                </button>
            </div>
        </form>
    );
};

// ─── Thread ──────────────────────────────────────────────────────────────────

const TicketThread: React.FC<{
    ticket?: Ticket;
    isLoading: boolean;
    onImage: (url: string) => void;
    onNeedsNewTicket: () => void;
}> = ({ ticket, isLoading, onImage, onNeedsNewTicket }) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const [body, setBody] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);

    const mutation = useMutation({
        mutationFn: () => supportService.reply(ticket!._id, body, attachments),
        onSuccess: (result) => {
            setBody('');
            setAttachments([]);
            queryClient.invalidateQueries({ queryKey: ['support', 'ticket', ticket!._id] });
            queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
            if (result.reopened) addToast('Ticket reaberto. Vamos olhar de novo.', 'info');
        },
        onError: (err: unknown) => {
            if (err instanceof SupportRequestError && err.needsNewTicket) {
                addToast(err.message, 'info');
                onNeedsNewTicket();
                return;
            }
            addToast(err instanceof SupportRequestError ? err.message : 'Não foi possível enviar.', 'error');
        },
    });

    const canReply = useMemo(() => ticket && ticket.status !== 'FECHADO', [ticket]);

    if (isLoading || !ticket) {
        return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-slate-600" /></div>;
    }

    const status = STATUS_UI[ticket.status];

    return (
        <div className="flex flex-col">
            <div className={`mx-4 mt-4 px-3 py-2 rounded-lg border text-[11px] font-semibold ${status.className}`}>
                {status.label} — {status.userHint}
            </div>

            <div className="p-4 space-y-4">
                {ticket.messages.map((message, i) => {
                    const fromSupport = message.authorRole === 'ADMIN';
                    return (
                        <div key={message._id ?? i} className={`flex ${fromSupport ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 border ${
                                fromSupport
                                    ? 'bg-card border-slate-800'
                                    : 'bg-blue-900/20 border-blue-900/40'
                            }`}>
                                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                    {fromSupport ? 'Suporte Vértice' : 'Você'} · {relativeTime(message.createdAt)}
                                </span>
                                <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                                    {message.body}
                                </p>
                                {message.attachments?.length > 0 && (
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                        {message.attachments.map((id) => (
                                            <AttachmentImage key={id} id={id} onOpen={onImage} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {canReply ? (
                <div className="p-4 border-t border-slate-800 space-y-2 sticky bottom-0 bg-panel">
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={3}
                        maxLength={5000}
                        placeholder={ticket.status === 'RESOLVIDO' ? 'Ainda com problema? Escreva aqui para reabrir.' : 'Escreva sua resposta...'}
                        className="w-full px-3 py-2.5 rounded-lg bg-base border border-slate-800 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-700 focus:outline-none resize-none"
                    />
                    <div className="flex items-end justify-between gap-3">
                        <AttachmentPicker files={attachments} onChange={setAttachments} disabled={mutation.isPending} />
                        <button
                            onClick={() => mutation.mutate()}
                            disabled={body.trim().length < 10 || mutation.isPending}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors shrink-0"
                        >
                            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Responder
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-4 border-t border-slate-800 flex items-start gap-2 text-[11px] text-slate-500">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>Este atendimento foi encerrado. Se o problema voltar, abra um ticket novo.</span>
                </div>
            )}
        </div>
    );
};
