/**
 * Proventos — resiliência da ingestão (externalMarketService.getDividendsHistory).
 * Garante que: re-tenta falhas transitórias do Yahoo, desiste de tickers
 * delistados sem re-tentar, e abre o circuito após falhas consecutivas (sem
 * martelar o provedor já caído).
 *
 * Cada teste reimporta o módulo (vi.resetModules) para começar com um circuit
 * breaker zerado — ele é um singleton de módulo, sem isso o estado vazaria
 * entre testes (um teste anterior poderia abrir o circuito para o seguinte).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
let logger;

beforeEach(async () => {
  chartMock.mockReset();
  vi.resetModules();
  ({ externalMarketService } = await import('../services/externalMarketService.js'));
  logger = (await import('../config/logger.js')).default;
});

describe('externalMarketService.getDividendsHistory — resiliência', () => {
  it('Yahoo responde normalmente → retorna os proventos', async () => {
    chartMock.mockResolvedValue({
      events: { dividends: [{ date: '2026-03-02', amount: 0.1 }] },
    });

    const result = await externalMarketService.getDividendsHistory('TAEE11', 'STOCK');

    expect(chartMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ date: new Date('2026-03-02'), amount: 0.1 }]);
  });

  it('falha transitória 1x, sucesso na 2ª tentativa → retorna dados sem warn', async () => {
    chartMock
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ events: { dividends: [{ date: '2026-03-02', amount: 0.1 }] } });

    const result = await externalMarketService.getDividendsHistory('TAEE11', 'STOCK');

    expect(chartMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falha em todas as tentativas → retorna [] e loga warn uma única vez', async () => {
    chartMock.mockRejectedValue(new Error('fetch failed'));

    const result = await externalMarketService.getDividendsHistory('TAEE11', 'STOCK');

    expect(result).toEqual([]);
    expect(chartMock).toHaveBeenCalledTimes(3); // 1 tentativa + 2 retries
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('ticker delistado → não re-tenta, falha direto na 1ª tentativa', async () => {
    chartMock.mockRejectedValue(new Error('No data found, symbol may be delisted'));

    const result = await externalMarketService.getDividendsHistory('XXXX99', 'STOCK');

    expect(chartMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('circuito aberto após falhas consecutivas → próxima chamada fast-fail sem nova tentativa de rede', async () => {
    chartMock.mockRejectedValue(new Error('fetch failed'));

    // failureThreshold do breaker é 4 — 4 chamadas (cada uma = 1 falha do
    // ponto de vista do breaker, que envolve o retry inteiro) abrem o circuito.
    for (let i = 0; i < 4; i++) {
      await externalMarketService.getDividendsHistory('TAEE11', 'STOCK');
    }
    chartMock.mockClear();

    const result = await externalMarketService.getDividendsHistory('TAEE11', 'STOCK');

    expect(result).toEqual([]);
    expect(chartMock).not.toHaveBeenCalled();
  });

  it('CRYPTO/FIXED_INCOME/CASH não chamam o Yahoo', async () => {
    const result = await externalMarketService.getDividendsHistory('BTC', 'CRYPTO');
    expect(result).toEqual([]);
    expect(chartMock).not.toHaveBeenCalled();
  });
});
