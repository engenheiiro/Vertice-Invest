import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { marketService } from './market';
import { authService } from './auth';

/**
 * Cotação para o formulário de lançamento: falha de preço nunca trava a UI
 * (null → preenchimento manual); o status do cache é ferramenta de Admin e
 * precisa distinguir erro de vazio.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
});

afterEach(() => vi.restoreAllMocks());

describe('marketService', () => {
  it('preço histórico monta ticker/data/tipo na query', async () => {
    apiSpy.mockImplementation(async () => json({ price: 31.2, foundDate: '2026-11-19' }));
    await expect(marketService.getHistoricalPrice('PETR4', '2026-11-20', 'STOCK')).resolves.toEqual({ price: 31.2, foundDate: '2026-11-19' });
    expect(apiSpy.mock.calls[0][0]).toBe('/api/market/price?ticker=PETR4&date=2026-11-20&type=STOCK');
  });

  it('sem preço (404) ou cotação indisponível devolvem null, não exceção', async () => {
    apiSpy.mockImplementation(async () => json({ message: 'not found' }, 404));
    await expect(marketService.getHistoricalPrice('XPTO3', '2026-01-02', 'STOCK')).resolves.toBeNull();
    await expect(marketService.getCurrentQuote('XPTO3')).resolves.toBeNull();
  });

  it('cotação ao vivo usa o ticker informado', async () => {
    apiSpy.mockImplementation(async () => json({ price: 10, name: 'Vale' }));
    await expect(marketService.getCurrentQuote('VALE3')).resolves.toEqual({ price: 10, name: 'Vale' });
    expect(apiSpy.mock.calls[0][0]).toBe('/api/market/quote?ticker=VALE3');
  });

  it('status do cache rejeita na falha', async () => {
    apiSpy.mockImplementationOnce(async () => json({ candles: 300 }));
    await expect(marketService.getAssetCacheStatus('ITUB4')).resolves.toEqual({ candles: 300 });
    expect(apiSpy.mock.calls[0][0]).toBe('/api/market/status/ITUB4');
    apiSpy.mockImplementationOnce(async () => json({}, 500));
    await expect(marketService.getAssetCacheStatus('ITUB4')).rejects.toThrow('Erro ao consultar status do cache');
  });
});
