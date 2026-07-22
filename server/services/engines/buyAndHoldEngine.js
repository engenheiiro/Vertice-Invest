/**
 * Engine do ranking "Buy-and-Hold" (estratégia BUY_AND_HOLD) — shadow mode.
 *
 * Filosofia (ver planejamento/DESIGN-BUY-AND-HOLD-2026-07-20.md):
 *  1. Segurança é PORTÃO, não score. Fora do portão => ausente (nunca BUY).
 *  2. Durabilidade e resiliência mandam; valuation é FREIO (nunca soma).
 *  3. Consistência através do ciclo é eixo de primeira classe (peso menor na Fase 1).
 *  4. BUY = seguro E com preço justo; WAIT = seguro, aguarde preço.
 *
 * Funções puras (sem I/O). Reusa taxonomia de setor e o threshold global.
 */

import { BUY_THRESHOLD } from '../../config/financialConstants.js';
import { isCyclicalSector, isStateControlled } from '../../config/sectorTaxonomy.js';
import { BUY_AND_HOLD_CONFIG, BUY_AND_HOLD_VERSION } from '../../config/buyAndHold.js';

const norm = value => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

const clamp = value => Math.min(100, Math.max(0, Number(value) || 0));

const higherBetter = (value, floor, target) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clamp(((numeric - floor) / (target - floor)) * 100);
};

const lowerBetter = (value, target, ceiling) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clamp(((ceiling - numeric) / (ceiling - target)) * 100);
};

/** Média ponderada só das partes observadas (peso das ausentes é redistribuído). */
const averageObserved = parts => {
  const observed = parts.filter(p => Number.isFinite(p.value));
  const weight = observed.reduce((total, p) => total + p.weight, 0);
  if (weight === 0) return { score: 0, observed: false, components: [] };
  return {
    score: Math.round(observed.reduce((total, p) => total + p.value * p.weight, 0) / weight),
    observed: true,
    components: observed.map(p => ({
      metric: p.metric,
      value: Math.round(p.value),
      effectiveWeight: Number((p.weight / weight).toFixed(3)),
    })),
  };
};

const part = (metric, value, weight) => ({ metric, value, weight });

const upper = ticker => String(ticker || '').trim().toUpperCase();

// Resiliência de controle: privada domina; estatal (dividendo/capex discricionário
// e político) é penalizada. Coerente com o eixo de governança do sistema.
const controlResilience = (ticker, controlType) => {
  if (isStateControlled(ticker)) return 45;
  return ({
    PRIVATE: 100,
    DISPERSED: 90,
    STATE_INDIRECT: 65,
    STATE_DIRECT: 45,
  })[controlType] ?? 100;
};

const readMetric = (asset, key) => {
  const sector = asset.sectorMetrics || {};
  if (Object.hasOwn(sector, key) && sector[key] !== null && sector[key] !== undefined) return sector[key];
  return asset.metrics?.[key];
};

/**
 * Portão de âncora. Retorna { passed, failures[], archetype }. Falhar qualquer
 * critério exclui o ativo do universo Buy-and-Hold.
 */
export const passesBuyAndHoldGate = (asset, config = BUY_AND_HOLD_CONFIG) => {
  const failures = [];
  const ticker = upper(asset.ticker);
  const metrics = asset.metrics || {};
  const sector = asset.sector || metrics.sector;
  const archetype = asset.stockArchetype || asset.archetype || 'OPERATIONAL';
  const gate = config.gate;

  const deny = (config.denyTickers || []).map(upper);
  const allow = (config.allowTickers || []).map(upper);

  if (deny.includes(ticker)) failures.push('denylist manual');
  if (isCyclicalSector(sector)) failures.push('setor cíclico');

  const sectorOk = config.anchorSectors.includes(norm(sector));
  if (!sectorOk && !allow.includes(ticker)) {
    failures.push(`setor fora do universo âncora (${sector || 'desconhecido'})`);
  }

  const marketCap = Number(metrics.marketCap ?? asset.marketCap);
  if (!(marketCap >= gate.minMarketCap)) failures.push(`market cap abaixo de ${gate.minMarketCap}`);

  const beta = Number(metrics.beta ?? asset.beta);
  if (!(Number.isFinite(beta) && beta <= gate.maxBeta)) failures.push(`beta acima de ${gate.maxBeta}`);

  const liquidity = Number(metrics.avgLiquidity ?? asset.avgLiquidity);
  if (!(liquidity >= gate.minAvgLiquidity)) failures.push(`liquidez abaixo de ${gate.minAvgLiquidity}`);

  const roe = Number(readMetric(asset, 'roeTtm') ?? metrics.roe);
  if (!(roe >= gate.minRoe)) failures.push(`ROE abaixo de ${gate.minRoe}`);

  if (archetype === 'BANK') {
    if (gate.bank.requireTier1 && !asset.isTier1) failures.push('banco não tier-1');
    const capitalRatio = Number(readMetric(asset, 'capitalRatio'));
    if (!(capitalRatio >= gate.bank.minCapitalRatio)) failures.push(`Basileia abaixo de ${gate.bank.minCapitalRatio}`);
  } else if (archetype === 'INSURER') {
    const solvency = Number(readMetric(asset, 'solvencyRatio'));
    const combined = Number(readMetric(asset, 'combinedRatio'));
    if (!(solvency >= gate.insurer.minSolvency)) failures.push(`solvência abaixo de ${gate.insurer.minSolvency}`);
    if (!(combined <= gate.insurer.maxCombined)) failures.push(`combined ratio acima de ${gate.insurer.maxCombined}`);
  } else {
    const netDebtEbitda = Number(readMetric(asset, 'netDebtEbitda'));
    if (Number.isFinite(netDebtEbitda) && netDebtEbitda > gate.maxNetDebtEbitda) {
      failures.push(`netDebt/EBITDA acima de ${gate.maxNetDebtEbitda}`);
    }
  }

  return { passed: failures.length === 0, failures, archetype };
};

/** Eixos 0–100 + flags de observação. Só faz sentido para quem passou no portão. */
export const computeBuyAndHoldAxes = (asset, archetype = 'OPERATIONAL') => {
  const metrics = asset.metrics || {};
  const structural = metrics.structural || {};
  const consistencyInput = asset.consistency || {};

  const durability = averageObserved([
    part('structuralQuality', clamp(structural.quality), 0.40),
    part('roe', higherBetter(readMetric(asset, 'roeTtm') ?? metrics.roe, 8, 25), 0.35),
    part(
      'earningsGrowth',
      higherBetter(
        readMetric(asset, 'earningsGrowth')
          ?? readMetric(asset, 'recurringEarningsGrowth')
          ?? metrics.revenueGrowth,
        -10,
        20,
      ),
      0.25,
    ),
  ]);

  let leverageAxis;
  if (archetype === 'BANK') {
    leverageAxis = higherBetter(readMetric(asset, 'capitalRatio'), 10.5, 18);
  } else if (archetype === 'INSURER') {
    leverageAxis = higherBetter(readMetric(asset, 'solvencyRatio'), 100, 200);
  } else {
    leverageAxis = lowerBetter(readMetric(asset, 'netDebtEbitda'), 0.5, 3.5);
  }

  const resilience = averageObserved([
    part('structuralRisk', clamp(structural.risk), 0.35),
    part('financialStrength', leverageAxis, 0.35),
    part('control', controlResilience(asset.ticker, readMetric(asset, 'controlType')), 0.30),
  ]);

  const consistency = averageObserved([
    part('dividendStreak', higherBetter(consistencyInput.dividendStreakYears, 0, 10), 0.50),
    part('maxDrawdown', lowerBetter(consistencyInput.maxDrawdownPct, 15, 60), 0.30),
    part('roeStability', lowerBetter(consistencyInput.roeVolatility, 2, 15), 0.20),
  ]);

  const dividendVerified = Number.isFinite(Number(consistencyInput.dividendStreakYears));

  return {
    durability: durability.score,
    resilience: resilience.score,
    consistency: consistency.score,
    observed: {
      durability: durability.observed,
      resilience: resilience.observed,
      consistency: consistency.observed,
    },
    dividendVerified,
    audit: {
      durability: durability.components,
      resilience: resilience.components,
      consistency: consistency.components,
    },
  };
};

/** Penalidade de valuation (freio). >0 marca "caro"; nunca é bônus. */
export const computeEntryPenalty = (asset, config = BUY_AND_HOLD_CONFIG) => {
  const price = Number(asset.currentPrice ?? asset.metrics?.price);
  const target = Number(asset.targetPrice);
  if (!Number.isFinite(price) || !Number.isFinite(target) || target <= 0) {
    return { penalty: 0, premium: null, expensive: false };
  }
  const premium = price / target - 1;
  const { fairValueTolerance, maxPenalty, penaltyFullAtPremium } = config.entry;
  if (premium <= fairValueTolerance) return { penalty: 0, premium, expensive: false };
  const over = premium - fairValueTolerance;
  const penalty = Math.min(maxPenalty, Math.round((over / penaltyFullAtPremium) * maxPenalty));
  return { penalty, premium, expensive: true };
};

/**
 * Score final Buy-and-Hold de um ativo. Combina os eixos observados (peso
 * redistribuído), aplica o freio de valuation e o teto de confiança.
 */
export const scoreBuyAndHold = (asset, config = BUY_AND_HOLD_CONFIG) => {
  const gate = passesBuyAndHoldGate(asset, config);
  if (!gate.passed) {
    return {
      version: BUY_AND_HOLD_VERSION,
      ticker: upper(asset.ticker),
      eligible: false,
      gate,
      score: 0,
      action: 'WAIT',
      reason: `Fora do universo Buy-and-Hold: ${gate.failures.join('; ')}`,
    };
  }

  const axes = computeBuyAndHoldAxes(asset, gate.archetype);
  const weights = config.weights;
  const activeWeight = (axes.observed.durability ? weights.durability : 0)
    + (axes.observed.resilience ? weights.resilience : 0)
    + (axes.observed.consistency ? weights.consistency : 0);

  const weightedSum = (axes.observed.durability ? axes.durability * weights.durability : 0)
    + (axes.observed.resilience ? axes.resilience * weights.resilience : 0)
    + (axes.observed.consistency ? axes.consistency * weights.consistency : 0);

  const composite = activeWeight > 0 ? Math.round(weightedSum / activeWeight) : 0;
  const entry = computeEntryPenalty(asset, config);
  const rawScore = clamp(composite - entry.penalty);

  const confidenceCap = axes.dividendVerified ? 100 : config.gate.dividend.capWhenUnverified;
  const score = Math.min(rawScore, confidenceCap);

  // BUY exige score >= threshold E preço justo. "Ótima âncora, porém cara" => WAIT.
  const action = (score >= BUY_THRESHOLD && !entry.expensive) ? 'BUY' : 'WAIT';

  let reason;
  if (action === 'BUY') {
    reason = 'Âncora segura com preço justo';
  } else if (entry.expensive && composite >= BUY_THRESHOLD) {
    // Convição de negócio suficiente; só o preço segura o BUY.
    reason = 'Âncora segura, porém cara — aguarde preço';
  } else {
    // Limitante é o eixo mais fraco — considerando só os eixos efetivamente medidos.
    const axisLabels = { durability: 'durabilidade', resilience: 'resiliência', consistency: 'consistência' };
    const weakest = ['durability', 'resilience', 'consistency']
      .filter(key => axes.observed[key])
      .map(key => [axisLabels[key], axes[key]])
      .sort((a, b) => a[1] - b[1])[0];
    const suffix = weakest ? ` (${weakest[0]} ${weakest[1]}/100)` : '';
    reason = entry.expensive
      ? `Âncora, mas convicção e preço insuficientes${suffix}`
      : `Âncora, mas convicção insuficiente${suffix}`;
  }

  return {
    version: BUY_AND_HOLD_VERSION,
    ticker: upper(asset.ticker),
    name: asset.name,
    sector: asset.sector,
    eligible: true,
    gate,
    archetype: gate.archetype,
    axes: { durability: axes.durability, resilience: axes.resilience, consistency: axes.consistency },
    composite,
    entry,
    confidenceCap,
    score,
    action,
    reason,
    audit: axes.audit,
    dividendVerified: axes.dividendVerified,
  };
};

/**
 * Constrói o ranking Buy-and-Hold a partir de candidatos já processados.
 * Só entram os elegíveis (que passaram no portão). Ordenação soberana por score;
 * tiebreaker pela média dos eixos.
 */
export const buildBuyAndHoldRanking = (candidates, config = BUY_AND_HOLD_CONFIG) => {
  const scored = (candidates || [])
    .filter(asset => asset?.ticker)
    .map(asset => scoreBuyAndHold(asset, config));

  const eligible = scored.filter(item => item.eligible);
  const excluded = scored.filter(item => !item.eligible);

  const axisAverage = item => (item.axes.durability + item.axes.resilience + item.axes.consistency) / 3;

  const ranking = eligible
    .sort((a, b) => (
      b.score - a.score
      || axisAverage(b) - axisAverage(a)
      || String(a.ticker).localeCompare(String(b.ticker))
    ))
    .map((item, index) => ({ position: index + 1, ...item }));

  return {
    version: BUY_AND_HOLD_VERSION,
    ranking,
    excluded,
    counts: {
      analyzed: scored.length,
      eligible: eligible.length,
      excluded: excluded.length,
      buy: ranking.filter(item => item.action === 'BUY').length,
      wait: ranking.filter(item => item.action === 'WAIT').length,
    },
  };
};
