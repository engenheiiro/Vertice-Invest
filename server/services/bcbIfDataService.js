import axios from 'axios';
import https from 'https';
import { BANK_IFDATA_ISSUERS } from '../config/bankIfDataMap.js';
import { validateStockSectorMetrics } from '../schemas/stockSectorMetricsSchemas.js';
import { createCircuitBreaker, withRetry } from '../utils/resilience.js';

const BASE_URL = 'https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata';
const DATASET_URL = 'https://dadosabertos.bcb.gov.br/dataset/ifdata---dados-selecionados-de-instituies-financeiras';
const METHODOLOGY_VERSION = 'BCB_IFDATA_PRUDENTIAL_TTM_V1';
const PRUDENTIAL_CONGLOMERATE = 1;

const REPORTS = Object.freeze({
  SUMMARY: '1',
  INCOME: '4',
  CAPITAL: '5',
  CREDIT_PORTFOLIO: '16',
});

const httpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
  minVersion: 'TLSv1.2',
});

const breaker = createCircuitBreaker({
  name: 'bcb-ifdata',
  failureThreshold: 4,
  cooldownMs: 60_000,
});

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const round = value => Number(Number(value).toFixed(2));

const percentRatio = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Razão IFData inválida');
  return round(Math.abs(numeric) <= 2 ? numeric * 100 : numeric);
};

const valueByName = (rows, name) => {
  const expected = normalize(name);
  const prefixMatches = (rows || []).filter(row => normalize(row.NomeColuna).startsWith(expected));
  const shortestNameLength = prefixMatches.reduce((min, row) => (
    Math.min(min, normalize(row.NomeColuna).length)
  ), Number.POSITIVE_INFINITY);
  // Relatórios detalhados contêm a linha agregada e suas subcontas com o mesmo
  // prefixo. A linha agregada tem o rótulo mais curto (ex.: Perda Esperada (f)
  // versus Perda Esperada de Operações de Crédito (f3)).
  const matches = prefixMatches.filter(row => normalize(row.NomeColuna).length === shortestNameLength);
  if (matches.length === 0) throw new Error(`Coluna IFData ausente: ${name}`);

  const values = [...new Set(matches.map(row => Number(row.Saldo)).filter(Number.isFinite))];
  if (values.length === 0) throw new Error(`Saldo IFData inválido: ${name}`);
  if (values.length > 1 && values.some(value => Math.abs(value - values[0]) > 0.01)) {
    throw new Error(`Coluna IFData ambígua: ${name}`);
  }
  return values[0];
};

const optionalValueByName = (rows, name) => {
  try {
    return valueByName(rows, name);
  } catch {
    return null;
  }
};

const splitYearMonth = baseDate => ({
  year: Math.floor(Number(baseDate) / 100),
  month: Number(baseDate) % 100,
});

const previousQuarter = baseDate => {
  const { year, month } = splitYearMonth(baseDate);
  if (![3, 6, 9, 12].includes(month)) throw new Error(`Data-base IFData inválida: ${baseDate}`);
  return month === 3 ? (year - 1) * 100 + 12 : year * 100 + month - 3;
};

export const trailingQuarterDates = (baseDate, count = 8) => {
  const dates = [Number(baseDate)];
  while (dates.length < count) dates.push(previousQuarter(dates[dates.length - 1]));
  return dates;
};

const asOfDate = baseDate => {
  const { year, month } = splitYearMonth(baseDate);
  return new Date(Date.UTC(year, month, 0));
};

const groupByInstitution = rows => {
  const grouped = new Map();
  for (const row of rows || []) {
    const list = grouped.get(row.CodInst) || [];
    list.push(row);
    grouped.set(row.CodInst, list);
  }
  return grouped;
};

const sumMetric = (rowsByQuarter, metric) => rowsByQuarter
  .reduce((total, rows) => total + valueByName(rows, metric), 0);

const operatingIncome = rows => (
  valueByName(rows, 'Resultado de Intermediação Financeira')
  - optionalValueByName(rows, 'Resultado com Perda Esperada')
  + optionalValueByName(rows, 'Rendas de Tarifas Bancárias')
  + optionalValueByName(rows, 'Outras Rendas de Prestação de Serviços')
  + optionalValueByName(rows, 'Resultado com Transações de Pagamento')
);

const operatingExpense = rows => Math.abs(valueByName(rows, 'Despesas de Pessoal'))
  + Math.abs(valueByName(rows, 'Despesas Administrativas'));

export const deriveBankSectorMetrics = ({
  issuer,
  baseDate,
  summaryRows,
  incomeRows,
  capitalRows,
  creditRows,
  collectedAt = new Date(),
}) => {
  if (summaryRows.length !== 8) throw new Error(`${issuer}: histórico de resumo deve conter 8 trimestres`);
  if (incomeRows.length !== 4) throw new Error(`${issuer}: histórico de DRE deve conter 4 trimestres`);

  const currentTtmNetIncome = sumMetric(summaryRows.slice(0, 4), 'Lucro Líquido');
  const priorTtmNetIncome = sumMetric(summaryRows.slice(4, 8), 'Lucro Líquido');
  if (Math.abs(priorTtmNetIncome) < 0.01) throw new Error(`${issuer}: lucro TTM anterior inválido`);

  const currentEquity = valueByName(summaryRows[0], 'Patrimônio Líquido');
  const priorYearEquity = valueByName(summaryRows[4], 'Patrimônio Líquido');
  const averageEquity = (currentEquity + priorYearEquity) / 2;
  if (!(averageEquity > 0)) throw new Error(`${issuer}: patrimônio médio inválido`);

  const totalOperatingIncome = incomeRows.reduce((total, rows) => total + operatingIncome(rows), 0);
  const totalOperatingExpense = incomeRows.reduce((total, rows) => total + operatingExpense(rows), 0);
  if (!(totalOperatingIncome > 0)) throw new Error(`${issuer}: receita operacional bancária inválida`);

  const totalCredit = valueByName(creditRows, 'Total Geral');
  const delinquency = valueByName(creditRows, 'Inadimplência');
  const problemAssets = optionalValueByName(creditRows, 'Ativos problemáticos');
  if (!(totalCredit > 0)) throw new Error(`${issuer}: carteira total inválida`);

  const issuerConfig = BANK_IFDATA_ISSUERS[issuer];
  const payload = {
    archetype: 'BANK',
    asOf: asOfDate(baseDate),
    collectedAt,
    source: 'Banco Central do Brasil — IFData',
    sourceDocument: DATASET_URL,
    methodologyVersion: METHODOLOGY_VERSION,
    roeTtm: round((currentTtmNetIncome / averageEquity) * 100),
    earningsGrowth: round(((currentTtmNetIncome / priorTtmNetIncome) - 1) * 100),
    delinquencyRatio: round((delinquency / totalCredit) * 100),
    capitalRatio: percentRatio(valueByName(capitalRows, 'Índice de Basileia')),
    operatingCostRatio: round((totalOperatingExpense / totalOperatingIncome) * 100),
    controlType: issuerConfig?.controlType,
  };

  if (problemAssets != null) payload.problemAssetsRatio = round((problemAssets / totalCredit) * 100);
  const capitalPrincipal = optionalValueByName(capitalRows, 'Índice de Capital Principal');
  if (capitalPrincipal != null) payload.capitalPrincipalRatio = percentRatio(capitalPrincipal);

  return validateStockSectorMetrics(payload);
};

const institutionFilter = codes => codes.map(code => `CodInst eq '${code}'`).join(' or ');

const fetchValues = async ({ baseDate, report, institutionCodes }) => {
  const resource = `IfDataValores(AnoMes=${baseDate},TipoInstituicao=${PRUDENTIAL_CONGLOMERATE},Relatorio='${report}')`;
  // O gateway Olinda não interpreta `+` como espaço dentro de $filter. Axios
  // serializa espaços como `+` quando recebe `params`, causando 400 em filtros
  // compostos. Montagem explícita preserva `%20` conforme OData.
  const encodedFilter = encodeURIComponent(institutionFilter(institutionCodes));
  const url = `${BASE_URL}/${resource}?%24filter=${encodedFilter}&%24format=json`;
  const response = await breaker.exec(() => withRetry(
    () => axios.get(url, {
      timeout: 15_000,
      httpsAgent,
      headers: { Accept: 'application/json' },
    }),
    {
      retries: 2,
      baseDelayMs: 300,
      shouldRetry: error => !error.response || error.response.status >= 500,
    },
  ));
  return Array.isArray(response.data?.value) ? response.data.value : [];
};

export const fetchBankSectorMetricsUniverse = async ({
  baseDate,
  issuers = BANK_IFDATA_ISSUERS,
} = {}) => {
  if (!baseDate) throw new Error('baseDate é obrigatório para coleta IFData point-in-time');
  const quarterDates = trailingQuarterDates(baseDate, 8);
  const currentFour = quarterDates.slice(0, 4);
  const institutionCodes = Object.values(issuers).map(item => item.institutionCode);

  const [summaryDatasets, incomeDatasets, capitalDataset, creditDataset] = await Promise.all([
    Promise.all(quarterDates.map(date => fetchValues({
      baseDate: date, report: REPORTS.SUMMARY, institutionCodes,
    }))),
    Promise.all(currentFour.map(date => fetchValues({
      baseDate: date, report: REPORTS.INCOME, institutionCodes,
    }))),
    fetchValues({ baseDate, report: REPORTS.CAPITAL, institutionCodes }),
    fetchValues({ baseDate, report: REPORTS.CREDIT_PORTFOLIO, institutionCodes }),
  ]);

  const summaries = summaryDatasets.map(groupByInstitution);
  const incomes = incomeDatasets.map(groupByInstitution);
  const capital = groupByInstitution(capitalDataset);
  const credit = groupByInstitution(creditDataset);
  const collectedAt = new Date();
  const results = {};
  const errors = {};

  for (const [issuer, config] of Object.entries(issuers)) {
    try {
      results[issuer] = deriveBankSectorMetrics({
        issuer,
        baseDate,
        summaryRows: summaries.map(dataset => dataset.get(config.institutionCode) || []),
        incomeRows: incomes.map(dataset => dataset.get(config.institutionCode) || []),
        capitalRows: capital.get(config.institutionCode) || [],
        creditRows: credit.get(config.institutionCode) || [],
        collectedAt,
      });
    } catch (error) {
      errors[issuer] = error.message;
    }
  }

  return {
    baseDate: Number(baseDate),
    methodologyVersion: METHODOLOGY_VERSION,
    sourceDocument: DATASET_URL,
    results,
    errors,
  };
};

const HARD_PLAUSIBILITY_RANGES = Object.freeze({
  roeTtm: Object.freeze({ min: -100, max: 150 }),
  earningsGrowth: Object.freeze({ min: -500, max: 1000 }),
  delinquencyRatio: Object.freeze({ min: 0, max: 30 }),
  problemAssetsRatio: Object.freeze({ min: 0, max: 50 }),
  capitalRatio: Object.freeze({ min: 8, max: 50 }),
  capitalPrincipalRatio: Object.freeze({ min: 4.5, max: 40 }),
  operatingCostRatio: Object.freeze({ min: 5, max: 200 }),
});

const REVIEW_RANGES = Object.freeze({
  roeTtm: Object.freeze({ min: 0, max: 45 }),
  earningsGrowth: Object.freeze({ min: -80, max: 150 }),
  delinquencyRatio: Object.freeze({ min: 0, max: 8 }),
  problemAssetsRatio: Object.freeze({ min: 0, max: 15 }),
  capitalRatio: Object.freeze({ min: 10.5, max: 30 }),
  capitalPrincipalRatio: Object.freeze({ min: 7, max: 25 }),
  operatingCostRatio: Object.freeze({ min: 20, max: 100 }),
});

const outside = (value, range) => (
  value != null && (!Number.isFinite(Number(value)) || Number(value) < range.min || Number(value) > range.max)
);

/**
 * Guard de persistencia. Faixas duras detectam erro de unidade/mapeamento; as
 * faixas de revisao apenas sinalizam observacoes incomuns que podem ser reais.
 */
export const assessBankMetricsPlausibility = metrics => {
  const errors = [];
  const warnings = [];

  for (const [metric, range] of Object.entries(HARD_PLAUSIBILITY_RANGES)) {
    if (outside(metrics?.[metric], range)) {
      errors.push(`${metric}=${metrics?.[metric]} fora da faixa dura ${range.min}..${range.max}`);
    }
  }
  for (const [metric, range] of Object.entries(REVIEW_RANGES)) {
    if (!outside(metrics?.[metric], HARD_PLAUSIBILITY_RANGES[metric]) && outside(metrics?.[metric], range)) {
      warnings.push(`${metric}=${metrics?.[metric]} fora da faixa usual ${range.min}..${range.max}`);
    }
  }

  return { ready: errors.length === 0, errors, warnings };
};

export const assessBankCollectionForPersistence = (collection, issuers = BANK_IFDATA_ISSUERS) => {
  const errors = [];
  const warnings = {};
  const expected = Object.keys(issuers).sort();
  const received = Object.keys(collection?.results || {}).sort();
  const missingIssuers = expected.filter(issuer => !received.includes(issuer));
  const unexpectedIssuers = received.filter(issuer => !expected.includes(issuer));

  if (Object.keys(collection?.errors || {}).length > 0) {
    errors.push(`coleta parcial: ${Object.keys(collection.errors).join(', ')}`);
  }
  if (missingIssuers.length > 0) errors.push(`emissores ausentes: ${missingIssuers.join(', ')}`);
  if (unexpectedIssuers.length > 0) errors.push(`emissores inesperados: ${unexpectedIssuers.join(', ')}`);

  for (const issuer of expected) {
    const metrics = collection?.results?.[issuer];
    if (!metrics) continue;
    const assessment = assessBankMetricsPlausibility(metrics);
    errors.push(...assessment.errors.map(message => `${issuer}: ${message}`));
    if (assessment.warnings.length > 0) warnings[issuer] = assessment.warnings;
  }

  return {
    ready: errors.length === 0,
    expectedIssuers: expected.length,
    receivedIssuers: received.length,
    errors,
    warnings,
  };
};

export const BCB_IFDATA_CONSTANTS = Object.freeze({
  BASE_URL,
  DATASET_URL,
  METHODOLOGY_VERSION,
  REPORTS,
  HARD_PLAUSIBILITY_RANGES,
  REVIEW_RANGES,
});
