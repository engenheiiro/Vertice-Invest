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
    requireTaxReportPlan,
    requireDividendsPlan,
    requireMinPlan,
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

    // Onda 3 do plano comercial: o relatório de IR desceu de BLACK para ELITE
    // quando o BLACK saiu da venda e o card do Elite passou a prometê-lo. Quem
    // ainda é BLACK continua entrando pela hierarquia, sem regra própria.
    it('requireTaxReportPlan libera ELITE, BLACK e ADMIN; bloqueia PRO', () => {
        for (const user of [
            { role: 'USER', plan: 'ELITE' },
            { role: 'USER', plan: 'BLACK' },
            { role: 'ADMIN', plan: 'GUEST' },
        ]) {
            expect(callGuard(requireTaxReportPlan, user).next).toHaveBeenCalledOnce();
        }

        const blocked = callGuard(requireTaxReportPlan, { role: 'USER', plan: 'PRO' });
        expect(blocked.res.statusCode).toBe(403);
        expect(blocked.res.body.requiredPlan).toBe('ELITE');
    });

    it('requireDividendsPlan libera do ESSENTIAL para cima; bloqueia GUEST', () => {
        for (const user of [
            { role: 'USER', plan: 'ESSENTIAL' },
            { role: 'USER', plan: 'PRO' },
            { role: 'USER', plan: 'ELITE' },
            { role: 'USER', plan: 'BLACK' },
            { role: 'ADMIN', plan: 'GUEST' },
        ]) {
            expect(callGuard(requireDividendsPlan, user).next).toHaveBeenCalledOnce();
        }

        const blocked = callGuard(requireDividendsPlan, { role: 'USER', plan: 'GUEST' });
        expect(blocked.res.statusCode).toBe(403);
        expect(blocked.res.body.requiredPlan).toBe('ESSENTIAL');
    });

    // Fail-closed: sem usuário, com plano desconhecido ou com degrau inexistente,
    // o gate nega. É o que impede um plano novo (ou um typo) de virar acesso livre.
    it('requireMinPlan nega usuário ausente, plano desconhecido e degrau inexistente', () => {
        const guard = requireMinPlan('PRO', 'nope');
        expect(callGuard(guard, undefined).res.statusCode).toBe(403);
        expect(callGuard(guard, { role: 'USER', plan: 'PLANO_QUE_NAO_EXISTE' }).res.statusCode).toBe(403);
        expect(callGuard(requireMinPlan('DEGRAU_INEXISTENTE', 'nope'), { role: 'USER', plan: 'BLACK' }).res.statusCode).toBe(403);
    });
});
