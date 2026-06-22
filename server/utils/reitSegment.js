// Sub-segmentação de REITs do Exterior para a UI (diversificação).
//
// O Yahoo classifica TODOS os REITs com sector "Real Estate" — coarse demais p/ mostrar
// diversificação no donut do Research. A indústria fina (assetProfile.industry, ex.:
// "REIT - Retail") é mapeada para um rótulo PT curto. O `sector` no banco continua
// "Real Estate" (a classificação usSubType depende disso); só a EXIBIÇÃO usa o segmento.

const MAP = [
  [/retail/i, 'Varejo'],
  [/industrial/i, 'Industrial/Logística'],
  [/office/i, 'Lajes/Escritórios'],
  [/residential/i, 'Residencial'],
  [/health\s*care|healthcare/i, 'Saúde'],
  [/hotel|motel|resort|lodging/i, 'Hotéis'],
  [/mortgage/i, 'Hipotecário'],
  [/diversified/i, 'Diversificado'],
  [/specialty/i, 'Especializado'], // data centers, torres, self-storage, etc.
  [/service/i, 'Serviços Imob.'], // "Real Estate Services" (ex.: CSGP, OPEN) — não-REIT clássico
];

/**
 * Mapeia a indústria fina do Yahoo para um sub-segmento PT de REIT.
 * @param {string|null} industry - ex.: "REIT - Retail"
 * @returns {string} rótulo de exibição (fallback "Imobiliário")
 */
export function reitSegmentPT(industry) {
  if (!industry) return 'Imobiliário';
  for (const [re, label] of MAP) if (re.test(industry)) return label;
  return 'Imobiliário';
}
