/**
 * Regras do portão Buy-and-Hold (`passesBuyAndHoldGate` em buyAndHoldEngine.js),
 * separadas por família: curadoria (lista/setor), quantitativas comuns e as do
 * arquétipo. Cada uma devolve a lista de motivos de reprovação, na ordem em que
 * o portão os publica. Puras, sem I/O.
 */

import { isCyclicalSector } from '../../config/sectorTaxonomy.js';

const norm = value => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

export const upper = ticker => String(ticker || '').trim().toUpperCase();

/** `sectorMetrics` tem precedência sobre `metrics` quando o campo está preenchido. */
export const readMetric = (asset, key) => {
  const sector = asset.sectorMetrics || {};
  if (Object.hasOwn(sector, key) && sector[key] !== null && sector[key] !== undefined) return sector[key];
  return asset.metrics?.[key];
};

/** Denylist manual, setor cíclico e setor fora do universo âncora (allowlist fura só este). */
export const curationFailures = (ticker, sector, config) => {
  const failures = [];
  const deny = (config.denyTickers || []).map(upper);
  const allow = (config.allowTickers || []).map(upper);

  if (deny.includes(ticker)) failures.push('denylist manual');
  if (isCyclicalSector(sector)) failures.push('setor cíclico');

  const sectorOk = config.anchorSectors.includes(norm(sector));
  if (!sectorOk && !allow.includes(ticker)) {
    failures.push(`setor fora do universo âncora (${sector || 'desconhecido'})`);
  }
  return failures;
};

/**
 * Porte, beta (teto já resolvido pelo arquétipo), liquidez e ROE. Dado ausente
 * reprova: as comparações são escritas como `!(x >= piso)` para NaN cair fora.
 */
export const quantitativeFailures = (asset, metrics, maxBeta, gate) => {
  const failures = [];
  const marketCap = Number(metrics.marketCap ?? asset.marketCap);
  if (!(marketCap >= gate.minMarketCap)) failures.push(`market cap abaixo de ${gate.minMarketCap}`);

  const beta = Number(metrics.beta ?? asset.beta);
  if (!(Number.isFinite(beta) && beta <= maxBeta)) failures.push(`beta acima de ${maxBeta}`);

  const liquidity = Number(metrics.avgLiquidity ?? asset.avgLiquidity);
  if (!(liquidity >= gate.minAvgLiquidity)) failures.push(`liquidez abaixo de ${gate.minAvgLiquidity}`);

  const roe = Number(readMetric(asset, 'roeTtm') ?? metrics.roe);
  if (!(roe >= gate.minRoe)) failures.push(`ROE abaixo de ${gate.minRoe}`);
  return failures;
};

// Solidez de banco é Basileia + rentabilidade recorrente, ambas do IF.data.
// `roeTtm` ausente cai no ROE genérico já cobrado nas quantitativas — aqui só
// reprova quando o dado EXISTE e está abaixo do piso, para não punir emissor sem
// cobertura.
const bankFailures = (asset, gate) => {
  const failures = [];
  const capitalRatio = Number(readMetric(asset, 'capitalRatio'));
  if (!(capitalRatio >= gate.bank.minCapitalRatio)) failures.push(`Basileia abaixo de ${gate.bank.minCapitalRatio}`);
  const bankRoe = Number(readMetric(asset, 'roeTtm'));
  if (Number.isFinite(bankRoe) && bankRoe < gate.bank.minRoeTtm) {
    failures.push(`ROE recorrente abaixo de ${gate.bank.minRoeTtm}`);
  }
  return failures;
};

const insurerFailures = (asset, gate) => {
  const failures = [];
  const solvency = Number(readMetric(asset, 'solvencyRatio'));
  const combined = Number(readMetric(asset, 'combinedRatio'));
  if (!(solvency >= gate.insurer.minSolvency)) failures.push(`solvência abaixo de ${gate.insurer.minSolvency}`);
  if (!(combined <= gate.insurer.maxCombined)) failures.push(`combined ratio acima de ${gate.insurer.maxCombined}`);
  return failures;
};

// Todo o resto (operacional, holdings, petroleira...) responde por alavancagem;
// DL/EBITDA ausente não reprova.
const leverageFailures = (asset, gate) => {
  const netDebtEbitda = Number(readMetric(asset, 'netDebtEbitda'));
  if (Number.isFinite(netDebtEbitda) && netDebtEbitda > gate.maxNetDebtEbitda) {
    return [`netDebt/EBITDA acima de ${gate.maxNetDebtEbitda}`];
  }
  return [];
};

export const archetypeFailures = (asset, archetype, gate) => {
  if (archetype === 'BANK') return bankFailures(asset, gate);
  if (archetype === 'INSURER') return insurerFailures(asset, gate);
  return leverageFailures(asset, gate);
};
