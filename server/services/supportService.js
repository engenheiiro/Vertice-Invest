/**
 * Serviço de atendimento: lê e escreve o ticket, delegando toda decisão às
 * funções puras de `utils/supportRules.js`.
 *
 * A divisão é deliberada — aqui mora o I/O (Mongo, notificação, e-mail), lá
 * moram as regras. Nenhuma condição de negócio nova deve nascer neste arquivo.
 */
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import SupportTicket from '../models/SupportTicket.js';
import SupportAttachment from '../models/SupportAttachment.js';
import SupportCounter from '../models/SupportCounter.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import { createNotification } from './notificationService.js';
import { sendSupportReplyEmail } from './emailService.js';
import {
    OPEN_STATUSES,
    MAX_OPEN_TICKETS_PER_USER,
    allowedTransitionsFrom,
    canReopen,
    canTransition,
    mimeOfDataUrl,
    priorityFromPlan,
    serializeTicketForUser,
    statusAfterUserReply,
    validateAttachments,
} from '../utils/supportRules.js';

/** Erro de regra de negócio — o controller traduz em 4xx em vez de 500. */
export class SupportError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'SupportError';
        this.statusCode = statusCode;
    }
}

// ─── Código legível ──────────────────────────────────────────────────────────

/**
 * "VT-0042". `findOneAndUpdate` com `$inc` é atômico no servidor do Mongo: duas
 * aberturas simultâneas recebem números diferentes. Contar documentos e somar 1
 * repetiria o número e esbarraria no índice único de `code`.
 */
async function nextTicketCode() {
    try {
        const counter = await SupportCounter.findOneAndUpdate(
            { key: 'TICKET' },
            { $inc: { seq: 1 } },
            { new: true, upsert: true },
        );
        return `VT-${String(counter.seq).padStart(4, '0')}`;
    } catch (err) {
        // Duas aberturas simultâneas com o contador AINDA inexistente podem tentar
        // inserir o mesmo documento e uma leva E11000 (a corrida clássica do
        // upsert). Acontece uma vez na vida — no primeiro ticket do sistema — e a
        // segunda tentativa já encontra o documento criado.
        if (err?.code !== 11000) throw err;

        const counter = await SupportCounter.findOneAndUpdate(
            { key: 'TICKET' },
            { $inc: { seq: 1 } },
            { new: true, upsert: true },
        );
        return `VT-${String(counter.seq).padStart(4, '0')}`;
    }
}

// ─── Anexos ──────────────────────────────────────────────────────────────────

/** Conta quantos anexos a thread inteira já carrega (teto por ticket). */
function countAttachments(ticket) {
    return (ticket.messages ?? []).reduce((acc, m) => acc + (m.attachments?.length ?? 0), 0);
}

/**
 * Persiste as imagens e devolve os ids. As data-URLs já passaram por
 * `validateAttachments` — aqui só grava.
 */
async function persistAttachments(dataUrls, { ticketId, userId }) {
    if (!dataUrls?.length) return [];

    const docs = await SupportAttachment.insertMany(
        dataUrls.map((data) => ({
            ticket: ticketId,
            user: userId,
            mimeType: mimeOfDataUrl(data),
            size: data.length,
            data,
        })),
    );
    return docs.map((d) => d._id);
}

/**
 * Grava a mensagem e, se o ticket não salvar, apaga as imagens que já subiram.
 *
 * A imagem é escrita ANTES do ticket (a mensagem precisa dos ids). Sem esta
 * compensação, qualquer falha depois do upload — transição de status recusada,
 * validação do documento, queda de conexão — deixaria até três imagens de 900KB
 * no banco sem nenhum ticket apontando para elas, e não existe faxineiro que as
 * encontre depois.
 */
async function saveWithAttachmentRollback(ticket, attachmentIds) {
    try {
        await ticket.save();
    } catch (err) {
        if (attachmentIds.length) {
            await SupportAttachment.deleteMany({ _id: { $in: attachmentIds } })
                .catch((cleanupErr) => logger.error('[support] anexo órfão não pôde ser removido', {
                    erro: cleanupErr.message, anexos: attachmentIds.length,
                }));
        }
        throw err;
    }
}

// ─── Abertura ────────────────────────────────────────────────────────────────

/**
 * Abre um ticket. O plano do usuário vira prioridade E fica congelado em
 * `planAtOpen`: um downgrade posterior não pode reescrever a história do
 * atendimento.
 */
export async function createTicket({ userId, category, subject, body, attachments = [], context = {}, relatedTicket = null }) {
    const user = await User.findById(userId).select('name email plan').lean();
    if (!user) throw new SupportError('Usuário não encontrado.', 404);

    const openCount = await SupportTicket.countDocuments({ user: userId, status: { $in: OPEN_STATUSES } });
    if (openCount >= MAX_OPEN_TICKETS_PER_USER) {
        throw new SupportError(
            `Você já tem ${MAX_OPEN_TICKETS_PER_USER} tickets em andamento. Acompanhe ou finalize um deles antes de abrir outro.`,
            429,
        );
    }

    const check = validateAttachments(attachments, 0);
    if (!check.ok) throw new SupportError(check.reason);

    // Continuação de um atendimento encerrado: o vínculo só vale se o ticket
    // antigo for DESTE usuário. Aceitar o id cru deixaria qualquer pessoa
    // pendurar o próprio ticket na conversa de outra.
    const previous = relatedTicket && mongoose.Types.ObjectId.isValid(relatedTicket)
        ? await SupportTicket.exists({ _id: relatedTicket, user: userId })
        : null;

    const now = new Date();
    const ticket = new SupportTicket({
        relatedTicket: previous ? relatedTicket : null,
        code: await nextTicketCode(),
        user: userId,
        userEmail: user.email,
        userName: user.name,
        planAtOpen: user.plan || 'GUEST',
        category,
        subject,
        status: 'ABERTO',
        priority: priorityFromPlan(user.plan),
        context: sanitizeContext(context),
        lastUserMessageAt: now,
    });

    const attachmentIds = await persistAttachments(attachments, { ticketId: ticket._id, userId });
    ticket.messages.push({
        authorRole: 'USER',
        author: userId,
        authorName: user.name,
        body,
        attachments: attachmentIds,
        createdAt: now,
    });

    await saveWithAttachmentRollback(ticket, attachmentIds);
    logger.info('[support] ticket aberto', {
        code: ticket.code, category, plan: user.plan, priority: ticket.priority,
    });

    return serializeTicketForUser(ticket);
}

/**
 * O contexto técnico chega do navegador — é entrada de cliente, e entra no
 * banco com tamanho limitado. Campo livre sem teto é convite a payload gordo.
 */
function sanitizeContext(context = {}) {
    const cut = (v, max) => String(v ?? '').slice(0, max);
    return {
        route: cut(context.route, 200),
        userAgent: cut(context.userAgent, 400),
        platform: cut(context.platform, 80),
        viewport: cut(context.viewport, 40),
        timezone: cut(context.timezone, 60),
        appVersion: cut(context.appVersion, 40),
        recentErrors: (Array.isArray(context.recentErrors) ? context.recentErrors : [])
            .slice(0, 3)
            .map((e) => ({
                at: e?.at ? new Date(e.at) : new Date(),
                status: Number(e?.status) || null,
                path: cut(e?.path, 200),
                message: cut(e?.message, 300),
            })),
    };
}

// ─── Resposta do usuário ─────────────────────────────────────────────────────

/**
 * Resposta do usuário na thread.
 *
 * Quando a janela de reabertura já fechou (ou o ticket foi encerrado), NÃO
 * ressuscita a conversa: devolve `{ needsNewTicket: true }` para o cliente
 * oferecer a abertura de um ticket novo ligado ao antigo.
 */
export async function replyAsUser({ ticketId, userId, body, attachments = [] }) {
    const ticket = await SupportTicket.findOne({ _id: ticketId, user: userId });
    if (!ticket) throw new SupportError('Ticket não encontrado.', 404);

    const nextStatus = statusAfterUserReply(ticket, new Date());
    if (nextStatus === null) {
        return { needsNewTicket: true, reason: 'Este atendimento já foi encerrado. Abra um novo ticket.' };
    }

    const check = validateAttachments(attachments, countAttachments(ticket));
    if (!check.ok) throw new SupportError(check.reason);

    const reopened = ticket.status === 'RESOLVIDO' && canReopen(ticket);
    const now = new Date();
    const attachmentIds = await persistAttachments(attachments, { ticketId: ticket._id, userId });

    ticket.messages.push({
        authorRole: 'USER',
        author: userId,
        authorName: ticket.userName,
        body,
        attachments: attachmentIds,
        createdAt: now,
    });
    ticket.status = nextStatus;
    ticket.lastUserMessageAt = now;
    if (reopened) ticket.resolvedAt = null;

    await saveWithAttachmentRollback(ticket, attachmentIds);
    logger.info('[support] resposta do usuário', { code: ticket.code, reopened });

    return { ticket: serializeTicketForUser(ticket), reopened };
}

// ─── Resposta do admin ───────────────────────────────────────────────────────

/**
 * Resposta (ou nota interna) do atendimento.
 *
 * Nota interna não mexe em status nem avisa ninguém — é bloco de rascunho na
 * thread, não atendimento.
 */
export async function replyAsAdmin({ ticketId, adminId, adminName, body, attachments = [], isInternal = false, newStatus }) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new SupportError('Ticket não encontrado.', 404);

    const check = validateAttachments(attachments, countAttachments(ticket));
    if (!check.ok) throw new SupportError(check.reason);

    // A transição é decidida ANTES de a imagem subir: recusar depois do upload
    // deixaria anexos órfãos a cada clique numa combinação inválida de status.
    let target = null;
    if (!isInternal) {
        target = newStatus || (ticket.status === 'RESOLVIDO' || ticket.status === 'FECHADO' ? ticket.status : 'RESPONDIDO');
        const t = canTransition(ticket.status, target, 'ADMIN');
        if (!t.ok) throw new SupportError(t.reason);
    }

    const now = new Date();
    const attachmentIds = await persistAttachments(attachments, { ticketId: ticket._id, userId: adminId });

    ticket.messages.push({
        authorRole: 'ADMIN',
        author: adminId,
        authorName: adminName,
        body,
        isInternal,
        attachments: attachmentIds,
        createdAt: now,
    });

    if (!isInternal) {
        applyStatus(ticket, target, now);
        ticket.lastAdminMessageAt = now;
        ticket.hasUnreadForUser = true;
    }

    await saveWithAttachmentRollback(ticket, attachmentIds);

    // Aviso ao usuário: nunca derruba a resposta se falhar. Mesma disciplina do
    // notificationService — atendimento salvo é o que importa.
    if (!isInternal && ticket.user) {
        notifyUserOfReply(ticket).catch((err) =>
            logger.error('[support] falha ao avisar usuário', { code: ticket.code, erro: err.message }));
    }

    logger.info('[support] resposta do admin', { code: ticket.code, isInternal, status: ticket.status });
    return ticket;
}

/** Carimba os relógios que acompanham a mudança de status. */
function applyStatus(ticket, status, now = new Date()) {
    ticket.status = status;
    if (status === 'RESOLVIDO') ticket.resolvedAt = now;
    if (status === 'FECHADO') ticket.closedAt = now;
    // Voltar para a mesa limpa o carimbo: a janela de reabertura conta a partir
    // da resolução mais recente, não da primeira.
    if (status === 'ABERTO' || status === 'EM_ANALISE') ticket.resolvedAt = null;
}

async function notifyUserOfReply(ticket) {
    const last = [...ticket.messages].reverse().find((m) => m.authorRole === 'ADMIN' && !m.isInternal);

    await createNotification({
        user: ticket.user,
        type: 'SUPPORT_REPLY',
        title: `Resposta do suporte · ${ticket.code}`,
        message: ticket.subject,
        // Sem isto o sino anuncia uma resposta e não diz onde ela está: o
        // usuário lê "respondemos" e fica procurando pela tela.
        link: `/suporte?ticket=${encodeURIComponent(ticket.code)}`,
    });

    if (ticket.userEmail) {
        await sendSupportReplyEmail({
            to: ticket.userEmail,
            name: ticket.userName,
            code: ticket.code,
            subject: ticket.subject,
            body: last?.body ?? '',
        });
    }
}

// ─── Edição administrativa ───────────────────────────────────────────────────

export async function updateTicket({ ticketId, status, priority, category, internalTags }) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new SupportError('Ticket não encontrado.', 404);

    if (status && status !== ticket.status) {
        const t = canTransition(ticket.status, status, 'ADMIN');
        if (!t.ok) throw new SupportError(t.reason);
        applyStatus(ticket, status);
    }
    if (priority) ticket.priority = priority;
    if (category) ticket.category = category;
    if (Array.isArray(internalTags)) ticket.internalTags = internalTags.slice(0, 10);

    await ticket.save();
    return ticket;
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function listUserTickets(userId) {
    const tickets = await SupportTicket.find({ user: userId })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

    return tickets.map((t) => {
        const view = serializeTicketForUser(t);
        return {
            _id: view._id,
            code: view.code,
            subject: view.subject,
            category: view.category,
            status: view.status,
            createdAt: view.createdAt,
            updatedAt: view.updatedAt,
            hasUnreadForUser: view.hasUnreadForUser,
            messageCount: view.messages.length,
            canReopen: canReopen(t),
        };
    });
}

/**
 * Abre a thread para o dono. Ler é o ato que zera a bolinha de "resposta nova" —
 * marcar em outro lugar faria o aviso sumir sem ninguém ter lido.
 */
export async function getTicketForUser(ticketId, userId) {
    const ticket = await SupportTicket.findOne({ _id: ticketId, user: userId });
    if (!ticket) throw new SupportError('Ticket não encontrado.', 404);

    if (ticket.hasUnreadForUser) {
        // `updateOne` e não `save()`: o hook de `save` carimba `updatedAt`, e a
        // lista "Meus tickets" ordena e rotula por esse campo. Com `save`, ABRIR
        // um ticket de três semanas o jogava para o topo dizendo "agora" — a tela
        // afirmava que houve novidade porque o usuário foi conferir que não houve.
        await SupportTicket.updateOne({ _id: ticket._id }, { $set: { hasUnreadForUser: false } });
        ticket.hasUnreadForUser = false;
    }

    return { ...serializeTicketForUser(ticket), canReopen: canReopen(ticket) };
}

/** Contadores do badge do Admin. */
export async function adminSummary() {
    const [byStatus, unansweredHigh] = await Promise.all([
        SupportTicket.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        SupportTicket.countDocuments({ status: { $in: ['ABERTO', 'EM_ANALISE'] }, priority: 'ALTA' }),
    ]);

    const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
    const open = OPEN_STATUSES.reduce((acc, s) => acc + (counts[s] ?? 0), 0);

    return {
        open,
        // "Na sua vez": esperando resposta sua, sem contar o que já foi respondido.
        waiting: (counts.ABERTO ?? 0) + (counts.EM_ANALISE ?? 0),
        highPriority: unansweredHigh,
        byStatus: counts,
    };
}

/**
 * Fila do Admin com filtros. A ordenação padrão é prioridade + espera; qualquer
 * filtro explícito de ordenação não muda a regra, só a direção.
 */
export async function listAdminTickets({ status, category, priority, search, from, to, limit = 100, skip = 0 } = {}) {
    const query = {};
    if (status === 'OPEN') query.status = { $in: OPEN_STATUSES };
    else if (status && status !== 'ALL') query.status = status;
    if (category && category !== 'ALL') query.category = category;
    if (priority && priority !== 'ALL') query.priority = priority;
    if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(from);
        if (to) query.createdAt.$lte = new Date(to);
    }
    if (search) {
        const rx = new RegExp(escapeRegex(search), 'i');
        query.$or = [{ code: rx }, { subject: rx }, { userEmail: rx }, { userName: rx }];
    }

    const [rows, total] = await Promise.all([
        SupportTicket.find(query)
            .sort({ priorityRank: -1, lastUserMessageAt: 1 })
            .skip(skip)
            .limit(Math.min(Number(limit) || 100, 200))
            // A fila mostra assunto e status — nunca o corpo das mensagens. Sem
            // este corte, listar 100 tickets baixava a conversa inteira de cada
            // um para renderizar uma tabela que não exibe nenhuma delas.
            // `messageCount` é desnormalizado no modelo justamente para caber aqui.
            .select('-messages -context')
            .lean(),
        SupportTicket.countDocuments(query),
    ]);

    return {
        total,
        tickets: rows.map((t) => ({
            _id: t._id,
            code: t.code,
            subject: t.subject,
            category: t.category,
            status: t.status,
            priority: t.priority,
            userName: t.userName,
            userEmail: t.userEmail,
            planAtOpen: t.planAtOpen,
            createdAt: t.createdAt,
            lastUserMessageAt: t.lastUserMessageAt,
            lastAdminMessageAt: t.lastAdminMessageAt,
            messageCount: t.messageCount ?? 0,
        })),
    };
}

// Busca do painel aceita texto livre; sem escape, um `(` do usuário derruba a
// query com erro de regex.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Thread completa para o Admin, com a ficha do usuário ao lado.
 *
 * A ficha é lida na hora (não desnormalizada): plano e assinatura mudam, e o
 * que você precisa ver ao responder é o estado de HOJE — `planAtOpen` guarda o
 * de ontem quando a diferença importa.
 */
export async function getTicketForAdmin(ticketId) {
    const ticket = await SupportTicket.findById(ticketId).lean();
    if (!ticket) throw new SupportError('Ticket não encontrado.', 404);

    let profile = null;
    if (ticket.user) {
        const [user, assetCount] = await Promise.all([
            User.findById(ticket.user).select('name email plan role subscriptionStatus validUntil createdAt').lean(),
            UserAsset.countDocuments({ user: ticket.user }),
        ]);
        if (user) profile = { ...user, assetCount };
    }

    // O anexo não viaja junto: a thread manda só o id, e a imagem é buscada
    // uma a uma pela rota própria.
    //
    // `allowedTransitions` vai junto para o painel oferecer só o que a regra
    // aceita. Reescrever a tabela de estados no TypeScript da tela seria criar
    // uma segunda verdade, que diverge da primeira no dia em que alguém mudar
    // uma das duas — e o sintoma seria um select cheio de opções que voltam 400.
    return { ticket, profile, allowedTransitions: allowedTransitionsFrom(ticket.status) };
}

/**
 * Serve o anexo a quem tem direito: o admin, ou o DONO DO TICKET.
 *
 * A autorização olha o ticket, não quem subiu o arquivo. Pelo campo `user` do
 * anexo, a imagem que o suporte anexa numa resposta pertenceria ao admin — e o
 * usuário, dono da conversa, receberia 404 numa imagem endereçada a ele.
 *
 * Print de carteira é dado sensível, então o id sozinho não abre nada: sem
 * sessão, ou com sessão de outra pessoa, a resposta é 404 (e não 403, que já
 * confirmaria a existência do anexo).
 */
export async function getAttachment(attachmentId, { userId, isAdmin }) {
    if (!mongoose.Types.ObjectId.isValid(attachmentId)) throw new SupportError('Anexo não encontrado.', 404);

    const attachment = await SupportAttachment.findById(attachmentId).lean();
    if (!attachment) throw new SupportError('Anexo não encontrado.', 404);

    if (!isAdmin) {
        const owns = await SupportTicket.exists({ _id: attachment.ticket, user: userId });
        if (!owns) throw new SupportError('Anexo não encontrado.', 404);
    }

    return attachment;
}

/**
 * Chamado na exclusão de conta (Art. 18 VI da LGPD). Anonimiza em vez de apagar:
 * o histórico de atendimento é registro do negócio — mesmo critério do AuditLog —
 * mas não pode continuar ligado a uma pessoa que pediu para sair.
 *
 * Recebe a `session` porque roda DENTRO da transação de exclusão: uma sessão do
 * MongoDB não admite operações concorrentes, e um atendimento que sobrevive ao
 * rollback da exclusão apontaria para um usuário que não existe mais.
 */
export async function anonymizeUserTickets(userId, { session } = {}) {
    const result = await SupportTicket.updateMany(
        { user: userId },
        {
            $set: {
                user: null,
                userEmail: '',
                userName: 'Conta excluída',
                hasUnreadForUser: false,
                'context.userAgent': '',
            },
        },
        { session },
    );

    // Os anexos vão junto: são conteúdo enviado pela pessoa, não registro do
    // atendimento. As mensagens seguem apontando para ids que não existem mais,
    // e a tela mostra "anexo removido".
    await SupportAttachment.deleteMany({ user: userId }, { session });

    if (result.modifiedCount) {
        logger.info('[support] tickets anonimizados por exclusão de conta', { tickets: result.modifiedCount });
    }
    return result.modifiedCount ?? 0;
}

/**
 * Apaga o ticket e as imagens dele. IRREVERSÍVEL e sem lixeira.
 *
 * Existe para o que não devia ter sido escrito: teste do próprio time, duplicata
 * de um usuário que clicou duas vezes, ou um relato aberto com dado sensível que
 * a pessoa pede para remover. Não é a ferramenta de encerrar atendimento — para
 * isso existe FECHADO, que preserva o histórico.
 *
 * Os anexos vão PRIMEIRO. Se a segunda etapa falhar, sobra um ticket cujas
 * imagens aparecem como indisponíveis, e repetir a exclusão termina o serviço.
 * Na ordem inversa, uma falha deixaria imagens de 900KB penduradas num ticket
 * que não existe mais — invisíveis para qualquer tela e para a rotina de
 * limpeza, que varre a partir do ticket.
 */
export async function deleteTicket(ticketId) {
    const ticket = await SupportTicket.findById(ticketId).select('code subject user').lean();
    if (!ticket) throw new SupportError('Ticket não encontrado.', 404);

    const removed = await SupportAttachment.deleteMany({ ticket: ticket._id });
    await SupportTicket.deleteOne({ _id: ticket._id });

    // `warn` de propósito: é a única operação do módulo que destrói registro de
    // atendimento, e no arquivo de log ela precisa saltar aos olhos.
    logger.warn('[support] ticket EXCLUÍDO', {
        code: ticket.code,
        attachments: removed.deletedCount ?? 0,
    });

    return { code: ticket.code, attachments: removed.deletedCount ?? 0 };
}
