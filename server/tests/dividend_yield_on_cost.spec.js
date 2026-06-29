/**
 * Proventos — Yield on Cost por ativo (financialService.calculateUserDividends).
 * Garante que: YoC usa só dados já existentes (DividendEvent + UserAsset.totalCost),
 * ignora provisionados/eventos fora da janela de 12 meses, e nunca produz
 * Infinity/NaN quando o custo investido é zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../models/UserAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../models/AssetTransaction.js', () => ({ default: { aggregate: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getDividendsHistory: vi.fn() } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));

const UserAsset = (await import('../models/UserAsset.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const DividendEvent = (await import('../models/DividendEvent.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const { financialService } = await import('../services/financialService.js');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const setupMocks = ({ assets, events, firstBuyDaysAgo = 3650 }) => {
  UserAsset.find.mockResolvedValue(assets);
  MarketAsset.find.mockReturnValue({ select: vi.fn().mockResolvedValue([]) });
  DividendEvent.find.mockReturnValue({ sort: vi.fn().mockResolvedValue(events) });
  AssetTransaction.aggregate.mockResolvedValue(
    assets.map((a) => ({ _id: a.ticker, firstBuyDate: daysAgo(firstBuyDaysAgo) })),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('financialService.calculateUserDividends — Yield on Cost', () => {
  it('calcula yocPercent ≈ 8 para R$80 recebidos em 12m sobre custo de R$1000', async () => {
    setupMocks({
      assets: [{ ticker: 'TAEE11', type: 'STOCK', quantity: 100, totalCost: 1000 }],
      events: [{ ticker: 'TAEE11', date: daysAgo(60), amount: 0.8, paymentDate: daysAgo(45) }],
    });

    const result = await financialService.calculateUserDividends('507f1f77bcf86cd799439011');

    expect(result.yieldOnCost).toEqual([
      { ticker: 'TAEE11', receivedLast12Months: 80, totalCost: 1000, yocPercent: 8 },
    ]);
  });

  it('totalCost zero não gera Infinity/NaN', async () => {
    setupMocks({
      assets: [{ ticker: 'TAEE11', type: 'STOCK', quantity: 100, totalCost: 0 }],
      events: [{ ticker: 'TAEE11', date: daysAgo(60), amount: 0.8, paymentDate: daysAgo(45) }],
    });

    const result = await financialService.calculateUserDividends('507f1f77bcf86cd799439011');

    expect(result.yieldOnCost).toEqual([
      { ticker: 'TAEE11', receivedLast12Months: 80, totalCost: 0, yocPercent: 0 },
    ]);
  });

  it('evento fora da janela de 12 meses não entra no YoC, mas conta em totalAllTime', async () => {
    setupMocks({
      assets: [{ ticker: 'TAEE11', type: 'STOCK', quantity: 100, totalCost: 1000 }],
      events: [{ ticker: 'TAEE11', date: daysAgo(500), amount: 0.8, paymentDate: daysAgo(485) }],
    });

    const result = await financialService.calculateUserDividends('507f1f77bcf86cd799439011');

    expect(result.yieldOnCost).toEqual([]);
    expect(result.totalAllTime).toBe(80);
  });

  it('ordena múltiplos ativos por yocPercent descendente', async () => {
    setupMocks({
      assets: [
        { ticker: 'AAA11', type: 'FII', quantity: 100, totalCost: 1000 },
        { ticker: 'BBB11', type: 'FII', quantity: 100, totalCost: 1000 },
      ],
      events: [
        { ticker: 'AAA11', date: daysAgo(60), amount: 0.5, paymentDate: daysAgo(45) },
        { ticker: 'BBB11', date: daysAgo(60), amount: 1.5, paymentDate: daysAgo(45) },
      ],
    });

    const result = await financialService.calculateUserDividends('507f1f77bcf86cd799439011');

    expect(result.yieldOnCost.map((i) => i.ticker)).toEqual(['BBB11', 'AAA11']);
  });

  it('NÃO dobra a soma quando o mesmo provento volta de 2 fontes (hora e valor diferentes)', async () => {
    // Caso real MXRF11: mesma ex-date de duas fontes, hora distinta (00:00Z vs
    // 13:00Z) e valor levemente diferente (0.109829 vs 0.109744). A identidade
    // canônica ignora o valor → conta UMA vez (200 × ~0,1098 ≈ R$21,9, não R$43,9).
    const exMidnight = new Date('2025-03-15T00:00:00.000Z');
    const exWithTime = new Date('2025-03-15T13:00:00.000Z');
    setupMocks({
      assets: [{ ticker: 'MXRF11', type: 'FII', quantity: 200, totalCost: 2036 }],
      events: [
        { ticker: 'MXRF11', date: exMidnight, amount: 0.109744, type: 'DIVIDEND', paymentDate: daysAgo(40) },
        { ticker: 'MXRF11', date: exWithTime, amount: 0.109829, type: 'DIVIDEND', paymentDate: daysAgo(40) },
      ],
    });

    const result = await financialService.calculateUserDividends('507f1f77bcf86cd799439011');

    // Conta só um evento do par (~R$21,9), nunca os dois (~R$43,9).
    expect(result.totalAllTime).toBeGreaterThan(20);
    expect(result.totalAllTime).toBeLessThan(25);
  });

  it('sem holdings pagadores retorna yieldOnCost vazio', async () => {
    UserAsset.find.mockResolvedValue([]);

    const result = await financialService.calculateUserDividends('507f1f77bcf86cd799439011');

    expect(result).toEqual({ dividendMap: new Map(), provisioned: [], totalAllTime: 0, projectedMonthly: 0, yieldOnCost: [], receivedByTicker: {} });
  });
});
