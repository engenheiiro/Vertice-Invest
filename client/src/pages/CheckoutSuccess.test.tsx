import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  query: 'plan=PRO&payment_id=pay-123&status=approved',
  navigate: vi.fn(),
  refreshProfile: vi.fn(),
  syncPayment: vi.fn(),
  api: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.query)],
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ refreshProfile: mocks.refreshProfile }) }));
vi.mock('../services/subscription', () => ({ subscriptionService: { syncPayment: mocks.syncPayment } }));
vi.mock('../services/auth', () => ({ authService: { api: mocks.api } }));

import { CheckoutSuccess, getCheckoutReturnDetails, isActivationRecorded } from './CheckoutSuccess';

beforeEach(() => {
  mocks.query = 'plan=PRO&payment_id=pay-123&status=approved';
  vi.clearAllMocks();
});

describe('CheckoutSuccess — parâmetros do retorno Mercado Pago', () => {
  it('aceita payment_id e status oficiais do Checkout Pro', () => {
    const details = getCheckoutReturnDetails(new URLSearchParams({
      plan: 'PRO', payment_id: 'pay-123', status: 'approved', collection_status: 'approved',
    }));

    expect(details).toEqual({ paymentId: 'pay-123', status: 'approved', rawPlan: 'PRO', expectedPlan: 'PRO' });
  });

  it('usa collection_id como fallback e converte plano de teste ao plano real esperado', () => {
    const details = getCheckoutReturnDetails(new URLSearchParams({
      plan: 'ELITE_TEST', collection_id: 'pay-456', collection_status: 'pending',
    }));

    expect(details).toEqual({ paymentId: 'pay-456', status: 'pending', rawPlan: 'ELITE_TEST', expectedPlan: 'ELITE' });
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
