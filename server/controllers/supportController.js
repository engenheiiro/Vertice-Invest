/**
 * Controller do atendimento. Camada fina: traduz HTTP em chamada de serviço e
 * `SupportError` em status code. Nenhuma regra mora aqui.
 */
import logger from '../config/logger.js';
import * as supportService from '../services/supportService.js';
import { SupportError } from '../services/supportService.js';
import { TICKET_CATEGORIES } from '../utils/supportRules.js';

/** Converte erro de regra em 4xx; o resto sobe para o errorHandler. */
const handle = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err instanceof SupportError) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        next(err);
    }
};

// ─── Usuário ─────────────────────────────────────────────────────────────────

export const createTicket = handle(async (req, res) => {
    const ticket = await supportService.createTicket({
        userId: req.user.id,
        category: req.body.category,
        subject: req.body.subject,
        body: req.body.body,
        attachments: req.body.attachments,
        context: req.body.context,
    });
    res.status(201).json(ticket);
});

export const listMyTickets = handle(async (req, res) => {
    res.json({ tickets: await supportService.listUserTickets(req.user.id) });
});

export const getMyTicket = handle(async (req, res) => {
    res.json(await supportService.getTicketForUser(req.params.id, req.user.id));
});

export const replyToMyTicket = handle(async (req, res) => {
    const result = await supportService.replyAsUser({
        ticketId: req.params.id,
        userId: req.user.id,
        body: req.body.body,
        attachments: req.body.attachments,
    });

    // Thread encerrada: 409 em vez de 400 porque não é input inválido — é o
    // estado do recurso que não aceita a operação. O cliente usa isso para
    // oferecer a abertura de um ticket novo.
    if (result.needsNewTicket) {
        return res.status(409).json({ message: result.reason, needsNewTicket: true });
    }
    res.json(result);
});

/**
 * Serve a imagem anexada. Exige sessão e checa dono-ou-admin no serviço: print
 * de carteira é dado sensível, id adivinhado não abre.
 */
export const getAttachment = handle(async (req, res) => {
    const attachment = await supportService.getAttachment(req.params.id, {
        userId: req.user.id,
        isAdmin: req.user.role === 'ADMIN',
    });

    // Devolve binário, não data-URL: o navegador põe direto num <img src> com
    // cache, sem inflar 33% em base64 na resposta.
    const base64 = attachment.data.split(',')[1] ?? '';
    const buffer = Buffer.from(base64, 'base64');

    res.set('Content-Type', attachment.mimeType);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
});

/** Vocabulário para o formulário (categorias) — evita duplicar a lista no front. */
export const getMeta = (_req, res) => {
    res.json({ categories: TICKET_CATEGORIES });
};

// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminList = handle(async (req, res) => {
    res.json(await supportService.listAdminTickets(req.query));
});

export const adminSummary = handle(async (_req, res) => {
    res.json(await supportService.adminSummary());
});

export const adminGetTicket = handle(async (req, res) => {
    res.json(await supportService.getTicketForAdmin(req.params.id));
});

export const adminReply = handle(async (req, res) => {
    const ticket = await supportService.replyAsAdmin({
        ticketId: req.params.id,
        adminId: req.user.id,
        adminName: req.user.name || 'Suporte Vértice',
        body: req.body.body,
        attachments: req.body.attachments,
        isInternal: Boolean(req.body.isInternal),
        newStatus: req.body.newStatus,
    });
    res.json(await supportService.getTicketForAdmin(ticket._id));
});

export const adminUpdate = handle(async (req, res) => {
    const ticket = await supportService.updateTicket({
        ticketId: req.params.id,
        status: req.body.status,
        priority: req.body.priority,
        category: req.body.category,
        internalTags: req.body.internalTags,
    });
    logger.info('[support] ticket atualizado', { code: ticket.code, status: ticket.status, priority: ticket.priority });
    res.json(await supportService.getTicketForAdmin(ticket._id));
});

/**
 * CSV do filtro corrente.
 *
 * Separador `;` e BOM UTF-8: é o que o Excel em português abre sem transformar
 * a planilha numa coluna só e sem comer os acentos.
 */
export const adminExportCsv = handle(async (req, res) => {
    const { tickets } = await supportService.listAdminTickets({ ...req.query, limit: 200 });

    const header = ['Codigo', 'Abertura', 'Status', 'Prioridade', 'Categoria', 'Plano', 'Usuario', 'Email', 'Assunto', 'Mensagens'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = tickets.map((t) => [
        t.code,
        new Date(t.createdAt).toLocaleString('pt-BR'),
        t.status, t.priority, t.category, t.planAtOpen,
        t.userName, t.userEmail, t.subject, t.messageCount,
    ].map(cell).join(';'));

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + [header.join(';'), ...rows].join('\n'));
});
