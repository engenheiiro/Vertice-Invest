import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import MarketAnalysis from '../models/MarketAnalysis.js';
import PublishedResearchPointer from '../models/PublishedResearchPointer.js';
import ResearchBatch from '../models/ResearchBatch.js';
import { BUY_THRESHOLD } from '../config/financialConstants.js';
import { STOCK_CALIBRATION_SHADOW_VERSION } from '../services/engines/stockCalibrationShadowEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PROFILES = ['DEFENSIVE', 'MODERATE', 'BOLD'];

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
try {
  const batch = await ResearchBatch.findOne({ status: { $in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS'] } })
    .sort({ startedAt: -1 })
    .lean();
  if (!batch) throw new Error('Nenhum batch concluído encontrado.');

  const analysis = await MarketAnalysis.findOne({ batchId: batch._id, assetClass: 'STOCK' }).lean();
  if (!analysis) throw new Error('Draft STOCK não encontrado no batch mais recente.');

  const ranking = analysis.content?.ranking || [];
  const fullAudit = analysis.content?.fullAuditLog || [];
  const byTicker = new Map(fullAudit.map(item => [item.ticker, item]));
  const pointers = await PublishedResearchPointer.countDocuments({ analysis: analysis._id });
  const profileCounts = Object.fromEntries(PROFILES.map(profile => [
    profile,
    ranking.filter(item => item.riskProfile === profile).length,
  ]));
  const profileBuys = Object.fromEntries(PROFILES.map(profile => [
    profile,
    ranking.filter(item => item.riskProfile === profile && item.action === 'BUY').length,
  ]));

  const failures = [];
  if (ranking.length !== 30) failures.push(`rankingSize=${ranking.length}, esperado=30`);
  if (new Set(ranking.map(item => item.ticker)).size !== ranking.length) failures.push('ticker duplicado no ranking');
  for (const profile of PROFILES) {
    if (profileCounts[profile] !== 10) failures.push(`${profile}=${profileCounts[profile]}, esperado=10`);
  }
  if (ranking.some(item => (item.score >= BUY_THRESHOLD) !== (item.action === 'BUY'))) {
    failures.push('action divergente do threshold global');
  }
  if (ranking.some(item => item.stockCalibration || item.coverage)) {
    failures.push('eixos/cobertura vazaram para o ranking público');
  }
  if (fullAudit.some(item => item.stockCalibration?.version !== STOCK_CALIBRATION_SHADOW_VERSION)) {
    failures.push('Auditoria Completa contém ativo sem versão V3');
  }
  if (ranking.some(item => {
    const audit = byTicker.get(item.ticker);
    return !audit
      || audit.riskProfile !== item.riskProfile
      || audit.score !== item.score
      || audit.action !== item.action;
  })) {
    failures.push('ranking e Auditoria Completa divergem em perfil/score/action');
  }
  if (analysis.isRankingPublished || analysis.isMorningCallPublished
      || analysis.isReportPublished || analysis.isExplainableAIPublished) {
    failures.push('draft possui flag de publicação ativa');
  }
  if (pointers > 0) failures.push('ponteiro publicado referencia o draft');

  const result = {
    ok: failures.length === 0,
    batchId: String(batch._id),
    runId: batch.runId,
    analysisId: String(analysis._id),
    calibrationVersion: STOCK_CALIBRATION_SHADOW_VERSION,
    rankingSize: ranking.length,
    uniqueTickers: new Set(ranking.map(item => item.ticker)).size,
    profileCounts,
    profileBuys,
    buyCount: ranking.filter(item => item.action === 'BUY').length,
    waitCount: ranking.filter(item => item.action === 'WAIT').length,
    fullAuditSize: fullAudit.length,
    calibrationReady: fullAudit.filter(item => item.stockCalibration?.eligible).length,
    coverageExcluded: fullAudit.filter(item => !item.stockCalibration?.eligible).map(item => ({
      ticker: item.ticker,
      missingRequired: item.coverage?.missingRequired || [],
    })),
    publicRankingHasInternalAxes: ranking.some(item => item.stockCalibration || item.coverage),
    pointersReferencingDraft: pointers,
    top10ByProfile: Object.fromEntries(PROFILES.map(profile => [
      profile,
      ranking
        .filter(item => item.riskProfile === profile)
        .sort((a, b) => (b.score - a.score) || (a.position - b.position))
        .map(({ ticker, score, action }) => ({ ticker, score, action })),
    ])),
    failures,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
