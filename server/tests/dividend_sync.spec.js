/**
 * Proventos — ingestão (financialService.syncDividends).
 * Garante que: busca por ticker e faz upsert em DividendEvent; conta só os
 * inseridos (upsertedCount); ignora cripto/renda fixa/caixa e tickers repetidos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/DividendEvent.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getDividendsHistory: vi.fn() },
}));
// Modelos não usados neste teste, mas importados pelo financialService:
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));

const DividendEvent = (await import('../models/DividendEvent.js')).default;
const { externalMarketService } = await import('../services/externalMarketService.js');
const { financialService } = await import('../services/financialService.js');

beforeEach(() => {
  vi.clearAllMocks();
  DividendEvent.updateOne.mockResolvedValue({ upsertedCount: 1 });
});

describe('financialService.syncDividends', () => {
  it('busca e faz upsert dos proventos, contando os novos', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([
      { date: new Date('2026-03-02'), amount: 0.10 },
      { date: new Date('2026-04-01'), amount: 0.095 },
    ]);

    const res = await financialService.syncDividends([{ ticker: 'mxrf11', type: 'FII' }]);

    expect(externalMarketService.getDividendsHistory).toHaveBeenCalledWith('mxrf11', 'FII');
    expect(DividendEvent.updateOne).toHaveBeenCalledTimes(2);
    // upsert filtra por ticker normalizado (uppercase) + date + amount
    const firstCall = DividendEvent.updateOne.mock.calls[0][0];
    expect(firstCall.ticker).toBe('MXRF11');
    expect(res).toEqual({ tickers: 1, events: 2 });
  });

  it('não conta evento já existente (upsertedCount 0)', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([{ date: new Date('2026-03-02'), amount: 0.10 }]);
    DividendEvent.updateOne.mockResolvedValue({ upsertedCount: 0 });

    const res = await financialService.syncDividends([{ ticker: 'MXRF11', type: 'FII' }]);
    expect(res).toEqual({ tickers: 1, events: 0 });
  });

  it('ignora cripto/renda fixa/caixa e tickers repetidos', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([]);

    const res = await financialService.syncDividends([
      { ticker: 'BTC', type: 'CRYPTO' },
      { ticker: 'TESOURO', type: 'FIXED_INCOME' },
      { ticker: 'PETR4', type: 'STOCK' },
      { ticker: 'PETR4', type: 'STOCK' }, // repetido
    ]);

    // só PETR4 (uma vez) chega ao fetch
    expect(externalMarketService.getDividendsHistory).toHaveBeenCalledTimes(1);
    expect(externalMarketService.getDividendsHistory).toHaveBeenCalledWith('PETR4', 'STOCK');
    expect(res.tickers).toBe(1);
  });

  it('lista vazia retorna zero sem buscar nada', async () => {
    const res = await financialService.syncDividends([]);
    expect(externalMarketService.getDividendsHistory).not.toHaveBeenCalled();
    expect(res).toEqual({ tickers: 0, events: 0 });
  });
});
