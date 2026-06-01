/**
 * S6 — Política de senha compartilhada (passwordPolicy).
 * Garante o mínimo de 8 + complexidade (minúscula/maiúscula/dígito) e o
 * bloqueio de senhas comuns/previsíveis (case-insensitive).
 */
import { describe, it, expect } from 'vitest';
import { getPasswordError, isStrongPassword } from '../utils/passwordPolicy.js';

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
