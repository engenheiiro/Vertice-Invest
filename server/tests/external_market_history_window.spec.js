/**
 * Histórico Yahoo — `period2` é exclusivo.
 *
 * A regressão real aparecia às 18:30: pedir period2=hoje fazia a série terminar
 * ontem, e a garantia do snapshot dependia do acaso de o servidor já estar no
 * dia seguinte em UTC às 23:59 BRT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { chartMock } = vi.hoisted(() => ({ chartMock: vi.fn() }));

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('yahoo-finance2', () => ({
  default: class {
    chart(...args) { return chartMock(...args); }
  },
}));

let externalMarketService;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-31T21:30:00.000Z')); // 18:30 BRT
  chartMock.mockReset();
  vi.resetModules();
  ({ externalMarketService } = await import('../services/externalMarketService.js'));
});

afterEach(() => vi.useRealTimers());

describe('externalMarketService.getFullHistoryDetailed — janela inclusiva', () => {
  it('avança period2 para incluir o candle de hoje no worker pós-mercado', async () => {
    chartMock.mockResolvedValue({
      quotes: [{
        date: new Date('2026-08-31T19:00:00.000Z'),
        close: 174.78,
        adjclose: 174.78,
        volume: 100,
      }],
    });

    const payload = await externalMarketService.getFullHistoryDetailed('BOVA11', 'ETF');

    expect(chartMock).toHaveBeenCalledWith(
      'BOVA11.SA',
      expect.objectContaining({ period1: '2020-01-01', period2: '2026-09-01', interval: '1d' }),
      { validateResult: false },
    );
    expect(payload.candles.at(-1)).toMatchObject({ date: '2026-08-31', close: 174.78 });
  });

  it('usa o dia pedido pelo snapshot, não a data UTC do processo', async () => {
    vi.setSystemTime(new Date('2026-09-02T02:59:00.000Z'));
    chartMock.mockResolvedValue({ quotes: [] });

    await externalMarketService.getFullHistoryDetailed('IVVB11', 'ETF', '2026-08-31');

    expect(chartMock.mock.calls[0][1].period2).toBe('2026-09-01');
  });

  it('avança corretamente a data exclusiva na virada de ano', async () => {
    chartMock.mockResolvedValue({ quotes: [] });

    await externalMarketService.getFullHistoryDetailed('PETR4', 'STOCK', '2026-12-31');

    expect(chartMock.mock.calls[0][1].period2).toBe('2027-01-01');
  });
});
