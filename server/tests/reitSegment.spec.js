/**
 * Sub-segmentação de REITs do Exterior (reitSegmentPT): mapeia a indústria fina do
 * Yahoo ("REIT - Retail" etc.) para um rótulo PT curto, exibido no donut do Research.
 * Inclui "Real Estate Services" (CSGP/OPEN), que antes caía no fallback genérico.
 */
import { describe, it, expect } from 'vitest';
import { reitSegmentPT } from '../utils/reitSegment.js';

describe('reitSegmentPT — mapeamento de indústria → segmento PT', () => {
  const cases = [
    ['REIT - Retail', 'Varejo'],
    ['REIT - Industrial', 'Industrial/Logística'],
    ['REIT - Office', 'Lajes/Escritórios'],
    ['REIT - Residential', 'Residencial'],
    ['REIT - Healthcare Facilities', 'Saúde'],
    ['REIT - Hotel & Motel', 'Hotéis'],
    ['REIT - Mortgage', 'Hipotecário'],
    ['REIT - Diversified', 'Diversificado'],
    ['REIT - Specialty', 'Especializado'],
    ['Real Estate Services', 'Serviços Imob.'],
  ];
  it.each(cases)('"%s" → "%s"', (industry, expected) => {
    expect(reitSegmentPT(industry)).toBe(expected);
  });

  it('industry nula/desconhecida cai no fallback "Imobiliário"', () => {
    expect(reitSegmentPT(null)).toBe('Imobiliário');
    expect(reitSegmentPT('Something Else')).toBe('Imobiliário');
  });
});
