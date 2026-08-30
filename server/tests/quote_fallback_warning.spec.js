/**
 * O warn de cotação é do RESULTADO da cadeia de fontes, não da primeira tentativa.
 *
 * Regressão de 30/08/2026: o serviço avisava assim que o Yahoo falhava, antes de
 * tentar Google/Brapi. Como o fallback recuperava a maioria segundos depois, o
 * relatório do sync:prod abria com três avisos por run (EA/AVB/EQR, NGRD3, HSRE11)
 * que já estavam resolvidos na linha seguinte — ruído que empurrava o veredito para
 * "SUCESSO COM AVISOS" sem existir nada a fazer a respeito.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '../config/logger.js';
import { externalMarketService } from '../services/externalMarketService.js';

const yahoo = vi.hoisted(() => ({ quote: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
  default: class {
    quote(...args) { return yahoo.quote(...args); }
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/errorLogService.js', () => ({ recordIngestionError: vi.fn() }));

const warnsMatching = (re) => logger.warn.mock.calls.filter(([msg]) => re.test(msg));

beforeEach(() => {
  vi.clearAllMocks();
  // Yahoo responde, mas sem preço → o ticker entra na fila do fallback.
  yahoo.quote.mockResolvedValue([{ symbol: 'NGRD3.SA', regularMarketPrice: 0 }]);
});

describe('getQuotes — aviso só para o que nenhuma fonte recuperou', () => {
  it('fallback recuperou: nada de warn, só debug', async () => {
    const spy = vi.spyOn(externalMarketService, 'recoverQuote')
      .mockResolvedValue({ ticker: 'NGRD3', price: 34.28, change: 0, source: 'GOOGLE_FINANCE_FALLBACK' });

    const res = await externalMarketService.getQuotes(['NGRD3']);

    expect(res.some((r) => r.ticker === 'NGRD3' && r.price === 34.28)).toBe(true);
    expect(warnsMatching(/Sem cotação em nenhuma fonte/)).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Yahoo falhou'));
    spy.mockRestore();
  });

  it('nenhuma fonte recuperou: warn nomeando o ticker', async () => {
    const spy = vi.spyOn(externalMarketService, 'recoverQuote').mockResolvedValue(null);

    await externalMarketService.getQuotes(['NGRD3']);

    const warns = warnsMatching(/Sem cotação em nenhuma fonte/);
    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toContain('NGRD3');
    spy.mockRestore();
  });
});
