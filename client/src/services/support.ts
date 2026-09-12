import { authService } from './auth';
import { collectSupportContext } from '../utils/supportContext';

export type TicketCategory = 'BUG' | 'DADO_INCORRETO' | 'DUVIDA' | 'SUGESTAO' | 'COBRANCA' | 'OUTRO';
export type TicketStatus = 'ABERTO' | 'EM_ANALISE' | 'RESPONDIDO' | 'RESOLVIDO' | 'FECHADO';
export type TicketPriority = 'NORMAL' | 'MEDIA' | 'ALTA';

export interface TicketMessage {
    _id?: string;
    authorRole: 'USER' | 'ADMIN';
    authorName: string;
    body: string;
    isInternal?: boolean;
    attachments: string[];
    createdAt: string;
}

export interface TicketSummary {
    _id: string;
    code: string;
    subject: string;
    category: TicketCategory;
    status: TicketStatus;
    createdAt: string;
    updatedAt: string;
    hasUnreadForUser: boolean;
    messageCount: number;
    canReopen: boolean;
}

export interface Ticket extends TicketSummary {
    messages: TicketMessage[];
    priority?: TicketPriority;
}

export interface AdminTicketRow extends TicketSummary {
    priority: TicketPriority;
    userName: string;
    userEmail: string;
    planAtOpen: string;
    lastUserMessageAt: string;
    lastAdminMessageAt: string | null;
}

export interface AdminTicketDetail {
    // Status que a regra do servidor aceita a partir do atual. A tela oferece
    // só estes — a tabela de transições vive no servidor e não é reescrita aqui.
    allowedTransitions: TicketStatus[];
    ticket: Ticket & {
        priority: TicketPriority;
        userName: string;
        userEmail: string;
        planAtOpen: string;
        internalTags: string[];
        context: {
            route?: string;
            userAgent?: string;
            platform?: string;
            viewport?: string;
            timezone?: string;
            appVersion?: string;
            recentErrors?: { at: string; status: number; path: string; message?: string }[];
        };
    };
    profile: {
        name: string;
        email: string;
        plan: string;
        role: string;
        subscriptionStatus?: string;
        validUntil?: string;
        createdAt: string;
        assetCount: number;
    } | null;
}

export interface AdminSummary {
    open: number;
    waiting: number;
    highPriority: number;
    byStatus: Record<string, number>;
}

/** Erro de regra vindo do servidor, com a mensagem que o usuário deve ler. */
export class SupportRequestError extends Error {
    needsNewTicket: boolean;
    /** Status HTTP, quando houve resposta. Separa "sumiu" de "nao consegui perguntar". */
    status: number | null;
    constructor(message: string, needsNewTicket = false, status: number | null = null) {
        super(message);
        this.name = 'SupportRequestError';
        this.needsNewTicket = needsNewTicket;
        this.status = status;
    }
}

// id do anexo → object URL já materializado nesta aba.
const attachmentCache = new Map<string, string>();

const parse = async (response: Response) => {
    if (response.ok) return response.json();

    // A mensagem do servidor é escrita para ser lida ("você já tem 3 tickets em
    // andamento"). Trocá-la por um genérico aqui joga fora a única explicação
    // que o usuário teria.
    const data = await response.json().catch(() => ({}));
    throw new SupportRequestError(data.message || 'Não foi possível completar a operação.', Boolean(data.needsNewTicket), response.status);
};

const query = (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '' && v !== 'ALL') search.set(k, String(v));
    });
    const qs = search.toString();
    return qs ? `?${qs}` : '';
};

export const supportService = {
    // ─── Usuário ─────────────────────────────────────────────────────────────

    async listMyTickets(): Promise<TicketSummary[]> {
        const data = await parse(await authService.api('/api/support/tickets'));
        return data.tickets ?? [];
    },

    async getTicket(id: string): Promise<Ticket> {
        return parse(await authService.api(`/api/support/tickets/${id}`));
    },

    /**
     * O contexto técnico é montado aqui, e não pela tela: assim toda porta de
     * abertura (widget, rota /suporte, um atalho futuro) manda a mesma coisa.
     */
    async createTicket(input: {
        category: TicketCategory;
        subject: string;
        body: string;
        attachments?: string[];
        // Ticket que originou este, quando o anterior já estava encerrado. O
        // servidor só aceita o vínculo se o ticket antigo for do mesmo usuário.
        relatedTicket?: string | null;
    }): Promise<Ticket> {
        return parse(await authService.api('/api/support/tickets', {
            method: 'POST',
            body: JSON.stringify({ ...input, context: collectSupportContext() }),
        }));
    },

    async reply(id: string, body: string, attachments: string[] = []): Promise<{ ticket: Ticket; reopened: boolean }> {
        return parse(await authService.api(`/api/support/tickets/${id}/reply`, {
            method: 'POST',
            body: JSON.stringify({ body, attachments }),
        }));
    },

    /**
     * Carrega o anexo como object URL.
     *
     * Não dá para apontar um `<img src="/api/support/attachments/...">` direto:
     * o access token vive só na memória da aba (nunca em cookie, por causa de
     * XSS), e a tag `<img>` não manda header `Authorization` — a imagem voltaria
     * 401 e o usuário veria um ícone quebrado. Então buscamos com o token e
     * entregamos um blob local.
     *
     * O cache evita recarregar a mesma imagem a cada render da thread; o object
     * URL vive enquanto a aba viver, que é o tempo de uso da tela.
     */
    async loadAttachment(id: string): Promise<string> {
        const cached = attachmentCache.get(id);
        if (cached) return cached;

        const response = await authService.api(`/api/support/attachments/${id}`);
        // O status importa para a tela: 404 é "não existe mais" (retenção), o
        // resto é "não consegui buscar agora".
        if (!response.ok) throw new SupportRequestError('Anexo indisponível.', false, response.status);

        const url = URL.createObjectURL(await response.blob());
        attachmentCache.set(id, url);
        return url;
    },

    // ─── Admin ───────────────────────────────────────────────────────────────

    /**
     * Contadores do badge.
     *
     * Propaga o erro em vez de devolver zeros. Um número inventado aqui é pior
     * que número nenhum: o badge sumiria e o painel afirmaria, com a autoridade
     * de um contador, que ninguém está esperando — justamente quando o servidor
     * parou de responder. Sem dado, o React Query segura o último valor
     * conhecido e não fabrica nada.
     */
    async adminSummary(): Promise<AdminSummary> {
        return parse(await authService.api('/api/support/admin/summary'));
    },

    async adminList(filters: {
        status?: string; category?: string; priority?: string; search?: string;
        from?: string; to?: string; limit?: number; skip?: number;
    } = {}): Promise<{ total: number; tickets: AdminTicketRow[] }> {
        // Falha NÃO vira lista vazia: numa fila de atendimento, "nada aqui" é uma
        // afirmação forte — significa que ninguém precisa de você. A tela precisa
        // poder distinguir isso de "não consegui perguntar".
        return parse(await authService.api(`/api/support/admin/tickets${query(filters)}`));
    },

    async adminGet(id: string): Promise<AdminTicketDetail> {
        return parse(await authService.api(`/api/support/admin/tickets/${id}`));
    },

    async adminReply(id: string, input: {
        body: string; attachments?: string[]; isInternal?: boolean; newStatus?: TicketStatus;
    }): Promise<AdminTicketDetail> {
        return parse(await authService.api(`/api/support/admin/tickets/${id}/reply`, {
            method: 'POST',
            body: JSON.stringify(input),
        }));
    },

    async adminUpdate(id: string, input: {
        status?: TicketStatus; priority?: TicketPriority; category?: TicketCategory; internalTags?: string[];
    }): Promise<AdminTicketDetail> {
        return parse(await authService.api(`/api/support/admin/tickets/${id}`, {
            method: 'PUT',
            body: JSON.stringify(input),
        }));
    },

    /** Exclusão definitiva — o ticket e as imagens dele somem do banco. */
    async adminDelete(id: string): Promise<{ ok: boolean; code: string }> {
        return parse(await authService.api(`/api/support/admin/tickets/${id}`, {
            method: 'DELETE',
        }));
    },

    /**
     * Baixa o CSV do filtro corrente. Mesma razão do anexo: um `<a href>` comum
     * sairia sem o header de autorização e baixaria um arquivo com "Sem token".
     */
    async adminDownloadCsv(filters: Record<string, string | number | undefined> = {}): Promise<void> {
        const response = await authService.api(`/api/support/admin/export.csv${query(filters)}`);
        if (!response.ok) throw new SupportRequestError('Não foi possível gerar o CSV.');

        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    },
};
