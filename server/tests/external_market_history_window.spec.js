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

  // 04/09/2026: durante o pregão, o Yahoo entregou o candle VIVO do dia junto
  // com a série pedida até 03/09. As 17 séries da carteira ficaram com o preço
  // das 10:25 gravado como fechamento de 04/09 — e `loadClosesForDay` lê candle
  // existente como fechamento, então aquilo viraria patrimônio às 23:59.
  it('descarta o candle em andamento que o Yahoo devolve além da janela', async () => {
    vi.setSystemTime(new Date('2026-09-04T14:25:00.000Z')); // 11:25 BRT, pregão aberto
    chartMock.mockResolvedValue({
      quotes: [
        { date: new Date('2026-09-02T13:00:00.000Z'), close: 182.27, volume: 10 },
        { date: new Date('2026-09-03T13:00:00.000Z'), close: null, volume: 0 },
        { date: new Date('2026-09-04T13:00:00.000Z'), close: 181.51, volume: 5 },
      ],
    });

    const payload = await externalMarketService.getFullHistoryDetailed('BOVA11', 'ETF', '2026-09-03');

    expect(payload.candles.map((c) => c.date)).toEqual(['2026-09-02']);
    expect(payload.emptyDates).toEqual(['2026-09-03']);
  });

  it('mantém o candle do próprio dia pedido (snapshot das 23:59)', async () => {
    vi.setSystemTime(new Date('2026-09-05T02:59:00.000Z')); // 23:59 BRT de 04/09
    chartMock.mockResolvedValue({
      quotes: [{ date: new Date('2026-09-04T13:00:00.000Z'), close: 181.02, volume: 5 }],
    });

    const payload = await externalMarketService.getFullHistoryDetailed('BOVA11', 'ETF', '2026-09-04');

    expect(payload.candles.at(-1)).toMatchObject({ date: '2026-09-04', close: 181.02 });
  });
});
