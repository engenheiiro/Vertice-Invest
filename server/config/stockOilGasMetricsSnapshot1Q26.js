/**
 * Snapshot point-in-time das produtoras de oleo e gas listadas no universo STOCK.
 * Os valores provem de releases/indicadores oficiais e nao alteram o ranking de producao.
 *
 * Comparabilidade:
 * - productionGrowth = variacao anual da producao media atribuivel ao emissor;
 * - lifting cost exclui arrendamentos quando o emissor publica essa abertura;
 * - EBITDA preserva a base declarada e registra `ebitdaBasis` para auditoria;
 * - reservas so entram quando ha base 1P explicita. Dados 2P nao sao misturados.
 */

export const OIL_GAS_SECTOR_METRICS_1Q26 = Object.freeze({
  PETR: Object.freeze({
    archetype: 'OIL_GAS_PRODUCER',
    asOf: '2026-03-31',
    source: 'Petrobras RI - Resultados e Indicadores 1T26',
    sourceDocument: 'https://agencia.petrobras.com.br/w/negocio/petrobras-registra-lucro-l%C3%ADquido-de-r-32-7-bilh%C3%B5es-no-primeiro-trimestre-de-2026',
    supportingDocuments: [
      'https://www.investidorpetrobras.com.br/visao-geral/indicadores/producao-e-comercializacao-3/',
      'https://www.investidorpetrobras.com.br/visao-geral/indicadores/divida-liquida-ebitda-ajustado/',
      'https://www.investidorpetrobras.com.br/visao-geral/indicadores/reservas-provadas/',
      'https://petrobras.com.br/documents/2677942/17808296/FORM%2B20F%2B2025.pdf/b6e8ed8d-e4c0-c4e7-ed60-ce69a4b2f034?download=true&t=1777312219000&version=1.0',
    ],
    methodologyVersion: 'OFFICIAL_OIL_GAS_1Q26_V1',
    productionKboed: 3225,
    productionGrowth: 16.38,
    liftingCostUsdBoe: 6.4,
    liftingCostAsOf: '2025-12-31',
    liftingCostBasis: 'EX_LEASES',
    ebitdaMargin: 49.71,
    ebitdaBasis: 'ADJUSTED',
    netDebtEbitda: 1.43,
    freeCashFlowMargin: 16.51,
    provedReserveLifeYears: 10.29,
    reserveBasis: 'SEC_1P',
    controlType: 'STATE_DIRECT',
  }),
  PRIO: Object.freeze({
    archetype: 'OIL_GAS_PRODUCER',
    asOf: '2026-03-31',
    source: 'PRIO RI - Release de Resultados 1T26',
    sourceDocument: 'https://api.mziq.com/mzfilemanager/v2/d/cecb3d3e-6bd6-4edd-b9b3-3cacde780cac/e1035b51-e64e-dd53-163e-6a57c2d49930?origin=2',
    methodologyVersion: 'OFFICIAL_OIL_GAS_1Q26_V1',
    productionKboed: 155.4,
    productionGrowth: 42,
    liftingCostUsdBoe: 9.4,
    liftingCostBasis: 'EX_LEASES',
    ebitdaMargin: 76,
    ebitdaBasis: 'ADJUSTED_EX_IFRS16',
    netDebtEbitda: 2,
    controlType: 'PRIVATE',
  }),
  BRAV: Object.freeze({
    archetype: 'OIL_GAS_PRODUCER',
    asOf: '2026-03-31',
    source: 'Brava Energia RI - Relatorio de Resultados 1T26',
    sourceDocument: 'https://api.mziq.com/mzfilemanager/v2/d/55b913af-cd4c-48d5-bc19-48c63916b8a5/98d83b7d-a1fb-849d-4262-1758f53a8892?origin=2',
    methodologyVersion: 'OFFICIAL_OIL_GAS_1Q26_V1',
    productionKboed: 76,
    productionGrowth: -1,
    liftingCostUsdBoe: 14.2,
    liftingCostBasis: 'EX_LEASES',
    ebitdaMargin: 51.9,
    ebitdaBasis: 'ADJUSTED',
    netDebtEbitda: 1.84,
    freeCashFlowMargin: 13.09,
    provedReserveLifeYears: 16.54,
    reserveBasis: 'SPE_1P',
    controlType: 'PRIVATE',
  }),
  RECV: Object.freeze({
    archetype: 'OIL_GAS_PRODUCER',
    asOf: '2026-03-31',
    source: 'PetroReconcavo - Divulgacao dos Resultados 1T26 (CVM)',
    sourceDocument: 'https://www.rad.cvm.gov.br/ENETCONSULTA/frmDownloadDocumento.aspx?CodigoInstituicao=1&Tela=99&descTipo=IPE&numProtocolo=1518205&numSequencia=1042911&numVersao=1',
    methodologyVersion: 'OFFICIAL_OIL_GAS_1Q26_V1',
    productionKboed: 24.367,
    productionGrowth: -11,
    liftingCostUsdBoe: 15.82,
    liftingCostBasis: 'REPORTED',
    ebitdaMargin: 45.3,
    ebitdaBasis: 'REPORTED',
    netDebtEbitda: 1.04,
    freeCashFlowMargin: 11.7,
    reserveReplacementRatio: 100,
    controlType: 'PRIVATE',
  }),
});
