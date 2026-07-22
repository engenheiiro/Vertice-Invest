/**
 * Auditoria read-only do ranking STOCK_BH_SHADOW_V1.
 *
 * Reprocessa todo o universo deduplicado, calcula eixos setoriais e monta um
 * Top 10 coeso por perfil. Nao salva MarketAnalysis, DiscardLog ou configuracao.
 *
 * Uso: node server/scripts/auditStockCalibrationShadowRanking.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import MarketAnalysis from '../models/MarketAnalysis.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { scoringEngine } from '../services/engines/scoringEngine.js';
import {
  calculateStockShadowAxes,
  calculateStockCalibrationConfidence,
  prepareStockForSectorScoring,
} from '../services/engines/stockSectorAxisEngine.js';
import {
  STOCK_CALIBRATION_SHADOW_VERSION,
  buildCompetitiveCohesiveShadowTop10s,
} from '../services/engines/stockCalibrationShadowEngine.js';
import {
  STOCK_ARCHETYPES,
  assessStockMetricCoverage,
} from '../config/stockCalibration.js';
import {
  DEFAULT_NTNB_FALLBACK,
  DEFAULT_SELIC_FALLBACK,
} from '../config/financialConstants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PROFILES = ['DEFENSIVE', 'MODERATE', 'BOLD'];
const COMPACT_OUTPUT = process.argv.includes('--compact');
const FOCUS_TICKERS = new Set([
  'ITUB4', 'BBSE3', 'BBAS3', 'PSSA3', 'ITSA4', 'CXSE3', 'IRBR3', 'WIZC3',
  'PETR3', 'PETR4', 'PRIO3', 'RECV3', 'BRAV3',
]);

const weakAxisReason = axes => {
  const labels = {
    durability: 'durabilidade e qualidade do negocio',
    entry: 'preco e margem de seguranca',
    resilience: 'resiliencia financeira',
  };
  const [weakest] = Object.entries({
    durability: axes.durability,
    entry: axes.entry,
    resilience: axes.resilience,
  }).sort((a, b) => a[1] - b[1]);
  return `Eixo limitante: ${labels[weakest[0]]} (${weakest[1]}/100)`;
};

const summarizeRanking = result => ({
  total: result.ranking.length,
  buy: result.ranking.filter(item => item.action === 'BUY').length,
  wait: result.ranking.filter(item => item.action === 'WAIT').length,
  ranking: result.ranking,
  adminAudit: result.adminAudit,
});

const currentByProfile = report => Object.fromEntries(PROFILES.map(profile => {
  const rows = (report?.content?.ranking || [])
    .filter(item => item.riskProfile === profile)
    .sort((a, b) => (b.score - a.score) || (a.position - b.position))
    .slice(0, 10)
    .map((item, index) => ({
      position: index + 1,
      ticker: item.ticker,
      score: item.score,
      action: item.action,
    }));
  return [profile, rows];
}));

const compareSets = (current, shadow) => Object.fromEntries(PROFILES.map(profile => {
  const oldRows = current[profile] || [];
  const newRows = shadow[profile]?.ranking || [];
  const oldSet = new Set(oldRows.map(item => item.ticker));
  const newSet = new Set(newRows.map(item => item.ticker));
  return [profile, {
    entered: newRows.filter(item => !oldSet.has(item.ticker)).map(item => item.ticker),
    exited: oldRows.filter(item => !newSet.has(item.ticker)).map(item => item.ticker),
    retained: newRows.filter(item => oldSet.has(item.ticker)).map(item => item.ticker),
  }];
}));

await mongoose.connect(process.env.MONGO_URI);
try {
  const [rawData, macroConfig, activeCount, currentReport] = await Promise.all([
    marketDataService.getMarketData('STOCK'),
    SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean(),
    MarketAsset.countDocuments({
      type: 'STOCK',
      isActive: true,
      isIgnored: false,
      isBlacklisted: false,
    }),
    MarketAnalysis.findOne({
      assetClass: 'STOCK',
      strategy: 'BUY_HOLD',
      isRankingPublished: true,
    }).sort({ createdAt: -1 }).lean(),
  ]);

  const context = {
    MACRO: macroConfig ? {
      SELIC: macroConfig.selic,
      IPCA: macroConfig.ipca,
      RISK_FREE: macroConfig.riskFree,
      NTNB_LONG: macroConfig.ntnbLong,
      RATES_STALE: !!macroConfig.ratesStale,
    } : {
      SELIC: DEFAULT_SELIC_FALLBACK,
      IPCA: 4.5,
      RISK_FREE: DEFAULT_SELIC_FALLBACK,
      NTNB_LONG: DEFAULT_NTNB_FALLBACK,
      RATES_STALE: true,
    },
  };

  const dbRows = await MarketAsset.find({
    ticker: { $in: rawData.map(asset => asset.ticker) },
    type: 'STOCK',
  }).select('ticker stockArchetype sectorMetrics').lean();
  const metadataByTicker = new Map(dbRows.map(row => [row.ticker, row]));

  const candidates = [];
  const discarded = [];
  const coverageExcluded = [];

  for (const rawAsset of rawData) {
    const metadata = metadataByTicker.get(rawAsset.ticker) || {};
    const preparedRawAsset = prepareStockForSectorScoring({
      ...rawAsset,
      stockArchetype: metadata.stockArchetype,
      sectorMetrics: metadata.sectorMetrics || {},
    });
    const processed = scoringEngine.processAsset(preparedRawAsset, context);
    if (!processed || processed._discarded) {
      discarded.push({
        ticker: rawAsset.ticker,
        reason: processed?.reason || 'Sem resultado',
        details: processed?.details || null,
      });
      continue;
    }

    const calibrationAsset = {
      ...preparedRawAsset,
      stockArchetype: metadata.stockArchetype,
      sectorMetrics: metadata.sectorMetrics || {},
      metrics: processed.metrics,
    };
    const coverage = assessStockMetricCoverage(calibrationAsset);
    const axes = calculateStockShadowAxes(calibrationAsset);
    const dataConfidence = calculateStockCalibrationConfidence(
      calibrationAsset,
      coverage,
      context.MACRO.RATES_STALE,
    );

    if (!coverage.readyForSectorCalibration) {
      coverageExcluded.push({
        ticker: processed.ticker,
        archetype: coverage.archetype,
        missingRequired: coverage.missingRequired,
      });
    }

    candidates.push({
      ticker: processed.ticker,
      name: processed.name,
      sector: processed.sector,
      type: processed.type,
      metrics: processed.metrics,
      sectorMetrics: calibrationAsset.sectorMetrics,
      archetype: coverage.archetype,
      eligibleByProfile: {
        DEFENSIVE: processed.isDefensiveEligible !== false,
        MODERATE: true,
        BOLD: true,
      },
      coverage,
      dataConfidence,
      axes,
      currentScores: processed.scores,
      currentPrice: processed.currentPrice,
      targetPrice: processed.targetPrice,
      auditLog: processed.auditLog,
      reason: weakAxisReason(axes),
      axisAudit: axes.audit,
    });
  }

  const competitiveDraft = buildCompetitiveCohesiveShadowTop10s(candidates);
  const shadowResults = Object.fromEntries(PROFILES.map(profile => [
    profile,
    summarizeRanking(competitiveDraft.profiles[profile]),
  ]));

  const current = currentByProfile(currentReport);
  const focus = candidates
    .filter(candidate => FOCUS_TICKERS.has(candidate.ticker))
    .map(candidate => ({
      ticker: candidate.ticker,
      archetype: candidate.archetype,
      coverage: candidate.coverage.requiredCoverage,
      dataConfidence: candidate.dataConfidence,
      currentScores: candidate.currentScores,
      fundamentals: candidate.archetype === STOCK_ARCHETYPES.OIL_GAS_PRODUCER ? {
        currentPrice: candidate.currentPrice,
        targetPrice: candidate.targetPrice,
        pl: candidate.metrics.pl,
        pvp: candidate.metrics.pvp,
        roe: candidate.metrics.roe,
        netMargin: candidate.metrics.netMargin,
        dy: candidate.metrics.dy,
        revenueGrowth: candidate.metrics.revenueGrowth,
        debtToEquity: candidate.metrics.debtToEquity,
        beta: candidate.metrics.beta,
        structural: candidate.metrics.structural,
        sectorMetrics: candidate.sectorMetrics,
      } : undefined,
      axes: {
        durability: candidate.axes.durability,
        entry: candidate.axes.entry,
        resilience: candidate.axes.resilience,
      },
      shadow: Object.fromEntries(PROFILES.map(profile => {
        const row = shadowResults[profile].ranking.find(item => item.ticker === candidate.ticker);
        const audit = shadowResults[profile].adminAudit.find(item => item.ticker === candidate.ticker);
        return [profile, row ? {
          position: row.position,
          score: row.score,
          action: row.action,
          rawScore: audit.rawScore,
        } : null];
      })),
      draftDecisions: competitiveDraft.trace
        .filter(item => item.ticker === candidate.ticker)
        .map(item => ({
          profile: item.profile,
          tier: item.tier,
          score: item.score,
          concentrationKey: item.key,
          outcome: item.outcome,
        })),
      profileAudit: candidate.archetype === STOCK_ARCHETYPES.OIL_GAS_PRODUCER
        ? candidate.auditLog.filter(item => (
          item.category === 'Perfil Defensivo'
          || item.category === 'Perfil Moderado'
          || item.category === 'Perfil Arrojado'
          || item.category === 'Dados e Confiança'
        ))
        : undefined,
      axisAudit: candidate.axisAudit,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  console.log(JSON.stringify({
    version: STOCK_CALIBRATION_SHADOW_VERSION,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    productionRankingChanged: false,
    productionBaseline: currentReport ? {
      id: currentReport._id,
      createdAt: currentReport.createdAt,
      algorithmVersion: currentReport.algorithmVersion,
    } : null,
    universe: {
      activeDocuments: activeCount,
      deduplicatedAnalyzed: rawData.length,
      fullyScored: candidates.length,
      earlyDiscarded: discarded.length,
      calibrationReady: candidates.length - coverageExcluded.length,
      coverageExcluded: coverageExcluded.length,
    },
    discardReasons: Object.entries(discarded.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {})).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    coverageExcluded,
    current,
    shadow: COMPACT_OUTPUT
      ? Object.fromEntries(PROFILES.map(profile => [profile, {
        total: shadowResults[profile].total,
        buy: shadowResults[profile].buy,
        wait: shadowResults[profile].wait,
        ranking: shadowResults[profile].ranking,
      }]))
      : shadowResults,
    comparison: compareSets(current, shadowResults),
    draftIntegrity: {
      selectedTotal: competitiveDraft.selectedTotal,
      uniqueTickers: competitiveDraft.uniqueTickers,
      hasDuplicateTicker: competitiveDraft.selectedTotal !== competitiveDraft.uniqueTickers,
    },
    focus: COMPACT_OUTPUT ? focus.map(({ axisAudit, ...item }) => item) : focus,
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
