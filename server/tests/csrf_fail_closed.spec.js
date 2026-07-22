import { describe, expect, it, vi } from 'vitest';
import { CSRF_COOKIE, CSRF_HEADER, csrfProtection } from '../middleware/csrf.js';

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const request = ({ method = 'POST', authorization, cookieToken, headerToken } = {}) => ({
  method,
  headers: authorization ? { authorization } : {},
  cookies: cookieToken ? { [CSRF_COOKIE]: cookieToken } : {},
  get: (name) => name === CSRF_HEADER ? headerToken : undefined,
});

describe('CSRF após bootstrap da sessão', () => {
  it('rejeita mutação autenticada sem cookie CSRF', () => {
    const res = response();
    const next = vi.fn();
    csrfProtection(request({ authorization: 'Bearer access-token' }), res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('aceita mutação autenticada somente com header correspondente', () => {
    const res = response();
    const next = vi.fn();
    csrfProtection(request({
      authorization: 'Bearer access-token',
      cookieToken: 'csrf-value',
      headerToken: 'csrf-value',
    }), res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
