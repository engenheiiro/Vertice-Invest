import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.CLIENT_URL = 'https://verticeinvest.com.br';

vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn(), genSalt: vi.fn() } }));
vi.mock('jsonwebtoken', () => ({ default: { sign: vi.fn(), verify: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn(), findById: vi.fn() } }));
vi.mock('../models/RefreshToken.js', () => ({ default: { create: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn(() => Promise.resolve()) } }));
vi.mock('../services/emailService.js', () => ({ sendResetPasswordEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const bcrypt = (await import('bcryptjs')).default;
const User = (await import('../models/User.js')).default;
const RefreshToken = (await import('../models/RefreshToken.js')).default;
const { sendResetPasswordEmail } = await import('../services/emailService.js');
const { forgotPassword, resetPassword, changePassword } = await import('../controllers/authController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  bcrypt.genSalt.mockResolvedValue('salt');
  bcrypt.hash.mockResolvedValue('new-hash');
});

describe('segurança de reset e sessão', () => {
  it('ignora Origin forjado ao construir o link de reset', async () => {
    const user = { _id: 'user-1', email: 'titular@exemplo.com', save: vi.fn().mockResolvedValue() };
    User.findOne.mockResolvedValue(user);

    await forgotPassword({
      body: { email: user.email },
      get: vi.fn(() => 'https://atacante.example'),
      headers: {}, socket: {},
    }, mockRes(), vi.fn());

    expect(sendResetPasswordEmail).toHaveBeenCalledWith(
      user.email,
      expect.any(String),
      'https://verticeinvest.com.br',
    );
  });

  it('revoga refresh tokens após reset de senha', async () => {
    const user = {
      _id: 'user-1', email: 'titular@exemplo.com', password: 'old-hash',
      save: vi.fn().mockResolvedValue(),
    };
    User.findOne.mockResolvedValue(user);

    await resetPassword({ body: { token: 'token-valido', newPassword: 'GoodPass123' }, headers: {}, socket: {} }, mockRes(), vi.fn());

    expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ user: 'user-1' });
    expect(user.sessionVersion).toBe(1);
  });

  it('revoga refresh tokens após troca de senha autenticada', async () => {
    const user = {
      _id: 'user-1', email: 'titular@exemplo.com', password: 'old-hash',
      save: vi.fn().mockResolvedValue(),
    };
    User.findById.mockResolvedValue(user);
    bcrypt.compare.mockResolvedValue(true);

    await changePassword({
      user: { id: 'user-1' },
      body: { oldPassword: 'GoodPass123', newPassword: 'OtherPass123' },
      headers: {}, socket: {},
    }, mockRes(), vi.fn());

    expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ user: 'user-1' });
    expect(user.sessionVersion).toBe(1);
  });
});
