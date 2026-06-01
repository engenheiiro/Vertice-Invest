/**
 * I14 — gate de MFA no login.
 * Cobre: usuário sem MFA loga normal (regressão); com MFA e sem código →
 * mfaRequired (sem tokens); com TOTP válido → emite accessToken; com código
 * inválido → 401. Usa o util de MFA real; mocka models/jwt/bcrypt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecret, generateSync } from 'otplib';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn(), genSalt: vi.fn() } }));
vi.mock('jsonwebtoken', () => ({ default: { sign: vi.fn(() => 'signed.jwt.token'), verify: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/RefreshToken.js', () => ({ default: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn(() => Promise.resolve()) } }));
vi.mock('../services/emailService.js', () => ({ sendResetPasswordEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const bcrypt = (await import('bcryptjs')).default;
const User = (await import('../models/User.js')).default;
const { login } = await import('../controllers/authController.js');

// User.findOne(...).select(...) resolve para o doc.
const mockFindOne = (doc) => User.findOne.mockReturnValue({ select: vi.fn().mockResolvedValue(doc) });

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.cookie = vi.fn(() => res);
  return res;
};

const baseUser = (over = {}) => ({
  _id: 'u1', email: 'a@b.com', name: 'A', plan: 'PRO', role: 'USER',
  password: 'hashed', mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [],
  save: vi.fn().mockResolvedValue(), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  bcrypt.compare.mockResolvedValue(true); // senha sempre correta nestes testes
});

describe('login — gate de MFA (I14)', () => {
  it('sem MFA: emite accessToken normalmente (regressão)', async () => {
    mockFindOne(baseUser({ mfaEnabled: false }));
    const res = mockRes();
    await login({ body: { email: 'a@b.com', password: 'x' }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBe('signed.jwt.token');
  });

  it('com MFA e sem código: responde mfaRequired sem emitir tokens', async () => {
    const secret = generateSecret();
    mockFindOne(baseUser({ mfaEnabled: true, mfaSecret: secret }));
    const res = mockRes();
    await login({ body: { email: 'a@b.com', password: 'x' }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ mfaRequired: true });
    expect(res.body.accessToken).toBeUndefined();
  });

  it('com MFA e TOTP válido: emite accessToken', async () => {
    const secret = generateSecret();
    const token = generateSync({ secret });
    mockFindOne(baseUser({ mfaEnabled: true, mfaSecret: secret }));
    const res = mockRes();
    await login({ body: { email: 'a@b.com', password: 'x', mfaToken: token }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBe('signed.jwt.token');
  });

  it('com MFA e código inválido: 401', async () => {
    const secret = generateSecret();
    mockFindOne(baseUser({ mfaEnabled: true, mfaSecret: secret }));
    const res = mockRes();
    await login({ body: { email: 'a@b.com', password: 'x', mfaToken: '000000' }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('senha incorreta: 401 antes mesmo do gate de MFA', async () => {
    bcrypt.compare.mockResolvedValue(false);
    mockFindOne(baseUser({ mfaEnabled: true }));
    const res = mockRes();
    await login({ body: { email: 'a@b.com', password: 'errada' }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(401);
  });
});
