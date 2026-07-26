import crypto from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidSignature } from '../controllers/webhookController.js';

const originalEnv = { nodeEnv: process.env.NODE_ENV, secret: process.env.MP_WEBHOOK_SECRET };

const signedRequest = ({ id = 'payment-1', requestId = 'request-1', timestamp = Math.floor(Date.now() / 1000) } = {}) => {
  const manifest = `id:${id};request-id:${requestId};ts:${timestamp};`;
  const signature = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  return {
    body: { data: { id } },
    query: {},
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature}` },
  };
};

afterEach(() => {
  process.env.NODE_ENV = originalEnv.nodeEnv;
  process.env.MP_WEBHOOK_SECRET = originalEnv.secret;
});

describe('assinatura do webhook Mercado Pago', () => {
  it('aceita HMAC recente e rejeita replay expirado', () => {
    process.env.NODE_ENV = 'production';
    process.env.MP_WEBHOOK_SECRET = 'webhook-test-secret';

    expect(isValidSignature(signedRequest())).toBe(true);
    expect(isValidSignature(signedRequest({ timestamp: Math.floor(Date.now() / 1000) - 301 }))).toBe(false);
  });

  it('exige assinatura também quando o recurso chega por query string', () => {
    process.env.NODE_ENV = 'production';
    process.env.MP_WEBHOOK_SECRET = 'webhook-test-secret';
    const req = signedRequest({ id: 'payment-query' });
    req.body = {};
    req.query = { id: 'payment-query', topic: 'payment' };

    expect(isValidSignature(req)).toBe(true);
    req.headers['x-signature'] = '';
    expect(isValidSignature(req)).toBe(false);
  });

  it('aceita o IPN legado, assinado SEM o trecho de id', () => {
    // Regressão de produção: o MP omite "id:...;" do manifesto quando a
    // notificação não traz data.id (formato ?topic=payment&id=X). Com um manifesto
    // rígido, essas entregas eram rejeitadas em loop e uma cobrança que só
    // chegasse assim seria perdida.
    process.env.NODE_ENV = 'production';
    process.env.MP_WEBHOOK_SECRET = 'webhook-test-secret';

    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = 'request-legacy';
    const manifestSemId = `request-id:${requestId};ts:${timestamp};`;
    const v1 = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifestSemId).digest('hex');

    expect(isValidSignature({
      body: {},
      query: { id: '169690657395', topic: 'payment' },
      headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${v1}` },
    })).toBe(true);
  });

  it('aceita o id na query como data.id (formato moderno)', () => {
    process.env.NODE_ENV = 'production';
    process.env.MP_WEBHOOK_SECRET = 'webhook-test-secret';

    const req = signedRequest({ id: 'preapp-1' });
    req.body = {};
    req.query = { 'data.id': 'preapp-1', type: 'subscription_preapproval' };

    expect(isValidSignature(req)).toBe(true);
  });

  it('aceita id alfanumérico assinado em minúsculas', () => {
    process.env.NODE_ENV = 'production';
    process.env.MP_WEBHOOK_SECRET = 'webhook-test-secret';

    const req = signedRequest({ id: 'f50bf4a85e5d48b1af74e905c2304555' });
    req.body = { data: { id: 'F50BF4A85E5D48B1AF74E905C2304555' } };

    expect(isValidSignature(req)).toBe(true);
  });

  it('continua rejeitando assinatura forjada com outro segredo', () => {
    process.env.NODE_ENV = 'production';
    process.env.MP_WEBHOOK_SECRET = 'webhook-test-secret';

    const timestamp = Math.floor(Date.now() / 1000);
    const forjada = crypto.createHmac('sha256', 'segredo-do-atacante')
      .update(`id:123;request-id:req-1;ts:${timestamp};`).digest('hex');

    expect(isValidSignature({
      body: { data: { id: '123' } },
      query: {},
      headers: { 'x-request-id': 'req-1', 'x-signature': `ts=${timestamp},v1=${forjada}` },
    })).toBe(false);
  });
});
