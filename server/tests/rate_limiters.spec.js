/**
 * I5 — rate limiters por usuário.
 * Verifica que a chave é o id do usuário (não o IP): dois usuários no mesmo IP
 * têm orçamentos independentes, e um usuário é bloqueado (429) ao exceder o teto.
 */
import { describe, it, expect } from 'vitest';
import { createUserLimiter } from '../middleware/rateLimiters.js';

// Dispara o limiter resolvendo tanto no next() (liberado) quanto no send() (429).
const fire = (limiter, req) =>
  new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200 };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.getHeader = (k) => res.headers[k];
    res.status = (c) => { res.statusCode = c; return res; };
    res.send = () => { resolve({ allowed: false, status: res.statusCode }); return res; };
    res.json = () => { resolve({ allowed: false, status: res.statusCode }); return res; };
    res.end = () => res;
    limiter(req, res, () => resolve({ allowed: true, status: 200 }));
  });

const reqFor = (uid, ip = '1.2.3.4') => ({ user: { id: uid }, ip, method: 'POST', headers: {}, app: { get: () => false } });

describe('createUserLimiter — chave por usuário', () => {
  it('libera abaixo do teto e bloqueia (429) ao exceder, por usuário', async () => {
    const limiter = createUserLimiter({ windowMs: 60_000, max: 3, message: 'stop' });
    const u = reqFor('userA');

    expect((await fire(limiter, u)).allowed).toBe(true);  // 1
    expect((await fire(limiter, u)).allowed).toBe(true);  // 2
    expect((await fire(limiter, u)).allowed).toBe(true);  // 3
    const fourth = await fire(limiter, u);                // 4 → bloqueado
    expect(fourth.allowed).toBe(false);
    expect(fourth.status).toBe(429);
  });

  it('isola orçamentos por usuário mesmo no MESMO IP', async () => {
    const limiter = createUserLimiter({ windowMs: 60_000, max: 2, message: 'stop' });

    // userA esgota seu orçamento
    await fire(limiter, reqFor('userA'));
    await fire(limiter, reqFor('userA'));
    expect((await fire(limiter, reqFor('userA'))).allowed).toBe(false);

    // userB, mesmo IP, continua liberado
    expect((await fire(limiter, reqFor('userB'))).allowed).toBe(true);
  });

  it('cai para IP quando não há usuário autenticado', async () => {
    const limiter = createUserLimiter({ windowMs: 60_000, max: 1, message: 'stop' });
    const anon = () => ({ ip: '9.9.9.9', method: 'GET', headers: {}, app: { get: () => false } });

    expect((await fire(limiter, anon())).allowed).toBe(true);
    expect((await fire(limiter, anon())).allowed).toBe(false); // mesmo IP, sem user → bloqueado
  });
});
