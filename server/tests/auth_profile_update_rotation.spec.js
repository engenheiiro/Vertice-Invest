import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Módulos extraídos do authController: o update do perfil (só campos permitidos,
// cifra em repouso, unicidade de CPF) e a janela de graça da rotação de refresh.

vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/RefreshToken.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../utils/encryption.js', () => ({ encrypt: (s) => `enc(${s})`, blindIndex: (s) => `bi(${s})` }));

const User = (await import('../models/User.js')).default;
const RefreshToken = (await import('../models/RefreshToken.js')).default;
const { buildProfileUpdate } = await import('../services/auth/profileUpdate.js');
const {
  hashToken, rememberRotation, consumeGraceRotation, revokeUserSessions,
} = await import('../services/auth/refreshRotation.js');

const cpfOwner = (id) => User.findOne.mockReturnValue({ select: () => Promise.resolve(id && { _id: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('buildProfileUpdate', () => {
  it('ignora plano, papel, e-mail e senha do corpo; cifra nascimento, salário e CPF', async () => {
    cpfOwner('u1');
    const { updateOps, error } = await buildProfileUpdate('u1', {
      name: 'Ana', plan: 'BLACK', role: 'ADMIN', email: 'x@y.z', password: 'p', sessionVersion: 9,
      birthDate: '1990-05-10', salary: '5000', cpf: '529.982.247-25', city: '', bannerColor: 'gold',
    });
    expect(error).toBeUndefined();
    expect(updateOps).toEqual({
      $set: {
        name: 'Ana', phone: undefined, occupation: undefined, birthDate: 'enc(1990-05-10)', salary: 'enc(5000)',
        bannerColor: 'gold', cpf: 'enc(52998224725)', cpfHash: 'bi(52998224725)',
      },
      $unset: { city: 1 },
    });
  });

  it('erros na ordem das validações, e CPF de outra conta é 409', async () => {
    expect((await buildProfileUpdate('u1', { brokerage: 'a'.repeat(81), salary: -1 })).error)
      .toEqual({ status: 400, message: 'Corretora inválida.' });
    expect((await buildProfileUpdate('u1', { birthDate: '2026-11-24' })).error.message).toBe('Data de nascimento inválida.');
    cpfOwner('u2');
    expect((await buildProfileUpdate('u1', { cpf: '52998224725' })).error).toEqual({ status: 409, message: 'CPF já utilizado.' });
  });

  it('CPF vazio remove CPF e blind index sem consultar o banco', async () => {
    const { updateOps } = await buildProfileUpdate('u1', { cpf: '' });
    expect(updateOps.$unset).toEqual({ cpf: 1, cpfHash: 1 });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('CPF que não é texto responde 400 de validação (era TypeError e 500)', async () => {
    const result = await buildProfileUpdate('u1', { cpf: 52998224725 });
    expect(result.error).toEqual({ status: 400, message: 'CPF inválido.' });
    expect(User.findOne).not.toHaveBeenCalled();
    // As validações anteriores continuam aparecendo primeiro.
    expect((await buildProfileUpdate('u1', { cpf: 123, bannerColor: 'neon' })).error.message).toBe('Banner inválido.');
  });
});

describe('refreshRotation', () => {
  it('a graça vale 15 s e a revogação do titular a apaga', async () => {
    const h = hashToken('cookie-a');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    rememberRotation(h, 'novo', 'u1');
    vi.setSystemTime(new Date('2026-11-23T12:00:15Z'));
    expect(consumeGraceRotation(h)).toMatchObject({ newTokenString: 'novo', userId: 'u1' });
    vi.setSystemTime(new Date('2026-11-23T12:00:15.001Z'));
    expect(consumeGraceRotation(h)).toBeNull();

    rememberRotation(h, 'novo', 'u1');
    await revokeUserSessions('u1');
    expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ user: 'u1' });
    expect(consumeGraceRotation(h)).toBeNull();
  });
});
