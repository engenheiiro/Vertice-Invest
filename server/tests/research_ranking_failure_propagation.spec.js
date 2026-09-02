import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMarketData: vi.fn(),
  systemConfigFindOne: vi.fn(),
  marketAnalysisCreate: vi.fn(),
  marketAnalysisFindOne: vi.fn(),
  researchBatchCreate: vi.fn(),
}));

vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getMarketData: mocks.getMarketData },
}));
vi.mock('../models/SystemConfig.js', () => ({
  default: { findOne: mocks.systemConfigFindOne },
}));
vi.mock('../models/MarketAnalysis.js', () => ({
  default: {
    create: mocks.marketAnalysisCreate,
    findOne: mocks.marketAnalysisFindOne,
  },
}));
vi.mock('../models/ResearchBatch.js', () => ({
  default: { create: mocks.researchBatchCreate },
}));
vi.mock('../models/DiscardLog.js', () => ({
  default: { insertMany: vi.fn() },
}));
vi.mock('../services/rankingTxtExportService.js', () => ({
  rankingTxtExportService: { saveRankingReport: vi.fn() },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { aiResearchService, RankingCalculationError } =
  await import('../services/aiResearchService.js');

const queryResult = (value) => ({
  sort: () => ({ select: () => Promise.resolve(value) }),
});

const rankingItem = {
  ticker: 'OK3',
  name: 'OK',
  type: 'STOCK',
  sector: 'Energia',
  score: 75,
  action: 'BUY',
  riskProfile: 'MODERATE',
  position: 1,
  metrics: { structural: { quality: 70, valuation: 70, risk: 70 } },
  scores: { DEFENSIVE: 70, MODERATE: 75, BOLD: 72 },
};

const makeBatch = () => ({
  _id: 'batch-1',
  completedClasses: [],
  failedClasses: [],
  warnings: [],
  failures: [],
  inputManifest: {},
  status: 'RUNNING',
  save: vi.fn().mockResolvedValue(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.systemConfigFindOne.mockResolvedValue(null);
  mocks.marketAnalysisFindOne.mockReturnValue(queryResult(null));
  mocks.marketAnalysisCreate.mockResolvedValue({ _id: 'analysis-1' });
});

describe('calculateRanking — vazio real versus falha', () => {
  it('devolve vazio identificado quando a fonte não tem ativos', async () => {
    mocks.getMarketData.mockResolvedValue([]);

    await expect(aiResearchService.calculateRanking('FII')).resolves.toMatchObject({
      ranking: [],
      emptyReason: 'NO_MARKET_DATA',
    });
  });

  it('propaga falha tipada em vez de convertê-la em ranking vazio', async () => {
    const sourceFailure = new Error('Mongo indisponível');
    mocks.getMarketData.mockRejectedValue(sourceFailure);

    await expect(aiResearchService.calculateRanking('FII')).rejects.toMatchObject({
      name: 'RankingCalculationError',
      code: 'RANKING_CALCULATION_FAILED',
      assetClass: 'FII',
      cause: sourceFailure,
    });
  });
});

describe('runBatchAnalysis — falha parcial', () => {
  it('não persiste ranking vazio nem conclui o batch quando uma classe lança erro', async () => {
    const batch = makeBatch();
    mocks.researchBatchCreate.mockResolvedValue(batch);

    const calculateSpy = vi.spyOn(aiResearchService, 'calculateRanking')
      .mockResolvedValueOnce({
        ranking: [rankingItem],
        fullList: [rankingItem],
        processedAssets: [rankingItem],
        discardLogs: [],
        retentionAudit: null,
      })
      .mockRejectedValueOnce(new RankingCalculationError('FII', new Error('falha parcial')));

    await expect(aiResearchService.runBatchAnalysis('admin-1')).rejects.toMatchObject({
      code: 'RANKING_CALCULATION_FAILED',
      assetClass: 'FII',
    });

    expect(mocks.marketAnalysisCreate).toHaveBeenCalledTimes(1);
    expect(mocks.marketAnalysisCreate.mock.calls[0][0].assetClass).toBe('STOCK');
    expect(batch.completedClasses).toEqual(['STOCK']);
    expect(batch.failedClasses).toEqual(['FII']);
    expect(batch.status).toBe('PARTIAL');
    expect(batch.failures).toContainEqual(expect.objectContaining({
      assetClass: 'FII',
      code: 'RANKING_CALCULATION_FAILED',
    }));
    expect(batch.status).not.toMatch(/^COMPLETED/);

    calculateSpy.mockRestore();
  });
});
