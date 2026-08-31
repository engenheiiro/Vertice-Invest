import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  query: 'plan=PRO&payment_id=pay-123&status=approved',
  navigate: vi.fn(),
  refreshProfile: vi.fn(),
  syncPayment: vi.fn(),
  syncPreapproval: vi.fn(),
  api: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.query)],
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ refreshProfile: mocks.refreshProfile }) }));
vi.mock('../services/subscription', () => ({
  subscriptionService: { syncPayment: mocks.syncPayment, syncPreapproval: mocks.syncPreapproval },
}));
vi.mock('../services/auth', () => ({ authService: { api: mocks.api } }));
vi.mock('../utils/analytics', () => ({ trackEvent: mocks.trackEvent }));

import { CheckoutSuccess } from './CheckoutSuccess';
import { getCheckoutReturnDetails, isActivationRecorded, isSubscriptionActivated } from '../utils/checkoutStatus';

beforeEach(() => {
  mocks.query = 'plan=PRO&payment_id=pay-123&status=approved';
  vi.clearAllMocks();
});

describe('CheckoutSuccess — parâmetros do retorno Mercado Pago', () => {
  it('aceita payment_id e status oficiais do Checkout Pro', () => {
    const details = getCheckoutReturnDetails(new URLSearchParams({
      plan: 'PRO', payment_id: 'pay-123', status: 'approved', collection_status: 'approved',
    }));

    expect(details).toEqual({ paymentId: 'pay-123', preapprovalId: null, status: 'approved', rawPlan: 'PRO', expectedPlan: 'PRO' });
  });

  it('reduz a chave anual ao plano creditado — senão a tela trava em "processando"', () => {
    // O servidor credita PRO por uma compra de PRO_ANNUAL. Comparar a chave de
    // checkout com o plano creditado nunca daria bate, e a confirmação ficaria
    // girando até o timeout mesmo com o pagamento aprovado.
    for (const chave of ['PRO_ANNUAL', 'PRO_ANNUAL_TEST', 'PRO_TEST']) {
      const details = getCheckoutReturnDetails(new URLSearchParams({
        plan: chave, payment_id: 'pay-123', status: 'approved',
      }));
      expect(details.expectedPlan, `${chave} deveria virar PRO`).toBe('PRO');
      expect(details.rawPlan).toBe(chave);
    }
  });

  it('usa collection_id como fallback e converte plano de teste ao plano real esperado', () => {
    const details = getCheckoutReturnDetails(new URLSearchParams({
      plan: 'ELITE_TEST', collection_id: 'pay-456', collection_status: 'pending',
    }));

    expect(details).toEqual({ paymentId: 'pay-456', preapprovalId: null, status: 'pending', rawPlan: 'ELITE_TEST', expectedPlan: 'ELITE' });
  });

  it('lê preapproval_id no retorno da assinatura recorrente (não há payment_id)', () => {
    const details = getCheckoutReturnDetails(new URLSearchParams({
      plan: 'PRO', preapproval_id: 'preapp-1', mode: 'recurring', return_status: 'success',
    }));

    expect(details).toEqual({
      paymentId: null, preapprovalId: 'preapp-1', status: 'success', rawPlan: 'PRO', expectedPlan: 'PRO',
    });
  });

  it('só considera ativado quando a Transaction persistida corresponde ao mesmo pagamento e plano', () => {
    const matching = {
      current: { plan: 'PRO' },
      lastPayment: { gatewayId: 'pay-123', status: 'PAID', plan: 'PRO' },
    };

    expect(isActivationRecorded(matching, 'pay-123', 'PRO')).toBe(true);
    expect(isActivationRecorded({ ...matching, lastPayment: { ...matching.lastPayment, gatewayId: 'outro' } }, 'pay-123', 'PRO')).toBe(false);
    expect(isActivationRecorded({ ...matching, current: { plan: 'ELITE' } }, 'pay-123', 'PRO')).toBe(false);
  });

  it('só exibe ativação após encontrar a Transaction persistida do mesmo payment_id', async () => {
    mocks.syncPayment.mockResolvedValue({ success: true, plan: 'PRO' });
    mocks.api.mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { plan: 'PRO' },
        lastPayment: { gatewayId: 'pay-123', status: 'PAID', plan: 'PRO' },
      }),
    });

    render(<CheckoutSuccess />);

    await waitFor(() => expect(screen.getByText('Pagamento confirmado!')).toBeInTheDocument());
    expect(mocks.syncPayment).toHaveBeenCalledWith('pay-123');
    expect(mocks.refreshProfile).toHaveBeenCalledOnce();
  });
});

describe('CheckoutSuccess — fluxo de assinatura recorrente', () => {
  it('confirma pela assinatura ativa, não por uma Transaction', () => {
    // A autorização do cartão acontece ANTES da primeira cobrança ser liquidada.
    // Exigir uma Transaction aqui deixaria a tela presa em "processando".
    const active = { current: { plan: 'PRO', subscriptionType: 'RECURRING', subscriptionStatus: 'ACTIVE' } };

    expect(isSubscriptionActivated(active, 'PRO')).toBe(true);
    expect(isSubscriptionActivated(active, 'ELITE')).toBe(false);
    expect(isSubscriptionActivated({ current: { ...active.current, subscriptionStatus: 'PAST_DUE' } }, 'PRO')).toBe(false);
    expect(isSubscriptionActivated({ current: { ...active.current, subscriptionType: 'ONE_TIME' } }, 'PRO')).toBe(false);
  });

  it('sincroniza pelo preapproval e ativa sem exigir payment_id', async () => {
    mocks.query = 'plan=PRO&preapproval_id=preapp-1&mode=recurring&return_status=success';
    mocks.syncPreapproval.mockResolvedValue({ success: true, plan: 'PRO' });
    mocks.api.mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { plan: 'PRO', subscriptionType: 'RECURRING', subscriptionStatus: 'ACTIVE' },
        lastPayment: null,
      }),
    });

    render(<CheckoutSuccess />);

    await waitFor(() => expect(screen.getByText('Pagamento confirmado!')).toBeInTheDocument());
    expect(mocks.syncPreapproval).toHaveBeenCalledWith('preapp-1');
    expect(mocks.syncPayment).not.toHaveBeenCalled();
    expect(screen.getByText('Mensal automática')).toBeInTheDocument();
  });
});

describe('CheckoutSuccess — evento de conversão', () => {
  const ativacaoAprovada = () => {
    mocks.syncPayment.mockResolvedValue({ success: true, status: 'approved' });
    mocks.api.mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { plan: 'PRO', subscriptionType: 'ONE_TIME', subscriptionStatus: 'ACTIVE' },
        lastPayment: { gatewayId: 'pay-123', plan: 'PRO', status: 'PAID' },
      }),
    });
  };

  it('manda o valor da compra, não só a contagem', async () => {
    // Sem `value`, o GA registra a conversão com receita zero e não dá para
    // comparar canal por retorno — só por volume, que é o número enganoso.
    mocks.query = 'plan=PRO&payment_id=pay-123&status=approved';
    ativacaoAprovada();

    render(<CheckoutSuccess />);

    await waitFor(() => expect(mocks.trackEvent).toHaveBeenCalledWith('purchase', expect.objectContaining({
      value: 69.9,
      currency: 'BRL',
      billing_cycle: 'MONTHLY',
    })));
  });

  it('no anual, o valor é o do ano — não o da parcela', async () => {
    mocks.query = 'plan=PRO_ANNUAL&payment_id=pay-123&status=approved';
    ativacaoAprovada();

    render(<CheckoutSuccess />);

    await waitFor(() => expect(mocks.trackEvent).toHaveBeenCalledWith('purchase', expect.objectContaining({
      value: 598.8,
      billing_cycle: 'ANNUAL',
    })));
  });

  it('não conta a compra de teste do admin como venda', async () => {
    // A variante _TEST custa R$ 0,50 e existe para verificar o checkout.
    // Reportá-la como conversão misturaria nosso teste com a receita medida.
    mocks.query = 'plan=PRO_TEST&payment_id=pay-123&status=approved';
    ativacaoAprovada();

    render(<CheckoutSuccess />);

    await waitFor(() => expect(screen.getByText('Pagamento confirmado!')).toBeInTheDocument());
    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });
});
