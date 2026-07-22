/**
 * S6 — Política de senha compartilhada (passwordPolicy).
 * Garante o mínimo de 8 + complexidade (minúscula/maiúscula/dígito) e o
 * bloqueio de senhas comuns/previsíveis (case-insensitive).
 */
import { describe, it, expect } from 'vitest';
import { BCRYPT_MAX_PASSWORD_BYTES, getPasswordError, isStrongPassword } from '../utils/passwordPolicy.js';

describe('getPasswordError — rejeita senhas fracas', () => {
  it('curta demais (< 8)', () => {
    expect(getPasswordError('Ab1')).toMatch(/8 caracteres/);
  });
  it('sem maiúscula', () => {
    expect(getPasswordError('semmaiuscula1')).toMatch(/8 caracteres/);
  });
  it('sem minúscula', () => {
    expect(getPasswordError('SEMMINUSCULA1')).toMatch(/8 caracteres/);
  });
  it('sem dígito', () => {
    expect(getPasswordError('SemDigitoAqui')).toMatch(/8 caracteres/);
  });
  it('vazia/undefined', () => {
    expect(getPasswordError('')).toBeTruthy();
    expect(getPasswordError(undefined)).toBeTruthy();
  });
});

describe('getPasswordError — bloqueia senhas comuns', () => {
  it('rejeita senha comum mesmo respeitando o formato (case-insensitive)', () => {
    // 'Senha123' passa no formato mas está na blocklist (via toLowerCase).
    expect(getPasswordError('Senha123')).toMatch(/comum|previsível/i);
    expect(getPasswordError('Password1')).toMatch(/comum|previsível/i);
  });
});

describe('getPasswordError — aceita senhas fortes', () => {
  it('senha válida retorna null (sem exigir caractere especial)', () => {
    expect(getPasswordError('GoodPass123')).toBeNull();
    expect(getPasswordError('Vertice2026X')).toBeNull();
  });
  it('isStrongPassword reflete o resultado', () => {
    expect(isStrongPassword('GoodPass123')).toBe(true);
    expect(isStrongPassword('fraca')).toBe(false);
  });
});

describe('getPasswordError — limite de bytes do bcrypt', () => {
  it('aceita exatamente 72 bytes UTF-8 e rejeita valores maiores', () => {
    const atLimit = `aA1${'x'.repeat(BCRYPT_MAX_PASSWORD_BYTES - 3)}`;
    const overLimitWithAccents = `aA1${'é'.repeat(35)}`; // 73 bytes UTF-8

    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(72);
    expect(getPasswordError(atLimit)).toBeNull();
    expect(Buffer.byteLength(overLimitWithAccents, 'utf8')).toBeGreaterThan(72);
    expect(getPasswordError(overLimitWithAccents)).toMatch(/72 bytes/);
  });
});
