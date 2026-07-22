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
