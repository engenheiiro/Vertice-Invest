import { describe, it, expect } from 'vitest';
import { computeWalletKpis } from './kpiCalculations';
import type { Asset, WalletKPIs } from '../contexts/WalletContext';

// Só totalValue/totalCost são lidos pelo cálculo — o resto é preenchível.
const pos = (totalValue: number, totalCost: number): Asset =>
  ({ totalValue, totalCost } as Asset);

describe('computeWalletKpis — carteira vazia', () => {
  it('retorna zeros mas preserva dividendos do servidor', () => {
    const server: Partial<WalletKPIs> = { totalDividends: 320, projectedDividends: 90 };
    const k = computeWalletKpis([], server);
    expect(k.totalEquity).toBe(0);
    expect(k.totalInvested).toBe(0);
    expect(k.totalResult).toBe(0);
    expect(k.totalDividends).toBe(320);
    expect(k.projectedDividends).toBe(90);
    expect(k.dataQuality).toBe('AUDITED');
  });
});

describe('computeWalletKpis — com posições', () => {
  it('soma equity e invested a partir das posições', () => {
    const k = computeWalletKpis([pos(1200, 1000), pos(800, 1000)]);
    expect(k.totalEquity).toBe(2000);
    expect(k.totalInvested).toBe(2000);
  });

  it('usa fallback result = equity - invested quando o servidor não envia', () => {
    const k = computeWalletKpis([pos(1500, 1000)]);
    expect(k.totalResult).toBe(500);
    expect(k.totalResultPercent).toBeCloseTo(50);
  });

  it('prioriza os KPIs do servidor (result/dayVariation/dataQuality)', () => {
    const server: Partial<WalletKPIs> = {
      totalResult: 777,
      totalResultPercent: 12.5,
      dayVariation: 33,
      dayVariationPercent: 1.1,
      dataQuality: 'AUDITED',
      sharpeRatio: 1.4,
      beta: 0.9,
    };
    const k = computeWalletKpis([pos(2000, 1000)], server);
    expect(k.totalResult).toBe(777); // não 1000
    expect(k.dayVariation).toBe(33);
    expect(k.dataQuality).toBe('AUDITED');
    expect(k.sharpeRatio).toBe(1.4);
  });

  it('weightedRentability cai para resultPercent quando ausente', () => {
    const k = computeWalletKpis([pos(1100, 1000)]);
    expect(k.weightedRentability).toBeCloseTo(10);
  });

  it('marca dataQuality ESTIMATED quando o servidor não informa', () => {
    const k = computeWalletKpis([pos(1000, 1000)]);
    expect(k.dataQuality).toBe('ESTIMATED');
  });
});
