/**
 * POST /subscription/sync-payment com o id de uma mensalidade da PRÓPRIA
 * assinatura. A rota tratava todo pagamento como avulso: grantOneTimePeriod
 * somava 30 dias por cima do calendário do MP e cancelava a assinatura
 * (stopRecurringAfterOneTime). Agora ela usa o mesmo desvio do webhook.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

// Relógio fixo: quarta-feira 18/11/2026, 14h de Brasília (dia útil, pregão aberto).
const AGORA = new Date('2026-11-18T14:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { create: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/UsageLog.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({ paymentService: { getPaymentStatus: vi.fn(), getPreapproval: vi.fn() } }));
vi.mock('../services/emailService.js', () => ({
  sendSubscriptionCanceledEmail: vi.fn(),
  sendCheckoutConfirmationEmail: vi.fn(),
  sendSubscriptionCreatedEmail: vi.fn(),
  sendRenewalReceiptEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
}));
vi.mock('../services/subscriptionService.js', () => ({
  grantOneTimePeriod: vi.fn(),
  syncRecurringPeriod: vi.fn(),
  recordRecurringCharge: vi.fn(),
  markPaymentFailed: vi.fn(),
  markSubscriptionCanceled: vi.fn(),
  resolvePlanKey: vi.fn((k) => k),
  parseExternalReference: (ref) => {
    const [userId, planKey] = String(ref || '').split(':');
    return { userId: userId || null, planKey: planKey || null };
  },
}));

const User = (await import('../models/User.js')).default;
const { paymentService } = await import('../services/paymentService.js');
const svc = await import('../services/subscriptionService.js');
const { syncPayment } = await import('../controllers/subscriptionController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const run = async () => {
  const res = mockRes();
  const next = vi.fn();
  await syncPayment({ body: { paymentId: '987' }, user: { id: 'u1' } }, res, next);
  return { res, next };
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.recordRecurringCharge.mockResolvedValue(true);
  svc.syncRecurringPeriod.mockResolvedValue({ synced: true });
  svc.grantOneTimePeriod.mockResolvedValue({ credited: true, plan: 'PRO', validUntil: new Date() });
  paymentService.getPreapproval.mockResolvedValue({ id: 'pre-1', status: 'authorized' });
});

describe('syncPayment — cobrança de assinatura', () => {
  it('pagamento com preapproval vai pelo caminho recorrente (nada de crédito avulso)', async () => {
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', external_reference: 'u1:PRO', transaction_amount: 49.9,
      payment_type_id: 'credit_card', metadata: { preapproval_id: 'pre-1' },
    });
    User.findById.mockResolvedValue({ _id: 'u1', plan: 'PRO', subscriptionType: 'RECURRING', mpPreapprovalId: 'pre-1' });

    const { res } = await run();

    expect(res.body.success).toBe(true);
    expect(svc.grantOneTimePeriod).not.toHaveBeenCalled();
    expect(svc.recordRecurringCharge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ gatewayId: '987' }));
    expect(paymentService.getPreapproval).toHaveBeenCalledWith('pre-1');
    expect(svc.syncRecurringPeriod).toHaveBeenCalled();
  });

  it('assinante RECURRING ativo sem metadata: também é cobrança da assinatura', async () => {
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', external_reference: 'u1:PRO', payment_type_id: 'credit_card',
    });
    User.findById.mockResolvedValue({ _id: 'u1', plan: 'PRO', subscriptionType: 'RECURRING', subscriptionStatus: 'ACTIVE', mpPreapprovalId: 'pre-1' });

    await run();

    expect(svc.grantOneTimePeriod).not.toHaveBeenCalled();
    expect(svc.syncRecurringPeriod).toHaveBeenCalled();
  });

  it('Pix avulso continua creditando o período avulso', async () => {
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', external_reference: 'u1:PRO', payment_type_id: 'bank_transfer', transaction_amount: 49.9,
    });
    User.findById.mockResolvedValue({ _id: 'u1', plan: 'GUEST', subscriptionType: 'RECURRING', mpPreapprovalId: 'pre-old' });

    const { res } = await run();

    expect(svc.grantOneTimePeriod).toHaveBeenCalledWith(expect.anything(), 'PRO', expect.objectContaining({ method: 'PIX' }));
    expect(svc.recordRecurringCharge).not.toHaveBeenCalled();
    expect(res.body.success).toBe(true);
  });

  it('pagamento de outro usuário continua 403', async () => {
    paymentService.getPaymentStatus.mockResolvedValue({ status: 'approved', external_reference: 'u2:PRO' });
    const { res } = await run();
    expect(res.statusCode).toBe(403);
    expect(svc.recordRecurringCharge).not.toHaveBeenCalled();
  });
});
