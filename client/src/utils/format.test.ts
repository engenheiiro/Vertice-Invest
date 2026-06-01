import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatPercent,
  formatCompact,
  formatQuantity,
  PRIVACY_MASK,
  PRIVACY_MASK_SHORT,
} from './format';

// Intl pt-BR usa NBSP (U+00A0) entre símbolo e número; \s casa NBSP e espaço,
// então normalizamos para um espaço comum antes de comparar.
const norm = (s: string) => s.replace(/\s/g, ' ');

describe('formatCurrency', () => {
  it('formata BRL por padrão', () => {
    expect(norm(formatCurrency(4253))).toBe('R$ 4.253,00');
  });
  it('formata USD quando pedido', () => {
    expect(norm(formatCurrency(28, 'USD'))).toBe('US$ 28,00');
  });
  it('trata null/undefined/NaN como 0', () => {
    expect(norm(formatCurrency(null))).toBe('R$ 0,00');
    expect(norm(formatCurrency(undefined))).toBe('R$ 0,00');
    expect(norm(formatCurrency(NaN))).toBe('R$ 0,00');
  });
  it('mascara no modo privacidade', () => {
    expect(formatCurrency(4253, 'BRL', { privacy: true })).toBe(PRIVACY_MASK);
  });
});

describe('formatPercent', () => {
  it('formata com 2 casas em pt-BR', () => {
    expect(formatPercent(6.333)).toBe('6,33%');
  });
  it('prefixa + em positivos com sign', () => {
    expect(formatPercent(6.33, { sign: true })).toBe('+6,33%');
    expect(formatPercent(-6.33, { sign: true })).toBe('-6,33%');
    expect(formatPercent(0, { sign: true })).toBe('0,00%');
  });
  it('respeita decimals custom', () => {
    expect(formatPercent(6.3, { decimals: 1 })).toBe('6,3%');
  });
  it('mascara no modo privacidade', () => {
    expect(formatPercent(6.33, { privacy: true })).toBe(PRIVACY_MASK_SHORT);
  });
});

describe('formatCompact', () => {
  it('compacta milhões em pt-BR', () => {
    expect(norm(formatCompact(1234567))).toBe('R$ 1,2 mi');
  });
  it('suprime símbolo com currency null', () => {
    expect(formatCompact(12345, null)).toMatch(/mil/);
  });
  it('mascara no modo privacidade', () => {
    expect(formatCompact(1234567, 'BRL', { privacy: true })).toBe(PRIVACY_MASK);
  });
});

describe('formatQuantity', () => {
  it('preserva até 8 casas de cripto sem zeros à direita', () => {
    expect(formatQuantity(0.0000028)).toBe('0,0000028');
  });
  it('inteiros sem casas decimais', () => {
    expect(formatQuantity(100)).toBe('100');
  });
  it('mascara no modo privacidade', () => {
    expect(formatQuantity(0.0000028, { privacy: true })).toBe(PRIVACY_MASK_SHORT);
  });
});
