/**
 * As mensagens em português dos schemas sobrevivem à Zod 4.
 *
 * O defeito que este arquivo trava: a Zod 4 IGNORA em silêncio
 * `required_error`, `invalid_type_error` e `errorMap`. O schema continua
 * validando — nenhum teste de "aceita/rejeita" percebe — mas o usuário passa a
 * ler "Invalid input: expected string, received undefined". As mensagens agora
 * passam por `typeMessages()` / `error`, e o padrão da Zod é pt-BR.
 */
import { describe, expect, it, vi } from 'vitest';
import validate from '../middleware/validateResource.js';
import { addTransactionSchema } from '../schemas/walletSchemas.js';
import { loginSchema, registerSchema, updateProfileSchema } from '../schemas/authSchemas.js';
import { rebalanceSchema } from '../schemas/rebalanceSchemas.js';

const messageFor = (schema, body) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    validate(schema)({ body, query: {}, params: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    return res.json.mock.calls[0][0].message;
};

describe('mensagens de tipo (required/invalid) na Zod 4', () => {
    it('campo ausente usa a mensagem de obrigatório', () => {
        expect(messageFor(addTransactionSchema, { quantity: 1, price: 10 })).toBe('Ticker é obrigatório');
        expect(messageFor(loginSchema, { password: 'x' })).toBe('Email é obrigatório');
    });

    it('tipo errado usa a mensagem de inválido', () => {
        expect(messageFor(addTransactionSchema, { ticker: 'PETR4', quantity: 'abc', price: 10 })).toBe('Quantidade inválida');
    });

    it('enum com mensagem própria (antigo errorMap)', () => {
        expect(messageFor(addTransactionSchema, { ticker: 'PETR4', type: 'NAO_EXISTE', quantity: 1, price: 10 }))
            .toBe('Tipo de ativo inválido');
        expect(messageFor(rebalanceSchema, { riskProfile: 'YOLO' })).toBe('Perfil de risco inválido');
    });

    it('issue customizada do superRefine (antigo ZodIssueCode.custom) chega ao usuário', () => {
        const message = messageFor(registerSchema, { name: 'Fulano', email: 'f@exemplo.com', password: 'curta' });
        expect(message).not.toMatch(/invalid input/i);
        expect(message.length).toBeGreaterThan(0);
    });

    it('mensagens explícitas de refinamento continuam valendo', () => {
        expect(messageFor(registerSchema, { name: 'Fulano', email: 'nao-e-email', password: 'Senha1234' }))
            .toBe('Formato de email inválido');
        expect(messageFor(addTransactionSchema, { ticker: 'PETR4', quantity: 1, price: 10, name: 'x'.repeat(200) }))
            .toBe('Nome muito longo');
    });

    it('sem mensagem própria, o padrão da Zod sai em português (pt-BR)', () => {
        // `cpf: z.string().max(20)` não declara mensagem: cai no padrão da Zod.
        const message = messageFor(updateProfileSchema, { cpf: '1'.repeat(30) });
        expect(message).not.toMatch(/too big|invalid input/i);
        expect(message).toMatch(/demais/i);
    });
});
