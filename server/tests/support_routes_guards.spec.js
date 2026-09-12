/**
 * Contrato das rotas de suporte: quem entra em cada porta.
 *
 * O defeito que este arquivo existe para pegar não é de lógica, é de descuido —
 * rota administrativa nova registrada sem `requireAdmin`, ou uma rota de usuário
 * que passa a aceitar corpo sem validação. Nada disso quebra em runtime: só
 * entrega dado a quem não devia.
 *
 * O `authenticateToken` é substituído por um injetor de identidade (o teste não
 * emite JWT), mas o `requireAdmin` é o REAL — é ele que está sob teste.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-suporte';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-suporte';

// Identidade vem de um header de teste; o resto do módulo (requireAdmin) é real.
vi.mock('../middleware/authMiddleware.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        authenticateToken: (req, res, next) => {
            const role = req.headers['x-test-role'];
            if (!role) return res.status(401).json({ message: 'Sem token.' });
            req.user = { id: '507f1f77bcf86cd799439011', role, name: 'Teste' };
            next();
        },
    };
});

// Limiters viram passa-tudo: 429 intermitente não é o assunto deste arquivo.
vi.mock('../middleware/rateLimiters.js', () => {
    const passthrough = (_req, _res, next) => next();
    return {
        adminLimiter: passthrough,
        supportReadLimiter: passthrough,
        supportWriteLimiter: passthrough,
        createUserLimiter: () => passthrough,
    };
});

// O serviço é dublê: aqui só interessa se a requisição CHEGA ao handler.
const calls = [];
vi.mock('../services/supportService.js', () => {
    const record = (name) => async (...args) => { calls.push({ name, args }); return {}; };
    class SupportError extends Error {
        constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
    }
    return {
        SupportError,
        createTicket: record('createTicket'),
        listUserTickets: async () => [],
        getTicketForUser: record('getTicketForUser'),
        replyAsUser: async () => ({ ticket: {} }),
        replyAsAdmin: async () => ({ _id: 'x' }),
        updateTicket: async () => ({ _id: 'x', code: 'VT-0001' }),
        listAdminTickets: async () => ({ total: 0, tickets: [] }),
        adminSummary: record('adminSummary'),
        getTicketForAdmin: async () => ({ ticket: {}, profile: null }),
        getAttachment: async () => ({ mimeType: 'image/png', data: 'data:image/png;base64,AAAA' }),
        anonymizeUserTickets: async () => 0,
    };
});

let server;
let base;

beforeAll(async () => {
    const express = (await import('express')).default;
    const { default: supportRoutes } = await import('../routes/supportRoutes.js');

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/support', supportRoutes);
    app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/support`;
}, 30000);

afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

const call = (path, { role, method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method,
    headers: {
        'Content-Type': 'application/json',
        ...(role ? { 'x-test-role': role } : {}),
    },
    // GET/HEAD com corpo é erro do próprio fetch — o corpo só acompanha escrita.
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
});

const ID = '507f1f77bcf86cd799439011';

const ADMIN_ROUTES = [
    ['GET', '/admin/summary'],
    ['GET', '/admin/tickets'],
    ['GET', '/admin/export.csv'],
    ['GET', `/admin/tickets/${ID}`],
    ['POST', `/admin/tickets/${ID}/reply`],
    ['PUT', `/admin/tickets/${ID}`],
];

const USER_ROUTES = [
    ['GET', '/meta'],
    ['GET', '/tickets'],
    ['GET', `/tickets/${ID}`],
    ['POST', '/tickets'],
    ['POST', `/tickets/${ID}/reply`],
    ['GET', `/attachments/${ID}`],
];

describe('nenhuma porta do suporte é pública', () => {
    it.each([...ADMIN_ROUTES, ...USER_ROUTES])('%s %s exige sessão', async (method, path) => {
        const res = await call(path, { method });
        expect(res.status).toBe(401);
    });
});

describe('rotas administrativas', () => {
    it.each(ADMIN_ROUTES)('%s %s recusa usuário comum', async (method, path) => {
        const res = await call(path, { role: 'USER', method, body: { body: 'oi' } });
        expect(res.status).toBe(403);
    });

    it('admin passa pelo guard e chega ao handler', async () => {
        const res = await call('/admin/summary', { role: 'ADMIN' });
        expect(res.status).toBe(200);
        expect(calls.some((c) => c.name === 'adminSummary')).toBe(true);
    });

    it('"admin" não é confundido com um id de ticket', async () => {
        // Se `/tickets/:id` casasse primeiro, `/admin/tickets` viraria uma
        // consulta de ticket com id "admin" — e escaparia do requireAdmin.
        const res = await call('/admin/tickets', { role: 'USER' });
        expect(res.status).toBe(403);
    });
});

describe('validação de entrada do usuário', () => {
    it('recusa abertura sem categoria válida', async () => {
        const res = await call('/tickets', {
            role: 'USER', method: 'POST',
            body: { category: 'QUALQUER', subject: 'Teste de assunto', body: 'descrição longa o suficiente' },
        });
        expect(res.status).toBe(400);
    });

    it('recusa relato curto demais para ser útil', async () => {
        const res = await call('/tickets', {
            role: 'USER', method: 'POST',
            body: { category: 'BUG', subject: 'Erro', body: 'quebrou' },
        });
        expect(res.status).toBe(400);
    });

    it('recusa id de ticket malformado', async () => {
        const res = await call('/tickets/nao-e-um-id', { role: 'USER' });
        expect(res.status).toBe(400);
    });

    it('aceita abertura bem formada', async () => {
        const res = await call('/tickets', {
            role: 'USER', method: 'POST',
            body: {
                category: 'BUG',
                subject: 'Preço do PETR4 errado',
                body: 'O preço mostrado na carteira está diferente do que vejo na corretora.',
            },
        });
        expect(res.status).toBe(201);
    });
});

describe('anexo', () => {
    it('é servido como imagem, não como data-URL', async () => {
        const res = await call(`/attachments/${ID}`, { role: 'USER' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('image/png');
        // Cache privado: nunca em cache compartilhado — a imagem é de uma pessoa.
        expect(res.headers.get('cache-control')).toContain('private');
    });
});
