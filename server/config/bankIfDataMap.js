/**
 * Emissor B3 (raiz do ticker) -> conglomerado prudencial no IFData/BCB.
 * Códigos reconciliados contra IfDataCadastro na data-base 03/2026.
 */
export const BANK_IFDATA_ISSUERS = Object.freeze({
  ABCB: Object.freeze({ institutionCode: 'C0080312', controlType: 'PRIVATE' }),
  BAZA: Object.freeze({ institutionCode: 'C0081249', controlType: 'STATE_DIRECT' }),
  BBAS: Object.freeze({ institutionCode: 'C0080329', controlType: 'STATE_DIRECT' }),
  BBDC: Object.freeze({ institutionCode: 'C0080075', controlType: 'PRIVATE' }),
  BMEB: Object.freeze({ institutionCode: 'C0080123', controlType: 'PRIVATE' }),
  BMGB: Object.freeze({ institutionCode: 'C0080178', controlType: 'PRIVATE' }),
  BPAC: Object.freeze({ institutionCode: 'C0080336', controlType: 'PRIVATE' }),
  BRSR: Object.freeze({ institutionCode: 'C0080154', controlType: 'STATE_DIRECT' }),
  ITUB: Object.freeze({ institutionCode: 'C0080099', controlType: 'PRIVATE' }),
  PINE: Object.freeze({ institutionCode: 'C0080374', controlType: 'PRIVATE' }),
  SANB: Object.freeze({ institutionCode: 'C0080185', controlType: 'PRIVATE' }),
});

export const issuerRootFromTicker = ticker => String(ticker || '').trim().toUpperCase().slice(0, 4);

