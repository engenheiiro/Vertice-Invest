/**
 * Rotas do atendimento (tickets).
 *
 * Duas famílias no mesmo arquivo porque são o mesmo assunto visto dos dois
 * lados: `/tickets` é o usuário falando, `/admin/*` é o suporte respondendo. O
 * que separa não é o caminho, é o `requireAdmin`.
 *
 * Ordem de middleware do projeto: limiter → autenticação → admin → validate → handler.
 */
import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { adminLimiter, supportReadLimiter, supportWriteLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validateResource.js';
import {
    adminExportCsv,
    adminGetTicket,
    adminList,
    adminReply,
    adminSummary,
    adminUpdate,
    createTicket,
    getAttachment,
    getMyTicket,
    listMyTickets,
    replyToMyTicket,
} from '../controllers/supportController.js';
import {
    adminListSchema,
    adminReplySchema,
    adminUpdateTicketSchema,
    createTicketSchema,
    idParamSchema,
    replyTicketSchema,
} from '../schemas/supportSchemas.js';

const router = express.Router();

// Nenhuma rota de suporte é pública: todo ticket nasce com dono conhecido.
router.use(authenticateToken);

// ─── Admin ───────────────────────────────────────────────────────────────────
// Antes das rotas de usuário: `/admin/tickets/:id` precisa casar antes que
// `/tickets/:id` tenha chance de interpretar "admin" como um id.
router.get('/admin/summary', adminLimiter, requireAdmin, adminSummary);
router.get('/admin/tickets', adminLimiter, requireAdmin, validate(adminListSchema), adminList);
router.get('/admin/export.csv', adminLimiter, requireAdmin, validate(adminListSchema), adminExportCsv);
router.get('/admin/tickets/:id', adminLimiter, requireAdmin, validate(idParamSchema), adminGetTicket);
router.post('/admin/tickets/:id/reply', adminLimiter, requireAdmin, validate(adminReplySchema), adminReply);
router.put('/admin/tickets/:id', adminLimiter, requireAdmin, validate(adminUpdateTicketSchema), adminUpdate);

// ─── Usuário ─────────────────────────────────────────────────────────────────
router.get('/tickets', supportReadLimiter, listMyTickets);
router.get('/tickets/:id', supportReadLimiter, validate(idParamSchema), getMyTicket);
router.post('/tickets', supportWriteLimiter, validate(createTicketSchema), createTicket);
router.post('/tickets/:id/reply', supportWriteLimiter, validate(replyTicketSchema), replyToMyTicket);

// Imagem do anexo. Leitura (não escrita) e autorizada no serviço por
// dono-ou-admin — por isso vive fora do bloco de admin.
router.get('/attachments/:id', supportReadLimiter, validate(idParamSchema), getAttachment);

export default router;
