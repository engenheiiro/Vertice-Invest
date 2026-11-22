/**
 * O id processado pelo webhook é o id que a assinatura cobre.
 *
 * Dois defeitos juntos: (1) o sanitizeInput global apaga chaves com ponto de
 * req.query, então `req.query['data.id']` nunca existia em produção; (2) o
 * manifesto SEM id estava sempre entre as candidatas, de modo que uma
 * assinatura capturada servia para qualquer `data.id` dentro da janela.
 */
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Relógio fixo: quarta-feira 18/11/2026, 14h de Brasília (dia útil, pregão aberto).
const AGORA = new Date('2026-11-18T14:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { verifyWebhookSignature, isValidSignature } = await import('../controllers/webhookController.js');

const SECRET = 'webhook-test-secret';
const original = { nodeEnv: process.env.NODE_ENV, secret: process.env.MP_WEBHOOK_SECRET };

const sign = (manifest) => crypto.createHmac('sha256', SECRET).update(manifest).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.MP_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  process.env.NODE_ENV = original.nodeEnv;
  process.env.MP_WEBHOOK_SECRET = original.secret;
});

describe('id do manifesto assinado', () => {
  it('lê data.id da URL original mesmo com a chave apagada pelo sanitizeInput', () => {
    const ts = now();
    const v1 = sign(`id:555;request-id:r1;ts:${ts};`);
    const req = {
      originalUrl: '/api/webhooks/mercadopago?data.id=555&type=payment',
      query: { type: 'payment' }, // `data.id` já removido pelo sanitizeInput
      body: { type: 'payment' },
      headers: { 'x-request-id': 'r1', 'x-signature': `ts=${ts},v1=${v1}` },
    };
    expect(verifyWebhookSignature(req)).toEqual({ valid: true, resourceId: '555' });
  });

  it('assinatura do id A não autoriza processar o id B (body)', () => {
    const ts = now();
    const v1 = sign(`id:AAA;request-id:r2;ts:${ts};`);
    const req = {
      body: { type: 'payment', data: { id: 'BBB' } },
      query: {},
      headers: { 'x-request-id': 'r2', 'x-signature': `ts=${ts},v1=${v1}` },
    };
    expect(isValidSignature(req)).toBe(false);
  });

  it('notificação moderna (com data.id) não cai no manifesto sem id', () => {
    // Captura de uma entrega legada (assinada sem id) reaproveitada com data.id.
    const ts = now();
    const v1 = sign(`request-id:r3;ts:${ts};`);
    const req = {
      body: { type: 'payment', data: { id: '999' } },
      query: {},
      headers: { 'x-request-id': 'r3', 'x-signature': `ts=${ts},v1=${v1}` },
    };
    expect(isValidSignature(req)).toBe(false);
  });

  it('fontes de id divergentes (body × query) são recusadas', () => {
    const ts = now();
    const v1 = sign(`id:111;request-id:r4;ts:${ts};`);
    const req = {
      originalUrl: '/api/webhooks/mercadopago?data.id=111',
      body: { data: { id: '222' } },
      query: {},
      headers: { 'x-request-id': 'r4', 'x-signature': `ts=${ts},v1=${v1}` },
    };
    expect(isValidSignature(req)).toBe(false);
  });

  it('data.id repetido na URL é ambíguo e não vale como id', () => {
    const ts = now();
    const v1 = sign(`id:111;request-id:r5;ts:${ts};`);
    const req = {
      originalUrl: '/api/webhooks/mercadopago?data.id=111&data.id=222',
      body: {},
      query: {},
      headers: { 'x-request-id': 'r5', 'x-signature': `ts=${ts},v1=${v1}` },
    };
    expect(isValidSignature(req)).toBe(false);
  });

  it('IPN legado: a assinatura sem id fica presa ao primeiro id usado', () => {
    const ts = now();
    const v1 = sign(`request-id:r6;ts:${ts};`);
    const legacy = (id) => ({
      originalUrl: `/api/webhooks/mercadopago?topic=payment&id=${id}`,
      body: {},
      query: { topic: 'payment', id },
      headers: { 'x-request-id': 'r6', 'x-signature': `ts=${ts},v1=${v1}` },
    });

    expect(verifyWebhookSignature(legacy('1001'))).toEqual({ valid: true, resourceId: '1001' });
    // Reentrega do MP com o mesmo id continua passando.
    expect(isValidSignature(legacy('1001'))).toBe(true);
    // Replay da mesma assinatura com outro id: recusado.
    expect(isValidSignature(legacy('2002'))).toBe(false);
  });

  it('sem segredo em produção continua fail-closed', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    expect(isValidSignature({ body: { data: { id: '1' } }, query: {}, headers: {} })).toBe(false);
  });
});
