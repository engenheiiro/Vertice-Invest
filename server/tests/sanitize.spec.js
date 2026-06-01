/**
 * S8 — sanitização anti-injeção (sanitizeInPlace).
 * Garante que chaves perigosas (operadores Mongo, dotted-path, prototype
 * pollution) são removidas de objetos aninhados, preservando dados legítimos.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeInPlace, sanitizeInput } from '../middleware/sanitize.js';

describe('sanitizeInPlace — chaves perigosas', () => {
  it('remove operador NoSQL ($gt, $ne) preservando o resto', () => {
    const body = { email: 'a@b.com', password: { $gt: '' } };
    sanitizeInPlace(body);
    expect(body.password).toEqual({}); // $gt removido
    expect(body.email).toBe('a@b.com');
  });

  it('remove chaves com ponto (dotted-path)', () => {
    const obj = { 'user.role': 'admin', name: 'ok' };
    sanitizeInPlace(obj);
    expect(obj).not.toHaveProperty('user.role');
    expect(obj.name).toBe('ok');
  });

  it('remove __proto__/constructor/prototype', () => {
    const obj = JSON.parse('{"__proto__": {"admin": true}, "ok": 1}');
    sanitizeInPlace(obj);
    expect(obj.ok).toBe(1);
    // não poluiu o protótipo de Object
    expect({}.admin).toBeUndefined();
  });

  it('atua em objetos aninhados e arrays', () => {
    const obj = { list: [{ $where: 'x', keep: 1 }], inner: { $ne: 2, ok: 3 } };
    sanitizeInPlace(obj);
    expect(obj.list[0]).toEqual({ keep: 1 });
    expect(obj.inner).toEqual({ ok: 3 });
  });

  it('preserva VALORES que contêm $ ou . (só chaves são checadas)', () => {
    const obj = { price: 'R$ 10,50', site: 'a.com.br' };
    sanitizeInPlace(obj);
    expect(obj.price).toBe('R$ 10,50');
    expect(obj.site).toBe('a.com.br');
  });
});

describe('sanitizeInput — middleware', () => {
  it('limpa body/query/params e chama next()', () => {
    const req = { body: { $gt: 1, ok: 2 }, query: { $ne: 3, q: 'x' }, params: { id: '5' } };
    let called = false;
    sanitizeInput(req, {}, () => { called = true; });
    expect(req.body).toEqual({ ok: 2 });
    expect(req.query).toEqual({ q: 'x' });
    expect(req.params).toEqual({ id: '5' });
    expect(called).toBe(true);
  });
});
