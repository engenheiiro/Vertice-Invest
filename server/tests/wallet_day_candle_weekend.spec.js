/**
 * Candle do dia em fim de semana (regra 13).
 *
 * A fonte às vezes devolve, para ativo que só negocia em dia útil, uma barra
 * datada no sábado/domingo repetindo o último preço. A mescla já a recusava
 * (`isStorableCandleDate`), mas o caminho do snapshot a devolvia como
 * fechamento do dia e contava `fetched`: o snapshot usava um close que nunca foi
 * gravado, e sem série guardada o upsert gravava `history: []`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  updateOne: vi.fn(),
  getFullHistoryDetailed: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../models/AssetHistory.js', () => ({
  default: { find: mocks.find, updateOne: mocks.updateOne, aggregate: vi.fn() },
}));
vi.mock('../services/b3DailyFileService.js', () => ({ fetchB3DailyCloses: vi.fn(async () => null) }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistoryDetailed: mocks.getFullHistoryDetailed },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: mocks.loggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ensureWalletDayCandles } = await import('../services/walletDayCandleService.js');

const SABADO = '2026-09-05';
const fetchedDoLog = () => mocks.loggerInfo.mock.calls
  .find(([msg]) => String(msg).includes('Candles do dia garantidos'))?.[1]?.fetched;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-06T02:59:00.000Z')); // 23:59 de sábado em Brasília
  vi.clearAllMocks();
  mocks.find.mockReturnValue({ lean: async () => [] });
  mocks.updateOne.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ensureWalletDayCandles — candle de fim de semana', () => {
  it('candle de sábado de STOCK_US não vira fechamento do dia nem grava history vazio (era devolvido e contado em fetched)', async () => {
    mocks.getFullHistoryDetailed.mockResolvedValue({
      candles: [{ date: SABADO, close: 230.1, adjClose: 230.1, volume: 0 }],
      emptyDates: [],
    });

    const resolved = await ensureWalletDayCandles([{ ticker: 'AAPL', type: 'STOCK_US', quantity: 1 }], SABADO);

    expect(resolved.size).toBe(0);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(fetchedDoLog()).toBe(0);
  });

  it('candle de sábado de CRYPTO continua valendo (cripto negocia no fim de semana)', async () => {
    mocks.getFullHistoryDetailed.mockResolvedValue({
      candles: [{ date: SABADO, close: 60000, adjClose: 60000, volume: 5 }],
      emptyDates: [],
    });

    const resolved = await ensureWalletDayCandles([{ ticker: 'BTC', type: 'CRYPTO', quantity: 1 }], SABADO);

    expect([...resolved.values()]).toEqual([60000]);
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    expect(fetchedDoLog()).toBe(1);
  });
});
