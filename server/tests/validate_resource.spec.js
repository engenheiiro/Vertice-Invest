/**
 * O validate() tem de ENTREGAR ao controller o que o schema produziu.
 *
 * O defeito que este arquivo trava: o resultado do `schema.parse` era jogado
 * fora, então `.trim()`, `.toLowerCase()`, `z.coerce.number()` e `.default()`
 * validavam o valor normalizado mas o handler recebia o corpo cru.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import validate from '../middleware/validateResource.js';
import { calendarDate } from '../schemas/calendarDate.js';

const run = (schema, req) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    validate(schema)(req, res, next);
    return { res, next };
};

describe('validate', () => {
    it('aplica trim, toLowerCase, coerce e default no corpo', () => {
        const schema = z.object({
            body: z.object({
                email: z.string().trim().toLowerCase(),
                amount: z.coerce.number(),
                profile: z.string().optional().default('MODERATE'),
            }),
        });
        const req = { body: { email: '  Fulano@Exemplo.COM ', amount: '12.5' }, query: {}, params: {} };

        const { next } = run(schema, req);

        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ email: 'fulano@exemplo.com', amount: 12.5, profile: 'MODERATE' });
    });

    it('preserva chaves que o schema não declara (o handler pode lê-las)', () => {
        const schema = z.object({ body: z.object({ ticker: z.string().trim() }) });
        const req = { body: { ticker: ' PETR4 ', walletId: 'abc' }, query: {}, params: {} };

        run(schema, req);

        expect(req.body).toEqual({ ticker: 'PETR4', walletId: 'abc' });
    });

    it('não converte data de calendário: o controller recebe o texto YYYY-MM-DD', () => {
        const schema = z.object({ body: z.object({ date: calendarDate('Data inválida').optional() }) });
        const req = { body: { date: '2026-10-30' }, query: {}, params: {} };

        run(schema, req);

        expect(req.body.date).toBe('2026-10-30');
    });

    it('recusa data ininterpretável com a mensagem do schema', () => {
        const schema = z.object({ body: z.object({ date: calendarDate('Data inválida') }) });
        const req = { body: { date: 'ontem' }, query: {}, params: {} };

        const { res, next } = run(schema, req);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'Data inválida' });
    });

    it('não toca em query/params quando o schema não os declara', () => {
        const schema = z.object({ body: z.object({ a: z.string() }) });
        const query = { page: '2' };
        const req = { body: { a: 'x' }, query, params: {} };

        run(schema, req);

        expect(req.query).toBe(query);
    });
});
