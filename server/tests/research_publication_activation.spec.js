import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bulkWrite: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('../models/PublishedResearchPointer.js', () => ({
  default: { bulkWrite: mocks.bulkWrite },
}));

vi.mock('../utils/dbTransaction.js', () => ({
  runTransaction: mocks.runTransaction,
}));

const { activateResearchSections } = await import('../services/researchPublicationService.js');

describe('ativação transacional de publicação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async callback => callback('session-test'));
    mocks.bulkWrite.mockResolvedValue({ ok: 1 });
  });

  it('ativa somente as seções solicitadas e vincula o ponteiro ao lote', async () => {
    const analysis = {
      _id: 'analysis-1',
      batchId: 'batch-1',
      assetClass: 'STOCK',
      strategy: 'BUY_HOLD',
      content: {
        ranking: [{ ticker: 'AAA3', score: 80, action: 'WAIT', riskProfile: 'DEFENSIVE' }],
        morningCall: 'Resumo da manhã.',
      },
      save: vi.fn().mockResolvedValue(undefined),
    };

    const result = await activateResearchSections({
      analysis,
      sections: ['RANKING'],
      activatedBy: 'admin-1',
    });

    expect(result.activated).toEqual(['RANKING']);
    expect(analysis.content.ranking[0]).toMatchObject({ action: 'BUY', position: 1 });
    expect(analysis.isRankingPublished).toBe(true);
    expect(analysis.isMorningCallPublished).toBeUndefined();
    expect(analysis.save).toHaveBeenCalledWith({ session: 'session-test' });
    expect(mocks.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { assetClass: 'STOCK', strategy: 'BUY_HOLD', section: 'RANKING' },
          update: { $set: expect.objectContaining({ analysis: 'analysis-1', batch: 'batch-1', activatedBy: 'admin-1' }) },
          upsert: true,
        }),
      }),
    ], { session: 'session-test' });
  });

  it('rejeita atomicamente uma seção solicitada sem conteúdo', async () => {
    const analysis = {
      _id: 'analysis-2',
      assetClass: 'FII',
      strategy: 'BUY_HOLD',
      content: { ranking: [{ ticker: 'FII11', score: 75, riskProfile: 'DEFENSIVE' }], morningCall: '' },
      save: vi.fn(),
    };

    await expect(activateResearchSections({
      analysis,
      sections: ['RANKING', 'MORNING_CALL'],
    })).rejects.toMatchObject({ code: 'SECTION_CONTENT_MISSING' });

    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(analysis.save).not.toHaveBeenCalled();
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });
});

/**
 * Publicação parcial (jul/2026). "Publicar Tudo Pendente" manda `type: ALL`, que
 * exige as 4 seções. Como Morning Call e Explainable IA raramente estão prontos
 * no draft novo, o tudo-ou-nada derrubava a classe inteira e nem o ranking ia ao
 * ar. Com `requireAll: false` o que está pronto é publicado e o resto volta em
 * `skipped`.
 */
describe('ativação parcial (requireAll: false)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async callback => callback('session-test'));
    mocks.bulkWrite.mockResolvedValue({ ok: 1 });
  });

  const allSections = ['RANKING', 'MORNING_CALL', 'REPORT', 'EXPLAINABLE_AI'];

  it('publica as seções com conteúdo e pula as vazias', async () => {
    const analysis = {
      _id: 'analysis-3',
      assetClass: 'STOCK',
      strategy: 'BUY_HOLD',
      content: {
        ranking: [{ ticker: 'AAA3', score: 80, action: 'WAIT', riskProfile: 'DEFENSIVE' }],
        morningCall: '',
      },
      comparisonReport: { summary: 'Comparativo semanal.' },
      generatedExplainableAI: '',
      save: vi.fn().mockResolvedValue(undefined),
    };

    const result = await activateResearchSections({
      analysis,
      sections: allSections,
      requireAll: false,
    });

    expect(result.activated).toEqual(['RANKING', 'REPORT']);
    expect(result.skipped).toEqual(['MORNING_CALL', 'EXPLAINABLE_AI']);
    expect(analysis.isRankingPublished).toBe(true);
    expect(analysis.isReportPublished).toBe(true);
    // Seção pulada não pode ganhar flag de publicada.
    expect(analysis.isMorningCallPublished).toBeUndefined();
    expect(analysis.isExplainableAIPublished).toBeUndefined();
    expect(mocks.bulkWrite).toHaveBeenCalledTimes(1);
    expect(mocks.bulkWrite.mock.calls[0][0]).toHaveLength(2);
  });

  it('ranking vazio é seção pulada, não contrato violado', async () => {
    const analysis = {
      _id: 'analysis-4',
      assetClass: 'ETF',
      strategy: 'BUY_HOLD',
      content: { ranking: [], morningCall: 'Resumo da manhã.' },
      save: vi.fn().mockResolvedValue(undefined),
    };

    const result = await activateResearchSections({
      analysis,
      sections: allSections,
      requireAll: false,
    });

    expect(result.activated).toEqual(['MORNING_CALL']);
    expect(result.skipped).toContain('RANKING');
    expect(analysis.isRankingPublished).toBeUndefined();
  });

  it('sem nenhuma seção com conteúdo não escreve nada', async () => {
    const analysis = {
      _id: 'analysis-5',
      assetClass: 'REIT',
      strategy: 'BUY_HOLD',
      content: { ranking: [], morningCall: '' },
      save: vi.fn(),
    };

    const result = await activateResearchSections({
      analysis,
      sections: allSections,
      requireAll: false,
    });

    expect(result.activated).toEqual([]);
    expect(result.skipped).toEqual(allSections);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(analysis.save).not.toHaveBeenCalled();
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });

  // O modo estrito é o default e continua tudo-ou-nada — os botões granulares
  // e o auto-publish dependem disso.
  it('modo estrito continua rejeitando seção vazia', async () => {
    const analysis = {
      _id: 'analysis-6',
      assetClass: 'CRYPTO',
      strategy: 'BUY_HOLD',
      content: { ranking: [{ ticker: 'BTC', score: 70, riskProfile: 'BOLD' }], morningCall: '' },
      save: vi.fn(),
    };

    await expect(activateResearchSections({
      analysis,
      sections: allSections,
    })).rejects.toMatchObject({ code: 'SECTION_CONTENT_MISSING' });
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });
});
