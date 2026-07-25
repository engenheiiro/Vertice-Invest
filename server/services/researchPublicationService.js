import PublishedResearchPointer from '../models/PublishedResearchPointer.js';
import { runTransaction } from '../utils/dbTransaction.js';
import { finalizeRanking, validateRankingContract } from '../utils/rankingContract.js';

export const RESEARCH_SECTIONS = ['RANKING', 'MORNING_CALL', 'REPORT', 'EXPLAINABLE_AI'];

const SECTION_META = {
  RANKING: { flag: 'isRankingPublished', timestamp: 'rankingAt' },
  MORNING_CALL: { flag: 'isMorningCallPublished', timestamp: 'morningCallAt' },
  REPORT: { flag: 'isReportPublished', timestamp: 'reportAt' },
  EXPLAINABLE_AI: { flag: 'isExplainableAIPublished', timestamp: 'explainableAIAt' },
};

export const sectionsForPublicationType = (type) => {
  if (type === 'BOTH') return ['RANKING', 'MORNING_CALL'];
  if (type === 'ALL') return [...RESEARCH_SECTIONS];
  return RESEARCH_SECTIONS.includes(type) ? [type] : [];
};

export const hasSectionContent = (analysis, section) => {
  if (section === 'RANKING') return (analysis?.content?.ranking?.length || 0) > 0;
  if (section === 'MORNING_CALL') return !!String(analysis?.content?.morningCall || '').trim();
  if (section === 'REPORT') return !!analysis?.comparisonReport;
  if (section === 'EXPLAINABLE_AI') {
    return !!(
      String(analysis?.generatedExplainableAI || '').trim()
      || Object.values(analysis?.generatedExplainableAIByProfile || {})
        .some(value => String(value || '').trim())
    );
  }
  return false;
};

export const isSectionPublished = (analysis, section) => !!analysis?.[SECTION_META[section]?.flag];

/**
 * Seções que já têm conteúdo mas ainda não foram ao ar — a definição de
 * "pendente de publicação" para o painel admin. Uma narrativa gerada depois do
 * ranking publicado conta como pendente; uma seção vazia, não.
 */
export const pendingSectionsFor = (analysis) => (
  analysis
    ? RESEARCH_SECTIONS.filter(section => hasSectionContent(analysis, section) && !isSectionPublished(analysis, section))
    : []
);

export const prepareRankingForPublication = (analysis) => {
  const finalized = finalizeRanking(analysis?.content?.ranking || []);
  const validation = validateRankingContract(finalized);
  if (!validation.ok) {
    const error = new Error(`Ranking inválido: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_RANKING';
    throw error;
  }
  analysis.content.ranking = finalized;
};

export const composeActiveResearchReport = ({ pointers = [], documents = [] }) => {
  const byId = new Map(documents.map(document => [String(document._id), document]));
  const pointerBySection = new Map(pointers.map(pointer => [pointer.section, pointer]));
  const documentFor = section => byId.get(String(pointerBySection.get(section)?.analysis || ''));
  const rankingDoc = documentFor('RANKING');
  const morningDoc = documentFor('MORNING_CALL');
  const reportDoc = documentFor('REPORT');
  const aiDoc = documentFor('EXPLAINABLE_AI');
  const base = rankingDoc || morningDoc || reportDoc || aiDoc;
  if (!base) return null;

  const response = structuredClone(base);
  response.content = response.content || {};
  response.content.ranking = rankingDoc?.content?.ranking || [];
  response.content.morningCall = morningDoc?.content?.morningCall || '';
  response.comparisonReport = reportDoc?.comparisonReport || null;
  response.generatedExplainableAI = aiDoc?.generatedExplainableAI || '';
  response.generatedExplainableAIByProfile = aiDoc?.generatedExplainableAIByProfile || {};
  response.isRankingPublished = !!rankingDoc;
  response.isMorningCallPublished = !!morningDoc;
  response.isReportPublished = !!reportDoc;
  response.isExplainableAIPublished = !!aiDoc;
  response.activeSections = Object.fromEntries(pointers.map(pointer => [pointer.section, {
    analysisId: pointer.analysis,
    batchId: pointer.batch || null,
    activatedAt: pointer.activatedAt,
  }]));
  return response;
};

export const activateResearchSections = async ({
  analysis,
  sections,
  activatedBy = null,
  requireAll = true,
}) => {
  const requested = [...new Set(sections || [])].filter(section => RESEARCH_SECTIONS.includes(section));
  if (!requested.length) throw new Error('Nenhuma seção de publicação válida.');

  // Em modo parcial, um ranking vazio é uma seção a pular — não um contrato
  // violado. Validar só quando ele de fato vai ao ar evita derrubar a
  // publicação das demais seções por causa de uma seção ausente.
  if (requested.includes('RANKING') && (requireAll || hasSectionContent(analysis, 'RANKING'))) {
    prepareRankingForPublication(analysis);
  }
  const missing = requested.filter(section => !hasSectionContent(analysis, section));
  if (requireAll && missing.length) {
    const error = new Error(`Conteúdo ausente para: ${missing.join(', ')}`);
    error.code = 'SECTION_CONTENT_MISSING';
    throw error;
  }
  const activatable = requested.filter(section => !missing.includes(section));
  if (!activatable.length) return { activated: [], skipped: missing };

  const activatedAt = new Date();
  await runTransaction(async (session) => {
    for (const section of activatable) {
      const meta = SECTION_META[section];
      analysis[meta.flag] = true;
      analysis.publication = analysis.publication || {};
      analysis.publication[meta.timestamp] = activatedAt;
    }
    await analysis.save({ session });

    await PublishedResearchPointer.bulkWrite(activatable.map(section => ({
      updateOne: {
        filter: { assetClass: analysis.assetClass, strategy: analysis.strategy, section },
        update: {
          $set: {
            analysis: analysis._id,
            batch: analysis.batchId || null,
            activatedAt,
            activatedBy,
          },
        },
        upsert: true,
      },
    })), { session });
  });

  return { activated: activatable, skipped: missing, activatedAt };
};
