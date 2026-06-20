/**
 * 6.9 — Circuit breaker do MongoDB: fail-fast 503 quando o banco está fora,
 * evitando que requests acumulem no timeout de seleção de servidor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock do mongoose com readyState controlável.
const connection = { readyState: 1, on: vi.fn() };
vi.mock('mongoose', () => ({ default: { connection } }));

const {
  shouldRejectRequest,
  isDbAvailable,
  mongoCircuitBreaker,
  getMongoBreakerState,
  _breaker,
} = await import('../middleware/mongoCircuitBreaker.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.set = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  connection.readyState = 1;
  _breaker.recordSuccess(); // fecha o circuito
});

describe('shouldRejectRequest (decisão pura)', () => {
  it('aceita quando conectado e circuito fechado', () => {
    expect(shouldRejectRequest(1, false)).toBe(false);
  });
  it('rejeita quando desconectado', () => {
    expect(shouldRejectRequest(0, false)).toBe(true);
    expect(shouldRejectRequest(2, false)).toBe(true); // connecting
    expect(shouldRejectRequest(3, false)).toBe(true); // disconnecting
  });
  it('rejeita quando o circuito está aberto mesmo conectado', () => {
    expect(shouldRejectRequest(1, true)).toBe(true);
  });
});

describe('mongoCircuitBreaker (middleware)', () => {
  it('chama next() com banco saudável', () => {
    const next = vi.fn();
    const res = mockRes();
    mongoCircuitBreaker({ originalUrl: '/api/wallet' }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responde 503 + Retry-After com banco desconectado', () => {
    connection.readyState = 0;
    const next = vi.fn();
    const res = mockRes();
    mongoCircuitBreaker({ originalUrl: '/api/wallet' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '15');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'DB_UNAVAILABLE' }),
    }));
  });
});

describe('isDbAvailable / estado do breaker', () => {
  it('reflete readyState', () => {
    expect(isDbAvailable()).toBe(true);
    connection.readyState = 0;
    expect(isDbAvailable()).toBe(false);
  });

  it('abre o circuito após o limiar de falhas', () => {
    // failureThreshold = 3
    _breaker.recordFailure();
    _breaker.recordFailure();
    _breaker.recordFailure();
    expect(getMongoBreakerState().circuit).toBe('OPEN');
    // mesmo "conectado", o circuito aberto rejeita.
    connection.readyState = 1;
    expect(isDbAvailable()).toBe(false);
  });
});
