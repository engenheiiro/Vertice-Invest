import { BUY_THRESHOLD } from '../../config/financialConstants.js';
import { STOCK_ARCHETYPES } from '../../config/stockCalibration.js';
import { portfolioEngine } from './portfolioEngine.js';

export const STOCK_CALIBRATION_SHADOW_VERSION = 'STOCK_BH_SHADOW_V3';

const BASELINE_WEIGHT = 0.80;
const AXIS_WEIGHT = 0.20;
const OIL_GAS_BASELINE_WEIGHT = 0.20;
const OIL_GAS_AXIS_WEIGHT = 0.80;

const PROFILE_WEIGHTS = Object.freeze({
  DEFENSIVE: Object.freeze({ durability: 0.45, entry: 0.25, resilience: 0.30 }),
  MODERATE: Object.freeze({ durability: 0.40, entry: 0.35, resilience: 0.25 }),
  BOLD: Object.freeze({ durability: 0.30, entry: 0.50, resilience: 0.20 }),
});

const PROFILE_CATEGORY = Object.freeze({
  DEFENSIVE: 'Perfil Defensivo',
  MODERATE: 'Perfil Moderado',
  BOLD: 'Perfil Arrojado',
});

const clamp = value => Math.min(100, Math.max(0, Number(value) || 0));

const confidenceCap = confidence => {
  if (confidence >= 80) return 100;
  if (confidence >= 60) return 85;
  return 70;
};

/**
 * Compõe os eixos internos em UM score público. Os pesos são hipóteses shadow,
 * não parâmetros de produção. Confiança atua como teto e não como segunda lista.
 */
export const composeCohesiveShadowScore = ({
  profile,
  durability,
  entry,
  resilience,
  dataConfidence = 100,
  baselineScore = null,
  blendWeights = null,
}) => {
  const weights = PROFILE_WEIGHTS[profile];
  if (!weights) throw new Error(`Perfil inválido para calibração shadow: ${profile}`);

  const axes = {
    durability: clamp(durability),
    entry: clamp(entry),
    resilience: clamp(resilience),
  };
  const confidence = clamp(dataConfidence);
  const axisScore = Math.round(
    axes.durability * weights.durability
    + axes.entry * weights.entry
    + axes.resilience * weights.resilience,
  );
  // Os eixos estruturais usam uma escala mais generosa que os scores de perfil.
  // Em V2 eles refinam o baseline aplicavel, sem substituir sua escala historica.
  const hasBaseline = baselineScore !== null
    && baselineScore !== undefined
    && baselineScore !== ''
    && Number.isFinite(Number(baselineScore));
  const normalizedBaseline = hasBaseline ? clamp(baselineScore) : null;
  const effectiveBlend = hasBaseline
    ? {
        baseline: blendWeights?.baseline ?? BASELINE_WEIGHT,
        axes: blendWeights?.axes ?? AXIS_WEIGHT,
      }
    : null;
  if (effectiveBlend && Math.abs((effectiveBlend.baseline + effectiveBlend.axes) - 1) > 0.0001) {
    throw new Error('Pesos de blend shadow devem somar 1');
  }
  const rawScore = hasBaseline
    ? Math.round(normalizedBaseline * effectiveBlend.baseline + axisScore * effectiveBlend.axes)
    : axisScore;
  const maxScoreAllowed = confidenceCap(confidence);
  const score = Math.min(rawScore, maxScoreAllowed);

  return {
    version: STOCK_CALIBRATION_SHADOW_VERSION,
    profile,
    score,
    action: score >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
    audit: {
      axes,
      weights,
      axisScore,
      baselineScore: normalizedBaseline,
      blendWeights: effectiveBlend,
      dataConfidence: confidence,
      rawScore,
      maxScoreAllowed,
    },
  };
};

const tieBreaker = item => (
  item.audit.axes.durability
  + item.audit.axes.entry
  + item.audit.axes.resilience
) / 3;

const blendForCandidate = candidate => (
  candidate.archetype === STOCK_ARCHETYPES.OIL_GAS_PRODUCER
    ? { baseline: OIL_GAS_BASELINE_WEIGHT, axes: OIL_GAS_AXIS_WEIGHT }
    : null
);

const composeCandidateProfiles = candidate => Object.fromEntries(
  Object.keys(PROFILE_WEIGHTS).map(profile => {
    const composed = composeCohesiveShadowScore({
      profile,
      durability: candidate.axes?.durability,
      entry: candidate.axes?.entry,
      resilience: candidate.axes?.resilience,
      dataConfidence: candidate.dataConfidence,
      baselineScore: candidate.currentScores?.[profile],
      blendWeights: blendForCandidate(candidate),
    });
    return [profile, composed];
  }),
);

const profileAuditEntries = (profile, composed) => {
  const category = PROFILE_CATEGORY[profile];
  const { axes, weights, blendWeights, baselineScore, rawScore, maxScoreAllowed } = composed.audit;
  const baselineWeight = blendWeights?.baseline || 0;
  const axisWeight = blendWeights?.axes ?? 1;
  const contributions = [
    {
      factor: `Fundamentos consolidados (${Math.round(baselineWeight * 100)}%)`,
      points: Math.round((baselineScore || 0) * baselineWeight),
      type: 'base',
      category,
    },
    {
      factor: `Durabilidade (${Math.round(weights.durability * axisWeight * 100)}%)`,
      points: Math.round(axes.durability * weights.durability * axisWeight),
      type: 'base',
      category,
    },
    {
      factor: `Preço e margem de segurança (${Math.round(weights.entry * axisWeight * 100)}%)`,
      points: Math.round(axes.entry * weights.entry * axisWeight),
      type: 'base',
      category,
    },
    {
      factor: `Resiliência financeira (${Math.round(weights.resilience * axisWeight * 100)}%)`,
      points: Math.round(axes.resilience * weights.resilience * axisWeight),
      type: 'base',
      category,
    },
  ];
  const contributionTotal = contributions.reduce((sum, entry) => sum + entry.points, 0);
  const rounding = rawScore - contributionTotal;
  if (rounding !== 0) {
    contributions.push({
      factor: 'Ajuste de arredondamento',
      points: rounding,
      type: rounding > 0 ? 'bonus' : 'penalty',
      category,
    });
  }
  if (rawScore > maxScoreAllowed) {
    contributions.push({
      factor: `Teto por confiança dos dados (${composed.audit.dataConfidence}%)`,
      points: maxScoreAllowed - rawScore,
      type: 'penalty',
      category,
    });
  }
  return contributions;
};

/**
 * Converte um candidato já processado pelo scorer legado em um ativo V3. Esta é
 * a representação usada tanto pelo draft quanto pela Auditoria Completa e pelo
 * Brasil 10, evitando três versões diferentes do mesmo score.
 */
export const calibrateStockCandidate = candidate => {
  const ready = candidate?.coverage?.readyForSectorCalibration !== false;
  const composedByProfile = ready ? composeCandidateProfiles(candidate) : {};
  const processedAsset = candidate?.processedAsset || {};
  const legacyProfileCategories = new Set(Object.values(PROFILE_CATEGORY));
  const retainedAudit = (processedAsset.auditLog || [])
    .filter(entry => !legacyProfileCategories.has(entry.category));

  const calibrationAudit = ready
    ? Object.entries(composedByProfile).flatMap(([profile, composed]) => profileAuditEntries(profile, composed))
    : [{
        factor: `Calibração setorial incompleta: ${(candidate?.coverage?.missingRequired || []).join(', ') || 'campos obrigatórios ausentes'}`,
        points: -100,
        type: 'penalty',
        category: 'Dados e Confiança',
      }];

  return {
    ...processedAsset,
    ticker: candidate.ticker,
    name: candidate.name,
    sector: candidate.sector,
    type: candidate.type || 'STOCK',
    metrics: candidate.metrics || processedAsset.metrics,
    scores: Object.fromEntries(Object.keys(PROFILE_WEIGHTS).map(profile => [
      profile,
      ready && candidate.eligibleByProfile?.[profile] !== false
        ? composedByProfile[profile].score
        : 0,
    ])),
    isDefensiveEligible: ready && candidate.eligibleByProfile?.DEFENSIVE !== false,
    reason: candidate.reason || null,
    coverage: candidate.coverage,
    stockCalibration: {
      version: STOCK_CALIBRATION_SHADOW_VERSION,
      archetype: candidate.archetype,
      eligible: ready,
      dataConfidence: candidate.dataConfidence,
      axes: candidate.axes,
      auditByProfile: Object.fromEntries(Object.entries(composedByProfile).map(([profile, composed]) => [
        profile,
        composed.audit,
      ])),
    },
    shadowAuditByProfile: Object.fromEntries(Object.entries(composedByProfile).map(([profile, composed]) => [
      profile,
      composed.audit,
    ])),
    auditLog: [...retainedAudit, ...calibrationAudit],
  };
};

/**
 * Retorna um único Top 10 por perfil. Eixos internos não vazam para a resposta
 * pública; continuam disponíveis em `adminAudit` para validação e governança.
 */
export const buildCohesiveShadowTop10 = (candidates, profile) => {
  const unique = new Map();

  for (const candidate of candidates || []) {
    if (!candidate?.ticker || candidate.eligible === false) continue;
    if (candidate.coverage?.readyForSectorCalibration === false) continue;
    const composed = composeCohesiveShadowScore({ profile, ...candidate });
    const row = { candidate, composed };
    const previous = unique.get(candidate.ticker);
    if (!previous || composed.score > previous.composed.score) unique.set(candidate.ticker, row);
  }

  const selected = [...unique.values()]
    .sort((a, b) => (
      b.composed.score - a.composed.score
      || tieBreaker(b.composed) - tieBreaker(a.composed)
      || String(a.candidate.ticker).localeCompare(String(b.candidate.ticker))
    ))
    .slice(0, 10);

  return {
    version: STOCK_CALIBRATION_SHADOW_VERSION,
    profile,
    ranking: selected.map(({ candidate, composed }, index) => ({
      position: index + 1,
      ticker: candidate.ticker,
      name: candidate.name,
      sector: candidate.sector,
      riskProfile: profile,
      score: composed.score,
      action: composed.action,
      reason: candidate.reason || null,
    })),
    adminAudit: selected.map(({ candidate, composed }, index) => ({
      position: index + 1,
      ticker: candidate.ticker,
      ...composed.audit,
      coverage: candidate.coverage || null,
    })),
  };
};

/**
 * Monta os tres Top 10 em um unico draft competitivo. Cada ticker pode ocupar
 * somente um perfil e reutiliza os limites/penalidades de concentracao vigentes.
 */
export const buildCompetitiveCohesiveShadowTop10s = candidates => {
  const trace = [];
  const eligible = (candidates || [])
    .filter(candidate => candidate?.ticker)
    .map(calibrateStockCandidate)
    .filter(candidate => candidate.stockCalibration.eligible);

  // A especificacao do produto estabelece 4 ativos por macro-setor no GOLD
  // defensivo. O core legado ainda usa 3 por default; o override fica isolado
  // ao shadow ate a calibracao ser aprovada.
  const drafted = portfolioEngine.performCompetitiveDraft(eligible, {
    trace,
    strictSectorCapByProfile: { DEFENSIVE: 4 },
  });
  // Em STOCK, o cap decide quem entra; concentracao nao reescreve a avaliacao
  // fundamental nem converte BUY em WAIT depois da selecao.
  const selectedPortfolio = drafted;
  const profiles = {};

  for (const profile of Object.keys(PROFILE_WEIGHTS)) {
    const selected = selectedPortfolio
      .filter(item => item.riskProfile === profile)
      .sort((a, b) => (
        b.score - a.score
        || tieBreaker({ audit: b.shadowAuditByProfile[profile] })
          - tieBreaker({ audit: a.shadowAuditByProfile[profile] })
        || String(a.ticker).localeCompare(String(b.ticker))
      ));

    profiles[profile] = {
      version: STOCK_CALIBRATION_SHADOW_VERSION,
      profile,
      ranking: selected.map((item, index) => ({
        position: index + 1,
        ticker: item.ticker,
        name: item.name,
        sector: item.sector,
        riskProfile: profile,
        score: item.score,
        action: item.action,
        reason: item.reason,
      })),
      adminAudit: selected.map((item, index) => {
        const audit = item.shadowAuditByProfile[profile];
        return {
          position: index + 1,
          ticker: item.ticker,
          ...audit,
          scoreAfterConcentration: item.score,
          concentrationPenalty: Math.max(0, audit.rawScore - item.score),
          coverage: item.coverage,
        };
      }),
    };
  }

  return {
    version: STOCK_CALIBRATION_SHADOW_VERSION,
    profiles,
    selectedItems: selectedPortfolio,
    calibratedAssets: (candidates || [])
      .filter(candidate => candidate?.ticker)
      .map(calibrateStockCandidate),
    selectedTotal: selectedPortfolio.length,
    uniqueTickers: new Set(selectedPortfolio.map(item => item.ticker)).size,
    trace,
  };
};
