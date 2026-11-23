import { describe, expect, it } from 'vitest';
import {
  coverageCap,
  legacyConfidenceCap,
  liquidityDiscount,
  operationalDiscount,
} from '../services/engines/stockCalibrationConfidence.js';

describe('stockCalibrationConfidence — peças da confiança STOCK', () => {
  it('desconta lacuna de fundamentos e idade dos dados do operacional', () => {
    expect(operationalDiscount({ _staleDays: 10, _missing: {} })).toBe(0);
    expect(operationalDiscount({ _staleDays: 91, _missing: { revenueGrowth: true } })).toBe(40);
    expect(operationalDiscount({ _staleDays: 181, _missing: { netMargin: true } })).toBe(45);
    // Sem data de fundamentos conta como levemente velho; NaN não desconta.
    expect(operationalDiscount({})).toBe(5);
    expect(operationalDiscount({ _staleDays: NaN })).toBe(0);
    expect(operationalDiscount(undefined)).toBe(5);
  });

  it('liquidez abaixo de 1 milhão desconta 30', () => {
    expect(liquidityDiscount({ avgLiquidity: 999_999 })).toBe(30);
    expect(liquidityDiscount({ avgLiquidity: 1_000_000 })).toBe(0);
    expect(liquidityDiscount(null)).toBe(30);
  });

  it('cobertura ausente zera o teto', () => {
    expect(coverageCap({ requiredCoverage: 80 })).toBe(80);
    expect(coverageCap({ requiredCoverage: '90' })).toBe(0);
    expect(coverageCap(undefined)).toBe(0);
  });

  it('confiança legada ausente ou não numérica não limita', () => {
    expect(legacyConfidenceCap(null)).toBe(100);
    expect(legacyConfidenceCap(undefined)).toBe(100);
    expect(legacyConfidenceCap('x')).toBe(100);
    expect(legacyConfidenceCap(40)).toBe(40);
    expect(legacyConfidenceCap(0)).toBe(0);
    expect(legacyConfidenceCap('')).toBe(0);
  });
});
