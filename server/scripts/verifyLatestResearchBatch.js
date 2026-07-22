import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAnalysis from '../models/MarketAnalysis.js';
import ResearchBatch from '../models/ResearchBatch.js';
import PublishedResearchPointer from '../models/PublishedResearchPointer.js';
import { validateRankingContract } from '../utils/rankingContract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const fail = (message) => {
  throw new Error(message);
};

const verify = async () => {
  if (!process.env.MONGO_URI) fail('MONGO_URI não definida.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });

  const batch = await ResearchBatch.findOne().sort({ startedAt: -1 }).lean();
  if (!batch) fail('Nenhum ResearchBatch encontrado.');

  const analyses = await MarketAnalysis.find({ batchId: batch._id }).lean();
  const pointers = await PublishedResearchPointer.find().lean();
  const expected = [...batch.expectedClasses].sort();
  const completed = [...batch.completedClasses].sort();
  const actual = analyses.map(item => item.assetClass).sort();
  const analysisIds = new Set(analyses.map(item => String(item._id)));
  const pointerHits = pointers.filter(pointer => (
    String(pointer.batch || '') === String(batch._id)
    || analysisIds.has(String(pointer.analysis))
  ));

  const classes = analyses.map((analysis) => {
    const ranking = analysis.content?.ranking || [];
    const validation = validateRankingContract(ranking);
    return {
      assetClass: analysis.assetClass,
      analysisId: String(analysis._id),
      rankingSize: ranking.length,
      buyCount: ranking.filter(item => item.action === 'BUY').length,
      waitCount: ranking.filter(item => item.action === 'WAIT').length,
      contractValid: validation.ok,
      contractErrors: validation.errors,
      publishedFlags: {
        ranking: !!analysis.isRankingPublished,
        morningCall: !!analysis.isMorningCallPublished,
        report: !!analysis.isReportPublished,
        explainableAI: !!analysis.isExplainableAIPublished,
      },
    };
  }).sort((a, b) => a.assetClass.localeCompare(b.assetClass));

  const failures = [];
  if (!['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(batch.status)) {
    failures.push(`status inesperado: ${batch.status}`);
  }
  if (JSON.stringify(expected) !== JSON.stringify(completed)) {
    failures.push(`classes concluídas divergentes: esperado=${expected.join(',')} concluído=${completed.join(',')}`);
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    failures.push(`documentos divergentes: esperado=${expected.join(',')} encontrado=${actual.join(',')}`);
  }
  if (classes.some(item => !item.contractValid)) failures.push('há ranking fora do contrato');
  if (classes.some(item => Object.values(item.publishedFlags).some(Boolean))) {
    failures.push('o novo lote contém flags de publicação ativas');
  }
  if (pointerHits.length) failures.push('um ponteiro ativo referencia o novo lote/draft');
  if (analyses.some(item => item.runId !== batch.runId)) failures.push('runId divergente entre lote e análises');

  const result = {
    ok: failures.length === 0,
    batch: {
      batchId: String(batch._id),
      runId: batch.runId,
      status: batch.status,
      algorithmVersion: batch.algorithmVersion,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      expectedClasses: expected,
      completedClasses: completed,
      warnings: batch.warnings || [],
      failures: batch.failures || [],
    },
    classes,
    activePointerCount: pointers.length,
    pointersReferencingDraft: pointerHits.length,
    failures,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
};

try {
  await verify();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
