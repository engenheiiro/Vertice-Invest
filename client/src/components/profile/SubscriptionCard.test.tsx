import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SubscriptionCard } from './SubscriptionCard';
import { useAuth } from '../../contexts/AuthContext';
import { subscriptionService } from '../../services/subscription';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../services/subscription', () => ({
  subscriptionService: { cancelSubscription: vi.fn() },
}));

const refreshProfile = vi.fn();
const mockAuth = (user: Record<string, unknown> | null) =>
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ user, refreshProfile });

const renderCard = () => render(
  <MemoryRouter initialEntries={['/profile']}>
    <Routes>
      <Route path="/profile" element={<SubscriptionCard />} />
      <Route path="/pricing" element={<p>Pricing page</p>} />
    </Routes>
  </MemoryRouter>
);

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

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
    mockAuth({
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
      subscriptionType: 'ONE_TIME',
      validUntil: inDays(2),
      paymentMethod: 'PIX',
    });
    renderCard();

    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText(/expira em 2 dias/i)).toBeInTheDocument();
    expect(screen.getByText(/pix · mercado pago/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gerenciar/i })).toBeInTheDocument();
  });

  it('convida quem paga avulso a migrar para renovação automática antes de vencer', () => {
    mockAuth({
      plan: 'PRO', subscriptionStatus: 'ACTIVE', subscriptionType: 'ONE_TIME',
      validUntil: inDays(3), paymentMethod: 'PIX',
    });
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /ativar renovação automática/i }));
    expect(screen.getByText('Pricing page')).toBeInTheDocument();
  });

  it('não oferece upgrade ao assinante Black', () => {
    mockAuth({ plan: 'BLACK', subscriptionStatus: 'ACTIVE', paymentMethod: 'CRYPTO' });
    renderCard();

    expect(screen.getByText('Vértice Black')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upgrade|gerenciar/i })).not.toBeInTheDocument();
  });
});

describe('SubscriptionCard — assinatura recorrente', () => {
  const recurringUser = {
    plan: 'PRO',
    subscriptionStatus: 'ACTIVE',
    subscriptionType: 'RECURRING',
    validUntil: inDays(2),
    nextBillingDate: inDays(2),
    cardBrand: 'master',
  };

  it('mostra renovação automática e NÃO alarma com contagem regressiva', () => {
    // Faltam 2 dias, mas a assinatura renova sozinha — exibir "expira em 2 dias"
    // aqui assustaria um assinante adimplente sem nenhum motivo.
    mockAuth(recurringUser);
    renderCard();

    expect(screen.getByText(/renovação automática/i)).toBeInTheDocument();
    expect(screen.getByText(/próxima cobrança/i)).toBeInTheDocument();
    expect(screen.queryByText(/expira em/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cartão de crédito \(master\) · assinatura/i)).toBeInTheDocument();
  });

  it('cancela mantendo o acesso até o fim do período pago', async () => {
    const validUntil = inDays(12);
    mockAuth({ ...recurringUser, validUntil, nextBillingDate: validUntil });
    (subscriptionService.cancelSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, validUntil });
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));
    // O modal deixa explícito que cancelar não é perder o acesso imediatamente.
    expect(screen.getByText(/o período já pago é seu/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sim, cancelar/i }));
    await waitFor(() => expect(subscriptionService.cancelSubscription).toHaveBeenCalledOnce());
    expect(refreshProfile).toHaveBeenCalledOnce();
  });

  it('alerta sobre cobrança recusada sem esconder o plano', () => {
    mockAuth({ ...recurringUser, subscriptionStatus: 'PAST_DUE' });
    renderCard();

    expect(screen.getByText(/não conseguimos renovar sua assinatura/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /atualizar pagamento/i })).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('assinatura já cancelada não oferece cancelar de novo', () => {
    mockAuth({ ...recurringUser, subscriptionStatus: 'CANCELED' });
    renderCard();

    expect(screen.queryByRole('button', { name: /^cancelar$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
  });
});
