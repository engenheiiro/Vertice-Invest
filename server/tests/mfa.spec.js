/**
 * I14 — helpers de MFA (TOTP + backup codes).
 * Round-trip real com otplib: gera um token válido e confirma a verificação;
 * cobre também token errado e o consumo único de códigos de backup
 * (via `verifySecondFactor`, o caminho que a produção usa).
 */
import { describe, it, expect } from 'vitest';
import { generateSync } from 'otplib';
import {
  generateMfaSecret,
  buildOtpAuthUrl,
  verifyTotp,
  generateBackupCodes,
  verifySecondFactor,
} from '../utils/mfa.js';

describe('TOTP', () => {
  it('gera segredo e verifica um token válido (round-trip)', () => {
    const secret = generateMfaSecret();
    expect(secret).toBeTruthy();
    const token = generateSync({ secret });
    expect(verifyTotp(token, secret)).toBe(true);
  });

  it('rejeita token inválido e entradas vazias', () => {
    const secret = generateMfaSecret();
    expect(verifyTotp('000000', secret)).toBe(false);
    expect(verifyTotp('', secret)).toBe(false);
    expect(verifyTotp('123456', '')).toBe(false);
  });

  it('buildOtpAuthUrl monta uri otpauth com o serviço e o email', () => {
    const url = buildOtpAuthUrl('user@exemplo.com', generateMfaSecret());
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('secret=');
    expect(decodeURIComponent(url)).toContain('Vértice Invest');
  });
});

// Modelo em memória com a semântica que `verifySecondFactor` usa: o `$pull` só
// casa se o hash ainda estiver na lista (consumo único) e a falha incrementa o contador.
const fakeUserModel = (hashed) => {
  const doc = { _id: 'u1', mfaBackupCodes: [...hashed], mfaFailedAttempts: 0 };
  return {
    doc,
    updateOne: async (filter, update) => {
      if ('mfaBackupCodes' in filter) {
        const idx = doc.mfaBackupCodes.indexOf(filter.mfaBackupCodes);
        if (idx === -1) return { modifiedCount: 0 };
        doc.mfaBackupCodes.splice(idx, 1);
      }
      Object.assign(doc, update.$set || {});
      return { modifiedCount: 1 };
    },
    findOneAndUpdate: async (_filter, update) => {
      doc.mfaFailedAttempts += update.$inc.mfaFailedAttempts;
      return { mfaFailedAttempts: doc.mfaFailedAttempts };
    },
  };
};

const tryBackup = (Model, code) => verifySecondFactor(Model, { _id: 'u1' }, code, { secret: null });

describe('backup codes', () => {
  it('gera N códigos em texto e N hashes', () => {
    const { plain, hashed } = generateBackupCodes(8);
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);
    expect(plain[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    // hash != texto (nunca guardamos em claro)
    expect(hashed[0]).not.toBe(plain[0]);
  });

  it('consome um código válido (uso único) e reduz a lista', async () => {
    const { plain, hashed } = generateBackupCodes(3);
    const Model = fakeUserModel(hashed);
    const r = await tryBackup(Model, plain[1]);
    expect(r).toMatchObject({ ok: true, method: 'backup' });
    expect(Model.doc.mfaBackupCodes).toHaveLength(2);
    // o mesmo código não funciona de novo
    const r2 = await tryBackup(Model, plain[1]);
    expect(r2.ok).toBe(false);
    expect(Model.doc.mfaBackupCodes).toHaveLength(2);
  });

  it('é tolerante a espaço/maiúscula e rejeita código inexistente', async () => {
    const { plain, hashed } = generateBackupCodes(2);
    expect((await tryBackup(fakeUserModel(hashed), `  ${plain[0].toUpperCase()} `)).ok).toBe(true);
    expect((await tryBackup(fakeUserModel(hashed), 'zzzzz-zzzzz')).ok).toBe(false);
    expect((await tryBackup(fakeUserModel([]), 'qualquer')).ok).toBe(false);
  });
});
