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

  it('saneia a contaminação nominal do raspador (IPCA+ com rate já nominal ~12%)', () => {
    // rate=12.43 é NOMINAL (cupom real ⊕ IPCA), não cupom real. Deve ser recuperado
    // para real = 12.43 - 4.72, e as estimativas derivadas do cupom real corrigido.
    const [b] = normalizeTreasuryBonds(
      [{ title: 'Tesouro IPCA+ 2045 Juros Semestrais', type: 'IPCA', rate: 12.43 }],
      { ipca: 4.72, selic: 14.25, cdi: 14.15 },
    );
    expect(b.rate).toBe(7.71);            // cupom real recuperado (12.43 - 4.72)
    expect(b.rate).not.toBe(12.43);       // nunca exibe o nominal como "taxa contratada"
    expect(b.nominalEstimate).toBe(12.43); // real + IPCA reconstrói o nominal original
    expect(b.realEstimate).toBe(7.71);     // acima da inflação = cupom real
    expect(b.vsCdi).toBe(-1.72);           // 12.43 - 14.15
  });

  it('RENDAMAIS/EDUCA contaminados também são saneados', () => {
    const out = normalizeTreasuryBonds(
      [
        { title: 'Renda+ 2050', type: 'RENDAMAIS', rate: 11.92 },
        { title: 'Educa+ 2040', type: 'EDUCA', rate: 12.35 },
      ],
      { ipca: 4.72, selic: 14.25, cdi: 14.15 },
    );
    expect(out[0].rate).toBe(7.2);   // 11.92 - 4.72
    expect(out[1].rate).toBe(7.63);  // 12.35 - 4.72
  });

  it('cupom real legítimo (≤ teto) NÃO é alterado', () => {
    const [b] = normalizeTreasuryBonds(
      [{ title: 'Tesouro IPCA+ 2035', type: 'IPCA', rate: 7.31 }],
      { ipca: 4.72, selic: 14.25, cdi: 14.15 },
    );
    expect(b.rate).toBe(7.31);             // plausível como real → intacto
    expect(b.nominalEstimate).toBe(12.03); // 7.31 + 4.72
  });

  it('PREFIXADO alto NÃO é confundido com contaminação (não é IPCA-indexado)', () => {
    const [b] = normalizeTreasuryBonds(
      [{ title: 'Tesouro Prefixado 2032', type: 'PREFIXADO', rate: 14.6 }],
      { ipca: 4.72, selic: 14.25, cdi: 14.15 },
    );
    expect(b.rate).toBe(14.6);             // prefixado já é nominal, fica intacto
    expect(b.nominalEstimate).toBe(14.6);
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
