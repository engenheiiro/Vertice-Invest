/**
 * S1.7 — invalidação de cache no webhook de pagamento.
 * Quando o Mercado Pago aprova um pagamento e o plano do usuário muda, o cache
 * de plano (I6, usado pelo authMiddleware) PRECISA ser limpo na hora — senão o
 * usuário fica com o plano antigo por até PLAN_CACHE_TTL_MS (5 min).
 *
 * Mocka models/serviços e verifica que invalidateUser() é chamado com o id do
 * usuário cujo plano foi atualizado. Também cobre o caminho idempotente (não
 * reprocessa / não invalida duas vezes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test'; // libera webhook sem MP_WEBHOOK_SECRET (não-produção)

vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { findOne: vi.fn(), create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({ paymentService: { getPaymentStatus: vi.fn() } }));
vi.mock('../services/emailService.js', () => ({ sendCheckoutConfirmationEmail: vi.fn().mockResolvedValue() }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const User = (await import('../models/User.js')).default;
const Transaction = (await import('../models/Transaction.js')).default;
const { paymentService } = await import('../services/paymentService.js');
const { invalidateUser } = await import('../utils/userCache.js');
const { handleMercadoPagoWebhook } = await import('../controllers/webhookController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
};

const paymentReq = () => ({
  body: { type: 'payment', data: { id: 'pay-123' } },
  query: {},
  headers: {},
  ip: '127.0.0.1',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webhook MP — invalidação de cache de plano (S1.7)', () => {
  it('pagamento aprovado: atualiza plano e invalida o cache do usuário', async () => {
    Transaction.findOne.mockResolvedValue(null); // ainda não processado
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved',
      transaction_amount: 49.9,
      external_reference: 'user-1:ESSENTIAL',
      payment_type_id: 'bank_transfer',
    });
    const user = { _id: 'user-1', email: 'a@b.com', validUntil: null, save: vi.fn().mockResolvedValue() };
    User.findById.mockResolvedValue(user);

    const res = mockRes();
    await handleMercadoPagoWebhook(paymentReq(), res);

    expect(user.save).toHaveBeenCalledOnce();
    expect(user.plan).toBe('ESSENTIAL');
    // O ponto central: cache derrubado com o id do usuário atualizado.
    expect(invalidateUser).toHaveBeenCalledOnce();
    expect(invalidateUser).toHaveBeenCalledWith('user-1');
    expect(res.statusCode).toBe(200);
  });

  it('pagamento já processado (idempotência): não toca no usuário nem no cache', async () => {
    Transaction.findOne.mockResolvedValue({ _id: 'tx-existente' });

    const res = mockRes();
    await handleMercadoPagoWebhook(paymentReq(), res);

    expect(paymentService.getPaymentStatus).not.toHaveBeenCalled();
    expect(User.findById).not.toHaveBeenCalled();
    expect(invalidateUser).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('pagamento não aprovado: não invalida o cache', async () => {
    Transaction.findOne.mockResolvedValue(null);
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'pending',
      transaction_amount: 49.9,
      external_reference: 'user-1:ESSENTIAL',
    });

    const res = mockRes();
    await handleMercadoPagoWebhook(paymentReq(), res);

    expect(invalidateUser).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
