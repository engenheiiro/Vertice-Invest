import { describe, expect, it } from 'vitest';
import { calculateStockCalibrationConfidence } from '../services/engines/stockSectorAxisEngine.js';
import {
  buildBuyAndHoldRanking,
  passesBuyAndHoldGate,
  scoreBuyAndHold,
} from '../services/engines/buyAndHoldEngine.js';
import { BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';
import { canon, hash16, mulberry32 } from './helpers/characterization.js';

// Caracterização gravada sobre as funções monolíticas ANTES da decomposição:
// a confiança da calibração STOCK (mínimo entre cobertura, descontos e confiança
// legada — decisão de produto) e o portão/score Buy-and-Hold. Só importa os
// exports que já existiam; cenários semeados, hash por cenário e alguns casos
// legíveis em JSON.

const run = fn => {
  try {
    return { ok: fn() };
  } catch (error) {
    return { throws: String(error?.message || error) };
  }
};

const pickFrom = rand => list => list[Math.floor(rand() * list.length)];

// ─── calculateStockCalibrationConfidence ───────────────────────────────────

const ARCHETYPES = [
  'OPERATIONAL', 'BANK', 'INSURER', 'INSURANCE_BROKER', 'FINANCIAL_HOLDING',
  'INSURANCE_HOLDING_DISTRIBUTOR', 'DIVERSIFIED_HOLDING', 'OIL_GAS_PRODUCER', 'OUTRO', undefined, null,
];

const confidenceScenario = rand => {
  const pick = pickFrom(rand);
  const missing = pick([
    undefined, null, {}, { revenueGrowth: true }, { roe: true }, { netMargin: true },
    { revenueGrowth: true, roe: true }, { roe: 0, netMargin: 1 }, { revenueGrowth: 'sim', netMargin: true },
    { beta: true },
  ]);
  const metrics = {
    _missing: missing,
    avgLiquidity: pick([undefined, null, 0, -1, 999_999, 1_000_000, 1_000_001, 5e6, NaN, '2000000', '500']),
    _staleDays: pick([undefined, null, 0, 89, 90, 91, 180, 181, NaN, Infinity, -5, '200', 400]),
  };
  if (rand() < 0.15) delete metrics._missing;
  const asset = rand() < 0.04 ? null : pick([{ metrics }, { metrics }, { metrics }, { metrics }, { metrics }, {}, { metrics: null }]);
  const coverage = rand() < 0.1 ? pick([undefined, null, {}]) : pick([
    { archetype: pick(ARCHETYPES), requiredCoverage: pick([undefined, NaN, 0, 50, 79, 80, 100, 120, '90', -10, Infinity]) },
    { archetype: pick(ARCHETYPES), requiredCoverage: pick([60, 85, 100]) },
    { archetype: 'OPERATIONAL', requiredCoverage: pick([70, 90, 100]) },
    { archetype: 'OPERATIONAL', requiredCoverage: 100 },
  ]);
  const ratesStale = pick([false, true, undefined, 1, 0, 'x', null]);
  const legacy = pick([undefined, null, 0, 100, 55, 72, 85, NaN, '80', '', Infinity, -10, 'abc', 150]);
  const argc = pick([2, 3, 4, 4, 4]);
  return { asset, coverage, ratesStale, legacy, argc };
};

const runConfidence = ({ asset, coverage, ratesStale, legacy, argc }) => run(() => {
  if (argc === 2) return calculateStockCalibrationConfidence(asset, coverage);
  if (argc === 3) return calculateStockCalibrationConfidence(asset, coverage, ratesStale);
  return calculateStockCalibrationConfidence(asset, coverage, ratesStale, legacy);
});

describe('caracterização — calculateStockCalibrationConfidence', () => {
  it('casos legíveis', () => {
    const op = (metrics, cov = 100) => [{ metrics }, { archetype: 'OPERATIONAL', requiredCoverage: cov }];
    const cases = {
      operacionalCompleto: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 10, _missing: {} })),
      operacionalSemDataFundamentos: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _missing: {} })),
      operacionalStale181: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 181 })),
      operacionalStale91: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 91 })),
      operacionalTudoRuim: calculateStockCalibrationConfidence(
        ...op({ avgLiquidity: 1, _staleDays: 999, _missing: { revenueGrowth: true, roe: true } }), true,
      ),
      bancoVelhoSemLegado: calculateStockCalibrationConfidence(
        { metrics: { avgLiquidity: 5e6, _staleDays: 400, _missing: { roe: true } } }, { archetype: 'BANK', requiredCoverage: 100 },
      ),
      bancoVelhoComLegado74: calculateStockCalibrationConfidence(
        { metrics: { avgLiquidity: 5e6, _staleDays: 400 } }, { archetype: 'BANK', requiredCoverage: 100 }, false, 74,
      ),
      legadoNuloIgnorado: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 1 }), false, null),
      legadoZero: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 1 }), false, 0),
      legadoStringVazia: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 1 }), false, ''),
      legadoNaN: calculateStockCalibrationConfidence(...op({ avgLiquidity: 5e6, _staleDays: 1 }), false, NaN),
      coberturaAusente: calculateStockCalibrationConfidence({ metrics: { avgLiquidity: 5e6 } }, undefined),
      assetNulo: run(() => calculateStockCalibrationConfidence(null, { requiredCoverage: 100 })),
    };
    expect(canon(cases)).toMatchSnapshot();
  });

  it('matriz semeada (hash por cenário)', () => {
    const rand = mulberry32(0x5eed_c0f1);
    const hashes = [];
    const histogram = {};
    for (let i = 0; i < 1500; i += 1) {
      const scenario = confidenceScenario(rand);
      const out = runConfidence(scenario);
      hashes.push(hash16({ scenario, out }));
      const key = out.throws ? 'throws' : String(out.ok);
      histogram[key] = (histogram[key] || 0) + 1;
    }
    expect(canon(histogram)).toMatchSnapshot();
    expect(hashes).toMatchSnapshot();
  });
});

// ─── Buy-and-Hold: portão e score ───────────────────────────────────────────

const CONFIGS = {
  padrao: BUY_AND_HOLD_CONFIG,
  curadoria: {
    ...BUY_AND_HOLD_CONFIG,
    denyTickers: ['itub4', ' TAEE11 '],
    allowTickers: ['petr4', 'WIZC3', 'XPTO3'],
  },
  semOverrideDeBeta: {
    ...BUY_AND_HOLD_CONFIG,
    gate: { ...BUY_AND_HOLD_CONFIG.gate, maxBetaByArchetype: undefined, betaScale: undefined },
  },
  semListas: {
    ...BUY_AND_HOLD_CONFIG,
    denyTickers: undefined,
    allowTickers: undefined,
    gate: {
      ...BUY_AND_HOLD_CONFIG.gate,
      maxBetaByArchetype: { BANK: 'abc', INSURER: 0.8 },
      betaScale: { best: 1, worst: 0.5 },
      dividend: { ...BUY_AND_HOLD_CONFIG.gate.dividend, capWhenUnverified: 70 },
    },
    weights: { durability: 0.5, resilience: 0.5, consistency: 0 },
  },
};

const TICKERS = [
  'BBAS3', 'ITUB4', 'TAEE11', 'SAPR11', 'BBSE3', 'ITSA4', 'PETR4', 'WIZC3', 'EGIE3', 'ABEV3',
  'CXSE3', 'SAPR11F', ' abc3 ', '', undefined, 'XPTO3', 'BPAN4',
];
const SECTORS = [
  'Bancos', 'Energia Elétrica', 'Seguros', 'Previdência e Seguros', 'Saneamento', 'Alimentos', 'bebidas', 'Telecomunicações',
  'Mineração', 'Varejo', 'Consumo Cíclico', 'Holdings Financeiras', undefined, '', 'Corretagem de Seguros', 'Petróleo',
];

const good = (rand, p, goodList, badList) => (rand() < p ? pickFrom(rand)(goodList) : pickFrom(rand)(badList));
const ANCHOR = ['Bancos', 'Energia Elétrica', 'Seguros', 'Saneamento', 'Alimentos', 'bebidas', 'Telecomunicações', 'Holdings Financeiras'];

const buildAsset = rand => {
  const pick = pickFrom(rand);
  const strict = rand() < 0.55;
  const g = (goodList, badList) => good(rand, strict ? 0.93 : 0.6, goodList, badList);
  const metrics = {
    marketCap: g([5e9, 1e10, 8e10, '6e9'], [undefined, null, 4.99e9, NaN, 0, -1]),
    beta: g([0.5, 0.8, 0.95, 1.0, 1.1, 1.2], [undefined, null, 1.0001, 1.21, 1.5, -0.3, NaN, '0.7']),
    avgLiquidity: g([5e6, 2e7, '9000000'], [undefined, null, 4_999_999, NaN]),
    roe: g([10, 15, 22, 30], [undefined, null, 9.99, -5, NaN]),
    revenueGrowth: pick([undefined, -20, 0, 5, 25, NaN]),
    price: pick([undefined, 10, 20, 40]),
    structural: pick([undefined, {}, { quality: 80, risk: 70 }, { quality: 40, risk: 90 }, { quality: 100, risk: 100 }, { quality: NaN, risk: -10 }]),
  };
  if (rand() < 0.2) metrics.sector = pick(SECTORS);
  const sectorMetrics = rand() < 0.15 ? undefined : {
    roeTtm: pick([undefined, null, 8, 9.99, 10, 18, 25, NaN]),
    capitalRatio: g([13, 15, 18, 20], [undefined, null, 12.99, NaN]),
    solvencyRatio: g([130, 180, 250], [undefined, 129, null]),
    combinedRatio: g([80, 95, 100], [undefined, 100.1, null]),
    netDebtEbitda: pick([undefined, null, 0, 0.5, 2.9, 3.0, 3.01, 5, NaN]),
    controlType: pick([undefined, null, 'PRIVATE', 'DISPERSED', 'STATE_INDIRECT', 'STATE_DIRECT', 'OUTRO']),
    earningsGrowth: pick([undefined, null, -15, 0, 12, 30]),
    recurringEarningsGrowth: pick([undefined, 5, 40]),
  };
  const asset = {
    ticker: pick(TICKERS),
    name: pick(['Banco Teste', 'BB Seguridade', 'Holding Financeira X', 'Energia SA', undefined]),
    sector: rand() < 0.9 ? pick(strict ? ANCHOR : SECTORS) : undefined,
    metrics: rand() < 0.05 ? undefined : metrics,
    sectorMetrics,
    consistency: pick([
      undefined, {}, { dividendStreakYears: 10, maxDrawdownPct: 20, roeVolatility: 3 },
      { dividendStreakYears: 0, maxDrawdownPct: 70, roeVolatility: 20 }, { dividendStreakYears: '6' },
      { maxDrawdownPct: 30 }, { dividendStreakYears: NaN },
    ]),
    currentPrice: pick([undefined, 10, 20, 21, 25, 30, 50, NaN]),
    targetPrice: pick([undefined, 0, -5, 20, 25, 40, NaN, '20']),
  };
  if (rand() < 0.2) asset.stockArchetype = pick(['BANK', 'INSURER', 'OPERATIONAL', 'DIVERSIFIED_HOLDING', 'NADA']);
  if (rand() < 0.15) asset.archetype = pick(['BANK', 'INSURER', 'OPERATIONAL']);
  if (rand() < 0.1) {
    asset.marketCap = pick([6e9, 1e9]);
    asset.beta = pick([0.7, 1.4]);
    asset.avgLiquidity = pick([6e6, 1e5]);
  }
  return asset;
};

const CONFIG_KEYS = Object.keys(CONFIGS);

describe('caracterização — Buy-and-Hold (portão + score)', () => {
  it('casos legíveis', () => {
    const banco = {
      ticker: 'ITUB4', name: 'Itaú', sector: 'Bancos',
      metrics: { marketCap: 3e11, beta: 1.1, avgLiquidity: 9e8, roe: 20, structural: { quality: 80, risk: 70 } },
      sectorMetrics: { roeTtm: 21, capitalRatio: 15, controlType: 'PRIVATE' },
      consistency: { dividendStreakYears: 10, maxDrawdownPct: 25, roeVolatility: 3 },
      currentPrice: 30, targetPrice: 40,
    };
    const caro = { ...banco, currentPrice: 60 };
    const utility = {
      ticker: 'TAEE11', sector: 'Energia Elétrica',
      metrics: { marketCap: 1.5e10, beta: 0.4, avgLiquidity: 4e7, roe: 25, structural: { quality: 60, risk: 60 } },
      sectorMetrics: { netDebtEbitda: 3.5 },
    };
    const seguradora = {
      ticker: 'PSSA3', sector: 'Seguros',
      metrics: { marketCap: 2e10, beta: 0.6, avgLiquidity: 6e7, roe: 18 },
      sectorMetrics: { solvencyRatio: 120, combinedRatio: 101 },
    };
    const cases = {
      banco: scoreBuyAndHold(banco),
      bancoCaro: scoreBuyAndHold(caro),
      utilityAlavancada: scoreBuyAndHold(utility),
      utilityOk: scoreBuyAndHold({ ...utility, sectorMetrics: { netDebtEbitda: 2 } }),
      seguradoraFraca: passesBuyAndHoldGate(seguradora),
      vazio: passesBuyAndHoldGate({}),
      ranking: buildBuyAndHoldRanking([banco, caro, utility, seguradora, { ...utility, ticker: 'EGIE3', sectorMetrics: {} }, null]),
    };
    expect(canon(cases)).toMatchSnapshot();
  });

  it('matriz semeada (hash por cenário)', () => {
    const rand = mulberry32(0xb0_4d_b0_1d);
    const hashes = [];
    const failures = {};
    const outcomes = {};
    const batches = Object.fromEntries(CONFIG_KEYS.map(key => [key, []]));
    for (let i = 0; i < 2000; i += 1) {
      const asset = buildAsset(rand);
      const configKey = CONFIG_KEYS[Math.floor(rand() * CONFIG_KEYS.length)];
      const config = CONFIGS[configKey];
      const gate = run(() => passesBuyAndHoldGate(asset, config));
      const score = run(() => scoreBuyAndHold(asset, config));
      batches[configKey].push(asset);
      hashes.push(hash16({ asset, configKey, gate, score }));
      for (const failure of gate.ok?.failures || []) {
        const key = failure.replace(/\(.*\)/, '(…)');
        failures[key] = (failures[key] || 0) + 1;
      }
      const outKey = score.throws ? 'throws' : `${score.ok.eligible}|${score.ok.action}|${String(score.ok.reason).split(' (')[0]}`;
      outcomes[outKey] = (outcomes[outKey] || 0) + 1;
    }
    const rankings = Object.fromEntries(CONFIG_KEYS.map(key => [
      key, hash16(run(() => buildBuyAndHoldRanking(batches[key], CONFIGS[key]))),
    ]));
    expect(canon({ failures, outcomes, rankings })).toMatchSnapshot();
    expect(hashes).toMatchSnapshot();
  });
});
