/**
 * I9 — validação Zod das rotas de escrita da carteira.
 * Garante que input malformado é rejeitado cedo (e que números em string são
 * coeridos), sem precisar subir o Express. Testa também o middleware validate.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  addTransactionSchema,
  updateAssetSchema,
  idParamSchema,
  corporateActionSchema,
} from '../schemas/walletSchemas.js';
import validate from '../middleware/validateResource.js';

const VALID_ID = '507f1f77bcf86cd799439011';

const parseBody = (schema, body) => schema.safeParse({ body, params: {}, query: {} });

describe('addTransactionSchema', () => {
  it('aceita transação válida e coage números em string', () => {
    const r = addTransactionSchema.safeParse({
      body: { ticker: 'petr4', quantity: '10', price: '38.50', type: 'STOCK' },
      params: {}, query: {},
    });
    expect(r.success).toBe(true);
    expect(r.data.body.quantity).toBe(10);
    expect(r.data.body.price).toBe(38.5);
    expect(r.data.body.ticker).toBe('petr4'); // trim aplicado, sem uppercase aqui
  });

  it('aceita quantidade negativa (venda)', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'PETR4', quantity: -5, price: 40 }).success).toBe(true);
  });

  it('rejeita ticker ausente', () => {
    expect(parseBody(addTransactionSchema, { quantity: 1, price: 1 }).success).toBe(false);
  });

  it('rejeita quantidade zero', () => {
    const r = parseBody(addTransactionSchema, { ticker: 'PETR4', quantity: 0, price: 40 });
    expect(r.success).toBe(false);
  });

  it('rejeita preço negativo', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'PETR4', quantity: 1, price: -1 }).success).toBe(false);
  });

  it('rejeita tipo de ativo inválido', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'PETR4', quantity: 1, price: 1, type: 'CDB' }).success).toBe(false);
  });
});

describe('idParamSchema', () => {
  it('aceita ObjectId de 24 hex', () => {
    expect(idParamSchema.safeParse({ params: { id: VALID_ID }, body: {}, query: {} }).success).toBe(true);
  });
  it('rejeita id malformado', () => {
    expect(idParamSchema.safeParse({ params: { id: 'abc' }, body: {}, query: {} }).success).toBe(false);
  });
});

describe('updateAssetSchema', () => {
  it('aceita array de tags', () => {
    const r = updateAssetSchema.safeParse({ params: { id: VALID_ID }, body: { tags: ['longo', 'fii'] }, query: {} });
    expect(r.success).toBe(true);
  });
  it('rejeita mais de 20 tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(updateAssetSchema.safeParse({ params: { id: VALID_ID }, body: { tags }, query: {} }).success).toBe(false);
  });
});

describe('corporateActionSchema', () => {
  it('exige ticker', () => {
    expect(parseBody(corporateActionSchema, { type: 'SPLIT' }).success).toBe(false);
    expect(parseBody(corporateActionSchema, { ticker: 'PETR4' }).success).toBe(true);
  });
});

describe('validate (middleware)', () => {
  it('chama next() em input válido', () => {
    const req = { body: { ticker: 'PETR4', quantity: 1, price: 10 }, params: {}, query: {} };
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    validate(addTransactionSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responde 400 com mensagem em input inválido', () => {
    const req = { body: { quantity: 0 }, params: {}, query: {} };
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    validate(addTransactionSchema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });
});
