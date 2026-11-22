/**
 * Segundo fator endurecido: anti-replay do TOTP, bloqueio por conta após 5
 * falhas, login sem usuário com custo de bcrypt igual ao do usuário real, e
 * e-mail mascarado na trilha de auditoria.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecret, generateSync } from 'otplib';

// Relógio fixo: quarta-feira 18/11/2026, 14h de Brasília (dia útil, pregão aberto).
const AGORA = new Date('2026-11-18T14:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn(), genSalt: vi.fn() } }));
vi.mock('jsonwebtoken', () => ({ default: { sign: vi.fn(() => 'signed.jwt.token'), verify: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn(), findById: vi.fn(), updateOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../models/RefreshToken.js', () => ({ default: { create: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}) } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn(() => Promise.resolve()) } }));
vi.mock('../services/emailService.js', () => ({ sendResetPasswordEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const bcrypt = (await import('bcryptjs')).default;
const User = (await import('../models/User.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;
const RefreshToken = (await import('../models/RefreshToken.js')).default;
const { login, deleteAccount } = await import('../controllers/authController.js');
const { disableMfa, enableMfa } = await import('../controllers/mfaController.js');
const { verifySecondFactor, MFA_MAX_FAILED_ATTEMPTS, isMfaLocked } = await import('../utils/mfa.js');
const { mfaDisableSchema, deleteAccountSchema } = await import('../schemas/authSchemas.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res;
};

const selectable = (doc) => ({ select: vi.fn().mockResolvedValue(doc) });

beforeEach(() => {
  vi.clearAllMocks();
  bcrypt.compare.mockResolvedValue(true);
  // TOTP: o passo é aceito; backup: nenhum hash casa (códigos de teste são aleatórios).
  User.updateOne.mockImplementation(async (filter) => ({ modifiedCount: filter.mfaBackupCodes ? 0 : 1 }));
  User.findOneAndUpdate.mockResolvedValue({ mfaFailedAttempts: 1 });
});

describe('verifySecondFactor — anti-replay e bloqueio', () => {
  it('aceita o TOTP só se o passo for maior que o último usado (update condicional)', async () => {
    const secret = generateSecret();
    const token = generateSync({ secret });
    const r = await verifySecondFactor(User, { _id: 'u1' }, token, { secret });
    expect(r).toMatchObject({ ok: true, method: 'totp' });
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter.$or).toContainEqual({ mfaLastUsedStep: { $lt: expect.any(Number) } });
    expect(update.$set.mfaLastUsedStep).toEqual(expect.any(Number));
  });

  it('código válido já usado (update não casa) é replay e conta como falha', async () => {
    const secret = generateSecret();
    const token = generateSync({ secret });
    User.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const r = await verifySecondFactor(User, { _id: 'u1' }, token, { secret });
    expect(r).toMatchObject({ ok: false, replay: true });
    expect(User.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'u1' }, { $inc: { mfaFailedAttempts: 1 } }, expect.anything());
  });

  it(`a ${MFA_MAX_FAILED_ATTEMPTS}ª falha bloqueia a conta por 15 min`, async () => {
    User.findOneAndUpdate.mockResolvedValueOnce({ mfaFailedAttempts: MFA_MAX_FAILED_ATTEMPTS });
    User.updateOne.mockResolvedValue({ modifiedCount: 0 }); // backup não casa
    const r = await verifySecondFactor(User, { _id: 'u1' }, '000000', { secret: generateSecret() });
    expect(r.locked).toBe(true);
    const lockCall = User.updateOne.mock.calls.find(([, u]) => u.$set?.mfaLockedUntil);
    expect(lockCall).toBeTruthy();
    expect(isMfaLocked({ mfaLockedUntil: lockCall[1].$set.mfaLockedUntil })).toBe(true);
  });

  it('conta bloqueada recusa até código correto, sem tocar o banco', async () => {
    const secret = generateSecret();
    const r = await verifySecondFactor(User, { _id: 'u1', mfaLockedUntil: new Date(Date.now() + 60_000) }, generateSync({ secret }), { secret });
    expect(r).toMatchObject({ ok: false, locked: true });
    expect(User.updateOne).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('e-mail inexistente ainda roda bcrypt (tempo igual) e loga mascarado', async () => {
    User.findOne.mockReturnValue(selectable(null));
    const res = mockRes();
    await login({ body: { email: 'fulano@dominio.com', password: 'x' }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare.mock.calls[0][1]).toMatch(/^\$2[ab]\$10\$/);
    expect(AuditLog.create.mock.calls[0][0].email).toBe('f***@dominio.com');
  });

  it('login com sucesso não grava o e-mail completo na auditoria', async () => {
    User.findOne.mockReturnValue(selectable({ _id: 'u1', email: 'fulano@dominio.com', password: 'h', mfaEnabled: false }));
    const res = mockRes();
    await login({ body: { email: 'fulano@dominio.com', password: 'x' }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(AuditLog.create.mock.calls.every(([doc]) => doc.email !== 'fulano@dominio.com')).toBe(true);
  });

  it('2º fator bloqueado responde 429 sem emitir tokens', async () => {
    const secret = generateSecret();
    User.findOne.mockReturnValue(selectable({
      _id: 'u1', email: 'a@b.com', password: 'h', mfaEnabled: true, mfaSecret: secret,
      mfaLockedUntil: new Date(Date.now() + 60_000),
    }));
    const res = mockRes();
    await login({ body: { email: 'a@b.com', password: 'x', mfaToken: generateSync({ secret }) }, headers: {}, socket: {} }, res, vi.fn());
    expect(res.statusCode).toBe(429);
    expect(res.body.accessToken).toBeUndefined();
  });
});

describe('disableMfa / enableMfa', () => {
  const mfaUser = (secret, over = {}) => ({
    _id: 'u1', email: 'a@b.com', password: 'h', mfaEnabled: true, mfaSecret: secret,
    sessionVersion: 3, save: vi.fn().mockResolvedValue(), ...over,
  });

  it('senha sozinha não desliga mais o MFA', async () => {
    User.findById.mockReturnValue(selectable(mfaUser(generateSecret())));
    const res = mockRes();
    await disableMfa({ user: { id: 'u1' }, body: { password: 'certa' } }, res, vi.fn());
    expect(res.statusCode).toBe(400);
  });

  it('TOTP válido desliga, sobe o sessionVersion e revoga as outras sessões', async () => {
    const secret = generateSecret();
    const user = mfaUser(secret);
    User.findById.mockReturnValue(selectable(user));
    const res = mockRes();
    await disableMfa({ user: { id: 'u1' }, body: { token: generateSync({ secret }) }, headers: {}, cookies: {} }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(user.mfaEnabled).toBe(false);
    expect(user.sessionVersion).toBe(4);
    expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ user: 'u1' });
    expect(RefreshToken.create).toHaveBeenCalledTimes(1); // só a sessão atual é reemitida
    expect(res.cookie).toHaveBeenCalledWith('jwt', expect.any(String), expect.anything());
  });

  it('ativar também sobe o sessionVersion e queima o passo usado na confirmação', async () => {
    const secret = generateSecret();
    const user = { _id: 'u1', email: 'a@b.com', mfaEnabled: false, mfaPendingSecret: secret, sessionVersion: 0, save: vi.fn().mockResolvedValue() };
    User.findById.mockReturnValue(selectable(user));
    const res = mockRes();
    await enableMfa({ user: { id: 'u1' }, body: { token: generateSync({ secret }) }, headers: {}, cookies: {} }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(user.mfaEnabled).toBe(true);
    expect(user.sessionVersion).toBe(1);
    expect(user.mfaLastUsedStep).toEqual(expect.any(Number));
  });
});

describe('schemas', () => {
  it('mfaDisableSchema exige o código; aceita TOTP e backup', () => {
    expect(mfaDisableSchema.safeParse({ body: { password: 'x' } }).success).toBe(false);
    expect(mfaDisableSchema.safeParse({ body: { token: '123456' } }).success).toBe(true);
    expect(mfaDisableSchema.safeParse({ body: { token: 'abcde-12345' } }).success).toBe(true);
  });

  it('deleteAccountSchema recusa senha não-string (antes: bcrypt lançava → 500)', () => {
    const r = deleteAccountSchema.safeParse({ body: { password: { $ne: 1 } } });
    expect(r.success).toBe(false);
    expect(deleteAccountSchema.safeParse({ body: { password: 'x', mfaToken: '' } }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ body: { password: 'x', mfaToken: 123456 } }).success).toBe(false);
  });

  it('deleteAccount com MFA bloqueado responde 429', async () => {
    const secret = generateSecret();
    User.findById.mockReturnValue(selectable({ _id: 'u1', email: 'a@b.com', password: 'h', mfaEnabled: true, mfaSecret: secret, mfaLockedUntil: new Date(Date.now() + 60_000) }));
    const res = mockRes();
    await deleteAccount({ user: { id: 'u1' }, body: { password: 'x', mfaToken: '123456' } }, res, vi.fn());
    expect(res.statusCode).toBe(429);
  });
});
