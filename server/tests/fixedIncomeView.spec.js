/**
 * Normalização da vitrine de Renda Fixa (Tesouro) — função pura, sem Mongo/Express.
 * Garante as fórmulas de rendimento nominal/real e comparação vs CDI por tipo de título.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTreasuryBonds } from '../utils/fixedIncomeView.js';

const MACRO = { ipca: 4, selic: 10.5, cdi: 10.4 };

describe('normalizeTreasuryBonds', () => {
  it('IPCA+: nominal = cupom real + IPCA; real = cupom; vsCdi correto', () => {
    const [b] = normalizeTreasuryBonds(
      [{ title: 'Tesouro IPCA+ 2035', type: 'IPCA', rate: 6, maturityDate: '15/05/2035' }],
      MACRO,
    );
    expect(b.nominalEstimate).toBe(10); // 6 + 4
    expect(b.realEstimate).toBe(6);     // 10 - 4
    expect(b.vsCdi).toBe(-0.4);         // 10 - 10.4
    expect(b.index).toBe('IPCA');
  });

  it('PREFIXADO: a taxa contratada já é nominal', () => {
    const [b] = normalizeTreasuryBonds(
      [{ title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', rate: 12 }],
      MACRO,
    );
    expect(b.nominalEstimate).toBe(12);
    expect(b.realEstimate).toBe(8);  // 12 - 4
    expect(b.vsCdi).toBe(1.6);       // 12 - 10.4
    expect(b.index).toBe('PRE');
  });

  it('SELIC: nominal = Selic + spread (rate)', () => {
    const [b] = normalizeTreasuryBonds(
      [{ title: 'Tesouro Selic 2027', type: 'SELIC', rate: 0.1 }],
      MACRO,
    );
    expect(b.nominalEstimate).toBe(10.6); // 10.5 + 0.1
    expect(b.realEstimate).toBe(6.6);     // 10.6 - 4
    expect(b.index).toBe('SELIC');
  });

  it('RENDAMAIS/EDUCA seguem a regra do IPCA+', () => {
    const out = normalizeTreasuryBonds(
      [
        { title: 'RendA+ 2050', type: 'RENDAMAIS', rate: 6.2 },
        { title: 'Educa+ 2040', type: 'EDUCA', rate: 6.5 },
      ],
      MACRO,
    );
    expect(out[0].nominalEstimate).toBe(10.2);
    expect(out[1].realEstimate).toBe(6.5);
    // index derivado deve ser IPCA (não cair em 'PRE' por falta de match explícito).
    expect(out[0].index).toBe('IPCA');
    expect(out[1].index).toBe('IPCA');
  });

  it('sem CDI no macro → vsCdi null', () => {
    const [b] = normalizeTreasuryBonds(
      [{ title: 'X', type: 'PREFIXADO', rate: 11 }],
      { ipca: 4, selic: 0, cdi: 0 },
    );
    expect(b.vsCdi).toBe(null);
  });

  it('lista vazia → array vazio', () => {
    expect(normalizeTreasuryBonds([], MACRO)).toEqual([]);
    expect(normalizeTreasuryBonds(undefined, MACRO)).toEqual([]);
  });
});
