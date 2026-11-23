import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rotação de refresh token sob corrida: a baixa do documento é a trava. Antes era
// findOne + delete sem conferir o resultado, e duas requisições simultâneas com o
// mesmo cookie emitiam DOIS refresh novos — a sessão bifurcava.

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.CLIENT_URL = 'https://verticeinvest.com.br';

vi.mock('jsonwebtoken', () => {
    let n = 0;
    return { default: { sign: vi.fn(() => `tok-${++n}`), verify: vi.fn() } };
});
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/RefreshToken.js', () => ({
    default: {
        findOne: vi.fn(), findOneAndDelete: vi.fn(), findByIdAndDelete: vi.fn(),
        create: vi.fn(), deleteMany: vi.fn(), verifyExpiration: vi.fn(() => false),
    },
}));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn(() => Promise.resolve()) } }));
vi.mock('../services/emailService.js', () => ({ sendResetPasswordEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const jwt = (await import('jsonwebtoken')).default;
const User = (await import('../models/User.js')).default;
const RefreshToken = (await import('../models/RefreshToken.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;
const logger = (await import('../config/logger.js')).default;
const { refreshToken } = await import('../controllers/authController.js');

const mockRes = () => {
    const res = { statusCode: 200, body: null, cookies: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.cookie = (name, value) => { res.cookies[name] = value; return res; };
    return res;
};
const req = (cookie) => ({ cookies: { jwt: cookie }, headers: {}, socket: {} });

beforeEach(() => {
    vi.clearAllMocks();
    User.findById.mockResolvedValue({ _id: 'user-1', email: 'a@b.c', isActive: true });
    RefreshToken.findOne.mockResolvedValue({ _id: 'rt-1', user: 'user-1' });
    RefreshToken.create.mockResolvedValue({});
});

describe('refreshToken — rotação atômica', () => {
    it('só quem apaga o documento cria um refresh novo; o perdedor recebe o mesmo token', async () => {
        // A 1ª baixa acha o documento, a 2ª não (já foi apagado).
        RefreshToken.findOneAndDelete
            .mockResolvedValueOnce({ _id: 'rt-1' })
            .mockResolvedValueOnce(null);

        const resA = mockRes();
        const resB = mockRes();
        await Promise.all([
            refreshToken(req('cookie-unico-1'), resA, vi.fn()),
            refreshToken(req('cookie-unico-1'), resB, vi.fn()),
        ]);

        expect(RefreshToken.create).toHaveBeenCalledTimes(1);
        expect(resA.statusCode).toBe(200);
        expect(resB.statusCode).toBe(200);
        expect(resB.cookies.jwt).toBe(resA.cookies.jwt);
    });

    it('baixa falhou e não há rotação registrada: 401, sem refresh novo', async () => {
        RefreshToken.findOneAndDelete.mockResolvedValue(null);
        const res = mockRes();
        await refreshToken(req('cookie-unico-2'), res, vi.fn());
        expect(res.statusCode).toBe(401);
        expect(RefreshToken.create).not.toHaveBeenCalled();
    });
});

describe('refreshToken — reuso fora da graça', () => {
    it('falha ao revogar no reuso ainda registra TOKEN_REUSE_DETECTED e loga o erro (era engolida como JWT inválido)', async () => {
        RefreshToken.findOne.mockResolvedValue(null);
        jwt.verify.mockReturnValue({ id: 'user-9' });
        RefreshToken.deleteMany.mockRejectedValue(new Error('mongo fora'));
        const res = mockRes();
        const next = vi.fn();
        await refreshToken(req('cookie-reusado-1'), res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
        const actions = AuditLog.create.mock.calls.map(([doc]) => doc.action);
        expect(actions).toEqual(['TOKEN_REUSE_DETECTED', 'TOKEN_REFRESH_FAILED']);
        expect(AuditLog.create.mock.calls[0][0].user).toBe('user-9');
        expect(logger.error).toHaveBeenCalledTimes(1);
        const logged = logger.error.mock.calls[0].join(' ');
        expect(logged).toContain('user-9');
        expect(logged).not.toContain('cookie-reusado-1');
    });

    it('JWT inválido no reuso: nada a revogar nem a registrar como reuso', async () => {
        RefreshToken.findOne.mockResolvedValue(null);
        jwt.verify.mockImplementation(() => { throw new Error('jwt malformed'); });
        const res = mockRes();
        await refreshToken(req('cookie-lixo-1'), res, vi.fn());

        expect(res.statusCode).toBe(401);
        expect(RefreshToken.deleteMany).not.toHaveBeenCalled();
        expect(AuditLog.create.mock.calls.map(([doc]) => doc.action)).toEqual(['TOKEN_REFRESH_FAILED']);
        expect(logger.error).not.toHaveBeenCalled();
    });
});
