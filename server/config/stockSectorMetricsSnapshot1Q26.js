/**
 * Snapshot point-in-time de metricas setoriais publicadas nos materiais
 * oficiais de RI do 1T26. Nao participa do ranking de producao.
 *
 * Regras de metodologia:
 * - crescimento recorrente usa a metrica ajustada/gerencial declarada pelo RI;
 * - solvencia = PLA / capital minimo requerido, quando o RI publica os saldos;
 * - capital de investida usa o menor indice material divulgado, de forma conservadora;
 * - cobertura de remessas = proventos de investidas / proventos da holding;
 * - concentracao = maior componente informado / total comparavel.
 */

export const NON_BANK_SECTOR_METRICS_1Q26 = Object.freeze({
  PSSA: Object.freeze({
    archetype: 'INSURER',
    asOf: '2026-03-31',
    source: 'Porto RI - Release de Resultados 1T26',
    sourceDocument: 'https://ri.portoseguro.com.br/informacoes-aos-acionistas/central-de-resultados/',
    methodologyVersion: 'OFFICIAL_RI_1Q26_V1',
    recurringEarningsGrowth: 15,
    solvencyRatio: 152.06,
    combinedRatio: 88.7,
    claimsRatio: 51.1,
    premiumGrowth: 5.6,
  }),
  IRBR: Object.freeze({
    archetype: 'INSURER',
    asOf: '2026-03-31',
    source: 'IRB(Re) - Resultados 1T26',
    sourceDocument: 'https://www.irbre.com/irbre-registra-lucro-liquido-de-r-1016-milhoes-no-1t26/',
    methodologyVersion: 'OFFICIAL_RI_1Q26_V1',
    recurringEarningsGrowth: 35,
    solvencyRatio: 287,
    combinedRatio: 98.1,
    claimsRatio: 58,
    premiumGrowth: 3.2,
  }),
  BBSE: Object.freeze({
    archetype: 'INSURANCE_HOLDING_DISTRIBUTOR',
    asOf: '2026-03-31',
    source: 'BB Seguridade RI - Analise do Desempenho 1T26',
    sourceDocument: 'https://api.mziq.com/mzfilemanager/v2/d/d4ee6df5-1dd8-4fb5-b518-e05397c304e4/35616430-abec-fe23-70bd-2e9b2d3f5320?origin=2',
    methodologyVersion: 'OFFICIAL_RI_1Q26_V1',
    recurringEarningsGrowth: 11.2,
    investeeCapitalAdequacy: 125.8,
    distributionRevenueGrowth: 1.4,
    distributionConcentration: 39.4,
    controlType: 'STATE_INDIRECT',
  }),
  CXSE: Object.freeze({
    archetype: 'INSURANCE_HOLDING_DISTRIBUTOR',
    asOf: '2026-03-31',
    source: 'Caixa Seguridade RI - Release de Resultados 1T26',
    sourceDocument: 'https://api.mziq.com/mzfilemanager/v2/d/3972906b-e50b-4f74-ab74-4d0d32125d11/90c7293e-b3cf-31f6-042b-731af1411869?origin=2',
    methodologyVersion: 'OFFICIAL_RI_1Q26_V1',
    recurringEarningsGrowth: 13.2,
    distributionRevenueGrowth: 1,
    distributionConcentration: 40.7,
    controlType: 'STATE_INDIRECT',
  }),
  ITSA: Object.freeze({
    archetype: 'DIVERSIFIED_HOLDING',
    asOf: '2026-03-31',
    source: 'Itausa - Resultados 1T26',
    sourceDocument: 'https://www.itausa.com.br/conteudo/itausa-lucro-liquido-recorrente-45-bilhoes-1t26-alta-17/',
    methodologyVersion: 'OFFICIAL_RI_1Q26_V1',
    recurringEarningsGrowth: 17,
    cashRemittanceCoverage: 107.86,
    distributionConcentration: 98.36,
    controlType: 'PRIVATE',
  }),
  WIZC: Object.freeze({
    archetype: 'INSURANCE_BROKER',
    asOf: '2026-03-31',
    source: 'Wiz Co RI - Release de Resultados 1T26',
    sourceDocument: 'https://ri.wiz.co/central-de-resultados/',
    methodologyVersion: 'OFFICIAL_RI_1Q26_V1',
    recurringEarningsGrowth: 0.5,
    commissionRevenueGrowth: 4.5,
  }),
});

