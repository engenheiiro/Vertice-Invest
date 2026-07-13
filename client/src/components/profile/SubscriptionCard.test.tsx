import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SubscriptionCard } from './SubscriptionCard';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

const mockAuth = (user: Record<string, unknown> | null) =>
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ user });

const renderCard = () => render(
  <MemoryRouter initialEntries={['/profile']}>
    <Routes>
      <Route path="/profile" element={<SubscriptionCard />} />
      <Route path="/pricing" element={<p>Pricing page</p>} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => vi.clearAllMocks());

describe('SubscriptionCard', () => {
  it('mostra o estado gratuito e leva o visitante para upgrade', () => {
    mockAuth(null);
    renderCard();

    expect(screen.getByText('Plano Gratuito')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fazer upgrade/i }));
    expect(screen.getByText('Pricing page')).toBeInTheDocument();
  });

  it('exibe renovação urgente e método PIX para plano pago próximo do vencimento', () => {
    const validUntil = new Date(Date.now() + 2 * 86_400_000).toISOString();
    mockAuth({
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
      validUntil,
      paymentMethod: 'PIX',
    });
    renderCard();

    expect(screen.getByText('Vértice Pro')).toBeInTheDocument();
    expect(screen.getByText(/expira em 2 dias/i)).toBeInTheDocument();
    expect(screen.getByText(/pix · mercado pago/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gerenciar/i })).toBeInTheDocument();
  });

  it('não oferece upgrade ao assinante Black', () => {
    mockAuth({ plan: 'BLACK', subscriptionStatus: 'ACTIVE', paymentMethod: 'CRYPTO' });
    renderCard();

    expect(screen.getByText('Vértice Black')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upgrade|gerenciar/i })).not.toBeInTheDocument();
  });
});
