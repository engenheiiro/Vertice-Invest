import { describe, expect, it } from 'vitest';
import {
  composeActiveResearchReport,
  hasSectionContent,
  pendingSectionsFor,
  prepareRankingForPublication,
  sectionsForPublicationType,
} from '../services/researchPublicationService.js';

const rankingItem = { ticker: 'AAA3', score: 80, action: 'WAIT', riskProfile: 'DEFENSIVE' };

describe('contrato de publicação por seção', () => {
  it('mapeia tipos sem ativar seção desconhecida', () => {
    expect(sectionsForPublicationType('RANKING')).toEqual(['RANKING']);
    expect(sectionsForPublicationType('BOTH')).toEqual(['RANKING', 'MORNING_CALL']);
    expect(sectionsForPublicationType('INVALID')).toEqual([]);
  });

  it('seção vazia não é publicável', () => {
    const analysis = { content: { ranking: [], morningCall: '' }, generatedExplainableAI: '' };
    expect(hasSectionContent(analysis, 'RANKING')).toBe(false);
    expect(hasSectionContent(analysis, 'MORNING_CALL')).toBe(false);
    expect(hasSectionContent(analysis, 'REPORT')).toBe(false);
    expect(hasSectionContent(analysis, 'EXPLAINABLE_AI')).toBe(false);
  });

  it('finaliza ranking antes da ativação', () => {
    const analysis = { content: { ranking: [rankingItem] } };
    prepareRankingForPublication(analysis);
    expect(analysis.content.ranking[0]).toMatchObject({ action: 'BUY', position: 1 });
  });

  /**
   * `readyToPublish` era só `!isRankingPublished`. Depois da publicação parcial
   * isso escondia o trabalho restante: com o ranking no ar, uma narrativa gerada
   * em seguida nunca acendia o botão de publicação em massa.
   */
  describe('seções pendentes de publicação', () => {
    it('conta seção com conteúdo ainda não publicada, mesmo com ranking no ar', () => {
      const analysis = {
        content: { ranking: [rankingItem], morningCall: '' },
        generatedExplainableAI: 'Tese qualitativa.',
        isRankingPublished: true,
        isExplainableAIPublished: false,
      };
      expect(pendingSectionsFor(analysis)).toEqual(['EXPLAINABLE_AI']);
    });

    it('não conta seção vazia nem seção já publicada', () => {
      const analysis = {
        content: { ranking: [rankingItem], morningCall: '' },
        comparisonReport: { summary: 'x' },
        isRankingPublished: true,
        isReportPublished: true,
      };
      expect(pendingSectionsFor(analysis)).toEqual([]);
    });

    it('draft novo tem todas as seções com conteúdo pendentes', () => {
      const analysis = {
        content: { ranking: [rankingItem], morningCall: 'Resumo.' },
        generatedExplainableAI: 'Tese.',
      };
      expect(pendingSectionsFor(analysis)).toEqual(['RANKING', 'MORNING_CALL', 'EXPLAINABLE_AI']);
    });

    it('sem análise não há nada pendente', () => {
      expect(pendingSectionsFor(null)).toEqual([]);
    });
  });

  it('compõe seções ativas de revisões e lotes independentes', () => {
    const pointers = [
      { section: 'RANKING', analysis: 'ranking-doc', batch: 'batch-new' },
      { section: 'EXPLAINABLE_AI', analysis: 'ai-doc', batch: 'batch-old' },
    ];
    const documents = [
      { _id: 'ranking-doc', content: { ranking: [rankingItem], morningCall: 'não expor' } },
      { _id: 'ai-doc', content: { ranking: [] }, generatedExplainableAI: 'Risco qualitativo.' },
    ];

    const report = composeActiveResearchReport({ pointers, documents });

    expect(report.content.ranking).toEqual([rankingItem]);
    expect(report.content.morningCall).toBe('');
    expect(report.generatedExplainableAI).toBe('Risco qualitativo.');
    expect(report.isRankingPublished).toBe(true);
    expect(report.isMorningCallPublished).toBe(false);
    expect(report.activeSections.RANKING.batchId).toBe('batch-new');
    expect(report.activeSections.EXPLAINABLE_AI.batchId).toBe('batch-old');
  });
});
