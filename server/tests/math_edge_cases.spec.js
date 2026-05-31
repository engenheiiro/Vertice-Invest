/**
 * T8 — Edge cases da matemática financeira segura (mathUtils).
 * Complementa financial_math/regression (que cobrem TWRR feliz) com os
 * limites: divisão por zero, base zero, guardas de dados insuficientes e
 * os ramos de aporte/resgate total do Modified Dietz diário.
 */
import { describe, it, expect } from 'vitest';
import {
  safeFloat,
  safeCurrency,
  safeDiv,
  calculatePercent,
  calculateDailyDietz,
  calculateStdDev,
  calculateSharpeRatio,
  calculateBeta,
} from '../utils/mathUtils.js';

describe('safeFloat / safeCurrency — valores degenerados', () => {
  it('safeFloat zera null/undefined/NaN', () => {
    expect(safeFloat(null)).toBe(0);
    expect(safeFloat(undefined)).toBe(0);
    expect(safeFloat(NaN)).toBe(0);
  });
  it('safeCurrency elimina erro de ponto flutuante (0.1 + 0.2)', () => {
    expect(safeCurrency(0.1 + 0.2)).toBe(0.3);
  });
});

describe('safeDiv — divisão por zero', () => {
  it('retorna 0 ao dividir por zero (nunca Infinity/NaN)', () => {
    expect(safeDiv(10, 0)).toBe(0);
  });
  it('divide normalmente e arredonda a 4 casas', () => {
    expect(safeDiv(10, 4)).toBe(2.5);
    expect(safeDiv(1, 3)).toBe(0.3333);
  });
});

describe('calculatePercent — base zero e perdas', () => {
  it('retorna 0 quando o valor inicial é zero (evita /0)', () => {
    expect(calculatePercent(100, 0)).toBe(0);
  });
  it('calcula ganho e perda corretamente', () => {
    expect(calculatePercent(150, 100)).toBe(50);
    expect(calculatePercent(80, 100)).toBe(-20);
  });
});

describe('calculateDailyDietz — aporte e resgate total', () => {
  it('sem patrimônio inicial: rende sobre o aporte do dia', () => {
    // start=0, aporte 1000, fecha 1100 → 10%
    expect(calculateDailyDietz(0, 1100, 1000)).toBeCloseTo(0.1, 6);
  });
  it('dia sem fluxo: rendimento puro sobre o patrimônio', () => {
    expect(calculateDailyDietz(1000, 1100, 0)).toBeCloseTo(0.1, 6);
  });
  it('resgate total preserva o rendimento gerado antes do resgate', () => {
    // start=1000, resgata 1000 (flow=-1000), sobra 10 de ganho → 1%
    expect(calculateDailyDietz(1000, 10, -1000)).toBeCloseTo(0.01, 6);
  });
  it('fluxo intradiário usa peso 0.5 (Modified Dietz)', () => {
    // num = 1050-1000-100 = -50 ; den = 1000 + 0.5*100 = 1050
    expect(calculateDailyDietz(1000, 1050, 100)).toBeCloseTo(-50 / 1050, 6);
  });
});

describe('guardas de dados insuficientes (Risco)', () => {
  it('calculateStdDev: menos de 2 pontos → 0', () => {
    expect(calculateStdDev([5])).toBe(0);
  });
  it('calculateStdDev: amostra conhecida', () => {
    expect(calculateStdDev([10, 20])).toBeCloseTo(7.0710, 3);
  });
  it('calculateSharpeRatio: menos de 10 retornos → 0', () => {
    expect(calculateSharpeRatio(new Array(9).fill(0.1), 11.25)).toBe(0);
  });
  it('calculateSharpeRatio: volatilidade zero → 0 (evita /0)', () => {
    // 12 dias de retorno 0% → desvio padrão exatamente 0 → guard retorna 0.
    expect(calculateSharpeRatio(new Array(12).fill(0), 11.25)).toBe(0);
  });
  it('calculateBeta: poucos dados → 1 (neutro)', () => {
    expect(calculateBeta([0.1, 0.2], [0.1, 0.2])).toBe(1);
  });
  it('calculateBeta: variância de mercado zero → 1 (neutro)', () => {
    // Mercado plano (0% todo dia) → variância exatamente 0 → beta neutro.
    const flatMarket = new Array(10).fill(0);
    const wallet = [0.1, -0.1, 0.2, -0.2, 0.05, 0.0, 0.3, -0.1, 0.1, -0.05];
    expect(calculateBeta(wallet, flatMarket)).toBe(1);
  });
  it('calculateBeta: carteira 2x o mercado → beta ≈ 2', () => {
    const market = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
    const wallet = market.map((x) => 2 * x);
    expect(calculateBeta(wallet, market)).toBeCloseTo(2, 6);
  });
});
