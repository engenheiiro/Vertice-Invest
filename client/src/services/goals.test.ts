import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { goalsService } from './goals';
import { authService } from './auth';

/** Metas: escopo de carteira, verbos/corpos e o contrato de erro. */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

const lastCall = () => {
  const [url, options = {}] = apiSpy.mock.calls.at(-1) ?? ['', {}];
  return { url, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined };
};

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
  apiSpy.mockImplementation(async () => json({ ok: true }));
});

afterEach(() => vi.restoreAllMocks());

describe('goalsService — requisições', () => {
  it.each([
    ['getGoals', () => goalsService.getGoals('w 1'), { url: '/api/goals?walletId=w%201', method: 'GET', body: undefined }],
    ['getGoals sem carteira', () => goalsService.getGoals(), { url: '/api/goals', method: 'GET', body: undefined }],
    ['getRateSuggestion', () => goalsService.getRateSuggestion('w1'), { url: '/api/goals/rate-suggestion?walletId=w1', method: 'GET', body: undefined }],
    ['getGoal', () => goalsService.getGoal('g1'), { url: '/api/goals/g1', method: 'GET', body: undefined }],
    ['renameJourney', () => goalsService.renameJourney('g1', 'Casa', 'w1'), {
      url: '/api/goals/g1/journey?walletId=w1', method: 'PUT', body: { name: 'Casa' },
    }],
    ['createGoal', () => goalsService.createGoal({ name: 'Casa', targetAmount: 500000, mirrorWallet: true }), {
      url: '/api/goals', method: 'POST', body: { name: 'Casa', targetAmount: 500000, mirrorWallet: true },
    }],
    ['updateGoal (arquivar)', () => goalsService.updateGoal('g1', { status: 'ARCHIVED' }, 'w1'), {
      url: '/api/goals/g1?walletId=w1', method: 'PUT', body: { status: 'ARCHIVED' },
    }],
    ['clearAllGoals', () => goalsService.clearAllGoals('w1'), { url: '/api/goals?walletId=w1', method: 'DELETE', body: undefined }],
    ['addContribution', () => goalsService.addContribution('g1', { amount: 1500, date: '2026-11-01', note: '13º' }), {
      url: '/api/goals/g1/contributions', method: 'POST', body: { amount: 1500, date: '2026-11-01', note: '13º' },
    }],
    ['deleteContribution', () => goalsService.deleteContribution('g1', 'c9', 'w1'), {
      url: '/api/goals/g1/contributions/c9?walletId=w1', method: 'DELETE', body: undefined,
    }],
  ] as const)('%s', async (_n, call, expected) => {
    await expect(call()).resolves.toEqual({ ok: true });
    expect(lastCall()).toEqual(expected);
  });

  it('deleteGoal resolve sem corpo', async () => {
    apiSpy.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(goalsService.deleteGoal('g1', 'w1')).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: '/api/goals/g1?walletId=w1', method: 'DELETE', body: undefined });
  });
});

describe('goalsService — erros', () => {
  it.each([
    ['getGoals', () => goalsService.getGoals(), 'Falha ao carregar metas'],
    ['getRateSuggestion', () => goalsService.getRateSuggestion(), 'Falha ao carregar taxa sugerida'],
    ['getGoal', () => goalsService.getGoal('g'), 'Falha ao carregar meta'],
    ['deleteGoal', () => goalsService.deleteGoal('g'), 'Falha ao remover meta'],
    ['clearAllGoals', () => goalsService.clearAllGoals(), 'Falha ao limpar metas'],
    ['deleteContribution', () => goalsService.deleteContribution('g', 'c'), 'Falha ao remover aporte'],
  ] as const)('%s rejeita com mensagem fixa (nunca devolve o corpo de erro como dado)', async (_n, call, message) => {
    apiSpy.mockImplementation(async () => json({ message: 'detalhe interno' }, 500));
    await expect(call()).rejects.toThrow(message);
  });

  const WRITES = [
    ['renameJourney', () => goalsService.renameJourney('g', 'x'), 'Falha ao renomear jornada'],
    ['createGoal', () => goalsService.createGoal({ name: 'x', targetAmount: 1 }), 'Falha ao criar meta'],
    ['updateGoal', () => goalsService.updateGoal('g', {}), 'Falha ao atualizar meta'],
    ['addContribution', () => goalsService.addContribution('g', { amount: 1 }), 'Falha ao registrar aporte'],
  ] as const;

  it.each(WRITES)('%s propaga a validação do servidor', async (_n, call) => {
    apiSpy.mockImplementation(async () => json({ message: 'Valor-alvo deve ser positivo' }, 400));
    await expect(call()).rejects.toThrow('Valor-alvo deve ser positivo');
  });

  it.each(WRITES)('%s com corpo ilegível usa a mensagem padrão', async (_n, call, fallback) => {
    apiSpy.mockImplementation(async () => new Response('x', { status: 502 }));
    await expect(call()).rejects.toThrow(fallback);
  });
});
