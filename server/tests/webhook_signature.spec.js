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
});
