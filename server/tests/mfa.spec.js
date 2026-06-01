/**
 * I14 — helpers de MFA (TOTP + backup codes).
 * Round-trip real com otplib: gera um token válido e confirma a verificação;
 * cobre também token errado e o consumo único de códigos de backup.
 */
import { describe, it, expect } from 'vitest';
import { generateSync } from 'otplib';
import {
  generateMfaSecret,
  buildOtpAuthUrl,
  verifyTotp,
  generateBackupCodes,
  consumeBackupCode,
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

describe('backup codes', () => {
  it('gera N códigos em texto e N hashes', () => {
    const { plain, hashed } = generateBackupCodes(8);
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);
    expect(plain[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    // hash != texto (nunca guardamos em claro)
    expect(hashed[0]).not.toBe(plain[0]);
  });

  it('consome um código válido (uso único) e reduz a lista', () => {
    const { plain, hashed } = generateBackupCodes(3);
    const r = consumeBackupCode(plain[1], hashed);
    expect(r.ok).toBe(true);
    expect(r.remaining).toHaveLength(2);
    // o mesmo código não funciona de novo
    const r2 = consumeBackupCode(plain[1], r.remaining);
    expect(r2.ok).toBe(false);
  });

  it('é tolerante a espaço/maiúscula e rejeita código inexistente', () => {
    const { plain, hashed } = generateBackupCodes(2);
    expect(consumeBackupCode(`  ${plain[0].toUpperCase()} `, hashed).ok).toBe(true);
    expect(consumeBackupCode('zzzzz-zzzzz', hashed).ok).toBe(false);
    expect(consumeBackupCode('qualquer', []).ok).toBe(false);
  });
});
