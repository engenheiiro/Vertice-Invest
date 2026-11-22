import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscriptionService } from './subscription';
import { authService } from './auth';

/**
 * Assinatura: o modo de cobrança e o ciclo vão no corpo (o anual é outro fluxo
 * do Mercado Pago), falha de checkout/sincronização nunca resolve como sucesso
 * e a sondagem de status degrada para null.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

const lastCall = () => {
  const [url, options = {}] = apiSpy.mock.calls.at(-1) ?? ['', {}];
  return { url, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined };
};

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
  apiSpy.mockImplementation(async () => json({ init_point: 'https://mp/checkout' }));
});

afterEach(() => vi.restoreAllMocks());

describe('subscriptionService — corpo das requisições', () => {
  it.each([
    ['checkout avulso por padrão', () => subscriptionService.initCheckout('PRO'), {
      url: '/api/subscription/checkout', body: { planId: 'PRO', mode: 'ONE_TIME' },
    }],
    ['checkout recorrente', () => subscriptionService.initCheckout('ELITE', 'RECURRING'), {
      url: '/api/subscription/checkout', body: { planId: 'ELITE', mode: 'RECURRING' },
    }],
    ['sync de pagamento avulso', () => subscriptionService.syncPayment('pay-1'), {
      url: '/api/subscription/sync-payment', body: { paymentId: 'pay-1' },
    }],
    ['sync de preapproval', () => subscriptionService.syncPreapproval('pre-1'), {
      url: '/api/subscription/sync-preapproval', body: { preapprovalId: 'pre-1' },
    }],
    ['troca de plano', () => subscriptionService.changePlan('BLACK'), {
      url: '/api/subscription/change-plan', body: { planId: 'BLACK' },
    }],
    ['checkout de teste mensal por padrão', () => subscriptionService.testCheckout('PRO'), {
      url: '/api/subscription/test-checkout', body: { planKey: 'PRO', mode: 'ONE_TIME', cycle: 'MONTHLY' },
    }],
    ['checkout de teste anual', () => subscriptionService.testCheckout('PRO', 'RECURRING', 'ANNUAL'), {
      url: '/api/subscription/test-checkout', body: { planKey: 'PRO', mode: 'RECURRING', cycle: 'ANNUAL' },
    }],
  ] as const)('%s', async (_n, call, expected) => {
    await expect(call()).resolves.toEqual({ init_point: 'https://mp/checkout' });
    expect(lastCall()).toEqual({ ...expected, method: 'POST' });
  });

  it('cancelamento é POST sem corpo', async () => {
    await subscriptionService.cancelSubscription();
    expect(lastCall()).toEqual({ url: '/api/subscription/cancel', method: 'POST', body: undefined });
  });
});

describe('subscriptionService — erros', () => {
  it.each([
    ['initCheckout', () => subscriptionService.initCheckout('PRO'), 'Erro ao iniciar checkout'],
    ['syncPayment', () => subscriptionService.syncPayment('p'), 'Não foi possível verificar o pagamento.'],
    ['syncPreapproval', () => subscriptionService.syncPreapproval('p'), 'Não foi possível verificar a assinatura.'],
    ['testCheckout', () => subscriptionService.testCheckout('PRO'), 'Erro ao iniciar checkout de teste'],
    ['cancelSubscription', () => subscriptionService.cancelSubscription(), 'Não foi possível cancelar a assinatura.'],
    ['changePlan', () => subscriptionService.changePlan('PRO'), 'Não foi possível trocar de plano.'],
  ] as const)('%s nunca resolve como sucesso numa resposta não-ok', async (_n, call, message) => {
    apiSpy.mockImplementation(async () => new Response('gateway', { status: 502 }));
    await expect(call()).rejects.toThrow(message);
  });

  it.each([
    ['cancelSubscription', () => subscriptionService.cancelSubscription()],
    ['changePlan', () => subscriptionService.changePlan('PRO')],
  ] as const)('%s mostra a regra do servidor quando ela vem', async (_n, call) => {
    apiSpy.mockImplementation(async () => json({ message: 'Assinatura já cancelada.' }, 409));
    await expect(call()).rejects.toThrow('Assinatura já cancelada.');
  });

  it('getStatus degrada para null (não derruba o cabeçalho)', async () => {
    apiSpy.mockImplementationOnce(async () => json({}, 500));
    await expect(subscriptionService.getStatus()).resolves.toBeNull();
    apiSpy.mockImplementationOnce(async () => json({ plan: 'PRO' }));
    await expect(subscriptionService.getStatus()).resolves.toEqual({ plan: 'PRO' });
  });
});
