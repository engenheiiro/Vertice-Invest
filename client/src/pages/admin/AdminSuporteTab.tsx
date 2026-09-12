import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertTriangle, ChevronDown, ChevronUp, Download, Inbox, Loader2, Lock,
    MessageSquare, RefreshCw, Search, Send, User as UserIcon,
} from 'lucide-react';
import {
    supportService, SupportRequestError,
    type AdminTicketRow, type TicketCategory, type TicketPriority, type TicketStatus,
} from '../../services/support';
import { useToast } from '../../contexts/ToastContext';
import { AttachmentImage } from '../../components/support/AttachmentImage';
import { CATEGORY_LABEL, PRIORITY_UI, STATUS_UI, relativeTime } from '../../components/support/categories';

/**
 * Aba "Suporte" do Admin — a fila de atendimento.
 *
 * Layout mestre-detalhe, e não uma tabela: um ticket não se resolve olhando uma
 * linha, se resolve LENDO a conversa. A lista existe para escolher qual ler.
 *
 * A ordem da fila vem pronta do servidor (prioridade do plano e depois tempo de
 * espera) de propósito — reordenar na tela faria o painel e o e-mail de
 * "prioritário 24h" contarem histórias diferentes sobre quem vem primeiro.
 */

// Respostas prontas: caem no campo e PODEM ser editadas antes de enviar. São
// rascunho, não macro automática — atendimento que responde sozinho no texto
// exato é o que faz o cliente perceber que ninguém leu.
const CANNED_REPLIES = [
    {
        label: 'Recebido',
        text: 'Olá! Recebemos seu ticket e já estamos verificando. Retorno em breve com uma posição.',
        status: 'EM_ANALISE' as TicketStatus,
    },
    {
        label: 'Preciso de detalhes',
        text: 'Para conseguir reproduzir o problema, você pode me dizer qual ativo e em que momento isso aconteceu? Um print da tela ajuda bastante.',
        status: 'RESPONDIDO' as TicketStatus,
    },
    {
        label: 'Corrigido',
        text: 'Identificamos a causa e a correção já está no ar. Pode conferir e me dizer se ficou certo do seu lado?',
        status: 'RESOLVIDO' as TicketStatus,
    },
    {
        label: 'É o comportamento esperado',
        text: 'Verifiquei aqui e esse número está correto — ele considera o seguinte critério: ',
        status: 'RESPONDIDO' as TicketStatus,
    },
];

const STATUS_FILTERS: { value: string; label: string }[] = [
    { value: 'OPEN', label: 'Em andamento' },
    { value: 'ABERTO', label: 'Aberto' },
    { value: 'EM_ANALISE', label: 'Em análise' },
    { value: 'RESPONDIDO', label: 'Respondido' },
    { value: 'RESOLVIDO', label: 'Resolvido' },
    { value: 'FECHADO', label: 'Fechado' },
    { value: 'ALL', label: 'Todos' },
];

const selectClass = 'px-2.5 py-1.5 rounded-lg bg-base border border-slate-800 text-[11px] font-bold text-slate-300 focus:border-blue-700 focus:outline-none';

export const AdminSuporteTab: React.FC = () => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    const [status, setStatus] = useState('OPEN');
    const [category, setCategory] = useState('ALL');
    const [priority, setPriority] = useState('ALL');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const filters = useMemo(() => ({ status, category, priority, search }), [status, category, priority, search]);

    const { data, isFetching, refetch } = useQuery({
        queryKey: ['support', 'admin', 'list', filters],
        queryFn: () => supportService.adminList(filters),
        refetchInterval: 120_000,
    });

    const tickets = data?.tickets ?? [];

    const exportCsv = async () => {
        try {
            await supportService.adminDownloadCsv(filters);
        } catch {
            addToast('Não foi possível gerar o CSV.', 'error');
        }
    };

    return (
        <div className="space-y-4">
            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-2 bg-card border border-slate-800 rounded-xl p-3">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                    {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>

                <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
                    <option value="ALL">Todas as categorias</option>
                    {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABEL[c].label}</option>
                    ))}
                </select>

                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
                    <option value="ALL">Qualquer prioridade</option>
                    <option value="ALTA">Alta</option>
                    <option value="MEDIA">Média</option>
                    <option value="NORMAL">Normal</option>
                </select>

                <form
                    className="flex items-center gap-1.5 flex-1 min-w-[180px]"
                    onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}
                >
                    <div className="relative flex-1">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
                        <input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Código, assunto, nome ou e-mail"
                            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-base border border-slate-800 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-blue-700 focus:outline-none"
                        />
                    </div>
                </form>

                <button onClick={() => refetch()} className={`${selectClass} flex items-center gap-1.5 hover:text-white`}>
                    <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Atualizar
                </button>
                <button onClick={exportCsv} className={`${selectClass} flex items-center gap-1.5 hover:text-white`}>
                    <Download size={12} /> CSV
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
                <TicketQueue
                    tickets={tickets}
                    total={data?.total ?? 0}
                    isLoading={isFetching && !data}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                />

                {selectedId ? (
                    <TicketDetail
                        key={selectedId}
                        ticketId={selectedId}
                        onChanged={() => queryClient.invalidateQueries({ queryKey: ['support', 'admin'] })}
                    />
                ) : (
                    <div className="bg-card border border-slate-800 rounded-xl flex flex-col items-center justify-center py-20 text-slate-600 gap-2">
                        <Inbox size={28} />
                        <p className="text-xs">Selecione um ticket para ler a conversa.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Fila ────────────────────────────────────────────────────────────────────

const TicketQueue: React.FC<{
    tickets: AdminTicketRow[];
    total: number;
    isLoading: boolean;
    selectedId: string | null;
    onSelect: (id: string) => void;
}> = ({ tickets, total, isLoading, selectedId, onSelect }) => (
    <div className="bg-card border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[70vh]">
        <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
            {total} ticket{total === 1 ? '' : 's'}
        </div>

        <div className="overflow-y-auto divide-y divide-slate-800/60">
            {isLoading && (
                <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-slate-600" /></div>
            )}

            {!isLoading && tickets.length === 0 && (
                <p className="text-center text-[11px] text-slate-600 py-10 px-4">Nada nesta fila.</p>
            )}

            {tickets.map((ticket) => {
                const isSelected = ticket._id === selectedId;
                // "Na sua vez": a última palavra foi do usuário.
                const waitingOnUs = ticket.status === 'ABERTO' || ticket.status === 'EM_ANALISE';
                return (
                    <button
                        key={ticket._id}
                        onClick={() => onSelect(ticket._id)}
                        className={`w-full text-left px-3 py-2.5 transition-colors ${isSelected ? 'bg-slate-800/70' : 'hover:bg-slate-800/30'}`}
                    >
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] font-mono text-slate-500">{ticket.code}</span>
                            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${PRIORITY_UI[ticket.priority].className}`}>
                                {ticket.planAtOpen}
                            </span>
                            {waitingOnUs && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" title="Aguardando resposta sua" />}
                        </div>
                        <p className="text-[11px] font-bold text-slate-200 leading-snug line-clamp-2">{ticket.subject}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                            <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${STATUS_UI[ticket.status].className}`}>
                                {STATUS_UI[ticket.status].label}
                            </span>
                            <span className="text-[9px] text-slate-600 truncate">
                                {ticket.userName} · {relativeTime(ticket.lastUserMessageAt)}
                            </span>
                        </div>
                    </button>
                );
            })}
        </div>
    </div>
);

// ─── Detalhe ─────────────────────────────────────────────────────────────────

const TicketDetail: React.FC<{ ticketId: string; onChanged: () => void }> = ({ ticketId, onChanged }) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const [body, setBody] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [nextStatus, setNextStatus] = useState<TicketStatus | ''>('');
    const [showContext, setShowContext] = useState(false);
    const [lightbox, setLightbox] = useState<string | null>(null);

    const queryKey = ['support', 'admin', 'ticket', ticketId];

    const { data, isLoading } = useQuery({
        queryKey,
        queryFn: () => supportService.adminGet(ticketId),
    });

    const afterWrite = () => {
        queryClient.invalidateQueries({ queryKey });
        onChanged();
    };

    const replyMutation = useMutation({
        mutationFn: () => supportService.adminReply(ticketId, {
            body,
            isInternal,
            newStatus: nextStatus || undefined,
        }),
        onSuccess: () => {
            setBody('');
            setNextStatus('');
            addToast(isInternal ? 'Nota interna salva.' : 'Resposta enviada — o usuário foi avisado.', 'success');
            setIsInternal(false);
            afterWrite();
        },
        onError: (err: unknown) => {
            addToast(err instanceof SupportRequestError ? err.message : 'Não foi possível enviar.', 'error');
        },
    });

    const updateMutation = useMutation({
        mutationFn: (input: { status?: TicketStatus; priority?: TicketPriority }) =>
            supportService.adminUpdate(ticketId, input),
        onSuccess: afterWrite,
        onError: (err: unknown) => {
            addToast(err instanceof SupportRequestError ? err.message : 'Não foi possível atualizar.', 'error');
        },
    });

    if (isLoading || !data) {
        return (
            <div className="bg-card border border-slate-800 rounded-xl flex justify-center py-20">
                <Loader2 size={20} className="animate-spin text-slate-600" />
            </div>
        );
    }

    const { ticket, profile } = data;
    const context = ticket.context ?? {};

    return (
        <div className="bg-card border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[70vh]">
            {/* Cabeçalho e controles */}
            <div className="px-4 py-3 border-b border-slate-800 shrink-0">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-mono text-slate-500">
                            {ticket.code} · {CATEGORY_LABEL[ticket.category].label} · aberto {relativeTime(ticket.createdAt)}
                        </p>
                        <h3 className="text-sm font-bold text-slate-100 mt-0.5">{ticket.subject}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <select
                            value={ticket.status}
                            onChange={(e) => updateMutation.mutate({ status: e.target.value as TicketStatus })}
                            className={selectClass}
                        >
                            {(Object.keys(STATUS_UI) as TicketStatus[]).map((s) => (
                                <option key={s} value={s}>{STATUS_UI[s].label}</option>
                            ))}
                        </select>
                        <select
                            value={ticket.priority}
                            onChange={(e) => updateMutation.mutate({ priority: e.target.value as TicketPriority })}
                            className={selectClass}
                        >
                            {(Object.keys(PRIORITY_UI) as TicketPriority[]).map((p) => (
                                <option key={p} value={p}>{PRIORITY_UI[p].label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Ficha do usuário: o estado de HOJE. `planAtOpen` guarda o de ontem. */}
                {profile && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1 text-slate-300 font-bold">
                            <UserIcon size={11} /> {profile.name}
                        </span>
                        <span>{profile.email}</span>
                        <span>Plano hoje: <strong className="text-slate-300">{profile.plan}</strong>
                            {profile.plan !== ticket.planAtOpen && (
                                <span className="text-yellow-500"> (era {ticket.planAtOpen} na abertura)</span>
                            )}
                        </span>
                        <span>{profile.assetCount} ativo(s)</span>
                        <span>Cliente desde {new Date(profile.createdAt).toLocaleDateString('pt-BR')}</span>
                        {profile.subscriptionStatus && <span>Assinatura: {profile.subscriptionStatus}</span>}
                    </div>
                )}
                {!profile && (
                    <p className="mt-2 text-[10px] text-slate-600 flex items-center gap-1">
                        <AlertTriangle size={11} /> Conta excluída — o histórico foi anonimizado.
                    </p>
                )}

                <button
                    onClick={() => setShowContext((v) => !v)}
                    className="mt-2 flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-300"
                >
                    {showContext ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Contexto técnico
                </button>
                {showContext && (
                    <div className="mt-2 p-2.5 rounded-lg bg-base border border-slate-800 text-[10px] text-slate-400 font-mono space-y-0.5">
                        <p>Tela: {context.route || '—'}</p>
                        <p>Janela: {context.viewport || '—'} · Fuso: {context.timezone || '—'} · Versão: {context.appVersion || '—'}</p>
                        <p className="break-all">Navegador: {context.userAgent || '—'}</p>
                        {context.recentErrors?.length ? (
                            <div className="pt-1 mt-1 border-t border-slate-800">
                                <p className="text-slate-500">Últimos erros de API antes do relato:</p>
                                {context.recentErrors.map((e, i) => (
                                    <p key={i} className="text-red-400">{e.status} · {e.path} · {relativeTime(e.at)}</p>
                                ))}
                            </div>
                        ) : (
                            <p className="text-slate-600">Nenhum erro de API na sessão.</p>
                        )}
                    </div>
                )}
            </div>

            {/* Conversa */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {ticket.messages.map((message, i) => {
                    if (message.isInternal) {
                        return (
                            <div key={message._id ?? i} className="rounded-lg border border-yellow-900/50 bg-yellow-900/10 px-3 py-2">
                                <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-yellow-600 mb-1">
                                    <Lock size={10} /> Nota interna · {message.authorName} · {relativeTime(message.createdAt)}
                                </span>
                                <p className="text-[11px] text-yellow-100/80 whitespace-pre-wrap break-words">{message.body}</p>
                            </div>
                        );
                    }

                    const fromUser = message.authorRole === 'USER';
                    return (
                        <div key={message._id ?? i} className={`flex ${fromUser ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[80%] rounded-xl px-3 py-2 border ${
                                fromUser ? 'bg-base border-slate-800' : 'bg-blue-900/20 border-blue-900/40'
                            }`}>
                                <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                    {fromUser ? ticket.userName : message.authorName} · {relativeTime(message.createdAt)}
                                </span>
                                <p className="text-[11px] text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
                                {message.attachments?.length > 0 && (
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                        {message.attachments.map((id) => (
                                            <AttachmentImage key={id} id={id} onOpen={setLightbox} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Resposta */}
            <div className="border-t border-slate-800 p-3 space-y-2 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                    {CANNED_REPLIES.map((canned) => (
                        <button
                            key={canned.label}
                            onClick={() => { setBody(canned.text); setNextStatus(canned.status); setIsInternal(false); }}
                            className="px-2 py-1 rounded-lg border border-slate-800 bg-base text-[10px] font-bold text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors"
                        >
                            {canned.label}
                        </button>
                    ))}
                </div>

                <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={3}
                    maxLength={5000}
                    placeholder={isInternal ? 'Nota visível só para você...' : 'Resposta para o usuário...'}
                    className={`w-full px-3 py-2 rounded-lg bg-base border text-[12px] text-slate-100 placeholder:text-slate-600 focus:outline-none resize-none ${
                        isInternal ? 'border-yellow-900/60 focus:border-yellow-700' : 'border-slate-800 focus:border-blue-700'
                    }`}
                />

                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isInternal}
                            onChange={(e) => setIsInternal(e.target.checked)}
                            className="accent-yellow-600"
                        />
                        <Lock size={10} /> Nota interna (não notifica o usuário)
                    </label>

                    <div className="flex items-center gap-1.5">
                        {!isInternal && (
                            <select
                                value={nextStatus}
                                onChange={(e) => setNextStatus(e.target.value as TicketStatus | '')}
                                className={selectClass}
                                title="Status após enviar"
                            >
                                <option value="">Marcar como Respondido</option>
                                <option value="EM_ANALISE">Deixar em análise</option>
                                <option value="RESOLVIDO">Marcar como Resolvido</option>
                                <option value="FECHADO">Encerrar</option>
                            </select>
                        )}
                        <button
                            onClick={() => replyMutation.mutate()}
                            disabled={!body.trim() || replyMutation.isPending}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                isInternal ? 'bg-yellow-700 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-500'
                            }`}
                        >
                            {replyMutation.isPending
                                ? <Loader2 size={12} className="animate-spin" />
                                : isInternal ? <MessageSquare size={12} /> : <Send size={12} />}
                            {isInternal ? 'Salvar nota' : 'Responder'}
                        </button>
                    </div>
                </div>
            </div>

            {lightbox && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-8"
                    onClick={() => setLightbox(null)}
                >
                    <img src={lightbox} alt="Anexo ampliado" className="max-w-full max-h-full rounded-lg" />
                </div>
            )}
        </div>
    );
};
