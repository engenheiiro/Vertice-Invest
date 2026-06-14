/**
 * 2.8 — Cobertura da aritmética monetária segura (mathUtils).
 *
 * Os edge-cases de TWRR/Dietz/risco já estão em math_edge_cases.spec.js e
 * wallet_performance_math.spec.js. Faltavam as funções BASE do dinheiro —
 * safeAdd / safeSub / safeMult — que NÃO tinham nenhum teste direto, apesar
 * de serem a fundação de todo cálculo monetário do sistema (Regra 7 do
 * CLAUDE.md). Aqui blindamos justamente o ponto onde o erro custa caro:
 * arredondamento, ponto flutuante e valores degenerados (null/NaN/Infinity).
 */
import { describe, it, expect } from 'vitest';
import {
  safeAdd,
  safeSub,
  safeMult,
  safeFloat,
  safeCurrency,
  QUANTITY_EPSILON,
} from '../utils/mathUtils.js';

describe('safeAdd — soma monetária segura', () => {
  it('elimina o erro clássico de ponto flutuante (0.1 + 0.2)', () => {
    // Sem safeFloat, 0.1 + 0.2 = 0.30000000000000004.
    expect(safeAdd(0.1, 0.2)).toBe(0.3);
  });
  it('soma valores inteiros e decimais normalmente', () => {
    expect(safeAdd(1000, 250.5)).toBe(1250.5);
    expect(safeAdd(10.1234, 5.4321)).toBe(15.5555);
  });
  it('trata operandos null/undefined/NaN como zero', () => {
    expect(safeAdd(null, 100)).toBe(100);
    expect(safeAdd(100, undefined)).toBe(100);
    expect(safeAdd(NaN, NaN)).toBe(0);
  });
  it('soma com negativos (saída de caixa)', () => {
    expect(safeAdd(100, -30)).toBe(70);
    expect(safeAdd(-50, -50)).toBe(-100);
  });
  it('arredonda o resultado a 4 casas decimais', () => {
    // 0.00001 está abaixo da 4ª casa → some.
    expect(safeAdd(0.00001, 0)).toBe(0);
    expect(safeAdd(1.123456, 0)).toBe(1.1235);
  });
});

describe('safeSub — subtração monetária segura', () => {
  it('subtrai sem erro de ponto flutuante (0.3 - 0.1)', () => {
    expect(safeSub(0.3, 0.1)).toBe(0.2);
  });
  it('resultado negativo é preservado (prejuízo)', () => {
    expect(safeSub(100, 150)).toBe(-50);
  });
  it('trata operandos degenerados como zero', () => {
    expect(safeSub(null, null)).toBe(0);
    expect(safeSub(100, NaN)).toBe(100);
    expect(safeSub(NaN, 40)).toBe(-40);
  });
  it('a - a = 0 exato (sem resíduo de float)', () => {
    expect(safeSub(0.7, 0.7)).toBe(0);
    expect(safeSub(19.99, 19.99)).toBe(0);
  });
});

describe('safeMult — multiplicação monetária segura', () => {
  it('multiplica sem erro de ponto flutuante (0.1 * 3)', () => {
    // 0.1 * 3 = 0.30000000000000004 sem proteção.
    expect(safeMult(0.1, 3)).toBe(0.3);
  });
  it('quantidade × preço típico de B3', () => {
    expect(safeMult(100, 35.5)).toBe(3550);
    expect(safeMult(7, 12.34)).toBe(86.38);
  });
  it('multiplicação por zero zera o resultado', () => {
    expect(safeMult(0, 9999)).toBe(0);
    expect(safeMult(1234.56, 0)).toBe(0);
  });
  it('trata operandos null/NaN como zero', () => {
    expect(safeMult(null, 10)).toBe(0);
    expect(safeMult(10, NaN)).toBe(0);
  });
  it('sinal correto com negativos', () => {
    expect(safeMult(-5, 4)).toBe(-20);
    expect(safeMult(-5, -4)).toBe(20);
  });
  it('arredonda o produto a 4 casas decimais', () => {
    // safeMult trunca cada operando a 4 casas ANTES de multiplicar:
    // 1.11111→1.1111 ; 1.1111 × 1.1111 = 1.23454321 → 1.2345 (4 casas).
    expect(safeMult(1.11111, 1.11111)).toBe(1.2345);
  });
});

describe('safeFloat / safeCurrency — arredondamento e degenerados (complemento)', () => {
  it('safeFloat trunca a 4 casas; safeCurrency a 2', () => {
    expect(safeFloat(3.14159)).toBe(3.1416);
    expect(safeCurrency(3.14159)).toBe(3.14);
  });
  it('safeCurrency arredonda o meio-centavo para cima (banker-safe)', () => {
    expect(safeCurrency(1.005)).toBe(1.01);
    expect(safeCurrency(2.675)).toBe(2.68);
  });
  it('safeFloat/safeCurrency zeram zero, null e NaN', () => {
    expect(safeFloat(0)).toBe(0);
    expect(safeCurrency(0)).toBe(0);
    expect(safeFloat(null)).toBe(0);
    expect(safeCurrency(NaN)).toBe(0);
  });
});

describe('composição encadeada (cenário real de carteira)', () => {
  it('custo total = Σ(qty × preço) sem acumular erro de float', () => {
    // 3 aportes: 100×10,10 + 50×20,20 + 7×0,10
    const c1 = safeMult(100, 10.1); // 1010
    const c2 = safeMult(50, 20.2); // 1010
    const c3 = safeMult(7, 0.1); // 0.7
    const total = safeAdd(safeAdd(c1, c2), c3);
    expect(total).toBe(2020.7);
  });
  it('resultado = patrimônio − custo (lucro e prejuízo)', () => {
    expect(safeSub(safeMult(100, 12), safeMult(100, 10))).toBe(200); // lucro
    expect(safeSub(safeMult(100, 8), safeMult(100, 10))).toBe(-200); // prejuízo
  });
});

describe('QUANTITY_EPSILON — limiar de posição zerada', () => {
  it('é positivo e minúsculo (1e-9), abaixo de 1 satoshi (1e-8)', () => {
    expect(QUANTITY_EPSILON).toBe(1e-9);
    expect(QUANTITY_EPSILON).toBeGreaterThan(0);
    expect(QUANTITY_EPSILON).toBeLessThan(1e-8);
  });
});
