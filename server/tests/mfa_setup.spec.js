/**
 * MFA — consultar o estado e iniciar a configuração (`getMfaStatus`, `setupMfa`).
 * Trava: a configuração exige a senha atual, não liga o MFA sozinha (só grava o
 * segredo PENDENTE, criptografado) e devolve o segredo em claro só na resposta,
 * para o app autenticador. Sem banco: User, bcrypt e a criptografia são mockados.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// O mfaController importa o authController, que exige os segredos de JWT ao carregar.
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn(), genSalt: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../utils/encryption.js', () => ({ encrypt: (s) => `cifrado(${s})`, decrypt: (s) => s }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const bcrypt = (await import('bcryptjs')).default;
const User = (await import('../models/User.js')).default;
const { getMfaStatus, setupMfa } = await import('../controllers/mfaController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const req = (body = {}) => ({ user: { id: 'u1' }, body });
const found = (doc) => User.findById.mockReturnValue({ select: vi.fn().mockResolvedValue(doc) });

beforeEach(() => {
  vi.clearAllMocks();
  bcrypt.compare.mockResolvedValue(true);
});

describe('getMfaStatus', () => {
  it('responde se o MFA está ligado (ausente = desligado)', async () => {
    found({ mfaEnabled: true });
    const ligado = mockRes();
    await getMfaStatus(req(), ligado, vi.fn());
    expect(ligado.body).toEqual({ mfaEnabled: true });

    found({});
    const desligado = mockRes();
    await getMfaStatus(req(), desligado, vi.fn());
    expect(desligado.body).toEqual({ mfaEnabled: false });
  });

  it('404 sem usuário; erro do banco vai para o next', async () => {
    found(null);
    const res = mockRes();
    await getMfaStatus(req(), res, vi.fn());
    expect(res.statusCode).toBe(404);

    const boom = new Error('mongo fora');
    User.findById.mockReturnValue({ select: vi.fn().mockRejectedValue(boom) });
    const next = vi.fn();
    await getMfaStatus(req(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('setupMfa', () => {
  const userDoc = (over = {}) => ({ email: 'pessoa@exemplo.com', mfaEnabled: false, password: 'hash', save: vi.fn(), ...over });

  it('com a senha certa, grava só o segredo PENDENTE (cifrado) e devolve segredo + QR', async () => {
    const user = userDoc();
    found(user);
    const res = mockRes();
    await setupMfa(req({ password: 'senha-atual' }), res, vi.fn());

    expect(bcrypt.compare).toHaveBeenCalledWith('senha-atual', 'hash');
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaPendingSecret).toBe(`cifrado(${res.body.secret})`);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.body.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.otpauth).toContain(`secret=${res.body.secret}`);
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('senha errada: 403 e nada gravado', async () => {
    const user = userDoc();
    found(user);
    bcrypt.compare.mockResolvedValue(false);
    const res = mockRes();
    await setupMfa(req({ password: 'errada' }), res, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(user.save).not.toHaveBeenCalled();
    expect(user.mfaPendingSecret).toBeUndefined();
  });

  it('MFA já ligado: 400 sem nem conferir a senha; usuário ausente: 404', async () => {
    found(userDoc({ mfaEnabled: true }));
    const ativo = mockRes();
    await setupMfa(req({ password: 'x' }), ativo, vi.fn());
    expect(ativo.statusCode).toBe(400);
    expect(bcrypt.compare).not.toHaveBeenCalled();

    found(null);
    const sem = mockRes();
    await setupMfa(req({ password: 'x' }), sem, vi.fn());
    expect(sem.statusCode).toBe(404);
  });

  it('erro ao gravar vai para o next', async () => {
    const boom = new Error('falha ao salvar');
    found(userDoc({ save: vi.fn().mockRejectedValue(boom) }));
    const next = vi.fn();
    await setupMfa(req({ password: 'senha-atual' }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
