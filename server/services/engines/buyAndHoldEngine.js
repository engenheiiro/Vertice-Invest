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
import { isStateControlled } from '../../config/sectorTaxonomy.js';
import { BUY_AND_HOLD_CONFIG, BUY_AND_HOLD_VERSION } from '../../config/buyAndHold.js';
import { classifyStockArchetype, resolveRoeReading } from '../../config/stockCalibration.js';
import {
  archetypeFailures,
  curationFailures,
  quantitativeFailures,
  readMetric,
  upper,
} from './buyAndHoldGateRules.js';
import { buyAndHoldReason, weightedComposite } from './buyAndHoldVerdict.js';

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

/**
 * Teto de beta aplicável ao arquétipo (padrão quando não há override).
 * Banco é proxy do ciclo econômico local e tem beta estruturalmente acima de 1;
 * ver BANK_MAX_BETA em config/buyAndHold.js.
 */
export const resolveMaxBeta = (archetype, config = BUY_AND_HOLD_CONFIG) => {
  const override = config.gate.maxBetaByArchetype?.[archetype];
  return Number(Number.isFinite(Number(override)) ? override : config.gate.maxBeta);
};

// Resiliência de controle: privada domina; estatal (dividendo/capex discricionário
// e político) é penalizada. Coerente com o eixo de governança do sistema.
//
// O desconto é desconto, não veto — estatal pode disputar. Conferido na base em
// 22/08/2026: dos elegíveis, BRSR6 (STATE_DIRECT) e BBSE3 (STATE_INDIRECT) levam
// 45, CXSE3 65, e CMIG4/BBAS3 caem em 45 pela lista curada mesmo sem
// `controlType` no `sectorMetrics`. Nenhum passa sem o desconto aplicado.
const controlResilience = (ticker, controlType) => {
  if (isStateControlled(ticker)) return 45;
  return ({
    PRIVATE: 100,
    DISPERSED: 90,
    STATE_INDIRECT: 65,
    STATE_DIRECT: 45,
  })[controlType] ?? 100;
};

/**
 * Portão de âncora. Retorna { passed, failures[], archetype }. Falhar qualquer
 * critério exclui o ativo do universo Buy-and-Hold.
 */
export const passesBuyAndHoldGate = (asset, config = BUY_AND_HOLD_CONFIG) => {
  const ticker = upper(asset.ticker);
  const metrics = asset.metrics || {};
  const sector = asset.sector || metrics.sector;
  // `stockArchetype` vazio é o caso NORMAL de uma operacional: das 8 utilities
  // elegíveis hoje nenhuma tem o campo, e OPERATIONAL é exatamente o que elas
  // são. Só que cair direto em OPERATIONAL trata como operacional TUDO que não
  // foi populado — e um banco sem o campo passaria a ser cobrado por DL/EBITDA
  // em vez de Basileia, com teto de beta 1,00 em vez de 1,20. Não é hipotético:
  // BPAN4 está no banco sem `stockArchetype` (medição de 22/08/2026; hoje ele
  // nem chega ao portão, então isso é defesa, não correção de ranking).
  // classifyStockArchetype deduz do ticker/setor/nome e mantém o override do
  // campo com precedência, então a linha só age onde antes se chutava.
  const archetype = asset.stockArchetype || asset.archetype || classifyStockArchetype(asset);

  // Teto de beta é POR ARQUÉTIPO: 1,00 no geral, mais alto para banco. Beta
  // ausente continua reprovando — dado que falta não vira aprovação de graça.
  const maxBeta = resolveMaxBeta(archetype, config);
  const failures = [
    ...curationFailures(ticker, sector, config),
    ...quantitativeFailures(asset, metrics, maxBeta, config.gate),
    ...archetypeFailures(asset, archetype, config.gate),
  ];

  return { passed: failures.length === 0, failures, archetype };
};

/**
 * Nota de beta DENTRO do portão, numa rampa de escala ABSOLUTA: `best` vale 100,
 * `worst` vale 0, igual para todo arquétipo. Tira o caráter binário do limite —
 * um banco em 1,19 não pontua igual a um em 1,02 — sem transformar o portão em
 * score, que é a regra nº 1 do motor.
 *
 * A escala NÃO é por arquétipo de propósito: ver BETA_SCALE em
 * config/buyAndHold.js. O teto por arquétipo é tolerância de admissão e vive no
 * portão; repeti-lo aqui daria a mesma folga duas vezes e inverteria a ordem de
 * risco (a Itaúsa, com beta menor que o do Itaú, tirava nota menor que ele).
 *
 * Beta ausente vira `null` (AUSENTE, peso redistribuído), nunca zero: quem não
 * tem beta nem chega aqui, porque o portão já reprovou.
 */
export const betaResilience = (asset, config = BUY_AND_HOLD_CONFIG) => {
  const beta = Number(asset.metrics?.beta ?? asset.beta);
  if (!Number.isFinite(beta)) return null;
  const best = Number(config.gate.betaScale?.best);
  const worst = Number(config.gate.betaScale?.worst);
  if (!Number.isFinite(best) || !Number.isFinite(worst) || worst <= best) return null;
  return lowerBetter(beta, best, worst);
};

/** Eixos 0–100 + flags de observação. Só faz sentido para quem passou no portão. */
export const computeBuyAndHoldAxes = (asset, archetype = 'OPERATIONAL', config = BUY_AND_HOLD_CONFIG) => {
  const metrics = asset.metrics || {};
  const structural = metrics.structural || {};
  const consistencyInput = asset.consistency || {};
  const roeReading = resolveRoeReading(asset, archetype);

  const durability = averageObserved([
    part('structuralQuality', clamp(structural.quality), 0.40),
    // ROE recorrente (banco) e ROE contábil (o resto) chegavam MISTURADOS neste
    // mesmo parâmetro e eram medidos pela mesma régua de 8 a 25. São escalas
    // diferentes — o recorrente é ~1,5× o contábil — e o banco levava vantagem
    // de escala, não de fundamento. `resolveRoeReading` devolve o número E a
    // régua dele.
    part('roe', higherBetter(roeReading.value, roeReading.scale.floor, roeReading.scale.cap), 0.35),
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
    part('structuralRisk', clamp(structural.risk), 0.30),
    part('financialStrength', leverageAxis, 0.30),
    part('control', controlResilience(asset.ticker, readMetric(asset, 'controlType')), 0.25),
    // Peso deliberadamente menor que os demais: o beta é a RAMPA que substitui o
    // degrau do teto, não um quarto pilar de resiliência.
    part('beta', betaResilience(asset, config), 0.15),
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

  const axes = computeBuyAndHoldAxes(asset, gate.archetype, config);
  const composite = weightedComposite(axes, config.weights);
  const entry = computeEntryPenalty(asset, config);
  const rawScore = clamp(composite - entry.penalty);

  const confidenceCap = axes.dividendVerified ? 100 : config.gate.dividend.capWhenUnverified;
  const score = Math.min(rawScore, confidenceCap);

  // BUY exige score >= threshold E preço justo. "Ótima âncora, porém cara" => WAIT.
  //
  // O limiar é um degrau puro, e a lista publicada é fina demais para isso.
  // Medição de 22/08/2026 sobre os 17 elegíveis:
  //
  //   ±3 pontos do limiar: 2 nomes (ABCB4 73, BRSR6 69)
  //   ±5 pontos do limiar: 4 nomes (BBSE3 74, ABCB4 73, BRSR6 69, CMIG4 65) — 24%
  //
  // Um quarto do universo elegível troca de lado com uma oscilação de dado que
  // não é notícia sobre o negócio. O Banrisul já mostrou isso duas vezes na
  // mesma semana: entrou em COMPRAR pousado em exatamente 70 e saiu com 69,
  // pelos ajustes de medição destes commits, sem nada ter acontecido com o banco.
  //
  // Isso é o giro de screener que a estratégia âncora existe para NÃO ter (V-01
  // do estudo de maturidade: 34 tickers distintos em 40 publicações do Brasil 10
  // em 90 dias). A histerese planejada (entra >= 70, permanece >= 62) resolve, e
  // esta medição diz que ela é pré-requisito de lançamento, não melhoria: sem
  // ela, publicar mensalmente já nasce girando. Deliberadamente NÃO implementada
  // aqui — o motor segue em shadow e a histerese precisa de estado entre runs
  // (a lista anterior), que este módulo, sendo função pura, não tem.
  const action = (score >= BUY_THRESHOLD && !entry.expensive) ? 'BUY' : 'WAIT';
  const reason = buyAndHoldReason(action, entry, composite, axes);

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
