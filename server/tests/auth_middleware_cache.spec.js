/**
 * I6 — authMiddleware com cache.
 * Verifica que: (1) o segundo request do mesmo usuário NÃO toca o banco (cache
 * hit); (2) um plano pago expirado servido do cache ainda força o caminho de DB
 * para rebaixar e persistir (nunca vaza acesso pago vencido).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const jwt = (await import('jsonwebtoken')).default;
const User = (await import('../models/User.js')).default;
const { authenticateToken } = await import('../middleware/authMiddleware.js');
const { clearUserCache } = await import('../utils/userCache.js');

// findById(...).select(...) resolve para o doc dado.
const mockUser = (doc) => User.findById.mockReturnValue({ select: vi.fn().mockResolvedValue(doc) });

const run = (req) =>
  new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = () => { resolve({ blocked: true, status: res.statusCode }); return res; };
    authenticateToken(req, res, () => resolve({ blocked: false, user: req.user }));
  });

const reqWith = (token = 'tok') => ({ headers: { authorization: `Bearer ${token}` } });

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  clearUserCache();
});

describe('authenticateToken — cache (I6)', () => {
  it('cache hit no 2º request evita novo findById', async () => {
    jwt.verify.mockReturnValue({ id: 'u1' });
    mockUser({ _id: 'u1', name: 'Ana', role: 'USER', plan: 'PRO', validUntil: future });

    const r1 = await run(reqWith());
    expect(r1.blocked).toBe(false);
    expect(r1.user.plan).toBe('PRO');
    expect(User.findById).toHaveBeenCalledTimes(1);

    const r2 = await run(reqWith());
    expect(r2.blocked).toBe(false);
    expect(r2.user.plan).toBe('PRO');
    expect(User.findById).toHaveBeenCalledTimes(1); // ainda 1 → veio do cache
  });

  it('plano pago expirado no cache força DB e rebaixa para GUEST', async () => {
    jwt.verify.mockReturnValue({ id: 'u2' });
    // 1º request: plano pago já vencido → DB path rebaixa + salva + cacheia GUEST
    const save = vi.fn().mockResolvedValue();
    mockUser({ _id: 'u2', name: 'Beto', role: 'USER', plan: 'PRO', validUntil: past, save });

    const r1 = await run(reqWith());
    expect(r1.user.plan).toBe('GUEST');
    expect(save).toHaveBeenCalledTimes(1);
    expect(User.findById).toHaveBeenCalledTimes(1);

    // 2º request: cache agora tem GUEST (não-pago) → serve do cache, sem DB
    const r2 = await run(reqWith());
    expect(r2.user.plan).toBe('GUEST');
    expect(User.findById).toHaveBeenCalledTimes(1);
  });

  it('rejeita sem token', async () => {
    const r = await run({ headers: {} });
    expect(r.blocked).toBe(true);
    expect(r.status).toBe(401);
  });
});
