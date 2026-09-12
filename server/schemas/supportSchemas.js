import { z } from 'zod';
import {
    MAX_ATTACHMENTS_PER_MESSAGE,
    TICKET_CATEGORIES,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
} from '../utils/supportRules.js';

/**
 * Schemas Zod das rotas de suporte. Validação ESTRUTURAL (forma, tamanho,
 * vocabulário); a regra de negócio — teto por ticket, formato da data-URL,
 * transição de status — vive em `utils/supportRules.js` e roda no serviço.
 *
 * O teto de caracteres aqui é de propósito generoso no corpo e apertado no
 * assunto: assunto é rótulo de lista, corpo é relato.
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

// A validação fina da data-URL fica no serviço (regex de MIME + tamanho). Aqui
// só barramos o grosso, para o payload absurdo morrer antes de virar objeto.
const attachmentList = z.array(z.string().max(2_000_000, 'Imagem muito grande.'))
    .max(MAX_ATTACHMENTS_PER_MESSAGE, `Máximo de ${MAX_ATTACHMENTS_PER_MESSAGE} imagens por mensagem.`)
    .optional();

const messageBody = z.string({ required_error: 'Escreva a mensagem.' })
    .trim()
    .min(10, 'Descreva com um pouco mais de detalhe (mínimo 10 caracteres).')
    .max(5000, 'Mensagem muito longa (máximo 5000 caracteres).');

const contextSchema = z.object({
    route: z.string().max(200).optional(),
    userAgent: z.string().max(400).optional(),
    platform: z.string().max(80).optional(),
    viewport: z.string().max(40).optional(),
    timezone: z.string().max(60).optional(),
    appVersion: z.string().max(40).optional(),
    recentErrors: z.array(z.object({
        at: z.string().optional(),
        status: z.coerce.number().optional(),
        path: z.string().max(200).optional(),
        message: z.string().max(300).optional(),
    })).max(3).optional(),
}).optional();

// POST /support/tickets
export const createTicketSchema = z.object({
    body: z.object({
        category: z.enum(TICKET_CATEGORIES, { errorMap: () => ({ message: 'Categoria inválida.' }) }),
        subject: z.string({ required_error: 'Informe um assunto.' })
            .trim()
            .min(3, 'Assunto muito curto.')
            .max(120, 'Assunto muito longo (máximo 120 caracteres).'),
        body: messageBody,
        attachments: attachmentList,
        context: contextSchema,
        relatedTicket: objectId.nullable().optional(),
    }),
});

// POST /support/tickets/:id/reply
export const replyTicketSchema = z.object({
    params: z.object({ id: objectId }),
    body: z.object({
        body: messageBody,
        attachments: attachmentList,
    }),
});

// POST /support/admin/tickets/:id/reply
export const adminReplySchema = z.object({
    params: z.object({ id: objectId }),
    body: z.object({
        // Nota interna pode ser curta ("é o bug do candle") — não faz sentido
        // exigir dez caracteres de quem escreve para si mesmo.
        body: z.string({ required_error: 'Escreva a mensagem.' }).trim().min(1, 'Escreva a mensagem.').max(5000),
        attachments: attachmentList,
        isInternal: z.coerce.boolean().optional(),
        newStatus: z.enum(TICKET_STATUSES).optional(),
    }),
});

// PUT /support/admin/tickets/:id
export const adminUpdateTicketSchema = z.object({
    params: z.object({ id: objectId }),
    body: z.object({
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        category: z.enum(TICKET_CATEGORIES).optional(),
        internalTags: z.array(z.string().trim().max(30)).max(10).optional(),
    }),
});

// GET /support/admin/tickets
export const adminListSchema = z.object({
    query: z.object({
        status: z.string().max(20).optional(),
        category: z.string().max(20).optional(),
        priority: z.string().max(20).optional(),
        search: z.string().max(120).optional(),
        from: z.string().max(40).optional(),
        to: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        skip: z.coerce.number().int().min(0).optional(),
    }),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });
