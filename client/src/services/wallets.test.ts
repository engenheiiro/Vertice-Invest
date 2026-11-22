import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { walletsService } from './wallets';
import { authService } from './auth';

/** CRUD de carteiras e link público: rota, verbo, corpo e mensagem de erro. */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

const lastCall = () => {
  const [url, options = {}] = apiSpy.mock.calls.at(-1) ?? ['', {}];
  return { url, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined };
};

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
});

afterEach(() => vi.restoreAllMocks());

describe('walletsService — requisições', () => {
  it.each([
    ['create', () => walletsService.create('Aposentadoria'), { url: '/api/wallets', method: 'POST', body: { name: 'Aposentadoria' } }],
    ['rename', () => walletsService.rename('w1', 'Filhos'), { url: '/api/wallets/w1', method: 'PUT', body: { name: 'Filhos' } }],
    ['remove', () => walletsService.remove('w1'), { url: '/api/wallets/w1', method: 'DELETE', body: undefined }],
    ['setActive', () => walletsService.setActive('w2'), { url: '/api/wallets/active', method: 'PUT', body: { walletId: 'w2' } }],
    [
      'share (rotaciona o token)',
      () => walletsService.share('w1', { regenerate: true, showValues: false }),
      { url: '/api/wallets/w1/share', method: 'POST', body: { regenerate: true, showValues: false } },
    ],
    ['share sem opções', () => walletsService.share('w1'), { url: '/api/wallets/w1/share', method: 'POST', body: {} }],
    ['unshare', () => walletsService.unshare('w1'), { url: '/api/wallets/w1/share', method: 'DELETE', body: undefined }],
  ] as const)('%s', async (_n, call, expected) => {
    apiSpy.mockImplementation(async () => json({ ok: true }));
    await expect(call()).resolves.toEqual({ ok: true });
    expect(lastCall()).toEqual(expected);
  });

  it('list devolve carteiras e a ativa; falha rejeita (a tela não inventa carteira)', async () => {
    const payload = { wallets: [{ id: 'w1', name: 'Principal', isDefault: true, createdAt: '2026-01-01' }], activeWalletId: 'w1' };
    apiSpy.mockImplementationOnce(async () => json(payload));
    await expect(walletsService.list()).resolves.toEqual(payload);
    apiSpy.mockImplementationOnce(async () => json({}, 500));
    await expect(walletsService.list()).rejects.toThrow('Falha ao carregar carteiras');
  });
});

describe('walletsService — erros', () => {
  const CASES = [
    ['create', () => walletsService.create('x'), 'Falha ao criar carteira'],
    ['rename', () => walletsService.rename('w', 'x'), 'Falha ao renomear carteira'],
    ['remove', () => walletsService.remove('w'), 'Falha ao excluir carteira'],
    ['setActive', () => walletsService.setActive('w'), 'Falha ao trocar carteira ativa'],
    ['share', () => walletsService.share('w'), 'Falha ao compartilhar carteira'],
    ['unshare', () => walletsService.unshare('w'), 'Falha ao revogar compartilhamento'],
  ] as const;

  it.each(CASES)('%s propaga a regra do servidor (ex.: limite de carteiras do plano)', async (_n, call) => {
    apiSpy.mockImplementation(async () => json({ message: 'Seu plano permite 1 carteira.' }, 403));
    await expect(call()).rejects.toThrow('Seu plano permite 1 carteira.');
  });

  it.each(CASES)('%s com corpo ilegível cai na mensagem padrão', async (_n, call, fallback) => {
    apiSpy.mockImplementation(async () => new Response('gateway', { status: 502 }));
    await expect(call()).rejects.toThrow(fallback);
  });
});
