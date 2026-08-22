/**
 * Engine do ranking âncora de FIIs (estratégia BUY_AND_HOLD) — shadow mode.
 * Par do buyAndHoldEngine.js (ações); mesma arquitetura, mesmos nomes de export.
 *
 * Filosofia (ver planejamento/ESTUDO-MATURIDADE-RANKING-2026-08.html):
 *  1. Segurança é PORTÃO, não score. Fora do portão => ausente (nunca BUY).
 *  2. Durabilidade e resiliência mandam; valuation é FREIO (nunca soma pontos).
 *  3. Consistência através do ciclo é eixo de primeira classe (peso menor na
 *     Fase 1, com a série de fundamentos dormente).
 *  4. BUY = seguro E com preço justo; WAIT = seguro, aguarde preço.
 *
 * O que o motor semanal de FII faz de errado e este não repete: publicar 28–30
 * COMPRAR de 30 há 12 publicações seguidas. Um ranking âncora precisa SEPARAR.
 * O ponto de separação aqui é o freio próprio de preço (spread de DY vs. NTN-B
 * + P/FFO), porque o preço justo genérico de FII é tautologia do P/VP: com o
 * setor a P/VP 0,70–0,95, 100% dos elegíveis aparecem "dentro do valor justo".
 *
 * Funções puras (sem I/O).
 */

import { BUY_THRESHOLD, DEFAULT_NTNB_FALLBACK } from '../../config/financialConstants.js';
import { getFiiManager, FII_MANAGER_MAP } from '../../config/fiiManagerMap.js';
import { FII_BUY_AND_HOLD_CONFIG, FII_BUY_AND_HOLD_VERSION } from '../../config/fiiBuyAndHold.js';
import { safeDiv, safeFloat } from '../../utils/mathUtils.js';

const norm = value => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

const upper = ticker => String(ticker || '').trim().toUpperCase();

const clamp = value => Math.min(100, Math.max(0, Number(value) || 0));

// AUSENTE tem que chegar como null nas duas pontas: `Number(null)` é 0, e 0 numa
// escala lowerBetter viraria NOTA MÁXIMA de graça (alavancagem que a fonte não
// publica) e numa escala higherBetter viraria NOTA ZERO (cobertura de FFO que a
// fonte não publica). Dado que não existe não vira nota nenhuma — o peso é
// redistribuído em averageObserved.
const absent = value => value === null || value === undefined || value === '';

const higherBetter = (value, floor, target) => {
  if (absent(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clamp(((numeric - floor) / (target - floor)) * 100);
};

const lowerBetter = (value, target, ceiling) => {
  if (absent(value)) return null;
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

/** Leitura tolerante: o candidato pode trazer o campo no topo ou dentro de metrics. */
const readMetric = (asset, key) => {
  const metrics = asset.metrics || {};
  if (metrics[key] !== null && metrics[key] !== undefined) return metrics[key];
  return asset[key];
};

/** TIJOLO | PAPEL | HIBRIDO | … a partir de fiiSubType, com fallback por segmento. */
export const resolveFiiSubType = asset => {
  const explicit = String(asset.fiiSubType || asset.metrics?.fiiSubType || '').toUpperCase();
  if (explicit) return explicit;
  const sector = norm(asset.sector || asset.metrics?.sector);
  if (!sector) return 'UNKNOWN';
  if (sector.includes('papel') || sector.includes('recebiv')) return 'PAPEL';
  if (sector.includes('fundo de fundos')) return 'FOF';
  if (sector.includes('fiagro')) return 'FIAGRO';
  if (sector.includes('desenvolvimento')) return 'DESENVOLVIMENTO';
  if (sector.includes('hibrido')) return 'HIBRIDO';
  return 'TIJOLO';
};

/**
 * FFO Yield saneado. Fora da banda plausível vira `null` (AUSENTE), nunca nota
 * baixa: `0` significa "a fonte não publicou". FFO Yield acima de ~30% não existe
 * em fundo de tijolo saudável — é evento não recorrente, fundo em amortização, ou
 * base de cálculo divergente na fonte (7 casos na base, até 128,5% em CPTR11).
 */
export const sanitizeFfoYield = (value, config = FII_BUY_AND_HOLD_CONFIG) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const { minPlausibleYield, maxPlausibleYield } = config.gate.ffo;
  if (numeric < minPlausibleYield || numeric > maxPlausibleYield) return null;
  return numeric;
};

/**
 * Cobertura da distribuição pelo FFO: FFO por cota ÷ provento por cota.
 * < 1 significa que o fundo distribui mais do que gera operacionalmente — renda
 * financiada por ganho de capital ou amortização, exatamente o que uma âncora de
 * renda não pode ser. Retorna null quando falta qualquer insumo.
 */
export const computeFfoCoverage = asset => {
  const ffoCota = Number(readMetric(asset, 'ffoCota'));
  const price = Number(asset.currentPrice ?? readMetric(asset, 'price'));
  const dy = Number(readMetric(asset, 'dy'));
  if (!Number.isFinite(ffoCota) || ffoCota <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(dy) || dy <= 0) return null;
  const distributionPerShare = safeFloat((price * dy) / 100);
  if (distributionPerShare <= 0) return null;
  return safeDiv(ffoCota, distributionPerShare);
};

/**
 * Alavancagem em % do PL. Vem de `debtToEquity` (o campo que o MarketAsset tem
 * de fato); `leverage` fica aceito por compatibilidade caso a ingestão passe a
 * publicá-lo. Zero é AUSENTE, não "sem dívida": a fonte não publica dívida de
 * FII, e tratar 0 como ótimo daria nota máxima de graça a 371 fundos.
 */
const readLeverage = asset => {
  const explicit = Number(readMetric(asset, 'leverage'));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const debtToEquity = Number(readMetric(asset, 'debtToEquity'));
  if (Number.isFinite(debtToEquity) && debtToEquity > 0) return debtToEquity;
  return null;
};

/**
 * Vacância utilizável, ou nada. A coluna "Vacância Média" do Fundamentus publica
 * valores impossíveis e atribui vacância de dois dígitos altos a fundos de
 * ocupação plena (XPML11 91,81%, HSML11 85,82% — conferido na fonte). Quando a
 * leitura se contradiz, ela é descartada: vira AUSENTE (sem penalidade e sem
 * bônus, com teto de confiança), nunca vacância zero.
 *
 * Descartar é estreito de propósito — só cai o impossível e o auto-contraditório
 * (carteira meio vazia pagando renda normal, com FFO positivo, em vários
 * imóveis). Fundo de fato vazio continua com a vacância valendo, e barrando.
 */
export const assessVacancy = (asset, config = FII_BUY_AND_HOLD_CONFIG) => {
  const rule = config.gate.vacancy;
  const raw = Number(readMetric(asset, 'vacancy'));

  if (!Number.isFinite(raw) || raw < 0) {
    return { value: null, credible: false, raw: null, discardReason: 'vacância ausente na fonte' };
  }
  if (raw > rule.maxPossible) {
    return {
      value: null,
      credible: false,
      raw,
      discardReason: `vacância de ${raw.toFixed(2)}% é impossível — dado inválido na fonte`,
    };
  }
  if (raw < rule.implausibleFrom) return { value: raw, credible: true, raw, discardReason: null };

  // Metade ou mais da carteira vazia: só acreditamos se o caixa do fundo
  // acompanhar. Vários imóveis + renda normal + FFO positivo desmentem a leitura.
  const properties = Number(readMetric(asset, 'qtdImoveis'));
  const dy = Number(readMetric(asset, 'dy'));
  const ffoYield = sanitizeFfoYield(readMetric(asset, 'ffoYield'), config);
  const contradicted = properties >= rule.minPropertiesForImplausible
    && dy >= rule.minDyForImplausible
    && ffoYield !== null && ffoYield > 0;

  if (!contradicted) return { value: raw, credible: true, raw, discardReason: null };
  return {
    value: null,
    credible: false,
    raw,
    discardReason: `vacância de ${raw.toFixed(2)}% desmentida pelo próprio caixa `
      + `(${properties} imóveis pagando DY de ${dy.toFixed(2)}% com FFO de ${ffoYield.toFixed(2)}%)`,
  };
};

/**
 * Qualidade da casa gestora: tier-1 curado > gestora conhecida e mapeada >
 * gestora desconhecida. Proxy honesto — mede reputação e rastreabilidade da
 * casa, não performance passada do fundo.
 */
const managerQuality = asset => {
  if (asset.isTier1) return 100;
  const prefix = upper(asset.ticker).replace(/\d+$/, '');
  return Object.hasOwn(FII_MANAGER_MAP, prefix) ? 75 : 55;
};

/**
 * Portão âncora de FII. Retorna { passed, failures[], subType, isPaper }.
 * Falhar qualquer critério exclui o fundo do universo Buy-and-Hold.
 */
export const passesBuyAndHoldGate = (asset, config = FII_BUY_AND_HOLD_CONFIG) => {
  const failures = [];
  const ticker = upper(asset.ticker);
  const gate = config.gate;
  const subType = resolveFiiSubType(asset);
  const isPaper = subType === 'PAPEL';
  const excludedByNature = config.excludedSubTypes.includes(subType);

  const deny = (config.denyTickers || []).map(upper);
  const allow = (config.allowTickers || []).map(upper);

  if (deny.includes(ticker)) failures.push('denylist manual');

  // 1. Natureza incompatível com âncora — barra antes de qualquer número.
  if (excludedByNature) failures.push(`natureza fora do universo âncora (${subType.toLowerCase()})`);

  // 2. Prazo determinado / amortização: a renda tem data para acabar.
  const name = norm(asset.name);
  if (config.terminationHints.some(hint => name.includes(hint))) {
    failures.push('fundo com prazo determinado ou em amortização');
  }

  // 3. Papel/CRI só entra se for tier-1 (curadoria de crédito). Em FII a flag
  //    `isTier1` é populada de verdade — ao contrário das ações, onde exigi-la
  //    reprovava todo banco brasileiro (commit 54e62a5).
  if (isPaper && gate.requireTier1ForPaper && !asset.isTier1) {
    failures.push('FII de papel fora do tier-1');
  }

  // 4. Tijolo/híbrido precisa estar num segmento de RENDA curado.
  if (!isPaper && !excludedByNature) {
    const segmentOk = config.anchorSegments.includes(norm(asset.sector));
    if (!segmentOk && !allow.includes(ticker)) {
      failures.push(`segmento fora do universo âncora (${asset.sector || 'desconhecido'})`);
    }
  }

  // 5. Pisos quantitativos comuns.
  const marketCap = Number(readMetric(asset, 'marketCap'));
  if (!(marketCap >= gate.minMarketCap)) failures.push(`patrimônio abaixo de ${gate.minMarketCap}`);

  const liquidity = Number(readMetric(asset, 'avgLiquidity'));
  if (!(liquidity >= gate.minAvgLiquidity)) failures.push(`liquidez abaixo de ${gate.minAvgLiquidity}`);

  const dy = Number(readMetric(asset, 'dy'));
  if (!(dy >= gate.minDy)) failures.push(`DY abaixo de ${gate.minDy}%`);
  // Armadilha de yield: DY estratosférico é amortização/evento, não renda.
  else if (dy > gate.maxDy) failures.push(`armadilha de yield (DY ${dy.toFixed(1)}% > ${gate.maxDy}%)`);

  // Alavancagem: fail-open — o Fundamentus não publica o dado para FII hoje, então
  // só reprova quando o número EXISTE e estoura. Não punir ausência de cobertura.
  const leverage = readLeverage(asset);
  if (leverage !== null && leverage > gate.maxLeverage) {
    failures.push(`alavancagem acima de ${gate.maxLeverage}%`);
  }

  // 6. Pisos de tijolo: vacância e número de imóveis. Inaplicáveis a papel — cobrá-los
  // de um FII de CRI seria reprovar por dado estruturalmente inexistente. É também o
  // filtro que separa "híbrido de tijolo" de "híbrido de papel": sem imóveis, cai aqui.
  const vacancy = assessVacancy(asset, config);
  if (!isPaper && !excludedByNature) {
    // Só barra por vacância CRÍVEL. Leitura descartada não reprova nem aprova:
    // vira lacuna declarada, com teto de confiança no score.
    if (vacancy.credible && vacancy.value > gate.maxVacancy) {
      failures.push(`vacância acima de ${gate.maxVacancy}%`);
    }
    const properties = Number(readMetric(asset, 'qtdImoveis'));
    if (!(properties >= gate.minProperties)) {
      failures.push(`menos de ${gate.minProperties} imóveis`);
    }
  }

  return { passed: failures.length === 0, failures, subType, isPaper, vacancy };
};

/** Eixos 0–100 + flags de observação. Só faz sentido para quem passou no portão. */
export const computeBuyAndHoldAxes = (asset, gateInfo = {}, config = FII_BUY_AND_HOLD_CONFIG) => {
  const isPaper = !!gateInfo.isPaper;
  const structural = asset.metrics?.structural || {};
  const consistencyInput = asset.consistency || {};

  const coverage = computeFfoCoverage(asset);
  const vacancy = gateInfo.vacancy || assessVacancy(asset, config);

  // Durabilidade — qualidade do imóvel e do inquilino. Vacância e diversificação
  // são inaplicáveis a papel: ficam ausentes e o peso é redistribuído (mesmo
  // princípio do teto de confiança de FII no scoringEngine).
  const durability = averageObserved([
    part('structuralQuality', clamp(structural.quality), 0.30),
    part('vacancy', isPaper ? null : lowerBetter(vacancy.value, 3, 15), 0.25),
    // Acima de ~10 imóveis a diversificação adiciona pouco; pesa menos que a
    // cobertura do provento, que é de primeira ordem numa âncora de renda.
    part('propertyDiversification', isPaper ? null : higherBetter(readMetric(asset, 'qtdImoveis'), 1, 30), 0.15),
    // Cobertura da distribuição pelo FFO: 1,0x é o ponto em que o provento é
    // integralmente operacional. Abaixo de 0,7x a renda vem de outro lugar.
    part('ffoCoverage', higherBetter(coverage, 0.70, 1.15), 0.30),
  ]);

  // Resiliência — porte, execução, casa gestora e alavancagem.
  const resilience = averageObserved([
    part('structuralRisk', clamp(structural.risk), 0.25),
    part('liquidity', higherBetter(readMetric(asset, 'avgLiquidity'), 1_000_000, 20_000_000), 0.25),
    part('size', higherBetter(readMetric(asset, 'marketCap'), 500_000_000, 5_000_000_000), 0.20),
    part('manager', managerQuality(asset), 0.15),
    part('leverage', lowerBetter(readLeverage(asset), 10, 40), 0.15),
  ]);

  // Consistência — regularidade da renda através do ciclo. O streak plurianual
  // depende do FundamentalSnapshot, que só terá profundidade por volta de
  // dez/2026 (1 leitura por FII hoje, contra TRACK_RECORD_MIN_PERIODS = 6): fica
  // ausente e o eixo se apoia no comportamento do preço, sem zerar ninguém por
  // falta de série — o teto de confiança cobre a lacuna.
  const consistency = averageObserved([
    part('distributionStreak', higherBetter(consistencyInput.distributionStreakYears, 0, 10), 0.35),
    part('dyStability', lowerBetter(consistencyInput.dyVolatility, 0.5, 4), 0.20),
    part('maxDrawdown', lowerBetter(consistencyInput.maxDrawdownPct, 15, 50), 0.25),
    part('priceVolatility', lowerBetter(readMetric(asset, 'volatility'), 8, 25), 0.20),
  ]);

  const distributionVerified = Number.isFinite(Number(consistencyInput.distributionStreakYears));

  return {
    vacancy,
    durability: durability.score,
    resilience: resilience.score,
    consistency: consistency.score,
    observed: {
      durability: durability.observed,
      resilience: resilience.observed,
      consistency: consistency.observed,
    },
    distributionVerified,
    ffoCoverage: coverage,
    audit: {
      durability: durability.components,
      resilience: resilience.components,
      consistency: consistency.components,
    },
  };
};

/**
 * FREIO de preço (nunca bônus). Dois eixos independentes; a penalidade é a do
 * eixo que morde mais forte — freios não se somam: um fundo caro no spread e
 * caro no P/FFO não é "duas vezes caro", é caro.
 *
 * `expensive: true` força WAIT — é o pedágio de "ótima âncora, porém cara".
 * Spread esticado NÃO marca `expensive`: não é preço alto, é prêmio de risco.
 */
export const computeEntryPenalty = (asset, context = {}, config = FII_BUY_AND_HOLD_CONFIG) => {
  const { maxPenalty } = config.entry;
  const band = config.entry.spread;
  const pFfoCfg = config.entry.pFfo;

  const ntnb = Number(context.MACRO?.NTNB_LONG ?? context.ntnbLong ?? DEFAULT_NTNB_FALLBACK);
  const dy = Number(readMetric(asset, 'dy'));

  let spread = null;
  let spreadPenalty = 0;
  let spreadCompressed = false;
  let spreadStretched = false;
  if (Number.isFinite(dy) && dy > 0 && Number.isFinite(ntnb)) {
    spread = safeFloat(dy - ntnb);
    if (spread < band.minBand) {
      spreadCompressed = true;
      const depth = (band.minBand - spread) / (band.minBand - band.fullPenaltyWhenCompressedAt);
      spreadPenalty = Math.round(Math.min(1, Math.max(0, depth)) * maxPenalty);
    } else if (spread > band.maxBand) {
      spreadStretched = true;
      const excess = (spread - band.maxBand) / (band.fullPenaltyWhenStretchedAt - band.maxBand);
      spreadPenalty = Math.round(Math.min(1, Math.max(0, excess)) * maxPenalty);
    }
  }

  const ffoYield = sanitizeFfoYield(readMetric(asset, 'ffoYield'), config);
  let pFfo = null;
  let ffoPenalty = 0;
  let pFfoExpensive = false;
  if (ffoYield !== null) {
    pFfo = safeFloat(100 / ffoYield);
    if (pFfo > pFfoCfg.fair) {
      pFfoExpensive = true;
      const excess = (pFfo - pFfoCfg.fair) / (pFfoCfg.fullPenaltyAt - pFfoCfg.fair);
      ffoPenalty = Math.round(Math.min(1, Math.max(0, excess)) * maxPenalty);
    }
  }

  return {
    penalty: Math.min(maxPenalty, Math.max(spreadPenalty, ffoPenalty)),
    spread,
    ntnb,
    pFfo,
    ffoYield,
    spreadCompressed,
    spreadStretched,
    pFfoExpensive,
    expensive: spreadCompressed || pFfoExpensive,
  };
};

const AXIS_LABELS = { durability: 'durabilidade', resilience: 'resiliência', consistency: 'consistência' };

const buildReason = ({ action, entry, composite, axes, payoutUncovered }) => {
  if (action === 'BUY') return 'Âncora de renda com preço justo';

  const weakest = ['durability', 'resilience', 'consistency']
    .filter(key => axes.observed[key])
    .map(key => [AXIS_LABELS[key], axes[key]])
    .sort((a, b) => a[1] - b[1])[0];
  const suffix = weakest ? ` (${weakest[0]} ${weakest[1]}/100)` : '';

  // O provento não operacional é o defeito mais grave que uma âncora de renda
  // pode ter: nomeia o motivo antes de qualquer consideração de preço.
  if (payoutUncovered) {
    return `Distribuição não coberta pelo FFO (${axes.ffoCoverage.toFixed(2)}x) — renda vem de ganho de capital ou amortização${suffix}`;
  }
  if (entry.expensive && composite >= BUY_THRESHOLD) {
    // Convicção de negócio suficiente; só o preço segura o BUY.
    return entry.spreadCompressed
      ? `Âncora sólida, porém cara — spread de ${entry.spread.toFixed(2)} p.p. sobre a NTN-B, aguarde preço`
      : `Âncora sólida, porém cara — P/FFO ${entry.pFfo.toFixed(1)}x, aguarde preço`;
  }
  if (entry.spreadStretched) {
    return `Prêmio alto demais para ser barganha (DY ${entry.spread.toFixed(2)} p.p. acima da NTN-B) — risco, não desconto${suffix}`;
  }
  return entry.expensive
    ? `Âncora, mas convicção e preço insuficientes${suffix}`
    : `Âncora, mas convicção insuficiente${suffix}`;
};

/**
 * Score final âncora de um FII. Combina os eixos observados (peso redistribuído),
 * aplica o freio de preço e o teto de confiança.
 */
export const scoreBuyAndHold = (asset, context = {}, config = FII_BUY_AND_HOLD_CONFIG) => {
  const gate = passesBuyAndHoldGate(asset, config);
  if (!gate.passed) {
    return {
      version: FII_BUY_AND_HOLD_VERSION,
      ticker: upper(asset.ticker),
      eligible: false,
      gate,
      score: 0,
      action: 'WAIT',
      reason: `Fora do universo âncora de FIIs: ${gate.failures.join('; ')}`,
    };
  }

  const axes = computeBuyAndHoldAxes(asset, gate, config);
  const weights = config.weights;
  const activeWeight = (axes.observed.durability ? weights.durability : 0)
    + (axes.observed.resilience ? weights.resilience : 0)
    + (axes.observed.consistency ? weights.consistency : 0);

  const weightedSum = (axes.observed.durability ? axes.durability * weights.durability : 0)
    + (axes.observed.resilience ? axes.resilience * weights.resilience : 0)
    + (axes.observed.consistency ? axes.consistency * weights.consistency : 0);

  const composite = activeWeight > 0 ? Math.round(weightedSum / activeWeight) : 0;
  const entry = computeEntryPenalty(asset, context, config);
  const rawScore = clamp(composite - entry.penalty);

  // Tetos de confiança: o menor manda. Um fundo de tijolo cuja vacância teve de
  // ser descartada não é reprovado por isso, mas também não sobe até o topo com
  // uma lacuna no eixo que mais pesa na durabilidade.
  const vacancyUnverified = !gate.isPaper && !axes.vacancy.credible;
  const confidenceCap = Math.min(
    axes.distributionVerified ? 100 : config.gate.distribution.capWhenUnverified,
    vacancyUnverified ? config.gate.vacancy.capWhenUnverified : 100,
  );
  const score = Math.min(rawScore, confidenceCap);

  // Provento não coberto pelo FFO veta o COMPRAR sem excluir o fundo da lista:
  // a cobertura oscila entre trimestres, mas enquanto a renda não for operacional
  // o fundo não é âncora de renda. Só morde quando a cobertura foi MEDIDA.
  const payoutUncovered = axes.ffoCoverage !== null && axes.ffoCoverage < config.gate.ffo.minCoverage;

  // BUY exige score >= threshold, preço justo E renda operacional.
  // "Ótima âncora, porém cara" => WAIT.
  const action = (score >= BUY_THRESHOLD && !entry.expensive && !payoutUncovered) ? 'BUY' : 'WAIT';

  return {
    version: FII_BUY_AND_HOLD_VERSION,
    ticker: upper(asset.ticker),
    name: asset.name,
    sector: asset.sector,
    manager: getFiiManager(upper(asset.ticker)),
    eligible: true,
    gate,
    subType: gate.subType,
    axes: { durability: axes.durability, resilience: axes.resilience, consistency: axes.consistency },
    composite,
    entry,
    confidenceCap,
    score,
    action,
    // A lacuna vai escrita no motivo: quem lê a lista precisa saber que a
    // vacância daquele fundo foi descartada, não que ela é zero.
    reason: buildReason({ action, entry, composite, axes, payoutUncovered })
      + (vacancyUnverified && axes.vacancy.raw !== null ? ` · ${axes.vacancy.discardReason}` : ''),
    audit: axes.audit,
    vacancy: axes.vacancy,
    ffoCoverage: axes.ffoCoverage,
    payoutUncovered,
    distributionVerified: axes.distributionVerified,
  };
};

/**
 * Aplica o limite de concentração por gestora sobre a lista JÁ ordenada por
 * score: os melhores da casa ficam intactos, os excedentes perdem pontos (3º) ou
 * muitos pontos (4º+). Espelha a penalidade pós-draft do portfolioEngine.
 */
const applyManagerConcentration = (items, config) => {
  const { maxPerManager, thirdPenalty, overflowPenalty } = config.concentration;
  const seen = new Map();
  return items.map(item => {
    const manager = item.manager;
    const rank = (seen.get(manager) || 0) + 1;
    seen.set(manager, rank);
    if (rank <= maxPerManager) return item;
    const penalty = rank === maxPerManager + 1 ? thirdPenalty : overflowPenalty;
    const score = clamp(item.score - penalty);
    return {
      ...item,
      score,
      concentration: { manager, rank, penalty },
      action: (score >= BUY_THRESHOLD && !item.entry.expensive && !item.payoutUncovered) ? 'BUY' : 'WAIT',
      reason: `${item.reason} · ${rank}º fundo de ${manager} na lista (−${penalty} por concentração de gestora)`,
    };
  });
};

/**
 * Teto de COMPOSIÇÃO da lista publicável (os COMPRAR), aplicado sobre o ranking
 * já ordenado. Diferente de `applyManagerConcentration`, que penaliza pontos na
 * lista de ELEGÍVEIS e por isso nunca morde o topo: em 22/08/2026 os dois
 * primeiros COMPRAR eram papel e da mesma gestora, com a penalidade intacta.
 *
 * O excedente vira AGUARDAR com motivo explícito — não sai da lista, não perde
 * score e não muda de posição. O limite é de carteira, não de mérito.
 *
 * Os tetos são frações da lista publicável, resolvidas por PONTO FIXO: demover
 * um fundo encurta a lista, o que pode apertar o teto e demover outro. O laço
 * só encolhe (nada volta a ser COMPRAR), então converge, e o limite guarda a
 * fração sobre a lista FINAL — não sobre a lista de partida.
 */
export const applyPublicationLimits = (items, config = FII_BUY_AND_HOLD_CONFIG) => {
  const rule = config.publication;
  if (!rule) return items;

  const isPaper = item => item.gate?.isPaper ?? item.subType === 'PAPEL';
  const blocked = new Map();

  // Teto: nunca abaixo de minPerBucket — um único nome não é concentração.
  const capFor = (total, share) => Math.max(rule.minPerBucket, Math.floor(total * share));

  // No pior caso cada passada bloqueia um item; +1 para a passada que confirma.
  for (let pass = 0; pass <= items.length; pass += 1) {
    const admitted = items.filter(item => item.action === 'BUY' && !blocked.has(item.ticker));
    const paperCap = capFor(admitted.length, rule.maxPaperShare);
    const managerCap = capFor(admitted.length, rule.maxManagerShare);

    let paperCount = 0;
    const perManager = new Map();
    let changed = false;

    for (const item of admitted) {
      if (isPaper(item) && paperCount + 1 > paperCap) {
        blocked.set(item.ticker, { bucket: 'PAPER', cap: paperCap });
        changed = true;
        continue;
      }
      const managerRank = (perManager.get(item.manager) || 0) + 1;
      if (managerRank > managerCap) {
        blocked.set(item.ticker, { bucket: 'MANAGER', cap: managerCap, manager: item.manager });
        changed = true;
        continue;
      }
      // Só quem entrou de fato consome vaga.
      if (isPaper(item)) paperCount += 1;
      perManager.set(item.manager, managerRank);
    }

    if (!changed) break;
  }

  if (blocked.size === 0) return items;

  return items.map(item => {
    const limit = blocked.get(item.ticker);
    if (!limit) return item;
    const because = limit.bucket === 'PAPER'
      ? `a lista de COMPRAR já leva ${limit.cap} de papel — teto de crédito na carteira publicável`
      : `a lista de COMPRAR já leva ${limit.cap} de ${limit.manager} — teto por gestora na carteira publicável`;
    return {
      ...item,
      action: 'WAIT',
      publicationLimit: limit,
      // Não é demérito do fundo: o motivo diz que o limite é de composição.
      reason: `${item.reason} · Fora do COMPRAR por composição de carteira: ${because}`,
    };
  });
};

/**
 * Constrói o ranking âncora de FIIs a partir de candidatos já processados.
 * Só entram os elegíveis. Ordenação soberana por score; tiebreaker pela média
 * dos eixos.
 */
export const buildBuyAndHoldRanking = (candidates, context = {}, config = FII_BUY_AND_HOLD_CONFIG) => {
  const scored = (candidates || [])
    .filter(asset => asset?.ticker)
    .map(asset => scoreBuyAndHold(asset, context, config));

  const eligible = scored.filter(item => item.eligible);
  const excluded = scored.filter(item => !item.eligible);

  const axisAverage = item => (item.axes.durability + item.axes.resilience + item.axes.consistency) / 3;
  const bySovereignOrder = (a, b) => (
    b.score - a.score
    || axisAverage(b) - axisAverage(a)
    || String(a.ticker).localeCompare(String(b.ticker))
  );

  // Ordem soberana primeiro; o teto de composição só decide QUEM é publicável
  // como COMPRAR, nunca mexe em score nem em posição.
  const ordered = applyManagerConcentration(eligible.sort(bySovereignOrder), config)
    .sort(bySovereignOrder);

  const ranking = applyPublicationLimits(ordered, config)
    .map((item, index) => ({ position: index + 1, ...item }));

  return {
    version: FII_BUY_AND_HOLD_VERSION,
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
