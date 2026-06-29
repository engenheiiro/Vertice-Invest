import { describe, it, expect } from 'vitest';
import { simulateReinvestment } from './dividendSimulator';

describe('simulateReinvestment', () => {
  it('yield 0% → ambas as curvas idênticas (sem crescimento)', () => {
    const { withReinvestment, withoutReinvestment } = simulateReinvestment({
      initialEquity: 1000,
      monthlyYieldRate: 0,
      years: 5,
    });

    expect(withReinvestment).toEqual(withoutReinvestment);
    expect(withReinvestment[withReinvestment.length - 1]).toBe(1000);
  });

  it('yield > 0% sem aporte → "com reinvestimento" cresce mais que "sem reinvestimento"', () => {
    const { withReinvestment, withoutReinvestment } = simulateReinvestment({
      initialEquity: 1000,
      monthlyYieldRate: 0.01,
      years: 1,
    });

    expect(withReinvestment[1]).toBeGreaterThan(withoutReinvestment[1]);
    expect(withReinvestment[12]).toBeGreaterThan(withoutReinvestment[12]);
    // Sem aporte e sem reinvestir, o patrimônio "flat" não muda.
    expect(withoutReinvestment[12]).toBe(1000);
  });

  it('aporte mensal > 0 → ambas as curvas recebem o aporte igualmente', () => {
    const { withReinvestment, withoutReinvestment } = simulateReinvestment({
      initialEquity: 1000,
      monthlyYieldRate: 0,
      years: 1,
      monthlyContribution: 100,
    });

    // Sem yield, a diferença entre as curvas é zero — o aporte por si só não
    // deveria gerar divergência (isola o efeito do reinvestimento do provento).
    expect(withReinvestment).toEqual(withoutReinvestment);
    expect(withReinvestment[12]).toBe(1000 + 100 * 12);
  });

  it('com yield e aporte, a diferença entre curvas vem só do reinvestimento', () => {
    const { withReinvestment, withoutReinvestment } = simulateReinvestment({
      initialEquity: 1000,
      monthlyYieldRate: 0.01,
      years: 1,
      monthlyContribution: 100,
    });

    expect(withReinvestment[12]).toBeGreaterThan(withoutReinvestment[12]);
    expect(withoutReinvestment[12]).toBe(1000 + 100 * 12);
  });

  it('years grande (30) não trava e produz um array de tamanho razoável', () => {
    const { withReinvestment } = simulateReinvestment({
      initialEquity: 1000,
      monthlyYieldRate: 0.005,
      years: 30,
    });

    expect(withReinvestment).toHaveLength(361); // mês 0 + 360 meses
    expect(Number.isFinite(withReinvestment[withReinvestment.length - 1])).toBe(true);
  });

  it('years 0 retorna apenas o ponto inicial', () => {
    const { withReinvestment, withoutReinvestment } = simulateReinvestment({
      initialEquity: 500,
      monthlyYieldRate: 0.01,
      years: 0,
    });

    expect(withReinvestment).toEqual([500]);
    expect(withoutReinvestment).toEqual([500]);
  });
});
