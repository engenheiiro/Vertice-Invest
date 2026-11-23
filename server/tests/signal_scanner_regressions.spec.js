/**
 * Defeitos da varredura do Radar Alpha (`signalEngine.runScanner`).
 *
 * 1) A divergência altista validava a correlação macro como se fosse
 *    `'RSI_OVERSOLD'` — o único tipo isento do veto de dia de crash — e por isso
 *    saía sinal de compra por divergência no meio do pânico.
 * 2) `roe` gravado em texto passava em `> 0` e quebrava no `toFixed` da mensagem
 *    do Deep Value: o ativo caía no catch e saía da varredura inteira.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assets: [],
  histories: [],
  bulkWrite: vi.fn(),
  metaUpdate: vi.fn(),
  quotes: [],
}));

const lean = (rows) => ({ lean: async () => rows, select: () => ({ lean: async () => [] }) });

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getQuotes: async () => mocks.quotes },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: () => lean(mocks.assets) } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: () => lean(mocks.histories) } }));
vi.mock('../models/QuantSignal.js', () => ({
  default: {
    find: () => lean([]),
    bulkWrite: mocks.bulkWrite,
    updateMany: vi.fn(),
    countDocuments: async () => 0,
  },
}));
vi.mock('../models/SystemConfig.js', () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: mocks.metaUpdate },
}));

const { signalEngine } = await import('../services/engines/signalEngine.js');

// 20 pregões sem volume (o filtro de volume degrada para "confirmado").
const history = (ticker) => ({
  ticker,
  history: Array.from({ length: 20 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
    close: 10 + (i % 3),
  })),
});

const upsertedTypes = () => (mocks.bulkWrite.mock.calls[0]?.[0] || []).map((op) => op.updateOne.filter.type);
const meta = () => mocks.metaUpdate.mock.calls[0]?.[1]?.$set?.value;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.bulkWrite.mockReset().mockResolvedValue({});
  mocks.metaUpdate.mockReset().mockResolvedValue({});
  mocks.quotes = [];
});

describe('runScanner — divergência no dia de crash', () => {
  it('divergência altista é vetada no dia de crash do Ibovespa (era validada como RSI_OVERSOLD e escapava do veto)', async () => {
    mocks.quotes = [{ ticker: '^BVSP', change: -3.1 }];
    mocks.assets = [{ ticker: 'WEGE3', type: 'STOCK', netMargin: 12, lastPrice: 11 }];
    mocks.histories = [history('WEGE3')];
    vi.spyOn(signalEngine, 'calculateRSI').mockReturnValue(50);
    vi.spyOn(signalEngine, 'detectBullishDivergence')
      .mockReturnValue({ rsiAtLow: 32, priorRsiLow: 25, priceLow: 9, priorPriceLow: 10, barsBetween: 5 });

    const out = await signalEngine.runScanner();

    expect(upsertedTypes()).not.toContain('BULLISH_DIVERGENCE');
    expect(out.blocked).toBe(1);
  });

  it('fora do dia de crash a mesma divergência continua emitindo sinal', async () => {
    mocks.quotes = [{ ticker: '^BVSP', change: -0.4 }];
    mocks.assets = [{ ticker: 'WEGE3', type: 'STOCK', netMargin: 12, lastPrice: 11 }];
    mocks.histories = [history('WEGE3')];
    vi.spyOn(signalEngine, 'calculateRSI').mockReturnValue(50);
    vi.spyOn(signalEngine, 'detectBullishDivergence')
      .mockReturnValue({ rsiAtLow: 32, priorRsiLow: 25, priceLow: 9, priorPriceLow: 10, barsBetween: 5 });

    await signalEngine.runScanner();

    expect(upsertedTypes()).toEqual(['BULLISH_DIVERGENCE']);
  });
});

describe('runScanner — roe em texto', () => {
  const deepValueAsset = (roe) => ({ ticker: 'ITSA4', type: 'STOCK', netMargin: 20, lastPrice: 10, pl: 2, p_vp: 0.5, roe });

  it('roe em texto numérico gera o Deep Value e o ativo segue varrido (era TypeError no toFixed e o ativo caía no catch)', async () => {
    mocks.assets = [deepValueAsset('15.5')];
    mocks.histories = [history('ITSA4')];
    vi.spyOn(signalEngine, 'calculateRSI').mockReturnValue(50);
    vi.spyOn(signalEngine, 'detectBullishDivergence').mockReturnValue(null);

    await signalEngine.runScanner();

    expect(upsertedTypes()).toEqual(['DEEP_VALUE']);
    expect(mocks.bulkWrite.mock.calls[0][0][0].updateOne.update.$set.message).toContain('ROE: 15.5%');
    expect(meta().assetsWithHistory).toBe(1);
  });

  it('roe em texto não numérico é tratado como ausente: sem Deep Value, ativo segue varrido', async () => {
    mocks.assets = [deepValueAsset('n/d')];
    mocks.histories = [history('ITSA4')];
    vi.spyOn(signalEngine, 'calculateRSI').mockReturnValue(50);
    vi.spyOn(signalEngine, 'detectBullishDivergence').mockReturnValue(null);

    await signalEngine.runScanner();

    expect(mocks.bulkWrite).not.toHaveBeenCalled();
    expect(meta().assetsWithHistory).toBe(1);
  });
});
