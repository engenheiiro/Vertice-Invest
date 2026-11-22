import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publicWalletService, publicWalletQueryOptions } from './publicWallet';

/**
 * Carteira pública: rota sem token (fetch cru), token codificado na URL, 404
 * vira NOT_FOUND (link revogado — sem retry) e as seções secundárias degradam
 * para o fallback declarado.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('publicWalletService', () => {
  it('busca sem Authorization e com o token codificado no caminho', async () => {
    fetchMock.mockImplementation(async () => json({ showValues: false }));

    await expect(publicWalletService.getWallet('a/b c')).resolves.toEqual({ showValues: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/public/wallet/a%2Fb%20c');
    expect(init).toBeUndefined();
  });

  it('link revogado (404) é NOT_FOUND em qualquer seção, inclusive as que têm fallback', async () => {
    fetchMock.mockImplementation(async () => json({}, 404));
    await expect(publicWalletService.getWallet('t')).rejects.toThrow('NOT_FOUND');
    await expect(publicWalletService.getHistory('t')).rejects.toThrow('NOT_FOUND');
  });

  it('seções secundárias degradam para o fallback; a carteira e o extrato rejeitam', async () => {
    fetchMock.mockImplementation(async () => json({}, 500));
    await expect(publicWalletService.getHistory('t')).resolves.toEqual([]);
    await expect(publicWalletService.getPerformance('t')).resolves.toEqual([]);
    await expect(publicWalletService.getDividends('t')).resolves.toBeNull();
    await expect(publicWalletService.getWallet('t')).rejects.toThrow('Falha ao carregar carteira pública');
    await expect(publicWalletService.getCashFlow('t')).rejects.toThrow('Falha ao carregar carteira pública');
  });

  it('extrato monta paginação e filtro (padrões 1/15/ALL)', async () => {
    fetchMock.mockImplementation(async () => json({ items: [] }));
    await publicWalletService.getCashFlow('tok');
    await publicWalletService.getCashFlow('tok', 3, 50, 'BUY&SELL');
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      '/api/public/wallet/tok/cashflow?page=1&limit=15&filterType=ALL',
      '/api/public/wallet/tok/cashflow?page=3&limit=50&filterType=BUY%26SELL',
    ]);
  });
});

describe('publicWalletQueryOptions', () => {
  it('provider e página compartilham a mesma chave (uma ida ao servidor)', () => {
    expect(publicWalletQueryOptions('tok').queryKey).toEqual(['publicWallet', 'tok']);
  });

  it('não repete link inexistente; outras falhas tentam até 2 vezes', () => {
    const { retry } = publicWalletQueryOptions('tok');
    expect(retry(0, new Error('NOT_FOUND'))).toBe(false);
    expect(retry(0, new Error('Falha'))).toBe(true);
    expect(retry(1, new Error('Falha'))).toBe(true);
    expect(retry(2, new Error('Falha'))).toBe(false);
  });

  it('queryFn busca a carteira do token', async () => {
    fetchMock.mockImplementation(async () => json({ wallet: { name: 'X' } }));
    await expect(publicWalletQueryOptions('tok').queryFn()).resolves.toEqual({ wallet: { name: 'X' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/public/wallet/tok');
  });
});
