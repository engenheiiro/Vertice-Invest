import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBenchmarkHistory: vi.fn(),
  getFullHistory: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock('../models/AssetHistory.js', () => ({ default: { updateOne: mocks.updateOne } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { findOne: mocks.findOne } }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: { getBenchmarkHistory: mocks.getBenchmarkHistory } }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getFullHistory: mocks.getFullHistory } }));
vi.mock('../config/logger.js', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }));

const { hasNoPriceSeries, loadTickerHistory } = await import('../services/priceCacheLoader.js');

// Dias úteis consecutivos a partir de uma segunda-feira.
const candles = (start, n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i + 2 * Math.floor(i / 5));
  return { date: d.toISOString().slice(0, 10), close: 10 + i };
});

describe('priceCacheLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOne.mockResolvedValue(null);
  });

  it('renda fixa, caixa e RESERVA não têm série de preço', () => {
    expect(hasNoPriceSeries('CDB', { type: 'FIXED_INCOME' })).toBe(true);
    expect(hasNoPriceSeries('X', { type: 'CASH' })).toBe(true);
    expect(hasNoPriceSeries('RESERVA', undefined)).toBe(true);
    expect(hasNoPriceSeries('PETR4', { type: 'STOCK' })).toBe(false);
  });

  it('série local que cobre a posição não consulta a fonte externa', async () => {
    const local = candles('2025-01-06', 10);
    mocks.getBenchmarkHistory.mockResolvedValue(local);
    const h = await loadTickerHistory('PETR4', { assetMeta: { type: 'STOCK' }, requiredFrom: '2025-01-06', searchTicker: 'PETR4.SA' });
    expect(h).toBe(local);
    expect(mocks.getFullHistory).not.toHaveBeenCalled();
  });

  it('sem série utilizável, grava a externa e a devolve', async () => {
    const ext = candles('2024-01-01', 8);
    mocks.getBenchmarkHistory.mockResolvedValue([]);
    mocks.getFullHistory.mockResolvedValue(ext);
    const h = await loadTickerHistory('PETR4', { assetMeta: { type: 'STOCK' }, requiredFrom: null, searchTicker: 'PETR4.SA' });
    expect(h).toEqual(ext);
    expect(mocks.updateOne).toHaveBeenCalledWith({ ticker: 'PETR4' }, expect.objectContaining({ history: ext }), { upsert: true });
  });

  it('falha da fonte externa mantém a série local', async () => {
    const local = candles('2025-01-06', 3);
    mocks.getBenchmarkHistory.mockResolvedValue(local);
    mocks.getFullHistory.mockRejectedValue(new Error('fora do ar'));
    const h = await loadTickerHistory('PETR4', { assetMeta: undefined, requiredFrom: null, searchTicker: 'PETR4.SA' });
    expect(h).toBe(local);
  });
});
