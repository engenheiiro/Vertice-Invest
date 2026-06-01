/**
 * D12 — correlation id por requisição.
 * Verifica geração quando ausente, reuso do header recebido, exposição no header
 * da resposta, e que getRequestId() funciona dentro do contexto (next()).
 */
import { describe, it, expect } from 'vitest';
import { correlationId } from '../middleware/correlationId.js';
import { getRequestId } from '../utils/requestContext.js';

const mockRes = () => {
  const res = { headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
};

describe('correlationId', () => {
  it('gera um UUID quando não há x-request-id', () => {
    const req = { headers: {} };
    const res = mockRes();
    correlationId(req, res, () => {});
    expect(req.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(res.headers['x-request-id']).toBe(req.requestId);
  });

  it('reutiliza o x-request-id recebido', () => {
    const req = { headers: { 'x-request-id': 'abc-123' } };
    const res = mockRes();
    correlationId(req, res, () => {});
    expect(req.requestId).toBe('abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('limita o tamanho de um id recebido absurdamente longo', () => {
    const req = { headers: { 'x-request-id': 'x'.repeat(500) } };
    const res = mockRes();
    correlationId(req, res, () => {});
    expect(req.requestId.length).toBe(100);
  });

  it('disponibiliza getRequestId() dentro do contexto do next()', () => {
    const req = { headers: { 'x-request-id': 'ctx-id' } };
    const res = mockRes();
    let seen;
    correlationId(req, res, () => { seen = getRequestId(); });
    expect(seen).toBe('ctx-id');
  });

  it('fora de qualquer requisição, getRequestId() é undefined', () => {
    expect(getRequestId()).toBeUndefined();
  });
});
