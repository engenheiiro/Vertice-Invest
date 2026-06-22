/**
 * I9 — validação Zod das rotas de escrita da carteira.
 * Garante que input malformado é rejeitado cedo (e que números em string são
 * coeridos), sem precisar subir o Express. Testa também o middleware validate.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  addTransactionSchema,
  updateAssetSchema,
  updateTargetsSchema,
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
  it('aceita usSubType válido (override de Exterior)', () => {
    const r = updateAssetSchema.safeParse({ params: { id: VALID_ID }, body: { usSubType: 'REIT' }, query: {} });
    expect(r.success).toBe(true);
  });
  it('rejeita usSubType inválido', () => {
    expect(updateAssetSchema.safeParse({ params: { id: VALID_ID }, body: { usSubType: 'BOND' }, query: {} }).success).toBe(false);
  });
});

describe('addTransactionSchema — usSubType (Exterior)', () => {
  it('aceita usSubType válido', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'O', quantity: 1, price: 50, type: 'STOCK_US', usSubType: 'REIT' }).success).toBe(true);
  });
  it('rejeita usSubType inválido', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'O', quantity: 1, price: 50, type: 'STOCK_US', usSubType: 'CRYPTO' }).success).toBe(false);
  });
});

describe('updateTargetsSchema — sub-metas (ramificação)', () => {
  it('aceita corpo sem sub-metas (legado)', () => {
    const r = parseBody(updateTargetsSchema, { targetReserve: 5000 });
    expect(r.success).toBe(true);
  });

  it('aceita sub-metas que somam 100% dentro da classe', () => {
    const r = parseBody(updateTargetsSchema, {
      targetSubAllocation: {
        FIXED_INCOME: { IPCA: 68, POS: 32, PRE: 0 },
        STOCK_US: { STOCK: 50, REIT: 30, DOLLAR: 20 },
      },
    });
    expect(r.success).toBe(true);
  });

  it('aceita sub-metas TODAS zeradas (sem ramificação)', () => {
    const r = parseBody(updateTargetsSchema, {
      targetSubAllocation: { FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 } },
    });
    expect(r.success).toBe(true);
  });

  it('rejeita sub-metas com valores que não somam 100%', () => {
    const r = parseBody(updateTargetsSchema, {
      targetSubAllocation: { FIXED_INCOME: { IPCA: 50, POS: 30, PRE: 0 } },
    });
    expect(r.success).toBe(false);
  });

  it('rejeita sub-meta acima de 100%', () => {
    const r = parseBody(updateTargetsSchema, {
      targetSubAllocation: { STOCK_US: { STOCK: 120, REIT: 0, DOLLAR: 0 } },
    });
    expect(r.success).toBe(false);
  });

  it('aceita classe ETF na alocação-alvo (somando 100%)', () => {
    const r = parseBody(updateTargetsSchema, {
      targetAllocation: { STOCK: 40, FII: 20, STOCK_US: 20, ETF: 15, CRYPTO: 5, FIXED_INCOME: 0 },
    });
    expect(r.success).toBe(true);
    expect(r.data.body.targetAllocation.ETF).toBe(15);
  });

  it('aceita classe OURO na alocação-alvo (somando 100%)', () => {
    const r = parseBody(updateTargetsSchema, {
      targetAllocation: { STOCK: 40, FII: 25, STOCK_US: 20, CRYPTO: 5, FIXED_INCOME: 0, OURO: 10 },
    });
    expect(r.success).toBe(true);
    expect(r.data.body.targetAllocation.OURO).toBe(10);
  });

  it('rejeita OURO acima de 100%', () => {
    const r = parseBody(updateTargetsSchema, { targetAllocation: { OURO: 120 } });
    expect(r.success).toBe(false);
  });
});

describe('addTransactionSchema — classe OURO', () => {
  it('aceita type OURO (legado)', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'GOLD11', quantity: 10, price: 12, type: 'OURO' }).success).toBe(true);
  });
});

describe('addTransactionSchema — classe ETF', () => {
  it('aceita type ETF nacional', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'BOVA11', quantity: 10, price: 120, type: 'ETF' }).success).toBe(true);
  });
  it('aceita type ETF internacional com moeda USD (toggle Exterior)', () => {
    const r = parseBody(addTransactionSchema, { ticker: 'VOO', quantity: 1, price: 500, type: 'ETF', currency: 'USD' });
    expect(r.success).toBe(true);
    expect(r.data.body.currency).toBe('USD');
  });
  it('rejeita moeda inválida', () => {
    expect(parseBody(addTransactionSchema, { ticker: 'VOO', quantity: 1, price: 500, type: 'ETF', currency: 'EUR' }).success).toBe(false);
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
