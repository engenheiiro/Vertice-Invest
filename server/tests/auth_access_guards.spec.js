import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret';

vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const jwt = (await import('jsonwebtoken')).default;
const User = (await import('../models/User.js')).default;
const { clearUserCache } = await import('../utils/userCache.js');
const {
    authenticateToken,
    requireAdmin,
    requireElitePlan,
    requireBlackPlan,
} = await import('../middleware/authMiddleware.js');

const response = () => {
    const res = { statusCode: 200, body: null };
    res.status = (statusCode) => { res.statusCode = statusCode; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

const callGuard = (guard, user) => {
    const res = response();
    const next = vi.fn();
    guard({ user }, res, next);
    return { res, next };
};

const callAuthentication = async (user) => {
    User.findById.mockReturnValue({ select: vi.fn().mockResolvedValue(user) });
    const res = response();
    const next = vi.fn();
    await authenticateToken({ headers: { authorization: 'Bearer token' } }, res, next);
    return { res, next };
};

beforeEach(() => {
    vi.clearAllMocks();
    clearUserCache();
    jwt.verify.mockReturnValue({ id: 'user-1', sv: 0 });
});

describe('authenticateToken — rejeições de identidade', () => {
    it('rejeita token inválido antes de consultar o banco', async () => {
        jwt.verify.mockImplementation(() => { throw new Error('invalid signature'); });
        const { res, next } = await callAuthentication();

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
        expect(User.findById).not.toHaveBeenCalled();
    });

    it('retorna 404 para token de usuário que não existe mais', async () => {
        const { res, next } = await callAuthentication(null);

        expect(res.statusCode).toBe(404);
        expect(next).not.toHaveBeenCalled();
    });

    it('bloqueia conta desativada mesmo com token válido', async () => {
        const { res, next } = await callAuthentication({
            _id: 'user-1', plan: 'PRO', role: 'USER', isActive: false,
        });

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toMatch(/desativada/i);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejeita imediatamente um access token de versão revogada', async () => {
        jwt.verify.mockReturnValue({ id: 'user-1', sv: 2 });
        const { res, next } = await callAuthentication({
            _id: 'user-1', plan: 'PRO', role: 'USER', isActive: true, sessionVersion: 3,
        });

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toMatch(/sessão desatualizada/i);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('guards de autorização por papel e plano', () => {
    it('requireAdmin libera somente ADMIN', () => {
        const admin = callGuard(requireAdmin, { role: 'ADMIN', plan: 'GUEST' });
        const user = callGuard(requireAdmin, { role: 'USER', plan: 'BLACK' });

        expect(admin.next).toHaveBeenCalledOnce();
        expect(user.res.statusCode).toBe(403);
    });

    it('requireElitePlan libera ELITE, BLACK e ADMIN; bloqueia PRO', () => {
        for (const user of [
            { role: 'USER', plan: 'ELITE' },
            { role: 'USER', plan: 'BLACK' },
            { role: 'ADMIN', plan: 'GUEST' },
        ]) {
            expect(callGuard(requireElitePlan, user).next).toHaveBeenCalledOnce();
        }

        const blocked = callGuard(requireElitePlan, { role: 'USER', plan: 'PRO' });
        expect(blocked.res.statusCode).toBe(403);
        expect(blocked.res.body.requiredPlan).toBe('ELITE');
    });

    it('requireBlackPlan libera BLACK e ADMIN; bloqueia ELITE', () => {
        expect(callGuard(requireBlackPlan, { role: 'USER', plan: 'BLACK' }).next).toHaveBeenCalledOnce();
        expect(callGuard(requireBlackPlan, { role: 'ADMIN', plan: 'GUEST' }).next).toHaveBeenCalledOnce();

        const blocked = callGuard(requireBlackPlan, { role: 'USER', plan: 'ELITE' });
        expect(blocked.res.statusCode).toBe(403);
        expect(blocked.res.body.requiredPlan).toBe('BLACK');
    });
});
